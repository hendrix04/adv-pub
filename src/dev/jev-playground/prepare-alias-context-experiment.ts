import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sourceCandidates } from "../../domains/document/decisions/semantic-input.js";
import { decodeCapturedSource } from "../../domains/document/discovery/source.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";
import { validateWireRequest } from "./request.js";

const parent = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds");
const root = join(parent, "alias-context-factorial-test");
const namingRule = 'An alias must function as a name for the entity, not merely refer back to it. Generic category references such as "the state" or "the dukedom", and animal words such as "bear" or "deer" within a clan name, are not aliases merely because local context identifies the entity. Meaningful shortened proper names, titles, acronyms, epithets, and spelling variants can still be aliases; do not require the full formal name. A common word can qualify when it is actually used as a specific name or nickname.';
const configurations = [
  { id: "A", wording: false, context: false },
  { id: "B", wording: true, context: false },
  { id: "C", wording: false, context: true },
  { id: "D", wording: true, context: true },
];
let requests = 0;
const sequence: string[] = [];
for (const round of [1, 2]) {
  for (const config of round === 1 ? configurations : [...configurations].reverse()) {
    for (const doc of ["01", "02"]) {
      const base = join(parent, doc === "01" ? "document-01-noul-discussed-pairs" : "document-02-noul-grouping");
      const template = JSON.parse(await readFile(join(base, "frozen-template.json"), "utf8"));
      const pairFile = join(parent, doc === "01" ? "document-01-noul-discussed-pairs" : "document-02-generic-name-prompt-test", "pairs.json");
      const pairs: Array<{ id: string; name_a: string; name_b: string }> = JSON.parse(await readFile(pairFile, "utf8"));
      const discovery: { entities: string[] } = JSON.parse(await readFile(resolve(`Resources/Lore/proposed_entities/${doc}.json`), "utf8"));
      const source = decodeCapturedSource(Buffer.from(template.state.complete_source));
      const names = [...new Set([...discovery.entities, ...pairs.flatMap((pair) => [pair.name_a, pair.name_b])])];
      const candidates = sourceCandidates(names, source, "diagnostic-occurrences");
      const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
      const question = template.questions.alias;
      if (config.wording) {
        question.criteria.true += " Both expressions must function as names, rather than merely generic contextual references.";
        question.criteria.false += " A generic reference or fragment that does not function as a name is not an alias, even if it refers to the same thing in a passage.";
        question.instructions = question.instructions.replace("Decide identity, not mere association or extraction eligibility.", "Decide identity as a name, not mere association or a generic contextual reference.");
        question.instructions = question.instructions.replace("Are the two expressions names of the same referent?", namingRule + " Are the two expressions names of the same referent?");
      }
      if (config.context) {
        question.instructions = "Consult target.name_clues.source_evidence for exact occurrences and marked surrounding snippets. Containment in another candidate's span is an observation, not proof for or against an alias. Use the complete source to interpret it. " + question.instructions;
      }
      const cases = pairs.map((pair) => {
        const target: Record<string, unknown> = { name_a: pair.name_a, name_b: pair.name_b, name_clues: {} };
        if (config.context) {
          target.name_clues = { source_evidence: [pair.name_a, pair.name_b].map((name) => ({
            name,
            occurrences: byName.get(name)!.occurrences.map((span) => {
              assert.equal(source.bytes.subarray(span.start_byte, span.end_byte).toString("utf8"), name);
              const start = source.bytes.subarray(0, span.start_byte).toString("utf8").length;
              const end = start + name.length;
              const before = source.text.slice(Math.max(0, start - 100), start);
              const after = source.text.slice(end, Math.min(source.text.length, end + 100));
              const containers = candidates.filter((candidate) => candidate.name !== name && candidate.occurrences.some((other) => other.start_byte <= span.start_byte && other.end_byte >= span.end_byte && other.end_byte - other.start_byte > span.end_byte - span.start_byte));
              return { ...span, text: name, surrounding_text: before + name + after, marked_text: before + "⟦" + name + "⟧" + after, contained_in_candidate_names: containers.map((candidate) => candidate.name) };
            }),
            literal_occurrence_count: byName.get(name)!.occurrences.length,
          })) };
        }
        const wire = structuredClone(template);
        wire.state.target = target;
        validateWireRequest(wire);
        return { id: pair.id, name_a: pair.name_a, name_b: pair.name_b, target };
      });
      const directory = join(root, `round-${round}`, config.id, doc);
      await mkdir(directory, { recursive: true });
      await writeJsonAtomic(join(directory, "template.json"), template);
      await writeJsonAtomic(join(directory, "cases.json"), cases);
      requests += cases.length;
      sequence.push(directory);
    }
  }
}
assert.equal(requests, 584);
await writeJsonAtomic(join(root, "sequence.json"), sequence);
await writeJsonAtomic(join(root, "configurations.json"), configurations);
console.log(`Validated ${requests} requests, including exact source spans; labels remain outside state.`);
