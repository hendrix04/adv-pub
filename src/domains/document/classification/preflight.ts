import type { QuestionPolicy } from "../decisions/policy.js";
import { jevExecutionPolicy } from "../decisions/execution-policy.js";

export type ClassificationPreflightDocument = {
  document_id: string;
  candidate_count: number;
  unnamed_map_place_count: number;
};

export type ClassificationEndpointCost = {
  tag: string;
  context_length: number;
  max_completion_tokens: number;
  pricing: { prompt: string | number; completion: string | number; overrides?: unknown[] };
};

export type ClassificationCostLedger = {
  capUsd: number;
  spentUsd: number;
  calls: unknown[];
};

const money = (value: string | number, label: string) => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value))) throw new Error(`Unknown conservative Jev cost: invalid ${label}`);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Unknown conservative Jev cost: invalid ${label}`);
  return amount;
};

/** Estimate aggregate worst-case planning cost; authorization remains per live call. */
export function preflightClassificationBudget(input: {
  documents: ClassificationPreflightDocument[];
  endpoint: ClassificationEndpointCost;
  ledger: ClassificationCostLedger;
  policy: QuestionPolicy;
  requiredDocumentIds?: string[];
}) {
  const endpoint = input.endpoint;
  if (
    endpoint.tag !== "typesafe" ||
    !Number.isFinite(endpoint.context_length) ||
    endpoint.context_length <= 0 ||
    !Number.isFinite(endpoint.max_completion_tokens) ||
    endpoint.max_completion_tokens < 0 ||
    (endpoint.pricing.overrides?.length ?? 0) > 0
  )
    throw new Error("Unknown conservative Jev cost; endpoint capacity or pricing overrides are unsupported");
  const prompt = money(endpoint.pricing.prompt, "prompt price");
  const completion = money(endpoint.pricing.completion, "completion price");
  if (!input.policy.rules.aliasIdentity || !input.policy.rules.entityQualification || !input.policy.rules.entityType) {
    throw new Error("Catalog preflight requires explicit alias identity, entity qualification, and entity type policy rules");
  }
  const ledger = input.ledger;
  if (!Number.isFinite(ledger.capUsd) || !Number.isFinite(ledger.spentUsd) || ledger.capUsd < 0 || ledger.spentUsd < 0 || ledger.spentUsd > Math.min(5, ledger.capUsd)) {
    throw new Error("Shared live-cost ledger is invalid or already over its $5 cap");
  }
  const byId = new Map(input.documents.map((document) => [document.document_id, document]));
  if (
    byId.size !== input.documents.length ||
    input.documents.some(
      (document) =>
        !Number.isInteger(document.candidate_count) || document.candidate_count < 0 || !Number.isInteger(document.unnamed_map_place_count) || document.unnamed_map_place_count < 0,
    )
  ) {
    throw new Error("Classification preflight document counts must be unique nonnegative integers");
  }
  const missingDocuments = (input.requiredDocumentIds ?? []).filter((documentId) => !byId.has(documentId));
  const rows = input.documents.map((document) => {
    const aliasPairCount = (document.candidate_count * (document.candidate_count - 1)) / 2;
    const qualificationUpperBound = document.candidate_count + document.unnamed_map_place_count;
    const typingUpperBound = qualificationUpperBound;
    const repeats =
      (input.policy.rules.aliasIdentity?.require_repeat ? aliasPairCount : 0) +
      (input.policy.rules.entityQualification?.require_repeat ? qualificationUpperBound : 0) +
      (input.policy.rules.entityType?.require_repeat ? typingUpperBound : 0);
    return {
      ...document,
      alias_identity_questions: aliasPairCount,
      entity_qualification_upper_bound: qualificationUpperBound,
      entity_type_upper_bound: typingUpperBound,
      repeat_questions_upper_bound: repeats,
      planned_questions_upper_bound: aliasPairCount + qualificationUpperBound + typingUpperBound + repeats,
    };
  });
  const aliasIdentityQuestionCount = rows.reduce((sum, row) => sum + row.alias_identity_questions, 0);
  const firstAttemptAliasIdentityUpperBoundUsd = aliasIdentityQuestionCount * (endpoint.context_length * prompt + endpoint.max_completion_tokens * completion);
  const questionCount = rows.reduce((sum, row) => sum + row.planned_questions_upper_bound, 0);
  const attemptsPerQuestion = jevExecutionPolicy.retries + 1;
  const perQuestionUsd = endpoint.context_length * prompt + endpoint.max_completion_tokens * completion;
  const aggregateWorstCaseUsd = questionCount * attemptsPerQuestion * perQuestionUsd;
  const capUsd = Math.min(5, ledger.capUsd);
  const remainingUsd = Math.max(0, capUsd - ledger.spentUsd);
  return {
    contract_version: "catalog-live-preflight-v3",
    status: missingDocuments.length ? ("blocked_missing_documents" as const) : ("ready_for_per_call_authorization" as const),
    model: jevExecutionPolicy.model,
    provider: jevExecutionPolicy.provider,
    documents: rows,
    missing_document_ids: missingDocuments,
    endpoint: {
      tag: endpoint.tag,
      context_length: endpoint.context_length,
      max_completion_tokens: endpoint.max_completion_tokens,
      prompt_price_per_token: prompt,
      completion_price_per_token: completion,
    },
    alias_identity_question_count: aliasIdentityQuestionCount,
    alias_identity_first_attempt_upper_bound_usd: Number(firstAttemptAliasIdentityUpperBoundUsd.toFixed(12)),
    planned_question_count_upper_bound: questionCount,
    attempts_per_question: attemptsPerQuestion,
    aggregate_worst_case_cost_upper_bound_usd: Number(aggregateWorstCaseUsd.toFixed(12)),
    aggregate_worst_case_cost_upper_bound_fits_remaining_budget: aggregateWorstCaseUsd <= remainingUsd,
    aggregate_cost_upper_bound_is_planning_only: true,
    live_authorization:
      "Each billable request and retry must reserve against the shared ledger before dispatch; usage.cost reconciles that call. This aggregate is planning information only.",
    ledger: { cap_usd: ledger.capUsd, spent_usd: ledger.spentUsd, remaining_usd: remainingUsd },
    finding: missingDocuments.length ? `Missing required source-hash-compatible documents: ${missingDocuments.join(", ")}` : null,
  };
}
