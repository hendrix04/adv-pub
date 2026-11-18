import assert from "node:assert/strict";
import test from "node:test";
import { applyDecisionPolicy } from "../decisions/policy.js";
import { calibrateStructurePolicy } from "./calibration.js";

const n = (noul: number) => ({ type: "noul" as const, noul });
const c = (choice: string, probabilities: Record<string, number>) => {
  const maximum = Math.max(...Object.values(probabilities));
  return { type: "choice" as const, choice, confidence: (maximum - 0.2) / 0.8, probabilities };
};

test("binary calibration finds separated reviewed actions and requires an agreeing fresh repeat", () => {
  const result = calibrateStructurePolicy({
    reviewedCases: [
      { question_id: "yes", question_kind: "listIntroduction", expected: "yes" },
      { question_id: "no", question_kind: "listIntroduction", expected: "no" },
    ],
    observations: [
      { question_id: "yes", question_kind: "listIntroduction", primary: n(0.91), repeat: n(0.87) },
      { question_id: "no", question_kind: "listIntroduction", primary: n(0.16), repeat: n(0.21) },
    ],
    evidenceHashes: ["review-hash"],
  });
  const rule = result.policy.rules.listIntroduction!;
  assert.ok(rule.no_threshold > 0.21);
  assert.ok(rule.yes_threshold < 0.87);
  assert.ok(rule.no_threshold <= rule.yes_threshold);
  const supported = applyDecisionPolicy(n(0.91), "listIntroduction", result.policy, n(0.87));
  assert.equal(supported.status, "supported");
  const unstable = applyDecisionPolicy(n(0.91), "listIntroduction", result.policy, n(0.16));
  assert.equal(unstable.status, "unresolved");
  assert.match(unstable.findings.join(" "), /Fresh repeat disagrees/);
});

test("overlapping Noul evidence widens the unresolved band instead of accepting a wrong action", () => {
  const result = calibrateStructurePolicy({
    reviewedCases: [
      { question_id: "yes", question_kind: "title", expected: "yes" },
      { question_id: "no", question_kind: "title", expected: "no" },
    ],
    observations: [
      { question_id: "yes", question_kind: "title", primary: n(0.55), repeat: n(0.45) },
      { question_id: "no", question_kind: "title", primary: n(0.6), repeat: n(0.4) },
    ],
    evidenceHashes: ["review-hash"],
  });
  const rule = result.policy.rules.title!;
  assert.equal(applyDecisionPolicy(n(0.55), "title", result.policy, n(0.45)).status, "unresolved");
  assert.equal(applyDecisionPolicy(n(0.6), "title", result.policy, n(0.4)).status, "unresolved");
  assert.ok(rule.no_threshold <= rule.yes_threshold);
  assert.deepEqual(result.families.title?.unresolved_calibration_cases.sort(), ["no", "yes"]);
});

test("Choice calibration omits a template rule when reviewed wrong choices overlap correct confidence", () => {
  const choices = (choice: string, after: number, before: number) => c(choice, { before, after, both: 0, neither: 0, unclear: 0 });
  const result = calibrateStructurePolicy({
    reviewedCases: [{ question_id: "linkPlacement", question_kind: "linkPlacement", expected: "after" }],
    observations: [
      {
        question_id: "linkPlacement",
        question_kind: "linkPlacement",
        primary: choices("after", 0.61, 0.39),
        repeat: choices("before", 0.28, 0.72),
      },
    ],
    evidenceHashes: ["review-hash"],
  });
  assert.equal(result.policy.rules.linkPlacement, undefined);
  assert.equal(result.families.linkPlacement?.threshold_available, false);
  assert.equal(applyDecisionPolicy(choices("after", 0.61, 0.39), "linkPlacement", result.policy).status, "unresolved");
});

test("Choice calibration freezes separated labels with the required repeat", () => {
  const choices = (after: number, before: number) => c("after", { before, after, both: 0, neither: 0, unclear: 0 });
  const result = calibrateStructurePolicy({
    reviewedCases: [{ question_id: "linkPlacement", question_kind: "linkPlacement", expected: "after" }],
    observations: [{ question_id: "linkPlacement", question_kind: "linkPlacement", primary: choices(0.92, 0.08), repeat: choices(0.88, 0.12) }],
    evidenceHashes: ["review-hash"],
  });
  const answer = choices(0.92, 0.08);
  assert.equal(applyDecisionPolicy(answer, "linkPlacement", result.policy, choices(0.88, 0.12)).status, "supported");
  assert.equal(result.policy.calibration_evidence_hashes[0], "review-hash");
});
