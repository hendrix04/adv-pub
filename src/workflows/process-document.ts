import type { HatchetClient } from "@hatchet-dev/typescript-sdk/v1";
import { ConcurrencyLimitStrategy, NonRetryableError } from "@hatchet-dev/typescript-sdk/v1/task";
import { join } from "node:path";
import { discoverDocument, RetryableDiscoveryError, type DiscoveryResult, type DiscoveryTaskInput } from "../domains/document/index.js";
import {
  prepareClassification,
  collectClassification,
  prepareCatalogQualification,
  collectCatalogQualification,
  prepareCatalogTyping,
  collectCatalogTyping,
  collectCatalogClassification,
} from "../domains/document/classification/operation.js";
import { prepareAliasLinking, collectAliasLinks, prepareCatalogAliasStage, collectCatalogAliasStage, catalogAliasDirectory } from "../domains/document/aliases/operation.js";
import type { ClassificationInput } from "../domains/document/decisions/contracts.js";
import { preflightJev } from "../domains/document/decisions/provider.js";
import { questionPolicySchema } from "../domains/document/decisions/policy.js";
import { exploratoryClassificationPolicy, classificationRepeatId } from "../domains/document/classification/policy.js";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { readValidatedBatch, withValidatedBatchSnapshot } from "../domains/document/decisions/operation.js";
import { randomUUID } from "node:crypto";
import { sha256 } from "../domains/document/decisions/contracts.js";
import { runBlocksOperation, type BlocksRunInput } from "../domains/document/blocks/operation.js";
import { seedCompatibleStageEvidence } from "../domains/document/blocks/reuse.js";
import { runAssociationOperation, type AssociationRunInput, type AssociationWorkflowInput } from "../domains/document/association/operation.js";
import type { createJevDecisionBatchWorkflow } from "./jev-decision-batch.js";

export type ReadinessResult = {
  status: "ready";
  task: "process-document-readiness";
};

export function readinessResult(): ReadinessResult {
  return { status: "ready", task: "process-document-readiness" };
}

export function blockOperationModeForInvocation(mode: "new" | "resume", invocationCount: number): "new" | "resume" {
  return mode === "new" && invocationCount > 1 ? "resume" : mode;
}

export const discoveryRetryOptions = {
  retries: 2,
  backoff: { factor: 30, maxSeconds: 30 },
} as const;

export function createReadinessWorkflow(hatchet: HatchetClient) {
  const workflow = hatchet.workflow<{ nonce: string }>({
    name: "process-document-readiness",
  });

  workflow.task({
    name: "readiness",
    fn: async () => readinessResult(),
  });

  return workflow;
}

export type ProcessDocumentInput = Omit<DiscoveryTaskInput, "retryCount"> | ClassificationInput | BlocksRunInput | AssociationWorkflowInput;

