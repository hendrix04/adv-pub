import { dirname, join } from "node:path";
import { DecisionsRequest$outboundSchema } from "@openrouter/sdk/models";
import { z } from "zod";
import { readJson } from "../discovery/artifacts.js";
import { applyDecisionPolicy, decisionAnswerSchema, type DecisionAnswer } from "./policy.js";
import {
  classificationAnswerSchema,
  classificationDecisionSchema,
  aliasDecisionSchema,
  aliasOptions,
  jevModel,
  classificationOptions,
  type RetainedDecision,
  type Decision,
  type ClassificationManifest,
  type Manifest,
} from "./contracts.js";

/** Reject duplicate JSON object keys before decoding can silently discard an answer. */
export function parseDecisionWire(text: string): unknown {
  const decoded: unknown = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  const stack: Array<Set<string> | null> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys = stack.at(-1);
      const key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error(`Duplicate or invalid JSON object key: ${key}`);
      keys.add(key);
    }
  }
  return decoded;
}

/** Verify the actual SDK serialization captured at the producing attempt. */
export async function assertRetainedOutbound(request: Manifest["batches"][number]["request"], responsePath: string) {
  const wire = await readJson(join(dirname(responsePath), "outbound-request.json"));
  if (JSON.stringify(wire) !== JSON.stringify(DecisionsRequest$outboundSchema.parse(request))) {
    throw new Error("Retained SDK outbound differs");
  }
}

export function validateDecisionAnswers(
  raw: unknown,
  questions: Record<string, { type: string; criteria?: unknown }>,
  sumTolerance: number,
  confidenceTolerance: number,
): { answers: Array<{ id: string; answer: DecisionAnswer }>; findings: string[] } {
  const findings: string[] = [];
  const envelope = z.object({ model: z.string(), provider: z.string(), answers: z.record(z.string(), z.unknown()) }).safeParse(raw);
  if (!envelope.success) return { answers: [], findings: [envelope.error.message] };
  const data = envelope.data;
  if (data.model !== jevModel && !/^typesafe\/jev-1\.13-\d{8}$/.test(data.model)) findings.push("Unexpected served model");
  if (data.provider.toLowerCase() !== "typesafe") findings.push("Unexpected served provider");
  if (JSON.stringify(Object.keys(data.answers).sort()) !== JSON.stringify(Object.keys(questions).sort())) findings.push("Answer ID set differs from planned questions");
  const answers: Array<{ id: string; answer: DecisionAnswer }> = [];
  for (const [id, question] of Object.entries(questions)) {
    const parsed = decisionAnswerSchema.safeParse(data.answers[id]);
    if (!parsed.success) {
      findings.push(`${id}: ${parsed.error.message}`);
      continue;
    }
    const answer = parsed.data;
    if (answer.type !== question.type) {
      findings.push(`${id}: wrong answer kind`);
      continue;
    }
    if (answer.type === "choice") {
      const choices = Object.keys(question.criteria as Record<string, string>);
      if (!choices.includes(answer.choice) || JSON.stringify(Object.keys(answer.probabilities).sort()) !== JSON.stringify(choices.sort()))
        findings.push(`${id}: wrong Choice options`);
      const values = Object.values(answer.probabilities);
      const total = values.reduce((a, b) => a + b, 0);
      if (Math.abs(total - 1) > sumTolerance) findings.push(`${id}: invalid probability total ${total}`);
      const maximum = Math.max(...values);
      if (answer.probabilities[answer.choice] !== maximum) findings.push(`${id}: choice is not a maximal option`);
      const expected = (maximum - 1 / choices.length) / (1 - 1 / choices.length);
      if (Math.abs(answer.confidence - expected) > confidenceTolerance) findings.push(`${id}: confidence formula mismatch`);
    }
    answers.push({ id, answer });
  }
  return { answers: findings.length ? [] : answers, findings };
}

