import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

{
  const directory = new URL("./v9/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v9 discovery contract guards review defects while preserving the locked payload", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v9");
    assert.match(prompt, /Review every named place in narrative text, including headings and parenthetical examples/);
    assert.match(prompt, /When a source explicitly gives a former name in a parenthetical, preserve it as an alias/);
    assert.match(prompt, /Do not attach a nearby demon list, quotation, or imported example to a named demon/);
    assert.match(prompt, /Represent negation once/);
    assert.match(prompt, /A sentence fragment with an omitted actor stays unlinked/);
    assert.match(prompt, /Type a universe or dimension as a Location when it is a spatial container/);
    assert.match(prompt, /Before returning, read each relationship as a sentence in subject-to-object order/);
  });
}

{
  const directory = new URL("./v10/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v10 discovery contract preserves source coverage and encodes negation once", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v10");
    assert.match(prompt, /Use the affirmative property label without a “not” prefix/);
    assert.match(prompt, /Capture both the source's main proposition and each distinct explanation/);
    assert.match(prompt, /A grammatical fragment with no recoverable actor remains an unlinked assertion/);
    assert.match(prompt, /Reconcile every candidate-key object with its displayed source text/);
    assert.match(prompt, /Do not create a second entity for a referent already represented/);
    assert.match(prompt, /Keep exact-span failures and ambiguous anchors visible/);
  });
}

{
  const directory = new URL("./v11/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v11 discovery contract checks individual-type, spatial-type and attribution consistency", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v11");
    assert.match(prompt, /A named being described as a member of a creature class is an individual Creature/);
    assert.match(prompt, /If its notes say it is a Location, its entity_type must be Location/);
    assert.match(prompt, /A named spatial container is a Location candidate even when it is called a universe, dimension, or multiverse/);
    assert.match(prompt, /Bind every assertion to the grammatical source of the stance/);
    assert.match(prompt, /Capture every explicitly named example in a category's membership list/);
    assert.match(prompt, /Leave both anchors empty by default/);
    assert.match(prompt, /When a candidate key is present, use the exact candidate name or exact source alias in `subject_name` or `object_text`/);
    assert.match(prompt, /Do not assign ordinal numbers to a type, subclass, or category unless the source explicitly numbers it/);
  });
}

{
  const directory = new URL("./v12/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v12 discovery contract preserves singular relative-clause subjects and de-duplicates proposals", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v12");
    assert.match(prompt, /When a singular member of a category performs an action in a relative clause, link the action and any date to that individual/);
    assert.match(prompt, /Compare candidates with the same formal name and scope before returning/);
    assert.match(prompt, /A category may be represented once even if its full title appears in a table and narrative/);
    assert.match(prompt, /Retain missing and ambiguous evidence findings without repairing the response/);
  });
}

{
  const directory = new URL("./v13/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v13 discovery contract checks locations, co-subjects, endpoint types and repeated events", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v13");
    assert.match(prompt, /A named plane or hell used as a place of captivity or residence is a Location/);
    assert.match(prompt, /Do not turn two co-subjects of one clause into a relation with each other/);
    assert.match(prompt, /Use a locked relationship only when the exact endpoint types are allowed/);
    assert.match(prompt, /A named happening has one candidate key even when the source refers to it by two descriptions/);
    assert.match(prompt, /Do not attach an attribution to a quote about a different city or event/);
    assert.match(prompt, /Keep an unsupported spelling variant visible as its own ambiguous proposal/);
  });
}

{
  const directory = new URL("./v14/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v14 discovery contract preserves event and place types, attribution, and imported names", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v14");
    assert.match(prompt, /If notes describe a place, the type is Location; if they describe a happening, the type is Event/);
    assert.match(prompt, /Do not create a Concept candidate for an organization already proposed/);
    assert.match(prompt, /Capture each proper name in an imported parenthetical list as a proposal/);
    assert.match(prompt, /Populate attribution when a quotation or imported excerpt names its speaker or source/);
    assert.match(prompt, /A counterfactual prevention claim about a named event has that Event as its object/);
    assert.match(prompt, /A qualification saying a link is unresolved requires the candidate key to be empty/);
    assert.match(prompt, /Do not add a comparison target absent from the source wording/);
  });
}

{
  const directory = new URL("./v15/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v15 discovery contract keeps dates local and blocks co-occurrence relations", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v15");
    assert.match(prompt, /Capture each explicit relative or qualitative period separately/);
    assert.match(prompt, /Do not attach an earlier date to a later clause merely because it follows in the paragraph/);
    assert.match(prompt, /Do not infer a relation between two deities from an adherent name or offering passage/);
    assert.match(prompt, /A name of an adherent or follower is not an alias for the deity or organization/);
    assert.match(prompt, /If notes say that two labels are not established as identical, neither may be listed as an alias/);
    assert.match(prompt, /Split an assertion when its clauses state both an affirmative property and its negation/);
    assert.match(prompt, /Capture each explicit relative or qualitative period separately/);
    assert.match(prompt, /Do not attach an earlier date to a later clause merely because it follows in the paragraph/);
    assert.match(prompt, /Do not attach a quote about an action to a nearby place unless the source says the action occurred there/);
  });
}

{
  const directory = new URL("./v16/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v16 discovery contract blocks duplicate candidates and unsupported typed links", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v16");
    assert.match(prompt, /Before returning, reconcile every entity candidate against all mentions and aliases/);
    assert.match(prompt, /do not create a second candidate for the same referent/);
    assert.match(prompt, /A source heading, grammatical possessive, nearby mention, or table placement does not by itself establish group membership/);
    assert.match(prompt, /For N'Garal, the progenitor is one unnamed Elder God, not the plural Elder Gods category/);
    assert.match(prompt, /Dogma does not prohibit veneration/);
    assert.match(prompt, /negative polarity/);
  });
}
