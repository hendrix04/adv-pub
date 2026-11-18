import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classificationOptions,
  sha256,
  classificationDecisionSchema,
  manifestSchema,
  retainedDecisionSchema,
  classificationQuestionVersion,
  type ClassificationManifest,
} from "./contracts.js";
import { decodeCapturedSource } from "../discovery/source.js";
import { sourceCandidates, buildClassificationRequest, loadClassificationCriteria, assertSemanticSource } from "./semantic-input.js";
import { validateBatchResponse, inspectCoverage } from "./validation.js";
import { planDecisionBatches } from "./request.js";
import { readValidatedBatch } from "./operation.js";
import { writeJsonAtomic } from "../discovery/artifacts.js";

async function fixture() {
  const source = decodeCapturedSource(Buffer.from("Élan Guild calls itself Élan. Élan Guild met in Waterdeep."));
  const ontology = await loadClassificationCriteria();
  const candidates = sourceCandidates(["Élan Guild", "Élan", "Waterdeep", "Absent"], source, "fixture");
  const batches = planDecisionBatches(candidates, 32_000, 10, (slice) => buildClassificationRequest(source, slice, ontology));
  const manifest: ClassificationManifest = {
    operation_id: "fixture",
    discovery_directory: "/fixture",
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    candidates_sha256: "fixture",
    configuration_sha256: "fixture",
    question_version: classificationQuestionVersion,
    decision_kind: "entity_type",
    original_candidates: candidates,
    alias_directory: "/fixture/aliases",
    alias_result_sha256: "fixture",
    created_at_utc: "fixture",
    config: {},
    candidates,
    batches,
  };
  const answers = Object.fromEntries(
    batches[0]!.candidate_ids.map((key) => [
      key,
      {
        type: "choice",
        choice: "Organization",
        confidence: 0.65,
        probabilities: Object.fromEntries(classificationOptions.map((name) => [name, name === "Organization" ? 0.8 : name === "Concept" ? 0.2 : 0])),
      },
    ]),
  );
  return { source, ontology, manifest, raw: { model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers } };
}

test("occurrences use original UTF-8 byte coordinates and aliases stay separate", async () => {
  const { source, manifest } = await fixture();
  const candidate = manifest.candidates[2]!;
  assert.notEqual(candidate.occurrences[0]!.start_byte, source.text.indexOf("Waterdeep"));
  for (const item of manifest.candidates)
    for (const span of item.occurrences) {
      assert.equal(source.bytes.subarray(span.start_byte, span.end_byte).toString("utf8"), item.name);
    }
  assert.equal(manifest.candidates.length, 4);
  assert.equal(manifest.candidates[0]!.occurrences.length, 2);
  assert.equal(manifest.candidates[3]!.findings.length, 1);
});

test("batch splitting preserves all candidates and never truncates the source", async () => {
  const { source, manifest, ontology } = await fixture();
  const oneBound = Buffer.byteLength(JSON.stringify(buildClassificationRequest(source, manifest.candidates.slice(0, 1), ontology))) + 2048;
  const batches = planDecisionBatches(manifest.candidates, oneBound + 100, 10, (slice) => buildClassificationRequest(source, slice, ontology));
  assert.ok(batches.length > 1);
  assert.deepEqual(
    batches.flatMap((entry) => entry.candidate_ids),
    manifest.candidates.map((entry) => entry.candidate_id),
  );
  for (const batch of batches) assertSemanticSource(batch.request as never, source.bytes);
  assert.throws(() => planDecisionBatches(manifest.candidates, 10, 10, (slice) => buildClassificationRequest(source, slice, ontology)), /cannot fit/);
  assert.throws(() => assertSemanticSource({ state: { complete_source: "snippet" } } as never, source.bytes), /differs/);
  assert.ok(ontology.governingRules.includes("Supplied quotations and imported excerpts are not excluded through a separate campaign-adoption test"));
});

test("confidence is preserved separately from choice probability and answer ordering", async () => {
  const { manifest, raw } = await fixture();
  raw.answers = Object.fromEntries(Object.entries(raw.answers).reverse());
  const validated = validateBatchResponse(raw, manifest, manifest.batches[0]!.batch_id, "/raw");
  assert.deepEqual(validated.findings, []);
  assert.equal(classificationDecisionSchema.parse(validated.decisions[0]).confidence, 0.65);
  assert.equal(classificationDecisionSchema.parse(validated.decisions[0]).option_probabilities.Organization, 0.8);
  assert.equal(classificationDecisionSchema.parse(validated.decisions[0]).index, 0);
  assert.equal(classificationDecisionSchema.parse(validated.decisions[0]).outcome, "awaiting_admission_calibration");
});

