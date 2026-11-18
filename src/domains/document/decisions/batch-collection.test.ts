import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionsRequest$outboundSchema } from "@openrouter/sdk/models";
import { decodeCapturedSource } from "../discovery/source.js";
import { writeJsonAtomic, readJson } from "../discovery/artifacts.js";
import { prepareDecisionStage, collectDecisionStage } from "./stage.js";
import { readValidatedBatches } from "./batch-collection.js";
import { questionDecisionSchema, sha256, type QuestionManifest } from "./contracts.js";
import { definitionsVersion, title } from "./questions.js";
import { validateBatchResponse } from "./validation.js";

async function fixture(directory: string) {
  const source = decodeCapturedSource(Buffer.from("Keep\r\nThe keep shelters visitors.🧙"));
  return prepareDecisionStage({
    directory,
    operationId: "unit",
    stageId: "titles",
    discoveryDirectory: directory,
    source,
    inputLimit: 32000,
    targetMode: "single",
    questions: [
      title({
        id: "keep",
        target: {
          line: "Keep",
          following_text: "The keep shelters visitors.🧙",
          section_limits: [0, source.byteLength],
        },
      }),
    ],
    policy: {
      contract_version: "decision-policy-v2",
      definitions_version: definitionsVersion,
      version: "repeat-unit",
      mode: "supported",
      probability_sum_tolerance: 0.02,
      confidence_tolerance: 0.02,
      calibration_evidence_hashes: ["unit-review"],
      rules: { title: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true } },
    },
  });
}

async function save(directory: string, manifest: QuestionManifest, probability: number, repeatId?: string) {
  const batch = manifest.batches[0]!;
  const root = repeatId ? join(directory, "batches", batch.batch_id, "repeats", repeatId) : join(directory, "batches", batch.batch_id);
  const responsePath = join(root, "attempt-unit", "response-body.txt");
  const raw = {
    model: "typesafe/jev-1.13",
    provider: "TypeSafe",
    answers: { keep: { type: "noul", noul: probability } },
  };
  await writeJsonAtomic(responsePath, raw);
  await writeJsonAtomic(join(root, "attempt-unit", "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batch.request));
  const checked = validateBatchResponse(raw, manifest, batch.batch_id, responsePath);
  assert.deepEqual(checked.findings, []);
  await writeJsonAtomic(join(root, "result.json"), {
    batch_sha256: batch.batch_sha256,
    configuration_sha256: manifest.configuration_sha256,
    response_path: responsePath,
    response_sha256: sha256(await readFile(responsePath)),
    decisions: checked.decisions,
  });
  return responsePath;
}

test("catalog collection preserves missing-primary and missing/disagreeing/agreed-repeat boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap-reuse-collection-"));
  try {
    const { manifest } = await fixture(directory);
    const missing = await collectDecisionStage(directory, "fresh");
    assert.equal(missing.status, "failed");
    assert.deepEqual(missing.findings, ["Missing batch batch-000"]);
    await save(directory, manifest, 0.9);
    await collectDecisionStage(directory, "fresh");
    let decisions = (await readJson(join(directory, "decisions.json"))) as Array<{
      action: { status: string; findings: string[] };
      repeat_response_reference: string | null;
    }>;
    assert.equal(decisions[0]!.action.status, "unresolved");
    assert.deepEqual(decisions[0]!.action.findings, ["Fresh repeat required"]);
    assert.equal(decisions[0]!.repeat_response_reference, null);
    await save(directory, manifest, 0.1, "fresh");
    await collectDecisionStage(directory, "fresh");
    decisions = (await readJson(join(directory, "decisions.json"))) as typeof decisions;
    assert.deepEqual(decisions[0]!.action.findings, ["Fresh repeat disagrees"]);
    const repeatPath = await save(directory, manifest, 0.8, "fresh");
    const complete = await collectDecisionStage(directory, "fresh");
    assert.equal(complete.status, "complete");
    assert.deepEqual(complete.diagnostics.repeat_agreement, { available: 1, agreeing: 1 });
    decisions = (await readJson(join(directory, "decisions.json"))) as typeof decisions;
    assert.equal(decisions[0]!.action.status, "supported");
    assert.equal(decisions[0]!.repeat_response_reference, repeatPath);
    const previousResult = await readFile(join(directory, "result.json"));
    await writeFile(repeatPath, "{}");
    await assert.rejects(collectDecisionStage(directory, "fresh"), /Saved raw response hash differs/);
    assert.deepEqual(await readFile(join(directory, "result.json")), previousResult);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared collection lets candidate collectors retain invalid-evidence findings while strict callers stop", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap-reuse-invalid-"));
  try {
    const { manifest } = await fixture(directory);
    const responsePath = await save(directory, manifest, 0.9);
    await writeFile(responsePath, "{}");
    const findings: string[] = [];
    const entries = [];
    for await (const entry of readValidatedBatches(directory, manifest, {
      parse: (decision) => questionDecisionSchema.parse(decision),
      onError: (error, id) => findings.push(`${id}: ${error instanceof Error ? error.message : String(error)}`),
    }))
      entries.push(entry);
    assert.deepEqual(entries, []);
    assert.deepEqual(findings, ["batch-000: Saved raw response hash differs"]);
    await assert.rejects(async () => {
      for await (const _entry of readValidatedBatches(directory, manifest, {
        parse: (decision) => questionDecisionSchema.parse(decision),
      })) {
        /* consume evidence */
      }
    }, /Saved raw response hash differs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