export function createProcessDocumentWorkflow(hatchet: HatchetClient, decisionBatch?: ReturnType<typeof createJevDecisionBatchWorkflow>) {
  const workflow = hatchet.workflow<ProcessDocumentInput>({
    name: "process-document",
  });

  const discovery = workflow.task({
    name: "discover-document",
    ...discoveryRetryOptions,
    executionTimeout: "15m",
    fn: async (input, ctx): Promise<DiscoveryResult | { status: "skipped" }> => {
      if ("capability" in input && input.capability !== undefined) {
        if (!decisionBatch) throw new NonRetryableError(`${input.capability} requires the registered Jev batch child`);
        return { status: "skipped" };
      }
      const retryCount = ctx.retryCount();
      try {
        return await discoverDocument({ ...(input as Omit<DiscoveryTaskInput, "retryCount">), retryCount });
      } catch (error) {
        if (error instanceof RetryableDiscoveryError && retryCount < 2) throw error;
        if (error instanceof NonRetryableError) throw error;
        throw new NonRetryableError(error instanceof Error ? error.message : String(error));
      }
    },
  });

  if (decisionBatch) {
    workflow.durableTask({
      name: "build-document-blocks",
      parents: [discovery],
      executionTimeout: "4h",
      concurrency: {
        expression: "input.operationId",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      fn: async (input, ctx) => {
        if (!("capability" in input) || input.capability !== "blocks") return { status: "skipped" };
        const operationInput = { ...input, mode: blockOperationModeForInvocation(input.mode, ctx.invocationCount) };
        const result = await runBlocksOperation(operationInput, async (stage, repeatId) => {
          if (input.reuseEvidenceDirectory) {
            await seedCompatibleStageEvidence({
              prepared: stage,
              previousOperationDirectory: input.reuseEvidenceDirectory,
              repeatId,
            });
          }
          const primaryFailure = await runDecisionChildren(stage, input, ctx, decisionBatch);
          if (primaryFailure) throw new Error(`Primary block decisions failed: ${primaryFailure}`);
          const repeatFailure = await runDecisionChildren(stage, { verificationProbe: false }, ctx, decisionBatch, repeatId);
          if (repeatFailure) throw new Error(`Fresh block repeats failed: ${repeatFailure}`);
        });
        if (result.status !== "complete") throw new NonRetryableError(`Block structure incomplete; inspect ${result.directory}/result.json`);
        return {
          status: "complete",
          capability: "source-local-structure",
          directory: result.directory,
          source_sha256: result.layout.source_sha256,
          blocks: result.layout.blocks.length,
          sections: result.layout.sections.length,
          findings: result.layout.findings,
        };
      },
    });
    workflow.durableTask({
      name: "associate-document",
      parents: [discovery],
      executionTimeout: "4h",
      concurrency: {
        expression: "input.operationId",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      fn: async (input, ctx) => {
        if (!("capability" in input) || input.capability !== "associate") return { status: "skipped" };
        const endpointPreflight = await preflightJev();
        const operationInput: AssociationRunInput = {
          ...input,
          inputLimit: endpointPreflight.inputLimit,
          endpointPreflight,
        };
        const result = await runAssociationOperation(operationInput, async (stage, repeatId) => {
          const primaryFailure = await runDecisionChildren(stage, {}, ctx, decisionBatch);
          if (primaryFailure) throw new Error(`Primary association decisions failed: ${primaryFailure}`);
          const requiresRepeat = Object.values(stage.manifest.question_targets).some((target) =>
            Boolean(stage.manifest.policy.rules[target.question_kind as keyof typeof stage.manifest.policy.rules]?.require_repeat),
          );
          if (requiresRepeat) {
            const repeatFailure = await runDecisionChildren(stage, { verificationProbe: false }, ctx, decisionBatch, repeatId);
            if (repeatFailure) throw new Error(`Fresh association repeats failed: ${repeatFailure}`);
          }
        });
        if (result.status !== "complete") throw new NonRetryableError(`Association incomplete; inspect ${result.directory}/result.json`);
        return { ...result.result, directory: result.directory };
      },
    });
    const aliases = workflow.durableTask({
      name: "link-document-aliases",
      parents: [discovery],
      executionTimeout: "4h",
      concurrency: {
        expression: "input.operationId",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      fn: async (input, ctx) => {
        if (!("capability" in input) || input.capability !== "classify") return { status: "skipped" };
        if (input.legacyResume) {
          const prepared = await prepareAliasLinking(input);
          const failure = await runDecisionChildren(prepared, input, ctx, decisionBatch);
          const result = await collectAliasLinks(prepared.directory, failure);
          if (result.status !== "complete") throw new NonRetryableError(`Legacy alias linking incomplete; inspect ${prepared.directory}/result.json`);
          return {
            status: "complete",
            aliasDirectory: prepared.directory,
            candidateCount: result.candidate_count,
            pairCount: result.pair_count,
            referentCount: result.referent_count,
            execution: "legacy_reader_path",
          };
        }
        const policy = questionPolicySchema.parse(input.policy ?? exploratoryClassificationPolicy());
        const preflight = await preflightJev();
        const prepared = await prepareCatalogAliasStage({
          ...input,
          policy,
          inputLimit: preflight.inputLimit,
          endpointPreflight: preflight,
        });
        const primaryFailure = prepared.manifest ? await runDecisionChildren(prepared, input, ctx, decisionBatch) : undefined;
        const repeatId = classificationRepeatId("catalog-aliases-v1", policy, "aliasIdentity");
        const repeatFailure = repeatId && !primaryFailure ? await runDecisionChildren(prepared, { verificationProbe: false }, ctx, decisionBatch, repeatId) : undefined;
        const failure = [primaryFailure, repeatFailure].filter(Boolean).join("; ") || undefined;
        const result = await collectCatalogAliasStage(prepared.directory, failure, repeatId);
        if (result.status !== "complete") throw new NonRetryableError(`Alias linking incomplete; inspect ${prepared.directory}/result.json`);
        return {
          status: "complete",
          aliasDirectory: prepared.directory,
          candidateCount: result.candidate_count,
          pairCount: result.pair_count,
          referentCount: result.groups.length,
          inputLimit: preflight.inputLimit,
          endpointPreflight: preflight,
        };
      },
    });
    workflow.durableTask({
      name: "classify-entities",
      parents: [aliases],
      executionTimeout: "4h",
      concurrency: {
        expression: "input.operationId",
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      fn: async (input, ctx) => {
        if (!("capability" in input) || input.capability !== "classify") return { status: "skipped" };
        if (input.legacyResume) {
          const prepared = await prepareClassification(input);
          const failure = await runDecisionChildren(prepared, input, ctx, decisionBatch);
          const result = await collectClassification(prepared.directory, failure);
          if (result.status !== "complete") throw new NonRetryableError(`Legacy classification incomplete; inspect ${prepared.directory}/result.json`);
          return result;
        }
        const aliasDirectory = catalogAliasDirectory(input.discoveryDirectory, input.operationId);
        const endpointPreflight = (await readJson(join(aliasDirectory, "endpoint-preflight.json"))) as Record<string, unknown> & { inputLimit?: number };
        if (!Number.isInteger(endpointPreflight.inputLimit) || endpointPreflight.inputLimit! < 1)
          throw new NonRetryableError("Catalog alias preflight did not retain a usable input limit");
        const policy = questionPolicySchema.parse(input.policy ?? exploratoryClassificationPolicy());
        const stageInput = { ...input, policy, inputLimit: endpointPreflight.inputLimit!, endpointPreflight };
        const entityQualification = await prepareCatalogQualification(stageInput);
        const entityQualificationPrimaryFailure = entityQualification.manifest ? await runDecisionChildren(entityQualification, input, ctx, decisionBatch) : undefined;
        const entityQualificationRepeatId = classificationRepeatId("catalog-qualification-v1", policy, "entityQualification");
        const entityQualificationRepeatFailure =
          entityQualificationRepeatId && !entityQualificationPrimaryFailure
            ? await runDecisionChildren(entityQualification, { verificationProbe: false }, ctx, decisionBatch, entityQualificationRepeatId)
            : undefined;
        const entityQualificationFailure = [entityQualificationPrimaryFailure, entityQualificationRepeatFailure].filter(Boolean).join("; ") || undefined;
        const entityQualificationResult = await collectCatalogQualification(entityQualification);
        if (entityQualificationResult.status !== "complete" || entityQualificationFailure)
          throw new NonRetryableError(`Entity qualification incomplete; inspect ${entityQualification.directory}/result.json`);
        const entityType = await prepareCatalogTyping(stageInput);
        const entityTypePrimaryFailure = entityType.manifest ? await runDecisionChildren(entityType, input, ctx, decisionBatch) : undefined;
        const entityTypeRepeatId = classificationRepeatId("catalog-typing-v1", policy, "entityType");
        const entityTypeRepeatFailure =
          entityTypeRepeatId && !entityTypePrimaryFailure ? await runDecisionChildren(entityType, { verificationProbe: false }, ctx, decisionBatch, entityTypeRepeatId) : undefined;
        const entityTypeFailure = [entityTypePrimaryFailure, entityTypeRepeatFailure].filter(Boolean).join("; ") || undefined;
        const entityTypeResult = await collectCatalogTyping(entityType);
        if (entityTypeResult.status !== "complete" || entityTypeFailure) throw new NonRetryableError(`Entity typing incomplete; inspect ${entityType.directory}/result.json`);
        const result = await collectCatalogClassification({
          discoveryDirectory: input.discoveryDirectory,
          operationId: input.operationId,
        });
        if (result.status !== "complete")
          throw new NonRetryableError(`Catalog classification incomplete; inspect ${join(input.discoveryDirectory, "classifications", input.operationId, "result.json")}`);
        return result;
      },
    });
  }

  return workflow;
}

export async function runDecisionChildren(
  prepared: { directory: string; manifest?: import("../domains/document/decisions/contracts.js").Manifest },
  input: { verificationProbe?: boolean },
  ctx: import("@hatchet-dev/typescript-sdk/v1/client/worker/context").DurableContext<ProcessDocumentInput>,
  decisionBatch: ReturnType<typeof createJevDecisionBatchWorkflow>,
  freshRepeatId?: string,
  reuseSaved = true,
): Promise<string | undefined> {
  if (!prepared.manifest) return undefined;
  const failures: string[] = [];
  try {
    return await withValidatedBatchSnapshot(prepared.directory, prepared.manifest, async (snapshot) => {
      const taskId = typeof ctx.taskRunExternalId === "function" ? ctx.taskRunExternalId() : "unit";
      const planPath = join(prepared.directory, "dispatch-plans", taskId, `${freshRepeatId ?? "ordinary"}.json`);
      const manifestHash = sha256(JSON.stringify(snapshot.manifest));
      let plan: { manifest_sha256: string; pending_batch_ids: string[] };
      try {
        plan = (await readJson(planPath)) as typeof plan;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        plan = { manifest_sha256: manifestHash, pending_batch_ids: [] };
        for (const batch of snapshot.manifest.batches) {
          const saved = await readValidatedBatch(prepared.directory, snapshot.manifest, batch.batch_id, freshRepeatId, snapshot);
          if (saved && reuseSaved) {
            const root = freshRepeatId ? join(prepared.directory, "batches", batch.batch_id, "repeats", freshRepeatId) : join(prepared.directory, "batches", batch.batch_id);
            await writeJsonAtomic(join(root, "reuse", `${randomUUID()}.json`), {
              at_utc: new Date().toISOString(),
              network_request_sent: false,
              reuse_kind: "validated-input-snapshot",
              source_sha256: snapshot.manifest.source_sha256,
              configuration_sha256: snapshot.manifest.configuration_sha256,
              batch_sha256: batch.batch_sha256,
              response_path: saved.responsePath,
              repeat_id: freshRepeatId ?? null,
            });
          } else plan.pending_batch_ids.push(batch.batch_id);
        }
        await writeJsonAtomic(planPath, plan);
      }
      if (
        plan.manifest_sha256 !== manifestHash ||
        new Set(plan.pending_batch_ids).size !== plan.pending_batch_ids.length ||
        plan.pending_batch_ids.some((id) => !snapshot.manifest.batches.some((batch) => batch.batch_id === id))
      )
        throw new Error("Retained dispatch plan input changed");
      const results = await Promise.allSettled(
        plan.pending_batch_ids.map((batchId) =>
          ctx.spawnChild(decisionBatch, {
            stage: { version: 1, directory: prepared.directory },
            batchId,
            verificationProbe: Boolean(input.verificationProbe && batchId === snapshot.manifest.batches[0]?.batch_id),
            ...(freshRepeatId ? { freshRepeatId } : {}),
          }),
        ),
      );
      for (const result of results) {
        if (result.status === "fulfilled") continue;
        if (result.reason instanceof Error && result.reason.name === "AbortError") throw result.reason;
        failures.push(String(result.reason));
      }
      return failures.length ? failures.join("; ") : undefined;
    });
  } catch (error) {
    // Hatchet eviction/cancellation is control flow; do not publish a failed domain result while the durable task is resuming.
    if (error instanceof Error && error.name === "AbortError") throw error;
    return error instanceof Error ? error.message : String(error);
  }
}