export function validateBatchResponse(raw: unknown, manifest: Manifest, batchId: string, rawPath: string): { decisions: RetainedDecision[]; findings: string[] } {
  const findings: string[] = [];
  if (manifest.contract_version === "decision-questions-v2") {
    const batch = manifest.batches.find((entry) => entry.batch_id === batchId);
    if (!batch) throw new Error("Unknown batch");
    const checked = validateDecisionAnswers(
      raw,
      batch.request.questions as Parameters<typeof validateDecisionAnswers>[1],
      manifest.policy.probability_sum_tolerance,
      manifest.policy.confidence_tolerance,
    );
    return {
      findings: checked.findings,
      decisions: checked.answers.map(({ id, answer }) => {
        const descriptor = manifest.question_targets[id]!;
        return {
          contract_version: "decision-questions-v2" as const,
          question_id: id,
          question_kind: descriptor.question_kind,
          definition_variant: descriptor.definition_variant,
          definition_version: descriptor.definition_version,
          definition_sha256: descriptor.definition_sha256,
          target_id: descriptor.target_id,
          target: descriptor.target,
          raw_answer: answer,
          action: applyDecisionPolicy(answer, descriptor.question_kind, manifest.policy),
          raw_response_reference: rawPath,
          source_sha256: manifest.source_sha256,
          rules_sha256: descriptor.rules_sha256,
          upstream_hashes: manifest.upstream_hashes,
        };
      }),
    };
  }

  const envelope = z.object({ answers: z.record(z.string(), z.unknown()), model: z.string(), provider: z.string() }).safeParse(raw);
  if (!envelope.success)
    return {
      decisions: [],
      findings: envelope.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  const response = envelope.data;
  // OpenRouter resolves the pinned slug to a dated serving revision.
  if (response.model !== jevModel && !new RegExp(`^${jevModel}-\\d{8}$`).test(response.model)) findings.push(`Unexpected served model: ${response.model}`);
  if (response.provider.toLowerCase() !== "typesafe") findings.push(`Unexpected served provider: ${response.provider}`);
  const batch = manifest.batches.find((entry) => entry.batch_id === batchId);
  if (!batch) throw new Error(`Unknown batch ${batchId}`);
  for (const key of Object.keys(response.answers)) if (!batch.candidate_ids.includes(key)) findings.push(`Unexpected answer ID: ${key}`);
  const decisions: RetainedDecision[] = [];
  const isAlias = manifest.decision_kind === "document_alias";
  const aliasAnswerSchema = z.object({
    type: z.literal("choice"),
    choice: z.enum(aliasOptions),
    confidence: z.number().min(0).max(1),
    probabilities: aliasDecisionSchema.shape.option_probabilities,
  });
  for (const key of batch.candidate_ids) {
    const parsed = (isAlias ? aliasAnswerSchema : classificationAnswerSchema).safeParse(response.answers[key]);
    if (!parsed.success) {
      findings.push(`${key}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      continue;
    }
    const answer = parsed.data;
    const probabilities = answer.probabilities as Record<string, number>;
    const total = (isAlias ? aliasOptions : classificationOptions).reduce((sum, option) => sum + Number(probabilities[option]), 0);
    if (Math.abs(total - 1) > 0.02) findings.push(`${key}: option probabilities sum to ${total}, outside rounding tolerance`);
    if (isAlias) {
      const pair = manifest.alias_pairs.find((entry) => entry.pair_id === key);
      if (!pair) throw new Error(`Manifest pair missing: ${key}`);
      const left = manifest.candidates.find((entry) => entry.candidate_id === pair.left_id)!;
      const right = manifest.candidates.find((entry) => entry.candidate_id === pair.right_id)!;
      if (!left || !right) throw new Error(`Alias endpoints missing: ${key}`);
      const sufficientlyCertain =
        answer.confidence >= Number(manifest.config.minimum_confidence) && probabilities[answer.choice]! >= Number(manifest.config.minimum_same_probability);
      const supported = sufficientlyCertain && left.occurrences.length > 0 && right.occurrences.length > 0;
      decisions.push(
        aliasDecisionSchema.parse({
          ...pair,
          answer: answer.choice,
          confidence: answer.confidence,
          option_probabilities: probabilities,
          outcome: supported ? (answer.choice === "same_referent" ? "provisional_link" : answer.choice === "different_referents" ? "distinct" : "unresolved") : "unresolved",
          question_version: manifest.question_version,
          raw_response_reference: rawPath,
          source_sha256: manifest.source_sha256,
          discovery_directory: manifest.discovery_directory,
          left_evidence: left.occurrences,
          right_evidence: right.occurrences,
        }),
      );
      continue;
    }
    const candidate = manifest.candidates.find((entry) => entry.candidate_id === key);
    if (!candidate) throw new Error(`Manifest candidate missing: ${key}`);
    decisions.push(
      classificationDecisionSchema.parse({
        ...candidate,
        answer: answer.choice,
        confidence: answer.confidence,
        option_probabilities: answer.probabilities,
        question_version: manifest.question_version,
        outcome: "awaiting_admission_calibration",
        raw_response_reference: rawPath,
        source_sha256: manifest.source_sha256,
        discovery_directory: manifest.discovery_directory,
      }),
    );
  }
  return { decisions, findings };
}

export function inspectCoverage(manifest: ClassificationManifest, decisions: Decision[]): { missing: string[]; findings: string[] } {
  const counts = new Map<string, number>();
  const expected = new Set(manifest.candidates.map((entry) => entry.candidate_id));
  const findings: string[] = [];
  for (const decision of decisions) {
    counts.set(decision.candidate_id, (counts.get(decision.candidate_id) ?? 0) + 1);
    if (!expected.has(decision.candidate_id)) findings.push(`Unexpected candidate ${decision.candidate_id}`);
    const candidate = manifest.candidates.find((entry) => entry.candidate_id === decision.candidate_id);
    if (candidate && (candidate.name !== decision.name || candidate.index !== decision.index)) findings.push(`Candidate input mismatch: ${decision.candidate_id}`);
  }
  for (const [key, count] of counts) if (count !== 1) findings.push(`Duplicate decision ${key}: ${count}`);
  const members = manifest.candidates.flatMap((candidate) => candidate.members ?? [candidate]);
  const original = new Map(manifest.original_candidates.map((candidate) => [candidate.candidate_id, candidate]));
  if (
    members.length !== original.size ||
    new Set(members.map((candidate) => candidate.candidate_id)).size !== original.size ||
    members.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(original.get(candidate.candidate_id)))
  ) {
    findings.push("Referent groups do not preserve the original candidates exactly once");
  }
  return { missing: [...expected].filter((key) => !counts.has(key)), findings };
}
