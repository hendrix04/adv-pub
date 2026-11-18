import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { auditRetainedStage, hash, json } from "./retained-decision-audit.js";
import { auditCatalogClassification } from "./catalog-classification-audit.js";

const args = process.argv.slice(2);
const requireReuse = args.includes("--require-reuse");
const paths = args.filter((arg) => arg !== "--require-reuse");
if (paths.length !== 1) throw new Error("Usage: npm run verify:classification -- <classification-directory> [--require-reuse]");
const directory = resolve(paths[0]!);
try {
  const report = await auditCatalogClassification(directory, requireReuse);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const audit = await auditRetainedStage(directory, requireReuse);
const { manifest, source } = audit;
const proposals = await readFile(join(directory, "discovery-proposals.json"), "utf8");
const names: string[] = JSON.parse(proposals).entities;
assert.equal(manifest.decision_kind, "entity_type");
assert.ok(Array.isArray(manifest.original_candidates));
assert.equal(typeof manifest.alias_directory, "string");
const originals = manifest.original_candidates;
assert.equal(hash(proposals), manifest.candidates_sha256);
assert.equal(hash(await readFile(join(manifest.discovery_directory, "source.md"))), hash(source));
assert.equal(hash(await readFile(join(manifest.discovery_directory, "decoded-proposals.json"))), hash(proposals));
assert.deepEqual(
  originals.map((candidate: any) => candidate.name),
  names,
);
const groupedMembers = manifest.candidates.flatMap((group: any) => group.members ?? [group]);
assert.equal(groupedMembers.length, names.length);
assert.equal(new Set(groupedMembers.map((member: any) => member.candidate_id)).size, names.length);
assert.deepEqual(
  [...groupedMembers].sort((a, b) => a.index - b.index),
  originals,
);
const decisions = await json(join(directory, "decisions.json"));
assert.equal(decisions.length, manifest.candidates.length);
const typeCounts: Record<string, number> = {};
let independentConfidenceValues = 0;
for (const candidate of manifest.candidates) {
  const decision = decisions.find((entry: any) => entry.candidate_id === candidate.candidate_id);
  const answer = audit.answers.get(candidate.candidate_id);
  assert.ok(decision && answer);
  assert.equal(decision.name, candidate.name);
  assert.equal(decision.answer, answer.choice);
  assert.equal(decision.confidence, answer.confidence);
  assert.deepEqual(decision.option_probabilities, answer.probabilities);
  assert.deepEqual(decision.members, candidate.members);
  assert.equal(decision.outcome, "awaiting_admission_calibration");
  for (const member of candidate.members ?? [candidate])
    for (const span of member.occurrences) {
      assert.equal(source.subarray(span.start_byte, span.end_byte).toString("utf8"), member.name);
    }
  if (answer.confidence !== answer.probabilities[answer.choice]) independentConfidenceValues += 1;
  typeCounts[answer.choice] = (typeCounts[answer.choice] ?? 0) + 1;
}
const linked = await auditRetainedStage(manifest.alias_directory, requireReuse);
assert.equal(hash(linked.source), hash(source));
assert.equal(hash(await readFile(join(manifest.alias_directory, "result.json"))), manifest.alias_result_sha256);
const pairs = linked.manifest.alias_pairs;
assert.equal(pairs.length, (originals.length * (originals.length - 1)) / 2);
assert.equal(linked.answers.size, pairs.length);
const pairMap = new Map<string, any>();
for (const pair of pairs) {
  const key = [pair.left_id, pair.right_id].sort().join("/");
  assert.ok(!pairMap.has(key) && pair.left_id !== pair.right_id);
  pairMap.set(key, linked.answers.get(pair.pair_id));
}
for (const group of manifest.candidates) {
  for (let i = 0; i < group.members.length; i += 1)
    for (const right of group.members.slice(i + 1)) {
      const answer = pairMap.get([group.members[i].candidate_id, right.candidate_id].sort().join("/"));
      assert.equal(answer.choice, "same_referent");
      assert.ok(answer.confidence >= linked.manifest.config.minimum_confidence);
      assert.ok(answer.probabilities.same_referent >= linked.manifest.config.minimum_same_probability);
    }
}
const aliasEnds = linked.events.filter((event) => event.delta < 0).map((event) => event.at);
const classificationStarts = audit.events.filter((event) => event.delta > 0).map((event) => event.at);
if (aliasEnds.length && classificationStarts.length) assert.ok(Math.max(...aliasEnds) <= Math.min(...classificationStarts), "Classification overlapped unfinished alias calls");
const aliases = { pair_decisions: pairs.length, ...linked.report, all_group_member_pairs_supported: true };

process.stdout.write(
  JSON.stringify(
    {
      verdict: "PASS",
      directory,
      original_candidates: names.length,
      referents: manifest.candidates.length,
      valid_decisions: decisions.length,
      ...audit.report,
      answers_with_confidence_distinct_from_choice_probability: independentConfidenceValues,
      type_counts: typeCounts,
      aliases,
      semantic_acceptance: "Structural/operational audit only. Document-local groups and classifications are provisional, not canonical admission.",
    },
    null,
    2,
  ) + "\n",
);
