import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderCandidateView, validateProposals } from "./response.js";

{
  const directory = new URL("./v25/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v25 recovers omitted named source referents and distinct imported beings", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v25");
    for (const name of ["Caine", "Kheldell", "Calimport", "Satan", "Dalmon Hellstrom", "Satana", "Ghost Rider", "Undying Ones"]) {
      assert.ok(prompt.includes(name), `v25 should explicitly check ${name}`);
    }
    assert.match(prompt, /unnamed demon explicitly described as posing as Satan/);
    assert.match(prompt, /without treating the parenthetical list as identity\/alias assertions/);
  });

  test("v25 keeps deity identity, collective Divine Lords, negation, and counterfactual meaning source-faithful", () => {
    for (const name of ["Orcus", "Yeenoghu", "Eilistralee"]) assert.match(prompt, new RegExp(`${name}.*Creature`));
    assert.match(prompt, /Divine Lords is the collective group/);
    assert.match(prompt, /negative polarity exactly once/);
    assert.match(prompt, /would have prevented the Fall/);
    assert.match(prompt, /counterfactual, not a Dogma requirement/);
  });

  test("v25 uses deterministic table inventory as context while retaining one model-produced response", () => {
    assert.match(prompt, /deterministic navigation inventory/i);
    assert.match(prompt, /not a candidate list/);
    assert.match(prompt, /same single structured proposal response/);
  });
}

{
  const directory = new URL("./v26/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v26 preserves source spellings and grammatical subjects without inventing holdout claims", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v26");
    assert.match(prompt, /Lloth and Gruumush as source-used spellings/);
    assert.match(prompt, /sword coast/);
    assert.match(prompt, /single-God holdouts/);
    assert.match(prompt, /the universe is the grammatical subject of the reset statement/i);
    assert.match(prompt, /Pherria Jynks is the speaker\/attribution.*not the actor/);
    assert.match(prompt, /“The Fall of Elturel” is the supported event name/);
  });

  test("v26 requires disambiguating exact context for repeated evidence", () => {
    assert.match(prompt, /quote repeated in the source/);
    assert.match(prompt, /unique match in the complete source/);
    assert.match(prompt, /do not shorten context until it becomes ambiguous/i);
  });
}

{
  const directory = new URL("./v27/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v27 assigns the Gods-in-realms clause to its source-stated property", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v27");
    assert.match(prompt, /Hundreds of Gods were known to exist in the realms/);
    assert.match(prompt, /unlinked subject name `Hundreds of Gods`/);
    assert.match(prompt, /Do not move the subject phrase into `object_text`/);
  });

  test("v27 preserves source subjects across quoted and attributed assertions", () => {
    assert.match(prompt, /`the universe` as `subject_name`/);
    assert.match(prompt, /“the number of worshipers” as the subject/);
    assert.match(prompt, /“Lawful stability,” “chaos leading to innovation and growth,” and “Neutral balance” as subjects/);
    assert.match(prompt, /must not be placed in `object_text` while `subject_name` is empty/);
  });

  test("v27 fixes the exact remaining evidence context cases", () => {
    assert.match(prompt, /Hells quote/);
    assert.match(prompt, /`Angels and Demons` quote/);
    assert.match(prompt, /first in normal prose/);
    assert.match(prompt, /later as a repeated italicized quotation/);
  });

  test("v27 covers the opening, observer, date, and imported-spatial statements from iteration 037", () => {
    assert.match(prompt, /offerings to other major deities/);
    assert.match(prompt, /surprised some observers/);
    assert.match(prompt, /have spent years.*only to the reconsideration clause/);
    assert.match(prompt, /imported `multiverse of dimensions` as a distinct Location/);
    assert.match(prompt, /beings who are not strictly mortal/);
    assert.match(prompt, /exact period “have spent years” only to/);
    assert.match(prompt, /exact immediate surrounding source characters.*before.*of .*after.*These be-ings/s);
  });

  test("v27 prioritizes high-recall source-grounded proposals and preserves uncertainty", () => {
    assert.match(prompt, /Optimize for recall at discovery/);
    assert.match(prompt, /retain a source-grounded proposal with an uncertainty qualification/);
    assert.match(prompt, /do not omit it merely because its identity or campaign specificity is uncertain/);
    assert.match(prompt, /do not invent details to make the proposal definite/i);
  });
}

