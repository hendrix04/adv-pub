import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DecisionsRequest$outboundSchema } from "@openrouter/sdk/models";
import { prepareDecisionStage } from "./stage.js";
import { assertExecutionCompatibility } from "./retained-stage.js";
import { readValidatedBatch, executeDecisionBatch, withValidatedBatchSnapshot, type BatchSnapshot } from "./operation.js";
import { validateBatchResponse } from "./validation.js";
import { manifestSchema, sha256, aliasQuestionVersion, type AliasManifest } from "./contracts.js";
import { planDecisionBatches } from "./request.js";
import { loadClassificationCriteria } from "./semantic-input.js";
import { decodeCapturedSource } from "../discovery/source.js";
import { writeJsonAtomic } from "../discovery/artifacts.js";
import * as questions from "./questions.js";
import { seedCompatibleBatchEvidence } from "../blocks/reuse.js";
import { runDecisionChildren } from "../../../workflows/process-document.js";
import { loadVerifiedStage } from "./verified-stage.js";

test("decision reuse revalidates wire data; policy and upstream changes invalidate execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap25-stage-"));
  const upstream = join(directory, "upstream.json");
  await writeFile(upstream, "original");
  const source = decodeCapturedSource(Buffer.from("title\r\nbody🧙"));
  const prepared = await prepareDecisionStage({
    directory,
    operationId: "unit",
    stageId: "unit",
    discoveryDirectory: directory,
    source,
    inputLimit: 32000,
    upstreamPaths: { discovery: upstream },
    targetMode: "batch",
    questions: [
      questions.title({
        id: "x",
        target: { line: "title", following_text: "body🧙", section_limits: [0, source.byteLength] },
      }),
    ],
    policy: {
      version: "unit",
      mode: "exploratory",
      contract_version: "decision-policy-v2",
      definitions_version: questions.definitionsVersion,
      probability_sum_tolerance: 0.02,
      confidence_tolerance: 0.02,
      calibration_evidence_hashes: [],
      rules: { title: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false } },
    },
  });
  assert.equal(prepared.manifest.config.max_concurrent_requests, 10);
  const historicalFourSlotManifest = structuredClone(prepared.manifest);
  historicalFourSlotManifest.config.max_concurrent_requests = 4;
  historicalFourSlotManifest.configuration_sha256 = sha256(JSON.stringify(historicalFourSlotManifest.config));
  await assertExecutionCompatibility(manifestSchema.parse(historicalFourSlotManifest), directory);
  const batch = prepared.manifest.batches[0]!;
  const path = join(directory, "wire.json");
  const raw = { model: "typesafe/jev-1.13", provider: "TypeSafe", answers: { x: { type: "noul", noul: 0.8 } } };
  await writeJsonAtomic(path, raw);
  const { DecisionsRequest$outboundSchema } = await import("@openrouter/sdk/models");
  await writeJsonAtomic(join(directory, "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batch.request));
  const validated = validateBatchResponse(raw, prepared.manifest, batch.batch_id, path);
  await writeJsonAtomic(join(directory, "batches", batch.batch_id, "result.json"), {
    batch_sha256: batch.batch_sha256,
    configuration_sha256: prepared.manifest.configuration_sha256,
    response_path: path,
    response_sha256: sha256(await readFile(path)),
    decisions: validated.decisions,
  });
  assert.equal((await readValidatedBatch(directory, prepared.manifest, batch.batch_id))!.decisions.length, 1);
  let token: BatchSnapshot;
  await withValidatedBatchSnapshot(directory, prepared.manifest, async (snapshot) => {
    token = snapshot;
    assert.ok(Object.isFrozen(snapshot.manifest.batches[0]!.request));
    assert.throws(() => {
      snapshot.manifest.batches[0]!.request.state = {};
    }, TypeError);
    assert.equal((await readValidatedBatch(directory, snapshot.manifest, batch.batch_id, undefined, snapshot))!.decisions.length, 1);
  });
  await assert.rejects(readValidatedBatch(directory, token!.manifest, batch.batch_id, undefined, token!), /Inactive/);
  let spawned = 0;
  const ctx = {
    spawnChild: async () => {
      spawned += 1;
    },
  };
  assert.equal(await runDecisionChildren(prepared, {}, ctx as never, {} as never), undefined);
  assert.equal(spawned, 0);
  assert.equal(await runDecisionChildren(prepared, {}, ctx as never, {} as never, "new-fresh-repeat"), undefined);
  assert.equal(spawned, 1); // An ordinary saved answer cannot satisfy a fresh-repeat request.
  const resultPath = join(directory, "batches", batch.batch_id, "result.json");
  const resultBytes = await readFile(resultPath);
  await rm(resultPath);
  const eviction = new Error("child completed while parent was evicted");
  eviction.name = "AbortError";
  let replayCalls = 0;
  const replayContext = {
    taskRunExternalId: () => "same-durable-task",
    spawnChild: async () => {
      replayCalls++;
      await writeFile(resultPath, resultBytes);
      if (replayCalls === 1) throw eviction;
    },
  };
  await assert.rejects(runDecisionChildren(prepared, {}, replayContext as never, {} as never), (error) => error === eviction);
  assert.equal(await runDecisionChildren(prepared, {}, replayContext as never, {} as never), undefined);
  assert.equal(replayCalls, 2); // Replay reproduces its pinned child call, even though the result now exists.
  const resubmission = {
    taskRunExternalId: () => "new-parent-submission",
    spawnChild: async () => {
      throw new Error("Redundant child dispatch");
    },
  };
  assert.equal(await runDecisionChildren(prepared, {}, resubmission as never, {} as never), undefined);
  for (const changedPath of [
    join(directory, "source.md"),
    join(directory, "question-targets.json"),
    join(directory, "decision-policy.json"),
    upstream,
    path,
    join(directory, "outbound-request.json"),
    join(directory, "manifest.json"),
  ]) {
    const bytes = await readFile(changedPath);
    try {
      await assert.rejects(
        withValidatedBatchSnapshot(directory, prepared.manifest, async (snapshot) => {
          assert.ok(await readValidatedBatch(directory, snapshot.manifest, batch.batch_id, undefined, snapshot));
          await writeFile(changedPath, "changed");
        }),
        /snapshot file changed/,
      );
    } finally {
      await writeFile(changedPath, bytes);
    }
  }
  const interruption = new Error("evicted");
  interruption.name = "AbortError";
  const sourceBytes = await readFile(join(directory, "source.md"));
  try {
    await assert.rejects(
      withValidatedBatchSnapshot(directory, prepared.manifest, async () => {
        await writeFile(join(directory, "source.md"), "changed");
        throw interruption;
      }),
      (error) => error === interruption,
    );
  } finally {
    await writeFile(join(directory, "source.md"), sourceBytes);
  }
  const result = await executeDecisionBatch({ stage: { version: 1, directory }, batchId: batch.batch_id }, { retryCount: 0, taskRunId: "unit", workflowRunId: "unit" });
  assert.equal(result.reused, true);
  const checked = await loadVerifiedStage(directory);
  assert.strictEqual(await loadVerifiedStage(directory), checked);
  assert.ok(Object.isFrozen(checked.batches[0]!.request));
  for (const changedPath of [
    join(directory, "manifest.json"),
    join(directory, "source.md"),
    join(directory, "question-targets.json"),
    join(directory, "decision-policy.json"),
    upstream,
  ]) {
    const bytes = await readFile(changedPath);
    try {
      await writeFile(changedPath, "changed");
      await assert.rejects(loadVerifiedStage(directory));
    } finally {
      await writeFile(changedPath, bytes);
    }
    assert.strictEqual(await loadVerifiedStage(directory), checked);
  }
  await writeFile(join(directory, "entity-rules.json"), "{}");
  await assert.rejects(loadVerifiedStage(directory));
  await rm(join(directory, "entity-rules.json"));
  const rebuildDirectory = join(directory, "policy-rebuild");
  const rebuilt = await prepareDecisionStage({
    directory: rebuildDirectory,
    operationId: "rebuilt",
    stageId: "unit",
    discoveryDirectory: directory,
    source,
    inputLimit: 32000,
    upstreamPaths: { discovery: upstream },
    targetMode: "batch",
    questions: [
      questions.title({
        id: "x",
        target: { line: "title", following_text: "body🧙", section_limits: [0, source.byteLength] },
      }),
    ],
    policy: { ...prepared.manifest.policy, version: "reviewed-policy" },
  });
  const seedInput = {
    oldDirectory: directory,
    oldManifest: prepared.manifest,
    currentDirectory: rebuildDirectory,
    currentManifest: rebuilt.manifest,
    batch: rebuilt.manifest.batches[0]!,
  };
  assert.equal((await seedCompatibleBatchEvidence(seedInput)).state, "reused");
  assert.equal((await readValidatedBatch(rebuildDirectory, rebuilt.manifest, seedInput.batch.batch_id))!.responsePath, path);
  const changedBatch = structuredClone(seedInput.batch);
  changedBatch.request.state = { complete_source: "changed" };
  changedBatch.batch_sha256 = sha256(JSON.stringify(changedBatch.request));
  assert.equal((await seedCompatibleBatchEvidence({ ...seedInput, batch: changedBatch })).state, "not_compatible");
  const originalRaw = await readFile(path);
  await writeFile(path, "{}");
  await assert.rejects(seedCompatibleBatchEvidence(seedInput), /Saved raw response hash differs/);
  await writeFile(path, originalRaw);
  // Warm plan reuse must still reject changed requests, source, and retained targets.
  const forged = structuredClone(prepared.manifest);
  forged.batches[0]!.request.state = { complete_source: "forged" };
  forged.batches[0]!.batch_sha256 = sha256(JSON.stringify(forged.batches[0]!.request));
  await assert.rejects(assertExecutionCompatibility(forged), /Planned requests changed/);
  await writeFile(join(directory, "source.md"), "changed");
  await assert.rejects(assertExecutionCompatibility(prepared.manifest), /Retained stage source changed/);
  await writeFile(join(directory, "source.md"), source.bytes);
  const targetPath = join(directory, "question-targets.json");
  const targets = await readFile(targetPath);
  await writeFile(targetPath, "{}");
  await assert.rejects(assertExecutionCompatibility(prepared.manifest), /Retained targets changed/);
  await writeFile(targetPath, targets);
  await writeFile(upstream, "changed");
  await assert.rejects(assertExecutionCompatibility(prepared.manifest), /Upstream artifact changed/);
  await writeFile(upstream, "original");
  prepared.manifest.policy!.version = "changed";
  await assert.rejects(assertExecutionCompatibility(prepared.manifest), /lineage changed/);
});

