export { sha256 } from "./integrity.js";
import { decisionAnswerSchema, actionSchema, questionPolicySchema } from "./policy.js";
import type { QuestionPolicy } from "./policy.js";
import { questionDescriptorSchema, questionKindSchema, definitionsVersion } from "./questions.js";
import { z } from "zod";
import type { DecisionsRequest } from "@openrouter/sdk/models";
import { jevModel, jevProvider } from "./execution-policy.js";
export { jevModel, jevProvider } from "./execution-policy.js";
export const classificationQuestionVersion = "entity-type-v3-linked";
export const aliasQuestionVersion = "document-alias-v2";
export const classificationOptions = ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept", "not_an_entity"] as const;
export const occurrenceSchema = z.object({
  start_byte: z.number().int().nonnegative(),
  end_byte: z.number().int().nonnegative(),
});
export const sourceCandidateSchema = z.object({
  candidate_id: z.string(),
  index: z.number().int().nonnegative(),
  name: z.string(),
  occurrences: z.array(occurrenceSchema),
  findings: z.array(z.string()),
});
export const candidateSchema = sourceCandidateSchema.extend({ members: z.array(sourceCandidateSchema).optional() });
export type Candidate = z.infer<typeof candidateSchema>;
export const classificationAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.enum(classificationOptions),
  confidence: z.number().min(0).max(1),
  probabilities: z.object(Object.fromEntries(classificationOptions.map((option) => [option, z.number().min(0).max(1)]))).strict(),
});
export const classificationDecisionSchema = candidateSchema.extend({
  answer: z.enum(classificationOptions),
  confidence: z.number().min(0).max(1),
  option_probabilities: classificationAnswerSchema.shape.probabilities,
  question_version: z.literal(classificationQuestionVersion),
  outcome: z.literal("awaiting_admission_calibration"),
  raw_response_reference: z.string(),
  source_sha256: z.string(),
  discovery_directory: z.string(),
});
export type Decision = z.infer<typeof classificationDecisionSchema>;
export const aliasOptions = ["same_referent", "different_referents", "unclear"] as const;
export const pairSchema = z.object({ pair_id: z.string(), left_id: z.string(), right_id: z.string() });
export type AliasPair = z.infer<typeof pairSchema>;
export const aliasDecisionSchema = pairSchema.extend({
  answer: z.enum(aliasOptions),
  confidence: z.number().min(0).max(1),
  option_probabilities: z
    .object({
      same_referent: z.number().min(0).max(1),
      different_referents: z.number().min(0).max(1),
      unclear: z.number().min(0).max(1),
    })
    .strict(),
  outcome: z.enum(["provisional_link", "distinct", "unresolved"]),
  question_version: z.literal(aliasQuestionVersion),
  raw_response_reference: z.string(),
  source_sha256: z.string(),
  discovery_directory: z.string(),
  left_evidence: z.array(occurrenceSchema),
  right_evidence: z.array(occurrenceSchema),
});
export type AliasDecision = z.infer<typeof aliasDecisionSchema>;
export const questionDecisionSchema = z
  .object({
    contract_version: z.literal("decision-questions-v2"),
    question_id: z.string(),
    target_id: z.string(),
    target: z.record(z.string(), z.unknown()),
    raw_answer: decisionAnswerSchema,
    action: actionSchema,
    raw_response_reference: z.string(),
    source_sha256: z.string(),
    upstream_hashes: z.record(z.string(), z.string()),
    question_kind: questionKindSchema,
    definition_variant: z.enum(["standard", "acronym"]),
    definition_version: z.string(),
    definition_sha256: z.string(),
    rules_sha256: z.string().nullable(),
    repeat_response_reference: z.string().nullable().optional(),
  })
  .strict();
