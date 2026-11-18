import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { createJevDecisionBatchWorkflow } from "../workflows/jev-decision-batch.js";
import { createProcessDocumentWorkflow } from "../workflows/process-document.js";
import { preflightJev } from "../domains/document/decisions/provider.js";
import { jevExecutionPolicy } from "../domains/document/decisions/execution-policy.js";
import type { BlocksRunInput } from "../domains/document/blocks/operation.js";
import type { AssociationWorkflowInput } from "../domains/document/association/operation.js";
import type { ProcessDocumentInput } from "../workflows/process-document.js";
import type { JsonObject } from "@hatchet-dev/typescript-sdk/v1/types";
import { writeJsonAtomic } from "../domains/document/discovery/artifacts.js";

export type EmbeddedBlocksInput = Omit<BlocksRunInput, "inputLimit" | "endpointPreflight"> & {
  inputLimit?: number;
};
export type EmbeddedDocumentInput = EmbeddedBlocksInput | AssociationWorkflowInput;
export type EmbeddedBlocksRun = { runId: string; directory: string; result: Record<string, unknown>; details: unknown };
export type EmbeddedBlocksContext = {
  preflight: Awaited<ReturnType<typeof preflightJev>>;
  run: (input: EmbeddedDocumentInput) => Promise<EmbeddedBlocksRun>;
};

export async function withEmbeddedBlocks<T>(body: (context: EmbeddedBlocksContext) => Promise<T>): Promise<T> {
  const preflight = await preflightJev();
  return withEmbeddedWorker(
    { name: "adv-pub-document-blocks", worker: { slots: jevExecutionPolicy.maxConcurrentRequests, durableSlots: 1 }, postgres: { kind: "temporary" } },
    (hatchet) => {
      const batch = createJevDecisionBatchWorkflow(hatchet);
      const workflow = createProcessDocumentWorkflow(hatchet, batch);
      return { workflows: [workflow, batch], value: workflow };
    },
    async ({ value: workflow, waitForRun, throwIfWorkerFailed }) =>
      body({
        preflight,
        run: async (input: EmbeddedDocumentInput) => {
          throwIfWorkerFailed();
          const directory = input.directory;
          const operationId = input.mode === "new" ? input.operationId || randomUUID() : input.operationId;
          const runInput: ProcessDocumentInput =
            input.capability === "blocks"
              ? {
                  ...input,
                  operationId,
                  inputLimit: input.inputLimit ?? preflight.inputLimit,
                  endpointPreflight: JSON.parse(JSON.stringify(preflight)) as JsonObject,
                }
              : { ...input, operationId };
          const run = await workflow.runNoWait(runInput);
          const runId = await run.runId;
          const details = await waitForRun(runId, { timeoutMs: 4 * 60 * 60_000, pollIntervalMs: 500 });
          if (!details?.done || details.status !== "COMPLETED") throw new Error(`Block workflow ${details?.status ?? "not visible"}; inspect ${directory}/result.json`);
          await mkdir(join(directory, "hatchet-runs"), { recursive: true });
          await writeJsonAtomic(join(directory, "hatchet-runs", `${runId}.json`), details);
          const taskName = input.capability === "associate" ? "associate-document" : "build-document-blocks";
          const taskResult = details.taskRuns[taskName]?.output;
          assert.ok(taskResult && typeof taskResult === "object", `${input.capability} workflow did not return a capability result`);
          return { runId, directory, result: taskResult as Record<string, unknown>, details };
        },
      }),
  );
}