test("qualification stages retain approved entity rules and their lineage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap25-rules-"));
  const source = decodeCapturedSource(Buffer.from("UCR"));
  const ontology = await loadClassificationCriteria();
  const prepared = await prepareDecisionStage({
    directory,
    operationId: "unit",
    stageId: "qualification",
    discoveryDirectory: directory,
    source,
    inputLimit: 32000,
    targetMode: "batch",
    questions: [
      questions.entityQualification({
        id: "candidate",
        target: { candidate: { names: ["UCR"] } },
        entityRules: ontology,
      }),
    ],
    policy: {
      version: "unit",
      mode: "exploratory",
      contract_version: "decision-policy-v2",
      definitions_version: questions.definitionsVersion,
      probability_sum_tolerance: 0.02,
      confidence_tolerance: 0.02,
      calibration_evidence_hashes: [],
      rules: {
        entityQualification: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false },
      },
    },
  });
  assert.equal(prepared.manifest.config.rules_sha256, ontology.sha256);
  assert.equal((prepared.manifest.batches[0]!.request.state as Record<string, unknown>).entity_rules, ontology.governingRules);
  await assertExecutionCompatibility(prepared.manifest);
  prepared.manifest.config.rules_sha256 = "changed";
  prepared.manifest.configuration_sha256 = sha256(JSON.stringify(prepared.manifest.config));
  await assert.rejects(assertExecutionCompatibility(prepared.manifest), /rules_sha256 changed|Rule hash changed/);
});

