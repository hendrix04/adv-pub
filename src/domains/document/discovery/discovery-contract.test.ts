import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { z } from "zod";

const directory = new URL("./v8/", import.meta.url);
const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
const schema = JSON.parse(schemaText) as Parameters<typeof z.fromJSONSchema>[0];

test("v8 discovery contract keeps the locked seven types and closed relationship vocabulary", () => {
  assert.ok(typeof schema === "object" && schema !== null && "$id" in schema);
  assert.equal((schema as Record<string, unknown>).$id, "adventurers-pub/document-discovery/v8");
  const validationSchema = z.fromJSONSchema(schema, { defaultTarget: "draft-2020-12" });
  assert.equal(
    validationSchema.safeParse({
      entities: [],
      assertions: [],
      relationship_proposals: [],
      explicit_dates: [],
      useful_passages: [],
    }).success,
    true,
  );
  assert.match(prompt, /exactly these types/);
  assert.match(prompt, /must be an Event and the object a Location/);
  assert.match(prompt, /Do not infer an alias from a follower\/demonym\/adherent word/);
  assert.match(prompt, /including case, punctuation, spacing, and original line-break hyphenation/);
  assert.match(prompt, /For each paragraph, list, and table row/);
  assert.match(prompt, /The grammatical subject of a relative clause/);
  assert.match(prompt, /Capture source-described types and behaviors for every named class/);
  assert.match(prompt, /“X is the spawn of Y” states Y as progenitor\/source and X as spawn/);
  assert.match(prompt, /A different being “posing as” a named person is a distinct Creature proposal/);
  assert.match(prompt, /same negation both in a `does_not_.*` predicate and negative polarity/);
  assert.match(prompt, /do not replace a pronoun with its antecedent/);
  assert.match(prompt, /Dates and periods are not Locations/);
  assert.match(prompt, /An assertion cannot simultaneously make a definite positive subject\/object claim/);
  assert.match(prompt, /A parenthetical list of multiple names/);
  assert.match(prompt, /For every multi-row table, count all named referents/);
  assert.match(prompt, /reconcile every nonempty `subject_candidate_key`/);
  assert.match(prompt, /A named race or species is a category/);
  assert.match(prompt, /If the source paragraph's own qualification says a named candidate is not the referent/);
  assert.match(prompt, /A named table grouping or collective body can be an Organization/);
  assert.match(prompt, /Do not assert `member_of` with a Concept/);
  assert.match(prompt, /Do not infer the offspring's escape from an ancestor's relative clause/);
  assert.match(prompt, /Preserve exact scope in containment claims/);
  assert.match(prompt, /A singular unnamed actor in a concrete hypothetical campaign example/);
  assert.match(prompt, /A useful-passage quote must be one contiguous source span/);
});
