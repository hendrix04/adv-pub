import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDecisionPolicy, decisionDiagnostics, type QuestionPolicy } from "./policy.js";
import { validateDecisionAnswers } from "./validation.js";
const policy: QuestionPolicy = {
  version: "trial-v1",
  mode: "exploratory",
  contract_version: "decision-policy-v2",
  definitions_version: "document-questions-v2",
  probability_sum_tolerance: 0.02,
  confidence_tolerance: 0.02,
  calibration_evidence_hashes: [],
  rules: {
    title: { yes_threshold: 0.5, no_threshold: 0.49, choice_threshold: 0.5, require_repeat: false },
    linkPlacement: { yes_threshold: 0.5, no_threshold: 0.49, choice_threshold: 0.5, require_repeat: false },
  },
};
test("mixed Noul/Choice batches validate atomically with exact IDs and options", () => {
  const questions = {
    a: { type: "noul", criteria: { true: "yes", false: "no" } },
    b: { type: "choice", criteria: { before: "a", after: "b" } },
  };
  const raw = {
    model: "typesafe/jev-1.13",
    provider: "TypeSafe",
    answers: {
      a: { type: "noul", noul: 0.8 },
      b: { type: "choice", choice: "before", probabilities: { before: 0.8, after: 0.2 }, confidence: 0.6 },
    },
  };
  assert.equal(validateDecisionAnswers(raw, questions, 0.02, 0.02).answers.length, 2);
  for (const bad of [
    { ...raw, answers: { a: raw.answers.a } },
    { ...raw, answers: { ...raw.answers, c: raw.answers.a } },
    { ...raw, provider: "other" },
    { ...raw, answers: { ...raw.answers, a: { type: "noul", noul: Infinity } } },
    { ...raw, answers: { ...raw.answers, a: { type: "noul", noul: 0.8, confidence: 1 } } },
    { ...raw, answers: { ...raw.answers, b: { ...raw.answers.b, confidence: 1 } } },
  ]) {
    const result = validateDecisionAnswers(bad, questions, 0.02, 0.02);
    assert.equal(result.answers.length, 0);
    assert.ok(result.findings.length);
  }
});
test("exploratory answers never become supported; ties, calibration and repeats gate actions", () => {
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.8 }, "title", policy).status, "provisional");
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.5 }, "title", policy).status, "unresolved");
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.8 }, "title", { ...policy, mode: "supported" }).status, "unresolved");
  const calibrated = { ...policy, mode: "supported" as const, calibration_evidence_hashes: ["unit-review-evidence"] };
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.8 }, "title", calibrated).status, "supported");
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.1 }, "title", calibrated).status, "rejected");
  assert.equal(applyDecisionPolicy({ type: "choice", choice: "before", confidence: 0, probabilities: { before: 0.5, after: 0.5 } }, "linkPlacement", policy).status, "unresolved");
  const repeated = { ...policy, rules: { title: { ...policy.rules.title!, require_repeat: true } } };
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.8 }, "title", repeated, { type: "noul", noul: 0.1 }).status, "unresolved");
  const action = applyDecisionPolicy({ type: "noul", noul: 0.8 }, "title", policy);
  const report = decisionDiagnostics([{ id: "x", action, structureLabel: "yes" }]);
  assert.equal(report.structure_agreement.agreeing, 1);
  assert.equal(report.source_review.available, 0);
});

test("duplicate wire IDs cannot disappear during JSON decoding", async () => {
  const { parseDecisionWire } = await import("./validation.js");
  assert.throws(() => parseDecisionWire('{"answers":{"x":{},"\\u0078":{}}}'), /Duplicate/);
  assert.deepEqual(parseDecisionWire('{"answers":{"x":{"noul":0.5}},"quoted":"\\\"x\\\": 2"}'), {
    answers: { x: { noul: 0.5 } },
    quoted: '"x": 2',
  });
});

test("v2 descriptive rules preserve thresholds, calibration and identity repeat selection", async () => {
  const { questionPolicySchema } = await import("./policy.js");
  const current = {
    contract_version: "decision-policy-v2" as const,
    version: "v2-unit",
    mode: "exploratory" as const,
    definitions_version: "document-questions-v2" as const,
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [],
    rules: {
      title: { yes_threshold: 0.8, no_threshold: 0.2, choice_threshold: 0.9, require_repeat: false },
      aliasIdentity: { yes_threshold: 0.8, no_threshold: 0.2, choice_threshold: 0.9, require_repeat: true },
    },
  };
  for (const [value, status, label] of [
    [0.81, "provisional", "yes"],
    [0.8, "unresolved", null],
    [0.2, "unresolved", null],
    [0.19, "provisional", "no"],
  ] as const) {
    const action = applyDecisionPolicy({ type: "noul", noul: value }, "title", current);
    assert.equal(action.status, status);
    assert.equal(action.label, label);
  }
  assert.equal(applyDecisionPolicy({ type: "noul", noul: 0.99 }, "documentSubject", current).status, "unresolved");
  assert.throws(() => questionPolicySchema.parse({ ...current, rules: { unknown: current.rules.title } }));
  assert.throws(() => questionPolicySchema.parse({ ...current, rules: { title: { ...current.rules.title, yes_threshold: Infinity } } }));
  const answer = {
    type: "choice" as const,
    choice: "same_entity",
    confidence: 1,
    probabilities: { same_entity: 1, different_entities: 0, unclear: 0 },
  };
  assert.equal(applyDecisionPolicy(answer, "aliasIdentity", current).status, "unresolved");
  assert.equal(applyDecisionPolicy(answer, "aliasIdentity", current, answer).status, "provisional");
  assert.equal(applyDecisionPolicy(answer, "aliasIdentity", { ...current, mode: "supported" }, answer).status, "unresolved");
  assert.equal(applyDecisionPolicy(answer, "aliasIdentity", { ...current, mode: "supported", calibration_evidence_hashes: ["review"] }, answer).status, "supported");
});
