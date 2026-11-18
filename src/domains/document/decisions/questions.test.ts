import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import * as questions from "./questions.js";
import { loadClassificationCriteria } from "./semantic-input.js";
const titleTarget = {
  z: "extra",
  line: "Heading",
  following_text: { members: [{ name: "Laeral", occurrences: [{ start_byte: 0, end_byte: 6 }] }] },
  section_limits: [0, 12],
  id: "evidence-id",
  entityRules: { evidence: true },
};
test("descriptive definitions preserve all thirteen governing document questions and the identity variant", async () => {
  const markdown = await readFile("Resources/Jev question catalog.md", "utf8");
  assert.equal(Object.keys(questions.definitionsData).length, 13);
  for (const [i, [kind, d]] of Object.entries(questions.definitionsData).entries()) {
    const label = `Q${String(i + 1).padStart(2, "0")}`;
    const section = markdown.split(`### ${label} — `)[1]!.split(/\n### |\n## /)[0]!;
    assert.ok(section.includes(`**Question:** ${d.instructions}`), kind);
    if (d.guidance) assert.ok(section.includes(d.guidance), kind);
  }
});
test("constructors validate JSON without changing nested evidence, key order or control-like target keys", () => {
  const prepared = questions.title({ id: "heading", target: titleTarget });
  assert.equal(JSON.stringify(prepared.target), JSON.stringify(titleTarget));
  assert.equal(JSON.stringify(questions.restoreQuestion(prepared.descriptor, null)), JSON.stringify(prepared));
  prepared.target.following_text = "changed";
  assert.equal(typeof titleTarget.following_text, "object");
  for (const bad of [undefined, () => 0, NaN, Infinity, new Date(), { value: undefined }, [,], { toJSON: () => "hidden" }])
    assert.throws(() => questions.title({ id: "x", target: { ...titleTarget, line: bad as never } }));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => questions.title({ id: "x", target: { ...titleTarget, line: cycle as never } }));
  assert.throws(() => questions.title({ id: "", target: titleTarget }));
  assert.throws(() =>
    questions.passageMeaning({
      id: "x",
      target: { entity: "e", passage: "p", nearby_text: [], speaker: undefined } as never,
    }),
  );
});
test("named targets retain required nullable fields and reject missing fields, invalid variants and origin entities", async () => {
  const constructors = [
    questions.title,
    questions.listIntroduction,
    questions.mapLabels,
    questions.linkPlacement,
    questions.aliasIdentity,
    questions.entityQualification,
    questions.entityType,
    questions.blockSubject,
    questions.subjectContinuation,
    questions.sectionSubject,
    questions.documentSubject,
    questions.passageMeaning,
    questions.textOrigin,
  ];
  const entityRules = await loadClassificationCriteria();
  for (const [i, d] of Object.values(questions.definitionsData).entries()) {
    const target = Object.fromEntries(d.required.map((field) => [field, "evidence"]));
    const input = d.rule_resolution ? { id: "x", target, entityRules } : { id: "x", target };
    const prepared = constructors[i]!(input as never);
    assert.ok(questions.questionDescriptorSchema.safeParse(prepared.descriptor).success);
    assert.equal(questions.questionDescriptorSchema.safeParse({ ...prepared.descriptor, definition_variant: "unexpected" }).success, false);
    assert.equal(questions.questionDescriptorSchema.safeParse({ ...prepared.descriptor, definition_variant: "acronym" }).success, d.variants.length === 2);
    for (const field of d.required) {
      const missing = { ...target };
      delete missing[field];
      assert.throws(() => constructors[i]!({ ...input, target: missing } as never));
    }
    for (const field of d.required) {
      const nullable = { ...input, target: { ...target, [field]: null } };
      if ((d.nullable as readonly string[]).includes(field)) assert.doesNotThrow(() => constructors[i]!(nullable as never));
      else assert.throws(() => constructors[i]!(nullable as never));
    }
    for (const field of d.optional)
      for (const value of [null, { nested: ["evidence"] }]) assert.doesNotThrow(() => constructors[i]!({ ...input, target: { ...target, [field]: value } } as never));
  }
  assert.equal(
    questions.linkPlacement({
      id: "x",
      target: { link: "l", previous_block: null, next_block: null, section_limits: [] },
    }).target.previous_block,
    null,
  );
  assert.equal(
    questions.subjectContinuation({
      id: "x",
      target: { entity: "e", previous_block: null, block: "b", section_limits: [] },
    }).target.previous_block,
    null,
  );
  assert.throws(() => questions.textOrigin({ id: "x", target: { block: "b", nearby_blocks: [], entity: "extra" } }));
  const p = questions.title({ id: "x", target: titleTarget });
  for (const key of ["definition_version", "definition_sha256", "definition_variant", "rules_sha256", "question_id"])
    assert.throws(() => questions.restoreQuestion({ ...p.descriptor, [key]: "forged" }, null));
});
test("rules are explicit and hashed; type preserves seven complete definitions; identity constructors share policy kind", async () => {
  const rules = await loadClassificationCriteria();
  const input = {
    id: "candidate",
    target: { candidate: { members: [{ name: "UCR", evidence: ["retained"] }] } },
    entityRules: rules,
  };
  const typed = questions.entityType(input);
  assert.deepEqual(typed.question.criteria, Object.fromEntries(Object.keys(questions.definitionsData.entityType.criteria).map((key) => [key, rules.criteria[key]])));
  assert.equal(Object.keys(typed.question.criteria).length, 7);
  assert.throws(() => questions.entityType({ ...input, entityRules: { ...rules, sha256: "forged" } }));
  assert.equal(questions.entityQualification(input).descriptor.question_kind, "entityQualification");
  const alias = { id: "alias", target: { name_a: "Unified Church", name_b: "UCR", name_clues: [{ meaning: "clue" }] } };
  assert.equal(questions.aliasIdentity(alias).descriptor.question_kind, questions.acronymIdentity(alias).descriptor.question_kind);
  assert.notEqual(questions.aliasIdentity(alias).question.instructions, questions.acronymIdentity(alias).question.instructions);
});
// Compile-time named input contract; never dispatched.
function typedContract() {
  type TitleInput = Parameters<typeof questions.title>[0];
  const titleInput: TitleInput = { id: "x", target: titleTarget };
  questions.title(titleInput);
  // @ts-expect-error required following_text and section_limits
  questions.title({ id: "x", target: { line: "title" } });
  // @ts-expect-error explicit rules are required
  questions.entityType({ id: "x", target: { candidate: "name" } });
  // @ts-expect-error title line is non-null
  questions.title({ id: "x", target: { ...titleTarget, line: null } });
  questions.mapLabels({ id: "x", target: { list: [], nearby_text: "text", map_notes: null } });
  questions.passageMeaning({ id: "x", target: { entity: "e", passage: "p", nearby_text: [], speaker: null } });
  type TitleDescriptor = Extract<questions.QuestionDescriptor, { question_kind: "title" }>;
  // @ts-expect-error only identity questions permit the acronym variant
  const invalidVariant: TitleDescriptor["definition_variant"] = "acronym";
  void invalidVariant;
}
void typedContract;
