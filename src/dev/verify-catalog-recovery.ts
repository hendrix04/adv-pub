import { withTestExecution } from "./execution-retention.js";
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { createJevDecisionBatchWorkflow } from "../workflows/jev-decision-batch.js";
import { runDecisionChildren } from "../workflows/process-document.js";
import { manifestSchema } from "../domains/document/decisions/contracts.js";
import { readValidatedBatch, withValidatedBatchSnapshot } from "../domains/document/decisions/operation.js";
import { writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { jevExecutionPolicy } from "../domains/document/decisions/execution-policy.js";

/** Real engine eviction around the application's child collector; retained results only. */
async function main() {
  const directory = resolve(process.argv[2]!);
  const root = resolve(process.argv[3]!);
  return withTestExecution(root, async () => {
    await mkdir(root, { recursive: true });
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
    await withValidatedBatchSnapshot(directory, manifest, async (snapshot) => {
      for (const batch of snapshot.manifest.batches) assert.ok(await readValidatedBatch(directory, snapshot.manifest, batch.batch_id, undefined, snapshot));
    });
    // A missing result must never turn this operational probe into a paid model call.
    const ledgerPath = process.env.BB_LIVE_COST_LEDGER;
    assert.ok(ledgerPath);
    const before = await readFile(ledgerPath, "utf8");
    const ordinaryFetch = globalThis.fetch;
    let forbiddenCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("openrouter.ai") && url.includes("decisions")) {
        forbiddenCalls++;
        throw new Error("Zero-network recovery guard rejected Jev dispatch");
      }
      return ordinaryFetch(input, init);
    };
    const events: Array<Record<string, unknown>> = [];
    const record = async (event: Record<string, unknown>) => {
      events.push(event);
      await appendFile(join(root, "events.jsonl"), `${JSON.stringify(event)}\n`);
    };
    await withEmbeddedWorker(
      {
        name: "catalog-recovery-review",
        worker: { slots: jevExecutionPolicy.maxConcurrentRequests, durableSlots: 1 },
        postgres: { kind: "persistent", path: join(root, "hatchet-runtime") },
      },
      (hatchet) => {
        const child = createJevDecisionBatchWorkflow(hatchet);
        const gate = hatchet.task<{ stage: { version: 1; directory: string }; batchId: string }, { reused: boolean }>({
          name: "catalog-recovery-delay",
          executionTimeout: "1m",
          fn: async (input) => {
            await new Promise((resolve) => setTimeout(resolve, 8_000));
            const result = await child.run(input);
            assert.equal(result.reused, true);
            return { reused: true };
          },
        });
        const parent = hatchet.durableTask<{ nonce: string }, { status: string }>({
          name: "catalog-recovery-parent",
          evictionPolicy: { ttl: "1s", allowCapacityEviction: false },
          executionTimeout: "1m",
          fn: async (_input, ctx) => {
            await record({
              event: "invocation",
              count: ctx.invocationCount,
              task: ctx.taskRunExternalId(),
              at: new Date().toISOString(),
            });
            try {
              const failure = await runDecisionChildren({ directory, manifest }, {} as never, ctx as never, gate as never, undefined, false);
              assert.equal(failure, undefined);
              await record({ event: "complete", count: ctx.invocationCount, at: new Date().toISOString() });
              return { status: "complete" };
            } catch (error) {
              await record({
                event: "interruption",
                name: error instanceof Error ? error.name : String(error),
                count: ctx.invocationCount,
                at: new Date().toISOString(),
              });
              throw error;
            }
          },
        });
        return { workflows: [child, gate, parent], value: parent };
      },
      async ({ value: parent }) => {
        const result = await Promise.race([
          parent.run({ nonce: String(Date.now()) }),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Recovery probe timed out")), 60_000)),
        ]);
        assert.equal(result.status, "complete");
        assert.ok(events.some((event) => event.event === "interruption" && event.name === "AbortError"));
        assert.ok(events.some((event) => event.event === "complete" && Number(event.count) > 1));
        assert.equal(forbiddenCalls, 0);
        assert.equal(await readFile(ledgerPath, "utf8"), before);
        await writeJsonAtomic(join(root, "report.json"), {
          status: "PASS",
          events,
          network_calls: 0,
          ledger_unchanged: true,
          result,
        });
      },
    );
  });
}
main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
