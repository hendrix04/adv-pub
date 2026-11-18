import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { createProcessDocumentWorkflow } from "../workflows/process-document.js";
import { isAuthorizedDiscoverySource } from "../domains/document/source-policy.js";

const defaultSource = resolve("Resources/Lore/01-unified-church-of-the-realms.md");
const arguments_ = process.argv.slice(2);
const forceNewIteration = arguments_.includes("--new-iteration");
const pathArguments = arguments_.filter((argument) => argument !== "--new-iteration");
if (pathArguments.length > 1) throw new Error("Usage: npm run discover [source-path] [--new-iteration]");
const sourcePath = resolve(pathArguments[0] ?? defaultSource);
if (!isAuthorizedDiscoverySource(sourcePath)) {
  throw new Error(`This discovery launcher is limited to the nine supplied corpus documents (01 through 09); requested ${sourcePath}`);
}

async function main(): Promise<void> {
  await withEmbeddedWorker(
    {
      name: "adv-pub-document-discovery",
      worker: { slots: 1, durableSlots: 1 },
      postgres: { kind: "temporary" },
      onShutdown: (event) => {
        if (event === "stopped") process.stdout.write("Embedded Hatchet stopped.\n");
      },
    },
    (hatchet) => {
      const workflow = createProcessDocumentWorkflow(hatchet);
      return { workflows: [workflow], value: workflow };
    },
    async ({ value: workflow, waitForRun }) => {
      const retryProbeOperationId = process.env.ADV_PUB_RETRY_PROBE_OPERATION_ID;
      if (retryProbeOperationId && process.env.ADV_PUB_TEST_RETRY_PROBE !== "1") throw new Error("Retry probe operation identifier requires the explicit retry probe mode");
      if (retryProbeOperationId && !/^[0-9a-f-]{36}$/i.test(retryProbeOperationId)) throw new Error("Retry probe operation identifier is invalid");
      const operationId = retryProbeOperationId ?? randomUUID();
      const run = await workflow.runNoWait({ sourcePath, operationId, forceNewIteration });
      const runId = await run.runId;
      process.stdout.write(`Hatchet discovery run submitted for ${sourcePath}: ${runId}\n`);
      const details = await waitForRun(runId, { timeoutMs: 35 * 60_000, pollIntervalMs: 500 });
      if (!details) throw new Error("Hatchet discovery run was never visible");
      process.stdout.write(`Hatchet discovery run finished: ${details.status}\n`);
      assert.equal(details.done, true, "discovery workflow timed out");
      assert.equal(details.status, "COMPLETED", `discovery workflow ${details.status}`);
      const result = details.taskRuns["discover-document"]?.output;
      process.stdout.write(`${JSON.stringify({ runId, result }, null, 2)}\n`);
    },
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Document discovery failed: ${message}\n`);
  process.exitCode = 1;
});
