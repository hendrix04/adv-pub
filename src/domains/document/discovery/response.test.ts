import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { decodeProposalContent, renderCandidateView, validateProposals } from "./response.js";

const schemaPath = new URL("./v1/schema.json", import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;

test("the discovery contract accepts a complete proposal envelope and flags extra fields", () => {
  const valid = {
    entities: [{ candidate_key: "entity_1", entity_type: "Creature", name: "Mara", aliases: [], mentions: [], notes: "" }],
    assertions: [],
    relationship_proposals: [],
    explicit_dates: [],
    useful_passages: [],
  };
  assert.deepEqual(validateProposals(valid, schema, "").schema, []);
  const invalid = { ...valid, entities: [{ ...valid.entities[0], entity_type: "Character", extra: true }] };
  assert.ok(validateProposals(invalid, schema, "").schema.length >= 2);
});

test("malformed model text remains identifiable for a retained finding", () => {
  const malformed = decodeProposalContent("not JSON");
  assert.match(malformed.finding ?? "", /^Invalid JSON:/);
  assert.deepEqual(decodeProposalContent({ text: "{}" }), {
    finding: "The response content is not a text JSON value.",
  });
});

test("entity evidence findings point to the mentions property present in the proposal", () => {
  const payload = {
    entities: [
      {
        candidate_key: "entity_1",
        entity_type: "Creature",
        name: "Mara",
        aliases: [],
        mentions: [{ evidence_key: "ev_1", quote: "absent", before: "", after: "" }],
        notes: "",
      },
    ],
    assertions: [],
    relationship_proposals: [],
    explicit_dates: [],
    useful_passages: [],
  };
  const findings = validateProposals(payload, schema, "Mara is named.");
  assert.equal(findings.evidence[0]?.key, "entities[0].mentions[0]:ev_1");
  assert.equal(findings.evidence[0]?.status, "missing");
});

test("the readable candidate view retains relationship qualifiers and date pointers", () => {
  const view = renderCandidateView({
    entities: [],
    assertions: [
      {
        assertion_key: "a1",
        subject_name: "N",
        predicate_or_attribute: "age",
        object_text: "ancient",
        polarity: "qualified",
        qualification: "roughly",
        explicit_date_key: "date_1",
        attribution: "scribe",
        evidence: [],
      },
    ],
    relationship_proposals: [
      {
        relationship_key: "r1",
        subject_name: "A",
        predicate: "created",
        proposed_predicate: "spawned",
        object_name: "B",
        polarity: "qualified",
        qualifier: "in the legend",
        attribution: "scribe",
        evidence: [],
      },
    ],
    explicit_dates: [],
    useful_passages: [],
  });
  assert.match(view, /qualification: roughly; date key: date_1; attributed to scribe/);
  assert.match(view, /source relation: spawned; qualifier: in the legend; attributed to scribe/);
});

test("source-local validation catches duplicate evidence keys and unresolved date pointers", () => {
  const payload = {
    entities: [],
    assertions: [
      {
        assertion_key: "a1",
        subject_candidate_key: "",
        subject_name: "N",
        predicate_or_attribute: "age",
        object_candidate_key: "",
        object_text: "old",
        polarity: "positive",
        qualification: "",
        attribution: "",
        explicit_date_key: "date_missing",
        evidence: [{ evidence_key: "ev_shared", quote: "N", before: "", after: "" }],
      },
    ],
    relationship_proposals: [],
    explicit_dates: [
      {
        date_key: "date_1",
        source_wording: "now",
        normalized_value: "",
        describes: "N",
        attribution: "",
        evidence: [{ evidence_key: "ev_shared", quote: "N", before: "", after: "" }],
      },
    ],
    useful_passages: [],
  };
  const findings = validateProposals(payload, schema, "N");
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("unknown explicit_date_key")));
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("Duplicate evidence key")));
});

test("source-local relationship checks flag name-key mismatches and locked endpoint types", () => {
  const payload = {
    entities: [
      { candidate_key: "entity_1", entity_type: "Creature", name: "Mara", aliases: [], mentions: [], notes: "" },
      { candidate_key: "entity_2", entity_type: "Concept", name: "Pantheon", aliases: [], mentions: [], notes: "" },
    ],
    assertions: [],
    relationship_proposals: [
      {
        relationship_key: "rel_1",
        subject_candidate_key: "entity_1",
        subject_name: "Mara",
        predicate: "member_of",
        object_candidate_key: "entity_2",
        object_name: "Council",
        proposed_predicate: "belongs to",
        polarity: "positive",
        qualifier: "",
        attribution: "",
        evidence: [],
      },
    ],
    explicit_dates: [],
    useful_passages: [],
  };
  const findings = validateProposals(payload, schema, "");
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("object_name does not match")));
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("incompatible endpoint type") && item.message.includes("object_candidate_key")));
});

test("source-local assertion checks flag candidate keys that disagree with displayed names or objects", () => {
  const payload = {
    entities: [
      { candidate_key: "entity_1", entity_type: "Creature", name: "Lloth", aliases: [], mentions: [], notes: "" },
      { candidate_key: "entity_2", entity_type: "Creature", name: "Gruumush", aliases: [], mentions: [], notes: "" },
    ],
    assertions: [
      {
        assertion_key: "assertion_1",
        subject_candidate_key: "entity_1",
        subject_name: "Gruumush",
        predicate_or_attribute: "receives offerings",
        object_candidate_key: "entity_2",
        object_text: "spiders",
        polarity: "positive",
        qualification: "",
        attribution: "",
        explicit_date_key: "",
        evidence: [],
      },
    ],
    relationship_proposals: [],
    explicit_dates: [],
    useful_passages: [],
  };
  const findings = validateProposals(payload, schema, "");
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("subject_name does not match")));
  assert.ok(findings.sourceKeys.some((item) => item.message.includes("object_text does not match")));
});
