import assert from "node:assert/strict";
import { test } from "node:test";
import * as questions from "./questions.js";
import { buildDecisionRequest } from "./request.js";
import { decodeCapturedSource } from "../discovery/source.js";
import { loadClassificationCriteria } from "./semantic-input.js";
const source = decodeCapturedSource(Buffer.from("\ufeff“Heading”\r\n🧙 body"));
const heading = (id: string) => questions.title({ id, target: { line: "Heading", following_text: "body", section_limits: [0, source.byteLength] } });
test("single and mixed requests preserve complete source and isolated escaped own-key targets", () => {
  const ids = ["__proto__", "constructor", 'quote"/🧙', "1"];
  const prepared = ids.map(heading);
  const request = buildDecisionRequest({ source, questions: prepared, targetMode: "batch" });
  for (const id of ids) {
    assert.ok(Object.hasOwn(request.questions, id));
    assert.equal(
      request.questions[id]!.instructions,
      prepared.find((q) => q.id === id)!.question.instructions.replace(/target\.(\w+)/g, (_, field: string) => `targets[${JSON.stringify(id)}].${field}`),
    );
    assert.ok(Object.hasOwn((request.state as { targets: object }).targets, id));
  }
  assert.equal((request.state as { complete_source: string }).complete_source, source.text);
  const single = buildDecisionRequest({ source, questions: [prepared[0]!], targetMode: "single" });
  assert.equal(single.questions.__proto__!.instructions, prepared[0]!.question.instructions);
  for (const collection of [[], [{ ...heading("x"), id: "" }], [heading("same"), heading("same")]])
    assert.throws(() => buildDecisionRequest({ source, questions: collection, targetMode: "batch" }));
  assert.throws(() => buildDecisionRequest({ source, questions: prepared, targetMode: "single" }));
  assert.throws(() => buildDecisionRequest({ source: { ...source, text: "changed" }, questions: [heading("x")], targetMode: "single" }));
});
test("assembler merges identical rule evidence and rejects text, criteria and hash conflicts", async () => {
  const rules = await loadClassificationCriteria();
  const qualified = questions.entityQualification({ id: "q", target: { candidate: "UCR" }, entityRules: rules });
  const other = questions.entityType({ id: "type", target: { candidate: "UCR" }, entityRules: rules });
  const request = buildDecisionRequest({ source, questions: [heading("h"), qualified, other], targetMode: "batch" });
  assert.equal((request.state as { entity_rules: string }).entity_rules, rules.governingRules);
  for (const mutation of [{ sha256: "changed" }, { governingRules: "changed" }, { criteria: { ...rules.criteria, Creature: "changed" } }])
    assert.throws(() =>
      buildDecisionRequest({
        source,
        questions: [qualified, { ...other, entity_rules: { ...rules, ...mutation } }],
        targetMode: "batch",
      }),
    );
  assert.equal(Object.hasOwn(buildDecisionRequest({ source, questions: [heading("x")], targetMode: "single" }).state as object, "entity_rules"), false);
});
