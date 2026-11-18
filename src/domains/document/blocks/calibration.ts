import { definitionsVersion } from "../decisions/questions.js";
import { questionPolicySchema, type DecisionAnswer, type QuestionPolicy } from "../decisions/policy.js";
import type { QuestionKind } from "../decisions/questions.js";
import { sha256 } from "../decisions/integrity.js";

export type ReviewedStructureCase = { question_id: string; question_kind: QuestionKind; expected: string };
export type CalibrationObservation = {
  question_id: string;
  question_kind: QuestionKind;
  primary: DecisionAnswer;
  repeat: DecisionAnswer;
};
export type CalibrationFamily = {
  reviewed_cases: number;
  expected_labels: Record<string, number>;
  threshold_available: boolean;
  rule?: { yes_threshold: number; no_threshold: number; choice_threshold: number; require_repeat: true };
  unresolved_calibration_cases: string[];
  findings: string[];
};
export type StructureCalibration = {
  policy: QuestionPolicy;
  families: Partial<Record<QuestionKind, CalibrationFamily>>;
  evidence_hashes: string[];
};

const epsilon = 1e-6;
const binaryKinds: QuestionKind[] = ["title", "listIntroduction", "mapLabels"];
const structureKinds: QuestionKind[] = [...binaryKinds, "linkPlacement"];

function answerLabel(answer: DecisionAnswer, yes: number, no: number): string | null {
  if (answer.type !== "noul") return null;
  return answer.noul > yes ? "yes" : answer.noul < no ? "no" : null;
}

function candidates(values: number[]): number[] {
  const points = new Set([0, 1]);
  for (const value of values) {
    points.add(value);
    points.add(Math.max(0, value - epsilon));
    points.add(Math.min(1, value + epsilon));
  }
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) points.add((sorted[index - 1]! + sorted[index]!) / 2);
  return [...points].sort((a, b) => a - b);
}

function calibrateBinary(cases: ReviewedStructureCase[], observations: CalibrationObservation[]): CalibrationFamily {
  const scores: Array<{ id: string; expected: string; value: number }> = [];
  const findings: string[] = [];
  for (const entry of observations) {
    if (entry.primary.type !== "noul" || entry.repeat.type !== "noul") {
      findings.push(`${entry.question_id}: expected Noul answers for binary calibration`);
      continue;
    }
    const expected = cases.find((reviewed) => reviewed.question_id === entry.question_id)!.expected;
    scores.push({ id: entry.question_id, expected, value: entry.primary.noul }, { id: entry.question_id, expected, value: entry.repeat.noul });
  }
  const points = candidates(scores.map((entry) => entry.value));
  let selected: { yes: number; no: number; correct: number; width: number } | undefined;
  for (const no of points)
    for (const yes of points) {
      if (no > yes) continue;
      let correct = 0;
      let safe = true;
      for (const entry of scores) {
        const predicted = answerLabel({ type: "noul", noul: entry.value }, yes, no);
        if ((entry.expected === "yes" || entry.expected === "no") && predicted && predicted !== entry.expected) safe = false;
        if (entry.expected !== "yes" && entry.expected !== "no" && predicted) safe = false;
        if (predicted === entry.expected) correct += 1;
      }
      if (!safe) continue;
      const width = yes - no;
      if (!selected || correct > selected.correct || (correct === selected.correct && width > selected.width)) selected = { yes, no, correct, width };
    }
  const unresolved = scores.filter((entry) => answerLabel({ type: "noul", noul: entry.value }, selected?.yes ?? 1, selected?.no ?? 0) !== entry.expected);
  const expectedLabels = Object.fromEntries([...new Set(cases.map((entry) => entry.expected))].map((label) => [label, cases.filter((entry) => entry.expected === label).length]));
  if (!selected || !scores.length) findings.push("No usable source-reviewed Noul calibration examples");
  else if (unresolved.length) findings.push(`${new Set(unresolved.map((entry) => entry.id)).size} reviewed question(s) remain unresolved under the no-false-action thresholds`);
  return {
    reviewed_cases: cases.length,
    expected_labels: expectedLabels,
    threshold_available: Boolean(selected && scores.length),
    ...(selected
      ? {
          rule: {
            yes_threshold: selected.yes,
            no_threshold: selected.no,
            choice_threshold: 1,
            require_repeat: true as const,
          },
        }
      : {}),
    unresolved_calibration_cases: [...new Set(unresolved.map((entry) => entry.id))],
    findings,
  };
}