{
  const directory = new URL("./v28/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v28 gives a compact entity-name task and locked entity boundary", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v28");
    assert.ok(prompt.split("\n").length < 40);
    for (const type of ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"]) {
      assert.match(prompt, new RegExp(`- ${type}:`));
    }
    assert.match(prompt, /Return only a list of candidate names/);
    assert.match(prompt, /a candidate even when it appears only in a table/);
    assert.doesNotMatch(prompt, /unified church|Calimport|Yolonda|Halflings/);
  });

  test("v28 response contract contains names only, with no classification or downstream fields", () => {
    assert.deepEqual(Object.keys(schema.properties as object), ["entities"]);
    const entities = (schema.properties as Record<string, Record<string, unknown>>).entities;
    const item = entities.items as Record<string, unknown>;
    assert.deepEqual(Object.keys(item.properties as object), ["name"]);
    assert.deepEqual(item.required, ["name"]);
  });
}

{
  const directory = new URL("./v29/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v29 is a concise source-grounded name-finding prompt with locked recognition definitions", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v29");
    assert.ok(prompt.split("\n").length < 40);
    for (const type of ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"]) {
      assert.match(prompt, new RegExp(`- ${type}:`));
    }
    assert.match(prompt, /favor recall/i);
    assert.match(prompt, /Names appearing only in table cells still count/);
    assert.match(prompt, /Use only the supplied\s+source/);
    assert.doesNotMatch(prompt, /unified church|Calimport|Yolonda|Halflings/);
  });

  test("v29 structured response is an entity string list only", () => {
    assert.deepEqual(Object.keys(schema.properties as object), ["entities"]);
    const entities = (schema.properties as Record<string, Record<string, unknown>>).entities;
    assert.deepEqual(entities.items, { type: "string" });
    const checked = validateProposals({ entities: ["Aruna", "United Church of the Realms"] }, schema, "Aruna; United Church of the Realms.");
    assert.deepEqual(checked.schema, []);
    assert.deepEqual(checked.evidence, []);
    assert.equal(
      renderCandidateView({ entities: ["Aruna", "United Church of the Realms"] }),
      [
        "# Entity name candidates",
        "",
        "Unaccepted candidate names from one complete-source discovery response.",
        "",
        "## Entities (2)",
        "",
        "- Aruna",
        "- United Church of the Realms",
        "",
      ].join("\n"),
    );
  });
}

{
  const directory = new URL("./v30/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v30 keeps the entity-name instruction concise and covers embedded names and source forms", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v30");
    assert.ok(prompt.split("\n").length < 40);
    assert.match(prompt, /include a name when it\s+independently refers/i);
    assert.match(prompt, /Preserve separately used short names and acronyms/);
    assert.match(prompt, /exact source wording and capitalization/);
    assert.match(prompt, /Names in table cells count/);
    for (const type of ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"]) {
      assert.match(prompt, new RegExp(`- ${type}:`));
    }
    assert.doesNotMatch(prompt, /unified church|Elturel|UCR|Interdimensional space|Calimport/);
  });

  test("v30 strict response remains a string list, with no downstream decisions", () => {
    assert.deepEqual(Object.keys(schema.properties as object), ["entities"]);
    const entities = (schema.properties as Record<string, Record<string, unknown>>).entities;
    assert.deepEqual(entities.items, { type: "string" });
    const checked = validateProposals({ entities: ["Elturel", "UCR"] }, schema, "Elturel; UCR.");
    assert.deepEqual(checked.schema, []);
    assert.equal(renderCandidateView({ entities: ["Elturel", "UCR"] }).includes("- Elturel\n- UCR"), true);
  });
}

{
  const directory = new URL("./v31/", import.meta.url);
  const [prompt, schemaText] = await Promise.all([readFile(new URL("prompt.md", directory), "utf8"), readFile(new URL("schema.json", directory), "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;

  test("v31 retains the compact seven-type boundary with source-wide short-form coverage", () => {
    assert.equal(schema.$id, "adventurers-pub/document-discovery/v31");
    assert.ok(prompt.split("\n").length < 40);
    assert.match(prompt, /even if it occurs within a longer\s+event or organization name/);
    assert.match(prompt, /Preserve separately used short names and acronyms/);
    assert.match(prompt, /do not expand them/);
    assert.match(prompt, /exact source wording and capitalization/);
    for (const type of ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"]) {
      assert.match(prompt, new RegExp(`- ${type}:`));
    }
    assert.doesNotMatch(prompt, /unified church|Elturel|UCR|Interdimensional space|Calimport/);
  });

  test("v31 structured response remains a strict entity-name string list", () => {
    assert.deepEqual(Object.keys(schema.properties as object), ["entities"]);
    const entities = (schema.properties as Record<string, Record<string, unknown>>).entities;
    assert.deepEqual(entities.items, { type: "string" });
    const checked = validateProposals({ entities: ["Elturel", "UCR"] }, schema, "Elturel; UCR.");
    assert.deepEqual(checked.schema, []);
  });
}
