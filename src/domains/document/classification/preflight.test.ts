import assert from "node:assert/strict";
import test from "node:test";
import { exploratoryClassificationPolicy } from "./policy.js";
import { preflightClassificationBudget } from "./preflight.js";

const endpoint = {
  tag: "typesafe",
  context_length: 32_000,
  max_completion_tokens: 28_800,
  pricing: { prompt: "0.000000042", completion: "0", overrides: [] },
};
const ledger = { capUsd: 5, spentUsd: 0, calls: [] };

test("aggregate aliasIdentity cost upper bound is planning information, not a live authorization gate", () => {
  const counts = [90, 59, 41, 12, 169, 40, 15, 49];
  const documents = counts.map((candidate_count, index) => ({
    document_id: ["01", "03", "04", "05", "06", "07", "08", "09"][index]!,
    candidate_count,
    unnamed_map_place_count: 0,
  }));
  const result = preflightClassificationBudget({
    documents,
    endpoint,
    ledger,
    policy: exploratoryClassificationPolicy(),
    requiredDocumentIds: ["01", "02", "03", "04", "05", "06", "07", "08", "09"],
  });
  assert.equal(result.alias_identity_question_count, 22_859);
  assert.equal(result.alias_identity_first_attempt_upper_bound_usd, 30.722496);
  assert.equal(result.status, "blocked_missing_documents");
  assert.equal(result.aggregate_worst_case_cost_upper_bound_fits_remaining_budget, false);
  assert.equal(result.aggregate_cost_upper_bound_is_planning_only, true);
  assert.deepEqual(result.missing_document_ids, ["02"]);
  assert.equal(result.ledger.spent_usd, 0);
  assert.equal(ledger.spentUsd, 0);
});

test("complete source inputs are ready for per-call authorization even when aggregate maxima exceed the cap", () => {
  const counts = [90, 59, 41, 12, 169, 40, 15, 49, 20];
  const ids = ["01", "03", "04", "05", "06", "07", "08", "09", "02"];
  const documents = counts.map((candidate_count, index) => ({
    document_id: ids[index]!,
    candidate_count,
    unnamed_map_place_count: 0,
  }));
  const result = preflightClassificationBudget({
    documents,
    endpoint,
    ledger,
    policy: exploratoryClassificationPolicy(),
    requiredDocumentIds: ["01", "02", "03", "04", "05", "06", "07", "08", "09"],
  });
  assert.equal(result.status, "ready_for_per_call_authorization");
  assert.equal(result.aggregate_worst_case_cost_upper_bound_fits_remaining_budget, false);
  assert.equal(result.aggregate_cost_upper_bound_is_planning_only, true);
  assert.match(result.live_authorization, /Each billable request and retry must reserve/u);
  assert.equal(result.ledger.spent_usd, 0);
});

test("aggregate cost upper bound includes entityQualification/entityType, retries, and required fresh repeats", () => {
  const policy = {
    ...exploratoryClassificationPolicy(),
    rules: {
      aliasIdentity: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true },
      entityQualification: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false },
      entityType: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false },
    },
  };
  const result = preflightClassificationBudget({
    documents: [{ document_id: "01", candidate_count: 3, unnamed_map_place_count: 2 }],
    endpoint: { ...endpoint, context_length: 100 },
    ledger,
    policy,
    requiredDocumentIds: ["01"],
  });
  assert.equal(result.documents[0]!.alias_identity_questions, 3);
  assert.equal(result.documents[0]!.entity_qualification_upper_bound, 5);
  assert.equal(result.documents[0]!.entity_type_upper_bound, 5);
  assert.equal(result.documents[0]!.repeat_questions_upper_bound, 3);
  assert.equal(result.planned_question_count_upper_bound, 16);
  assert.equal(result.attempts_per_question, 3);
  assert.equal(result.aggregate_worst_case_cost_upper_bound_usd, 0.0002016);
});

test("preflight rejects an endpoint whose conservative capacity or price is unknown", () => {
  assert.throws(
    () =>
      preflightClassificationBudget({
        documents: [],
        endpoint: { ...endpoint, pricing: { ...endpoint.pricing, overrides: ["unknown"] } },
        ledger,
        policy: exploratoryClassificationPolicy(),
      }),
    /Unknown conservative Jev cost/,
  );
});