test("forged preparation, changed configuration and oversized complete context fail without dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap31-negative-"));
  const source = decodeCapturedSource(Buffer.from("Heading\nBody"));
  const question = questions.title({
    id: "2",
    target: { line: "Heading", following_text: "Body", section_limits: [0, source.byteLength] },
  });
  const other = questions.title({
    id: "1",
    target: { line: "Heading", following_text: "Body", section_limits: [0, source.byteLength] },
  });
  const policy = {
    contract_version: "decision-policy-v2" as const,
    definitions_version: questions.definitionsVersion,
    version: "unit",
    mode: "exploratory" as const,
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [],
    rules: {},
  };
  const input = {
    directory,
    operationId: "unit",
    stageId: "unit",
    discoveryDirectory: directory,
    source,
    inputLimit: 32000,
    targetMode: "batch" as const,
    questions: [question, other],
    policy,
  };
  for (const forged of [
    { ...question, maximum_questions: 50 as const },
    { ...question, question: { ...question.question, instructions: "forged" } },
    { ...question, question: { ...question.question, criteria: { true: "forged", false: "forged" } } },
  ])
    await assert.rejects(prepareDecisionStage({ ...input, questions: [forged] }), /Prepared question/);
  const prepared = await prepareDecisionStage(input);
  await assertExecutionCompatibility(prepared.manifest);
  for (const mutation of [
    { inputLimit: 31000 },
    { targetMode: "single" as const, questions: [question] },
    { policy: { ...policy, version: "changed" } },
    { operationId: "changed" },
  ])
    await assert.rejects(prepareDecisionStage({ ...input, ...mutation }), /inputs changed/);
  const oversized = join(directory, "oversized");
  await assert.rejects(prepareDecisionStage({ ...input, directory: oversized, inputLimit: 10, questions: [question] }), /cannot fit/);
  assert.equal(await readFile(join(oversized, "source.md"), "utf8"), source.text);
  assert.equal(JSON.parse(await readFile(join(oversized, "planning-failure.json"), "utf8")).network_request_sent, false);
  const changed = structuredClone(prepared.manifest);
  changed.question_targets["2"]!.definition_sha256 = "forged";
  await assert.rejects(assertExecutionCompatibility(changed));
});

