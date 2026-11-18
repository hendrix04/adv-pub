import assert from "node:assert/strict";
import test from "node:test";
import { blockOperationModeForInvocation, createProcessDocumentWorkflow, discoveryRetryOptions, readinessResult, runDecisionChildren } from "./process-document.js";
import { createJevDecisionBatchWorkflow } from "./jev-decision-batch.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDecisionStage } from "../domains/document/decisions/stage.js";
import { title, listIntroduction, definitionsVersion } from "../domains/document/decisions/questions.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { buildDecisionRequest } from "../domains/document/decisions/request.js";

async function retainedStage(count: number, mixed = false) {
  const directory = await mkdtemp(join(tmpdir(), "child-snapshot-"));
  const source = decodeCapturedSource(Buffer.from("Heading\nBody"));
  const questions = Array.from({ length: count }, (_, index) =>
    mixed && index % 2
      ? listIntroduction({ id: String(index), target: { paragraph: "Heading", next_list: "Body", section_limits: [0, source.byteLength] } })
      : title({ id: String(index), target: { line: "Heading", following_text: "Body", section_limits: [0, source.byteLength] } }),
  );
  const inputLimit = Buffer.byteLength(JSON.stringify(buildDecisionRequest({ source, questions: [questions[0]!], targetMode: "batch" }))) + 2048;
  return prepareDecisionStage({
    directory,
    operationId: "unit",
    stageId: "unit",
    discoveryDirectory: directory,
    source,
    inputLimit,
    targetMode: "batch",
    questions,
    policy: {
      contract_version: "decision-policy-v2",
      definitions_version: definitionsVersion,
      version: "unit",
      mode: "exploratory",
      probability_sum_tolerance: 0.02,
      confidence_tolerance: 0.02,
      calibration_evidence_hashes: [],
      rules: {},
    },
  });
}

test("the readiness task returns an explicit successful result", () => {
  assert.deepEqual(readinessResult(), {
    status: "ready",
    task: "process-document-readiness",
  });
});

test("discovery retries twice with a Hatchet-owned 30-second capped exponential delay", () => {
  assert.deepEqual(discoveryRetryOptions, {
    retries: 2,
    backoff: { factor: 30, maxSeconds: 30 },
  });
});

test("replayed block operations resume retained evidence while first invocations stay new", () => {
  assert.equal(blockOperationModeForInvocation("new", 1), "new");
  assert.equal(blockOperationModeForInvocation("new", 2), "resume");
  assert.equal(blockOperationModeForInvocation("resume", 1), "resume");
});

test("classification cannot silently succeed when its child is unregistered", async () => {
  let fn: (input: unknown, ctx: unknown) => Promise<unknown> = async () => undefined;
  const hatchet = {
    workflow: () => ({
      task: (config: { fn: typeof fn }) => {
        fn = config.fn;
        return {};
      },
    }),
  };
  createProcessDocumentWorkflow(hatchet as never);
  await assert.rejects(fn({ capability: "classify" }, {}), /registered Jev batch child/);
});

test("fan out delegates retries and queue admission to the Hatchet child", () => {
  let definition: Record<string, any> = {};
  createJevDecisionBatchWorkflow({
    task: (config: Record<string, any>) => {
      definition = config;
    },
  } as never);
  assert.equal(definition.retries, 2);
  assert.equal(definition.backoff.factor, 30);
  assert.equal(definition.concurrency[0].maxRuns, 10);
  assert.equal(definition.concurrency[1].maxRuns, 1);
  assert.equal(definition.name, "jev-decision-batch");
});

test("decision batches are all submitted while retaining failures until the stage completes", async () => {
  const calls: string[] = [];
  let active = 0;
  let peakActive = 0;
  const prepared = await retainedStage(6);
  const ctx = {
    spawnChild: async (_child: unknown, input: { batchId: string }) => {
      calls.push(input.batchId);
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (input.batchId === "batch-001") throw new Error("second batch failed");
    },
  };
  assert.equal(await runDecisionChildren(prepared as never, {} as never, ctx as never, {} as never), "Error: second batch failed");
  assert.deepEqual(calls, ["batch-000", "batch-001", "batch-002", "batch-003", "batch-004", "batch-005"]);
  assert.equal(peakActive, 6);
});

test("mixed question kinds keep their prepared submission order", async () => {
  const prepared = await retainedStage(6, true);
  const calls: string[] = [];
  let active = 0;
  let peakActive = 0;
  const ctx = {
    spawnChild: async (_child: unknown, input: { batchId: string }) => {
      calls.push(input.batchId);
      peakActive = Math.max(peakActive, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    },
  };
  assert.equal(await runDecisionChildren(prepared as never, {} as never, ctx as never, {} as never), undefined);
  assert.deepEqual(
    calls,
    prepared.manifest.batches.map((batch) => batch.batch_id),
  );
  assert.equal(peakActive, 6);
});

test("fresh repeat dispatch is distinct from ordinary batch execution and keeps its stable ID", async () => {
  const requests: Array<{ batchId: string; freshRepeatId?: string }> = [];
  const prepared = await retainedStage(2);
  const ctx = {
    spawnChild: async (_child: unknown, input: { batchId: string; freshRepeatId?: string }) => {
      requests.push(input);
    },
  };
  assert.equal(await runDecisionChildren(prepared as never, { verificationProbe: false }, ctx as never, {} as never, "catalog-aliasIdentity-repeat-0123456789abcdef"), undefined);
  assert.deepEqual(requests, [
    {
      batchId: "batch-000",
      freshRepeatId: "catalog-aliasIdentity-repeat-0123456789abcdef",
      stage: { version: 1, directory: prepared.directory },
      verificationProbe: false,
    },
    {
      batchId: "batch-001",
      freshRepeatId: "catalog-aliasIdentity-repeat-0123456789abcdef",
      stage: { version: 1, directory: prepared.directory },
      verificationProbe: false,
    },
  ]);
});

test("an interrupted child wait propagates the original AbortError even alongside a domain failure", async () => {
  const interruption = new Error("durable invocation evicted");
  interruption.name = "AbortError";
  const prepared = await retainedStage(2);
  const ctx = {
    spawnChild: async (_child: unknown, input: { batchId: string }) => {
      if (input.batchId === "batch-000") throw new Error("ordinary failure");
      throw interruption;
    },
  };
  await assert.rejects(runDecisionChildren(prepared as never, {} as never, ctx as never, {} as never), (error) => error === interruption);
});
