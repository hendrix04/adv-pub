import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadClassificationCriteria, sourceCandidates } from "../../domains/document/decisions/semantic-input.js";
import { decodeCapturedSource } from "../../domains/document/discovery/source.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";

const root = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds");
const directory = join(root, "document-01-combined-entity-test");
const template = JSON.parse(await readFile(join(root, "apollo-lathanderan-experiment/winning-request.json"), "utf8"));
const rules = await loadClassificationCriteria();
const criteria = { ...rules.criteria,
  mixed_referents: "The candidate's names identify multiple distinct referents rather than one entity. This includes different beings, a being and its followers, a group and its doctrine, or distinct places. Sharing one entity type does not make distinct referents identical.",
  insufficient_evidence: "The source does not settle whether the candidate identifies one specific qualifying entity or which approved entity type applies. Evidence is insufficient or conflicting, so clarification is needed." };
assert.equal(Object.keys(criteria).length, 10);
template.questions = { entity: { type: "choice", criteria,
  instructions: "Use complete_source, table1, table_reading_rules, glossary, entity_definitions and entity_rules. What does target.candidate identify in this document? Judge all its names together, using the supplied campaign meaning rather than external lore. If the names identify different referents, choose mixed_referents. If one specific referent fits an approved definition, select that type. If the candidate is generic content, structural metadata or otherwise not a qualifying entity, choose not_an_entity. If the source does not settle qualification or type, choose insufficient_evidence. A source mention is sufficient: do not require importance, lengthy description or an article. Examples and hypothetical statements retain their source meaning; they do not automatically establish an Event. Do not classify a deity as its followers, a place as its inhabitants, or a group's doctrine as the group itself." } };
template.state.entity_rules = rules.governingRules;
delete template.state.target;
await writeJsonAtomic(join(directory, "template.json"), template);
const church = ["UnifiedChurch", "Unified Church", "Church", "Unified Church of the Realms", "UCR"];
const deity = ["Apollo", "Lathander", "Dawnfather"];
const followers = ["Apolloite", "Lathanderan"];
const pantheon = ["Pantheon", "The 'Official' Pantheon of the Unified Church of the Realms", "'Official' Pantheon", "Gods of the Realms", "Divine Lords"];
const definitions: Array<[string, string[], string[] | null, string]> = [
  ["Church", church, ["Organization"], "Source describes the formal Church and user accepts its name variants."],
  ["Apollo deity", deity, ["Creature"], "User adjudication: these name one deity; ontology includes deities as individual beings."],
  ["Apollo followers", followers, ["Organization"], "Reviewer expectation: source-local followers have a collective religious identity; not the deity."],
  ["Pantheon", pantheon, ["Concept", "Organization"], "Review-sensitive: named theological construct or collectively ruling divine group; record actual type without forcing one interpretation."],
  ["Thor / Talos", ["Thor", "Talos"], ["Creature"], "Source explicitly identifies deity aliases."],
  ["Lloth / Lolth", ["Lloth", "Lolth"], ["Creature"], "User-accepted spelling variants of one deity."],
  ["Gruumush / Gruumsh", ["Gruumush", "Gruumsh"], ["Creature"], "User-accepted spelling variants of one deity."],
  ["Dogma", ["Dogma", "Dogma of the Unified Church"], ["Concept"], "Specific doctrine, distinct from the organization."],
  ["Realms", ["Realms", "Forgotten Realms"], ["Location"], "Reviewer setting-name interpretation; this is not the wiki itself."],
  ["Waterdeep", ["Waterdeep"], ["Location"], "Named place in source."],
  ["Cathedral", ["Cathedral of the Dawnfather"], ["Location"], "Named cathedral site, distinct from its namesake deity."],
  ["Pherria Jynks", ["Pherria Jynks"], ["Creature"], "Named individual with a role in Church doctrine."],
  ["Earlier movement", ["late DR1400's movement"], null, "User says different type from Church, but did not assign a type. Unscored; compare to Church result."],
  ["Deity plus followers", [...deity, ...followers], ["mixed_referents"], "Deliberately wrong grouping under user adjudication."],
  ["Church plus movement", [...church, "late DR1400's movement"], ["mixed_referents"], "Deliberately wrong grouping under user adjudication."],
  ["Church plus doctrine", [...church, "Dogma", "Dogma of the Unified Church"], ["mixed_referents"], "Organization and its doctrine are different referents."],
  ["Two distinct places", ["Waterdeep", "Cathedral of the Dawnfather"], ["mixed_referents"], "Both can be Locations but city and its cathedral are distinct referents."],
  ["Table header: Suggested Domains", ["Suggested Domains"], ["not_an_entity"], "Column label is structural metadata, not a campaign referent."],
  ["Table header: Province", ["Province"], ["not_an_entity"], "Column label is structural metadata, not a campaign referent."],
  ["Example festival", ["midnight dance festival"], null, "Unscored borderline: source example, no established named/dated event; do not reject solely because hypothetical."],
];
const source = decodeCapturedSource(Buffer.from(template.state.complete_source, "utf8"));
const cases: any[] = [];
for (let index = 0; index < definitions.length; index++) {
  const [label, names, expected, reason] = definitions[index]!;
  const members = sourceCandidates(names, source, "diagnostic-combined-entity-v1");
  assert(members.every((m) => m.occurrences.length));
  const candidate = { kind: "source_candidate_group", names, aliases: names.slice(1),
    members: members.map((m) => ({ name: m.name, source_evidence: m.occurrences })), source_evidence: members.flatMap((m) => m.occurrences) };
  for (let repeat = 1; repeat <= 3; repeat++) cases.push({ id: `case-${String(index + 1).padStart(2, "0")}-repeat-${repeat}`,
    case_id: `case-${String(index + 1).padStart(2, "0")}`, label, repeat, expected, reference_reason: reason, target: { candidate } });
}
await writeJsonAtomic(join(directory, "cases.json"), cases);
console.log(`Prepared ${definitions.length} cases, ${cases.length} fresh requests, ten options; exact source evidence verified.`);