test("classification requires the active question version and alias-first provenance", async () => {
  const { manifest, raw } = await fixture();
  assert.deepEqual(manifestSchema.parse(manifest), manifest);
  for (const field of ["decision_kind", "original_candidates", "alias_directory", "alias_result_sha256"] as const) {
    const incomplete: Record<string, unknown> = { ...manifest };
    delete incomplete[field];
    assert.throws(() => manifestSchema.parse(incomplete));
  }
  for (const version of ["entity-type-v1", "entity-type-v2", "unknown"]) {
    assert.throws(() => manifestSchema.parse({ ...manifest, question_version: version }));
  }
  const decision = validateBatchResponse(raw, manifest, manifest.batches[0]!.batch_id, "/raw").decisions[0]!;
  assert.doesNotThrow(() => retainedDecisionSchema.parse(decision));
  assert.throws(() => retainedDecisionSchema.parse({ ...decision, question_version: "entity-type-v1" }));
});

test("missing, extra, malformed answers and provider substitution fail validation", async () => {
  const { manifest, raw } = await fixture();
  const first = manifest.batches[0]!.candidate_ids[0]!;
  delete raw.answers[first];
  raw.answers.extra = { type: "choice", choice: "Other", confidence: 2, probabilities: {} } as never;
  raw.provider = "OpenAI";
  const validated = validateBatchResponse(raw, manifest, manifest.batches[0]!.batch_id, "/raw");
  assert.ok(validated.findings.some((entry) => entry.includes("Unexpected answer ID")));
  assert.ok(validated.findings.some((entry) => entry.includes(first)));
  assert.ok(validated.findings.some((entry) => entry.includes("provider")));
  const coverage = inspectCoverage(
    manifest,
    [...validated.decisions, ...validated.decisions].map((entry) => classificationDecisionSchema.parse(entry)),
  );
  assert.deepEqual(coverage.missing, [first]);
  assert.ok(coverage.findings.some((entry) => entry.includes("Duplicate")));
});

test("a saved batch must match its pinned input and original raw response", async () => {
  const { manifest, raw, source, ontology } = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "adv-pub-decision-"));
  try {
    manifest.alias_directory = join(directory, "aliases");
    await writeJsonAtomic(join(manifest.alias_directory, "result.json"), { groups: manifest.candidates });
    manifest.alias_result_sha256 = sha256(await readFile(join(manifest.alias_directory, "result.json")));
    const proposals = JSON.stringify({ entities: manifest.candidates.map((c) => c.name) });
    manifest.candidates_sha256 = sha256(proposals);
    manifest.config = {
      model: "typesafe/jev-1.13",
      provider: { only: ["typesafe"], allow_fallbacks: false },
      sdk_retries: "disabled",
      retries: 2,
      retry_delay_seconds: 30,
      max_concurrent_requests: 4,
      ontology_sha256: ontology.sha256,
    };
    manifest.configuration_sha256 = sha256(JSON.stringify(manifest.config));
    await writeFile(join(directory, "source.md"), source.bytes);
    await writeFile(join(directory, "discovery-proposals.json"), proposals);
    await writeJsonAtomic(join(directory, "ontology-criteria.json"), ontology);
    const batch = manifest.batches[0]!;
    const { DecisionsRequest$outboundSchema } = await import("@openrouter/sdk/models");
    await writeJsonAtomic(join(directory, "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batch.request));
    const rawPath = join(directory, "raw.json");
    await writeFile(rawPath, JSON.stringify(raw));
    const decisions = validateBatchResponse(raw, manifest, batch.batch_id, rawPath).decisions;
    await writeJsonAtomic(join(directory, "batches", batch.batch_id, "result.json"), {
      batch_sha256: batch.batch_sha256,
      configuration_sha256: manifest.configuration_sha256,
      response_path: rawPath,
      response_sha256: sha256(await readFile(rawPath)),
      decisions,
    });
    assert.equal((await readValidatedBatch(directory, manifest, batch.batch_id))!.decisions.length, decisions.length);
    await writeFile(rawPath, "{}");
    await assert.rejects(readValidatedBatch(directory, manifest, batch.batch_id), /raw response hash differs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent atomic writes use separate temporary paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adv-pub-atomic-"));
  try {
    const path = join(directory, "result.json");
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeJsonAtomic(path, { index })));
    assert.ok(Number.isInteger(JSON.parse(await readFile(path, "utf8")).index));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
