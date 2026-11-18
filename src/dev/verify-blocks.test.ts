import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReviewedDecisions } from "./blocks-semantic-review.js";

test("a missing source-reviewed decision is included in verification failures", () => {
  const review = [{ source_path: "/corpus/01.md", question_id: "title-title", expected: "yes" }];
  const result = evaluateReviewedDecisions(review, [{ source_path: "/corpus/01.md", decisions: [] }]);
  assert.equal(result.outcomes[0]?.status, "missing");
  assert.equal(result.outcomes[0]?.result, "missing");
  assert.deepEqual(
    result.failures.map((entry) => entry.question_id),
    ["title-title"],
  );
});

test("visible unresolved source-reviewed decisions stay distinct even when their primary label matches", () => {
  const review = [{ source_path: "/corpus/01.md", question_id: "title-title", expected: "yes" }];
  const result = evaluateReviewedDecisions(review, [
    {
      source_path: "/corpus/01.md",
      decisions: [{ question_id: "title-title", action: { label: "yes", status: "unresolved" } }],
    },
  ]);
  assert.equal(result.outcomes[0]?.result, "unresolved_visible");
  assert.deepEqual(result.failures, []);
});
