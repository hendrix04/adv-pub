import { definitionsVersion, questionKindSchema, type QuestionKind } from "./questions.js";
import { z } from "zod";
import { sha256 } from "./integrity.js";
const probability = z.number().finite().min(0).max(1);
export const decisionAnswerSchema = z.union([
  z.object({ type: z.literal("noul"), noul: probability }).strict(),
  z
    .object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: probability,
      probabilities: z.record(z.string(), probability),
    })
    .strict(),
]);
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>;
const ruleSchema = z
  .object({
    yes_threshold: probability,
    no_threshold: probability,
    choice_threshold: probability,
    require_repeat: z.boolean(),
  })
  .strict();
export const questionPolicySchema = z
  .object({
    contract_version: z.literal("decision-policy-v2"),
    definitions_version: z.literal(definitionsVersion),
    version: z.string().min(1),
    mode: z.enum(["exploratory", "supported"]),
    probability_sum_tolerance: probability,
    confidence_tolerance: probability,
    calibration_evidence_hashes: z.array(z.string()),
    rules: z.partialRecord(questionKindSchema, ruleSchema),
  })
  .strict();
export type QuestionPolicy = z.infer<typeof questionPolicySchema>;
export const actionSchema = z.object({
  status: z.enum(["provisional", "supported", "rejected", "unresolved"]),
  label: z.string().nullable(),
  policy_version: z.string(),
  policy_sha256: z.string(),
  findings: z.array(z.string()),
});
export type Action = z.infer<typeof actionSchema>;
export function applyDecisionPolicy(answer: DecisionAnswer, kind: QuestionKind, policy: QuestionPolicy, repeat?: DecisionAnswer): Action {
  questionPolicySchema.parse(policy);
  const rule = policy.rules[kind];
  const action: Action = {
    status: "unresolved",
    label: null,
    policy_version: policy.version,
    policy_sha256: sha256(JSON.stringify(policy)),
    findings: [],
  };
  if (!rule) {
    action.findings.push("No policy for question kind");
    return action;
  }
  if (rule.no_threshold > rule.yes_threshold) throw new Error("Noul thresholds must leave an unresolved boundary");
  if (policy.mode === "supported" && !policy.calibration_evidence_hashes.length) {
    action.findings.push("Supported policy lacks source-review calibration evidence");
    return action;
  }
  const label = (value: DecisionAnswer): string | null => {
    if (value.type === "noul") return value.noul > rule.yes_threshold ? "yes" : value.noul < rule.no_threshold ? "no" : null;
    const probabilities = Object.values(value.probabilities);
    const maximum = Math.max(...probabilities);
    if (probabilities.filter((p) => p === maximum).length !== 1 || value.probabilities[value.choice] !== maximum || maximum < rule.choice_threshold || value.choice === "unclear")
      return null;
    return value.choice;
  };
  action.label = label(answer);
  if (!action.label) {
    action.findings.push("Tie, unclear answer or insufficient probability");
    return action;
  }
  if (rule.require_repeat && (!repeat || label(repeat) !== action.label || repeat.type !== answer.type)) {
    action.findings.push(repeat ? "Fresh repeat disagrees" : "Fresh repeat required");
    return action;
  }
  action.status = policy.mode === "exploratory" ? "provisional" : action.label === "no" || action.label === "different_entities" ? "rejected" : "supported";
  return action;
}
/** Agreement is diagnostic; accuracy requires independently reviewed source cases. */
export function decisionDiagnostics(
  cases: Array<{
    id: string;
    action: Action;
    repeatAction?: Action;
    structureLabel?: string;
    sourceReview?: {
      expected: string;
      evidenceHashes: string[];
    };
  }>,
) {
  const repeats = cases.filter((entry) => entry.repeatAction);
  const clues = cases.filter((entry) => entry.structureLabel !== undefined);
  const reviewed = cases.filter((entry) => entry.sourceReview?.evidenceHashes.length);
  return {
    repeat_agreement: {
      available: repeats.length,
      agreeing: repeats.filter((entry) => entry.action.label === entry.repeatAction!.label && entry.action.status === entry.repeatAction!.status).length,
    },
    structure_agreement: {
      available: clues.length,
      unavailable: cases.length - clues.length,
      agreeing: clues.filter((entry) => entry.action.label === entry.structureLabel).length,
    },
    source_review: {
      available: reviewed.length,
      errors: reviewed.filter((entry) => entry.action.label !== entry.sourceReview!.expected).map((entry) => entry.id),
    },
    unresolved: cases.filter((entry) => entry.action.status === "unresolved").map((entry) => entry.id),
  };
}