test("unknown decision versions cannot be stripped by a candidate decision branch", async () => {
  const { retainedDecisionSchema } = await import("./contracts.js");
  const decision = {
    candidate_id: "candidate",
    index: 0,
    name: "Candidate",
    occurrences: [],
    findings: [],
    answer: "Creature",
    confidence: 0.5,
    option_probabilities: {
      Creature: 1,
      Location: 0,
      Organization: 0,
      Item: 0,
      Event: 0,
      Quest: 0,
      Concept: 0,
      not_an_entity: 0,
    },
    question_version: "entity-type-v3-linked",
    outcome: "awaiting_admission_calibration",
    raw_response_reference: "original",
    source_sha256: "original",
    discovery_directory: "original",
  };
  assert.doesNotThrow(() => retainedDecisionSchema.parse(decision));
  for (const version of ["unknown", null, undefined]) assert.throws(() => retainedDecisionSchema.parse({ ...decision, contract_version: version }));
});

test("unversioned aliases revalidate original confidence and reuse a saved result without a network call", async () => {
  const { sourceCandidates, loadClassificationCriteria } = await import("./semantic-input.js");
  const { buildAliasRequest, allCandidatePairs, aliasInstructions } = await import("../aliases/semantic-input.js");
  const { aliasDecisionSchema } = await import("./contracts.js");
  const directory = await mkdtemp(join(tmpdir(), "ap31-candidate-alias-unit-"));
  const source = decodeCapturedSource(Buffer.from("Unified Church calls itself UCR."));
  const rules = await loadClassificationCriteria();
  const proposals = JSON.stringify({ entities: ["Unified Church", "UCR"] });
  const proposalHash = sha256(proposals);
  const candidates = sourceCandidates(["Unified Church", "UCR"], source, sha256(`${directory}\n${proposalHash}`));
  const pairs = allCandidatePairs(candidates);
  const batches = planDecisionBatches(pairs, 32000, 50, (slice) => buildAliasRequest(source, candidates, slice, rules.governingRules));
  const config = {
    model: "typesafe/jev-1.13",
    provider: "typesafe",
    allow_fallbacks: false,
    question_version: aliasQuestionVersion,
    instructions_sha256: sha256(aliasInstructions),
    ontology_sha256: rules.sha256,
    candidate_policy: "all_unordered_pairs",
    batch_size: 50,
    max_concurrent_requests: 4,
    minimum_confidence: 0.9,
    minimum_same_probability: 0.9,
    grouping_policy: "all_member_pairs_supported",
    retries: 2,
    retry_delay_seconds: 30,
    sdk_retries: "disabled",
    verification_probe: false,
  };
  const manifest: AliasManifest = {
    operation_id: "unit",
    decision_kind: "document_alias",
    discovery_directory: directory,
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    candidates_sha256: proposalHash,
    configuration_sha256: sha256(JSON.stringify(config)),
    question_version: aliasQuestionVersion,
    created_at_utc: "unit",
    config,
    candidates,
    alias_pairs: pairs,
    batches,
  };
  assert.equal(JSON.stringify(manifestSchema.parse(manifest)), JSON.stringify(manifest));
  for (const version of ["unknown", null, undefined]) assert.throws(() => manifestSchema.parse({ ...manifest, contract_version: version }));
  await writeFile(join(directory, "source.md"), source.bytes);
  await writeFile(join(directory, "discovery-proposals.json"), proposals);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
  const raw = {
    model: "typesafe/jev-1.13",
    provider: "TypeSafe",
    answers: {
      [pairs[0]!.pair_id]: {
        type: "choice",
        choice: "same_referent",
        confidence: 0.97,
        probabilities: { same_referent: 0.95, different_referents: 0.03, unclear: 0.02 },
      },
    },
  };
  const path = join(directory, "response-body.txt");
  await writeJsonAtomic(path, raw);
  await writeJsonAtomic(join(directory, "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batches[0]!.request));
  const checked = validateBatchResponse(raw, manifest, batches[0]!.batch_id, path);
  assert.deepEqual(checked.findings, []);
  assert.equal(aliasDecisionSchema.parse(checked.decisions[0]).confidence, 0.97); // Candidate-stage confidence is independent of the v2 formula.
  await writeJsonAtomic(join(directory, "batches", batches[0]!.batch_id, "result.json"), {
    batch_sha256: batches[0]!.batch_sha256,
    configuration_sha256: manifest.configuration_sha256,
    response_path: path,
    response_sha256: sha256(await readFile(path)),
    decisions: checked.decisions,
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unit zero-network guard");
  };
  try {
    const result = await executeDecisionBatch({ stage: { version: 1, directory }, batchId: batches[0]!.batch_id }, { retryCount: 0, taskRunId: "unit", workflowRunId: "unit" });
    assert.equal(result.reused, true);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const batchId = batches[0]!.batch_id;
  const outboundPath = join(directory, "outbound-request.json");
  const outbound = await readFile(outboundPath);
  await writeFile(outboundPath, "{}");
  await assert.rejects(readValidatedBatch(directory, manifest, batchId), /outbound/);
  await writeFile(outboundPath, outbound);
  const rawBytes = await readFile(path);
  await writeFile(path, "{}");
  await assert.rejects(readValidatedBatch(directory, manifest, batchId), /raw response hash/);
  await writeFile(path, rawBytes);
  await writeFile(join(directory, "source.md"), "changed");
  await assert.rejects(readValidatedBatch(directory, manifest, batchId), /source differs/);
});
