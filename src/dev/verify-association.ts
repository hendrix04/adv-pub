import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { manifestSchema } from "../domains/document/decisions/contracts.js";
import type { QuestionManifest } from "../domains/document/decisions/contracts.js";
import { readValidatedDecisionStage } from "../domains/document/decisions/stage.js";
import { readValidatedBatch } from "../domains/document/decisions/operation.js";
import { loadAssociationInputs } from "../domains/document/association/inputs.js";

if (process.argv.length !== 3) throw new Error("Usage: npm run verify:association -- <association-directory>");
const directory = resolve(process.argv[2]!);
const operation = (await readJson(join(directory, "operation.json"))) as Record<string, any>;
const inputs = await loadAssociationInputs({
  sourcePath: operation.source_path,
  structureDirectory: operation.structure_directory,
  classificationDirectory: operation.classification_directory,
});
assert.equal(inputs.source.sha256, operation.source_sha256);
assert.equal(JSON.stringify(inputs.hashes), JSON.stringify(operation.upstream_hashes));
const stages = await readdir(join(directory, "stages"), { withFileTypes: true });
let questionCount = 0;
let batchCount = 0;
let repeatCount = 0;
for (const entry of stages.filter((value) => value.isDirectory())) {
  const stageDirectory = join(directory, "stages", entry.name);
  let manifest;
  try {
    manifest = manifestSchema.parse(await readJson(join(stageDirectory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    assert.equal(((await readJson(join(stageDirectory, "result.json"))) as { status: string }).status, "complete");
    continue;
  }
  if (manifest.contract_version !== "decision-questions-v2") throw new Error(`Unexpected manifest contract in ${stageDirectory}`);
  const questionManifest = manifest as QuestionManifest;
  const collected = await readValidatedDecisionStage(stageDirectory, operation.repeat_id);
  questionCount += collected.decisions.length;
  for (const batch of questionManifest.batches) {
    const primary = await readValidatedBatch(stageDirectory, questionManifest, batch.batch_id);
    assert.ok(primary, `Missing primary batch ${batch.batch_id} in ${entry.name}`);
    batchCount += 1;
    const needsRepeat = batch.candidate_ids.some((id) => {
      const target = questionManifest.question_targets[id];
      return Boolean(target && questionManifest.policy.rules[target.question_kind]?.require_repeat);
    });
    if (needsRepeat) {
      const repeat = await readValidatedBatch(stageDirectory, questionManifest, batch.batch_id, operation.repeat_id);
      assert.ok(repeat, `Missing required fresh repeat ${batch.batch_id} in ${entry.name}`);
      repeatCount += 1;
    }
  }
}
const ledger = (await readJson(join(directory, "block-subject-target-ledger.json"))) as {
  targets: Array<{ local_entity_id: string; block_id: string }>;
  expected_pair_count: number;
};
assert.equal(ledger.targets.length, ledger.expected_pair_count, "blockSubject target count differs from Cartesian coverage");
assert.equal(
  new Set(ledger.targets.map((target) => `${target.local_entity_id}\0${target.block_id}`)).size,
  ledger.expected_pair_count,
  "blockSubject target ledger contains duplicates",
);
const blockSubjectStage = manifestSchema.parse(await readJson(join(directory, "stages", "initial-subjects-and-origin", "manifest.json")));
if (blockSubjectStage.contract_version !== "decision-questions-v2") throw new Error("blockSubject stage has an unexpected manifest contract");
const blockSubjectQuestionStage = blockSubjectStage as QuestionManifest;
assert.equal(blockSubjectQuestionStage.batches.flatMap((batch) => batch.candidate_ids).filter((id) => id.startsWith("blockSubject-")).length, ledger.expected_pair_count);
const savedResult = (await readJson(join(directory, "result.json"))) as {
  status: string;
  full_product_status: string;
  block_subject_pair_count: number;
};
assert.equal(savedResult.status, "complete");
assert.equal(savedResult.full_product_status, "not_run");
assert.equal(savedResult.block_subject_pair_count, ledger.expected_pair_count);
const proposals = (await readJson(join(directory, "map-place-proposals.json"))) as {
  contract_version: string;
  source_sha256: string;
  layout_sha256: string;
  proposals: unknown[];
};
assert.equal(proposals.contract_version, "source-local-map-place-proposals-v1");
assert.equal(proposals.source_sha256, operation.source_sha256);
assert.equal(proposals.layout_sha256, inputs.hashes.layout_sha256);
assert.deepEqual(proposals.proposals, inputs.layout.place_proposals);
assert.equal(typeof (await readFile(join(directory, "context-view.md"), "utf8")), "string");
const foundSections = (await readJson(join(directory, "found-sections.json"))) as Array<{
  found_section_id: string;
  seed_question_id: string;
  continuation_question_ids: string[];
}>;
const links = (await readJson(join(directory, "links.json"))) as Array<{
  scope: string;
  target_id: string;
  question_ids: string[];
}>;
for (const found of foundSections) {
  const link = links.find((entry) => entry.scope === "found_section" && entry.target_id === found.found_section_id);
  assert.ok(link, `Missing found-section sectionSubject link ${found.found_section_id}`);
  for (const questionId of [found.seed_question_id, ...found.continuation_question_ids])
    assert.ok(link.question_ids.includes(questionId), `Found-section link lost evidence ${questionId}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      verdict: "PASS",
      directory,
      source_sha256: operation.source_sha256,
      input_hashes: inputs.hashes,
      block_subject_pairs: ledger.expected_pair_count,
      decisions: questionCount,
      batches: batchCount,
      fresh_repeat_batches: repeatCount,
      map_place_proposal_count: proposals.proposals.length,
      unresolved_question_count: (savedResult as any).unresolved_question_ids?.length ?? 0,
      live_requests_sent: false,
    },
    null,
    2,
  )}\n`,
);