export type RetainedDecision = z.infer<typeof questionDecisionSchema> | Decision | AliasDecision;
export const retainedDecisionSchema = z.unknown().transform((raw, ctx): RetainedDecision => {
  const present = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "contract_version");
  const version = present ? (raw as Record<string, unknown>).contract_version : undefined;
  if (present && version !== "decision-questions-v2") {
    ctx.addIssue({ code: "custom", message: "Unknown decision contract version" });
    return z.NEVER;
  }
  const schema = version === "decision-questions-v2" ? questionDecisionSchema : z.union([classificationDecisionSchema, aliasDecisionSchema]);
  const checked = schema.safeParse(raw);
  if (!checked.success) {
    for (const issue of checked.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  return JSON.parse(JSON.stringify(raw)) as RetainedDecision;
});

export const batchSchema = z.object({
  batch_id: z.string(),
  batch_sha256: z.string(),
  candidate_ids: z.array(z.string()),
  request: z.record(z.string(), z.unknown()),
  input_upper_bound_tokens: z.number(),
});
const candidateStageSchema = z.object({
  operation_id: z.string(),
  discovery_directory: z.string(),
  source_sha256: z.string(),
  source_byte_length: z.number(),
  candidates_sha256: z.string(),
  configuration_sha256: z.string(),
  created_at_utc: z.string(),
  config: z.record(z.string(), z.unknown()),
  candidates: z.array(candidateSchema),
  batches: z.array(batchSchema),
});
export const aliasManifestSchema = candidateStageSchema
  .extend({
    decision_kind: z.literal("document_alias"),
    question_version: z.literal(aliasQuestionVersion),
    alias_pairs: z.array(pairSchema),
  })
  .strict();
export const classificationManifestSchema = candidateStageSchema
  .extend({
    decision_kind: z.literal("entity_type"),
    question_version: z.literal(classificationQuestionVersion),
    original_candidates: z.array(sourceCandidateSchema),
    alias_directory: z.string(),
    alias_result_sha256: z.string(),
  })
  .strict();
export const candidateDecisionManifestSchema = z.discriminatedUnion("decision_kind", [aliasManifestSchema, classificationManifestSchema]);
export type AliasManifest = z.infer<typeof aliasManifestSchema> & { contract_version?: never };
export type ClassificationManifest = z.infer<typeof classificationManifestSchema> & { contract_version?: never };
export type CandidateDecisionManifest = z.infer<typeof candidateDecisionManifestSchema> & { contract_version?: never };
export const questionConfigurationSchema = z
  .object({
    contract_version: z.literal("decision-questions-v2"),
    stage_directory: z.string(),
    stage_id: z.string(),
    definitions_version: z.literal(definitionsVersion),
    definitions_sha256: z.string(),
    questions_sha256: z.string(),
    rules_sha256: z.string().nullable(),
    policy_sha256: z.string(),
    upstream_hashes: z.record(z.string(), z.string()),
    upstream_paths: z.record(z.string(), z.string()),
    target_mode: z.enum(["single", "batch"]),
    input_limit: z.number().int().positive(),
    maximum_questions: z.union([z.literal(1), z.literal(10), z.literal(50)]),
    model: z.literal(jevModel),
    provider: z.literal(jevProvider),
    allow_fallbacks: z.literal(false),
    sdk_retries: z.literal("disabled"),
    retries: z.literal(2),
    retry_delay_seconds: z.literal(30),
    max_concurrent_requests: z.union([z.literal(4), z.literal(10)]),
  })
  .strict();
export const questionManifestSchema = z
  .object({
    contract_version: z.literal("decision-questions-v2"),
    operation_id: z.string(),
    stage_id: z.string(),
    discovery_directory: z.string(),
    created_at_utc: z.string(),
    source_sha256: z.string(),
    source_byte_length: z.number().int().nonnegative(),
    definitions_version: z.literal(definitionsVersion),
    definitions_sha256: z.string(),
    questions_sha256: z.string(),
    configuration_sha256: z.string(),
    policy: questionPolicySchema,
    policy_sha256: z.string(),
    rules_sha256: z.string().nullable(),
    rule_evidence: z
      .object({ criteria: z.record(z.string(), z.string()), governingRules: z.string(), sha256: z.string() })
      .strict()
      .nullable(),
    upstream_hashes: z.record(z.string(), z.string()),
    question_targets: z.record(z.string(), questionDescriptorSchema),
    config: questionConfigurationSchema,
    batches: z.array(batchSchema),
  })
  .strict();
export type QuestionManifest = z.infer<typeof questionManifestSchema>;
export type Manifest = CandidateDecisionManifest | QuestionManifest;
export const manifestSchema = z.unknown().transform((raw, ctx): Manifest => {
  const version = raw && typeof raw === "object" && Object.hasOwn(raw, "contract_version") ? (raw as Record<string, unknown>).contract_version : undefined;
  if (raw && typeof raw === "object" && Object.hasOwn(raw, "contract_version") && version !== "decision-questions-v2") {
    ctx.addIssue({ code: "custom", message: "Unknown manifest contract version" });
    return z.NEVER;
  }
  const schema = version === "decision-questions-v2" ? questionManifestSchema : candidateDecisionManifestSchema;
  const checked = schema.safeParse(raw);
  if (!checked.success) {
    for (const issue of checked.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    return z.NEVER;
  }
  // Preserve original serialized order: parsing validates but does not rewrite retained evidence.
  return JSON.parse(JSON.stringify(raw)) as Manifest;
});
export type BatchInput = {
  stage: {
    version: 1;
    directory: string;
  };
  batchId: string;
  verificationProbe?: boolean;
  freshRepeatId?: string;
};
export type BatchResult = {
  batchId: string;
  decisionCount: number;
  resultPath: string;
  reused: boolean;
};
export type ClassificationInput = {
  capability: "classify";
  discoveryDirectory: string;
  operationId: string;
  verificationProbe?: boolean;
  blocksDirectory?: string;
  policy?: QuestionPolicy;
  legacyResume?: boolean;
};
export type ClassificationResult = {
  status: "complete" | "failed";
  classificationDirectory: string;
  candidateCount: number;
  decisionCount: number;
  missingCandidateIds: string[];
  findings: string[];
  originalCandidateCount?: number;
};
export function requestOf(batch: Manifest["batches"][number]): DecisionsRequest {
  return batch.request as unknown as DecisionsRequest;
}