function calibrateChoice(cases: ReviewedStructureCase[], observations: CalibrationObservation[]): CalibrationFamily {
  const findings: string[] = [];
  const reviewed = new Map(cases.map((entry) => [entry.question_id, entry.expected]));
  const right: number[] = [];
  const wrong: number[] = [];
  for (const entry of observations) {
    for (const answer of [entry.primary, entry.repeat]) {
      if (answer.type !== "choice") {
        findings.push(`${entry.question_id}: expected Choice answers for link-placement calibration`);
        continue;
      }
      const expected = reviewed.get(entry.question_id)!;
      if (answer.choice === expected && expected !== "unclear") right.push(answer.probabilities[answer.choice]!);
      else if (answer.choice !== "unclear") wrong.push(answer.probabilities[answer.choice]!);
    }
  }
  const expectedLabels = Object.fromEntries([...new Set(cases.map((entry) => entry.expected))].map((label) => [label, cases.filter((entry) => entry.expected === label).length]));
  const maxWrong = wrong.length ? Math.max(...wrong) : -Infinity;
  const minRight = right.length ? Math.min(...right) : Infinity;
  const usable = right.length > 0 && maxWrong < minRight;
  if (!right.length) findings.push("No reviewed, non-unclear Choice answers support a link-placement threshold");
  if (right.length && wrong.length && !usable) findings.push("No threshold separates reviewed correct and incorrect Choice actions; link placements remain unresolved");
  const threshold = usable ? (wrong.length ? (maxWrong + minRight) / 2 : Math.max(0, minRight - epsilon)) : undefined;
  return {
    reviewed_cases: cases.length,
    expected_labels: expectedLabels,
    threshold_available: usable,
    ...(threshold === undefined
      ? {}
      : {
          rule: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: threshold, require_repeat: true as const },
        }),
    unresolved_calibration_cases: usable ? [] : cases.map((entry) => entry.question_id),
    findings,
  };
}

export function calibrateStructurePolicy(input: {
  reviewedCases: ReviewedStructureCase[];
  observations: CalibrationObservation[];
  evidenceHashes: string[];
}): StructureCalibration {
  if (!input.evidenceHashes.length) throw new Error("Source-reviewed calibration evidence is required");
  const observed = new Map(input.observations.map((entry) => [entry.question_id, entry]));
  const duplicates = input.observations.map((entry) => entry.question_id).filter((id, index, list) => list.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Duplicate calibration observations: ${[...new Set(duplicates)].join(", ")}`);
  const missing = input.reviewedCases.filter((entry) => !observed.has(entry.question_id)).map((entry) => entry.question_id);
  if (missing.length) throw new Error(`Missing live primary/repeat evidence for reviewed cases: ${missing.join(", ")}`);
  const unexpected = input.observations.filter((entry) => !input.reviewedCases.some((reviewed) => reviewed.question_id === entry.question_id));
  const families: StructureCalibration["families"] = {};
  const rules: QuestionPolicy["rules"] = {};
  for (const kind of structureKinds) {
    const cases = input.reviewedCases.filter((entry) => entry.question_kind === kind);
    if (!cases.length) continue;
    const familyObservations = cases.map((entry) => observed.get(entry.question_id)!);
    const family = (binaryKinds.includes(kind) ? calibrateBinary : calibrateChoice)(cases, familyObservations);
    families[kind] = family;
    if (family.rule) rules[kind] = family.rule;
  }
  const policyVersion = `blocks-supported-${sha256(JSON.stringify({ rules, evidence: input.evidenceHashes })).slice(0, 12)}`;
  const policy = questionPolicySchema.parse({
    contract_version: "decision-policy-v2",
    definitions_version: definitionsVersion,
    version: policyVersion,
    mode: "supported",
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [...new Set(input.evidenceHashes)].sort(),
    rules,
  });
  if (unexpected.length)
    for (const kind of structureKinds) {
      if (unexpected.some((entry) => entry.question_kind === kind)) families[kind]?.findings.push("Additional unreviewed live targets are reported, not used for calibration");
    }
  return { policy, families, evidence_hashes: policy.calibration_evidence_hashes };
}
