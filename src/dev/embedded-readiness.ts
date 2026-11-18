import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { createReadinessWorkflow } from "../workflows/process-document.js";

async function main(): Promise<void> {
  await withEmbeddedWorker(
    {
      name: "adv-pub-local-readiness",
      worker: { slots: 1 },
      postgres: { kind: "temporary" },
      onShutdown: (event) => {
        const messages = {
          worker: "Stopping Hatchet worker.",
          engine: "Stopping embedded Hatchet.",
          stopped: "Embedded Hatchet stopped.",
        };
        process.stdout.write(`${messages[event]}\n`);
      },
      onFailure: (error) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stderr.write(`Embedded Hatchet readiness failed before cleanup: ${message}\n`);
      },
    },
    (hatchet) => {
      const workflow = createReadinessWorkflow(hatchet);
      return { workflows: [workflow], value: workflow };
    },
    async ({ value: workflow, waitForRun }) => {
      const run = await workflow.runNoWait({ nonce: randomUUID() });
      const runId = await run.runId;
      process.stdout.write(`Hatchet readiness run submitted: ${runId}\n`);
      const details = await waitForRun(runId, { timeoutMs: 30_000, pollIntervalMs: 100 });
      if (!details) throw new Error("readiness workflow was never visible to Hatchet");
      process.stdout.write(`Hatchet readiness run finished: ${details.status}\n`);
      assert.equal(details.done, true, "readiness workflow did not finish before timeout");
      assert.equal(details.status, "COMPLETED");
      assert.deepEqual(details.taskRuns.readiness?.output, {
        status: "ready",
        task: "process-document-readiness",
      });
      process.stdout.write(`${JSON.stringify({ status: "ready", runId, details })}\n`);
    },
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Embedded Hatchet readiness failed: ${message}\n`);
  process.exitCode = 1;
});
