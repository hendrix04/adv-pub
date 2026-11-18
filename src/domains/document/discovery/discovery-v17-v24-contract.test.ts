import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

{
  const directory = new URL("./v17/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v17 discovery contract preserves distinct places, source phrases, and table coverage", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v17");
    assert.match(prompt, /Keep the named places Elturgard and Elturel distinct/);
    assert.match(prompt, /Elturel paid the price/);
    assert.match(prompt, /Propose the exact spatial container “Earth's universe” as a Location candidate/);
    assert.match(prompt, /The N'Garal progenitor is one particular unnamed Elder God/);
    assert.match(prompt, /“at the beginning” dates only the initial non-God status/);
    assert.match(prompt, /Retain the entire multi-row source table as an exact useful passage/);
    assert.match(prompt, /Balance is important/);
    assert.match(prompt, /Unlike in Waterdeep, none are masked/);
    assert.match(prompt, /eventually/);
    assert.match(prompt, /always/);
    assert.match(prompt, /“Lloth” in the source question .* individual worship target described as a God; use Creature/);
  });
}

{
  const directory = new URL("./v18/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v18 discovery contract keeps table associations untyped and source attribution exact", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v18");
    assert.match(prompt, /For each of the 17 deity table rows, represent every non-N\/A Patron Of value/);
    assert.match(prompt, /A Patron Of value is not an alias for its patron deity/);
    assert.match(prompt, /Apolloite or Lathanderan describes the sailors/);
    assert.match(prompt, /it does not say that Waterdeep's Divine Lords are unmasked or masked/);
    assert.match(prompt, /“Unlike in Waterdeep, none are masked\.”/);
    assert.match(prompt, /Use `participated_in` only with a compatible Event endpoint/);
    assert.match(prompt, /Do not link High Overseer Pherria Jynks as participating in the Dogma Concept/);
    assert.match(prompt, /date describing Druids' “always” warning belongs only to the warning/);
    assert.match(prompt, /“Lloth” occurs in the opening spider-gesture sentence/);
  });
}

{
  const directory = new URL("./v19/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v19 discovery contract preserves quantification, modality, and exact referent links", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v19");
    assert.match(prompt, /“good wizards” is a plural generic class/);
    assert.match(prompt, /Do not create an “unnamed wizard” individual/);
    assert.match(prompt, /Do not attach the narrative Gruumush mention to table candidate Gruumsh/);
    assert.match(prompt, /“at the beginning” describes not yet being Gods/);
    assert.match(prompt, /does not date their ascent from lower-plane lordship/);
    assert.match(prompt, /does not establish that all people actually respect it/);
    assert.match(prompt, /the Church requires or insists that the Pantheon be respected/);
    assert.match(prompt, /Treat the named Forgotten Realms wiki source as an Item of subtype Document/);
    assert.match(prompt, /Never use `serves` or `participated_in` with an incompatible category/);
    assert.doesNotMatch(prompt, /the “full Thevius Kreig sentence”/);
    assert.doesNotMatch(prompt, /Lloth.*in the source question/);
  });
}

{
  const directory = new URL("./v20/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v20 discovery contract preserves specific referents, source modality, and the full opening sweep", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v20");
    assert.match(prompt, /Earth is used as a place in this source and is a Location/);
    assert.match(prompt, /Do not attach Elturel's price statement as a mention of Pherria Jynks/);
    assert.match(prompt, /“good wizards” remains generic, not an unnamed individual/);
    assert.match(prompt, /Do not attach Gruumush evidence to Gruumsh/);
    assert.match(prompt, /The source explicitly identifies Apollo and Lathander as one referent/);
    assert.match(prompt, /“Druids” in Pherria's quotation is a generic group reference/);
    assert.match(prompt, /Use affirmative property labels and encode negation exactly once/);
    assert.match(prompt, /Dogma is the source-named subject of “does not prohibit”/);
    assert.match(prompt, /“Be respected” is the requested Church policy, not universal compliance/);
    assert.match(prompt, /In the Church's view such beings are still worthy of worship/);
    assert.match(prompt, /potentially could find their way into the Pantheon to replace one of the existing Gods/);
    assert.match(prompt, /the number of worshipers was a factor in divine power but not its defining characteristic/);
    assert.match(prompt, /a God's history in the multiverse was not the defining characteristic/);
    assert.match(prompt, /Capture the opening paragraph's source-specific worship examples/);
    assert.match(prompt, /Capture each named Pantheon deity's row attributes as assertions/);
  });
}

{
  const directory = new URL("./v21/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v21 discovery contract binds every table row, endpoint, attribute, and source attribution", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v21");
    assert.match(prompt, /from that same row's deity candidate to each patron referent/);
    assert.match(prompt, /Do not create a Pantheon-to-patron edge from a deity row/);
    assert.match(prompt, /three separate assertions for that row's Province, Suggested Domains, and Common Symbol/);
    assert.match(prompt, /count 17 distinct deity rows, 51 row-attribute assertions/);
    assert.match(prompt, /Celestial beings, Demonic beings, Angelic beings, Fiendish creatures, Angels, and Demons are distinct/);
    assert.match(prompt, /“Nation-States” in “one of the first Nation-States” is a generic category/);
    assert.match(prompt, /Do not attribute that earlier narrative rationale to the unnamed theologian/);
    assert.match(prompt, /Do not turn “the UCR” into a definite entity link or identity/);
    assert.match(prompt, /Preserve the exact period wording “have spent years”/);
    assert.match(prompt, /Capture the separate exact periods “now”/);
    assert.match(prompt, /“a long history” for Elturgard's followers of Apollo/);
  });
}

{
  const directory = new URL("./v22/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v22 discovery contract verifies source-local joins, event subjects, and exact excerpt evidence", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v22");
    assert.match(prompt, /Resolve every response-local key by exact name against the completed entity list/);
    assert.match(prompt, /Do not rely on candidate order or nearby keys/);
    assert.match(prompt, /do not attach that evidence as a mention of the Hells/);
    assert.match(prompt, /the Church Organization cannot be the subject of `occurred_at`/);
    assert.match(prompt, /resolve the subject key to the candidate whose name is “Divine Lords”/);
    assert.match(prompt, /Do not assert that the Divine Lords have a fixed number or Pantheon/);
    assert.match(prompt, /Capture the latter as a positive assertion that the Pantheon is fixed/);
    assert.match(prompt, /Keep its property affirmative \(“be labeled … Gods”\) with negative polarity exactly once/);
    assert.match(prompt, /the universe \*will\* eventually reset itself/);
    assert.match(prompt, /keep the universe as the grammatical subject/);
    assert.match(prompt, /An assertion that messenger and servant demons “serve the major demonic rulers” must cite that exact serving clause/);
    assert.match(prompt, /Do not use the following sentence about “These beings” deriving from the same origin/);
  });
}

{
  const directory = new URL("./v23/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v23 discovery contract resolves both relationship endpoints and separates campaign and imported claims", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v23");
    assert.match(prompt, /Before returning a Patron Of relationship, resolve both endpoint keys/);
    assert.match(prompt, /the object key must resolve to a candidate whose name is the patron cell label/);
    assert.match(prompt, /If no exact patron candidate exists, leave the object key empty/);
    assert.match(prompt, /For every deity row, retain all 51 attributes/);
    assert.match(prompt, /is not established as identical to “Earth's universe”/);
    assert.match(prompt, /“Neutral balance will always return” has Neutral balance as its subject/);
    assert.match(prompt, /Lawful stability will be preserved/);
    assert.match(prompt, /passive\/future outcomes, not actions the Divine Lords perform/);
    assert.match(prompt, /Capture the unnamed speaker introduced by “As one theologian commented” as one specific unnamed Creature proposal/);
    assert.match(prompt, /Do not duplicate a date record when the wording and original evidence span are identical/);
  });
}

{
  const directory = new URL("./v24/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v24 makes all 51 deity table attributes and exact patron joins mandatory", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v24");
    assert.match(prompt, /17 deity rows/);
    assert.match(prompt, /exactly three separate assertions/);
    assert.match(prompt, /51 required structured assertions in total/);
    assert.match(prompt, /cite the complete table row/);
    assert.match(prompt, /must resolve to the exact source-listed patron category/);
    assert.match(prompt, /Treat `\*N\/A\*` as no stated patron/);
  });

  test("v24 preserves source subjects and campaign/import boundaries found in review", () => {
    assert.match(prompt, /do not describe them as the Church's worshippers or members/);
    assert.match(prompt, /“had commensurate power”/);
    assert.match(prompt, /preserve the universe as the grammatical subject/);
    assert.match(prompt, /do not repair its missing subject from the nearest name/);
    assert.match(prompt, /retain the multiverse as the subject\/container/);
  });
}
