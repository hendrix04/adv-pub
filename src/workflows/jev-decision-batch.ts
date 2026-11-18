import type { HatchetClient } from "@hatchet-dev/typescript-sdk/v1";
import { ConcurrencyLimitStrategy, NonRetryableError } from "@hatchet-dev/typescript-sdk/v1/task";
import { executeDecisionBatch } from "../domains/document/decisions/operation.js";
import { RetryableDecisionError } from "../domains/document/decisions/provider.js";
import type { BatchInput, BatchResult } from "../domains/document/decisions/contracts.js";

import { decisionRetryOptions, jevExecutionPolicy } from "../domains/document/decisions/execution-policy.js";
export { decisionRetryOptions } from "../domains/document/decisions/execution-policy.js";

export function createJevDecisionBatchWorkflow(hatchet: HatchetClient) {
  return hatchet.task<BatchInput, BatchResult>({
    name: "jev-decision-batch",
    ...decisionRetryOptions,
    executionTimeout: jevExecutionPolicy.executionTimeout,
    scheduleTimeout: jevExecutionPolicy.scheduleTimeout,
    concurrency: [
      {
        expression: '"jev-decisions"',
        maxRuns: jevExecutionPolicy.maxConcurrentRequests,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      {
        expression: 'input.stage.directory + "/" + input.batchId',
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
    ],
    fn: async (input, ctx) => {
      try {
        return await executeDecisionBatch(input, {
          retryCount: ctx.retryCount(),
          taskRunId: ctx.taskRunId(),
          workflowRunId: ctx.workflowRunId(),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof RetryableDecisionError && ctx.retryCount() < jevExecutionPolicy.retries) throw error;
        throw new NonRetryableError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
