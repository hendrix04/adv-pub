import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { manifestSchema, type Manifest, type QuestionManifest } from "../decisions/contracts.js";
import { readJson, writeJsonAtomic } from "../discovery/artifacts.js";
import { sha256 } from "../decisions/integrity.js";
import { readValidatedBatch, type BatchSnapshot } from "../decisions/operation.js";
import { parseDecisionWire, validateBatchResponse } from "../decisions/validation.js";
import type { PreparedBlocksStage } from "./operation.js";

export type ReuseEvidence = {
  batch_id: string;
  repeat_id: string | null;
  state: "reused" | "not_compatible" | "missing";
  reason: string;
  source_response_path?: string;
};

function stageName(stageId: string) {
  if (!stageId.startsWith("blocks-")) throw new Error(`Unexpected structure stage ID ${stageId}`);
  return stageId.slice("blocks-".length);
}

function sameQuestionInputs(oldManifest: QuestionManifest, nextManifest: QuestionManifest, candidateIds: string[]) {
  if (
    oldManifest.source_sha256 !== nextManifest.source_sha256 ||
    oldManifest.definitions_version !== nextManifest.definitions_version ||
    oldManifest.definitions_sha256 !== nextManifest.definitions_sha256
  )
    return false;
  return candidateIds.every((id) => JSON.stringify(oldManifest.question_targets[id]) === JSON.stringify(nextManifest.question_targets[id]));
}

export async function seedCompatibleBatchEvidence(input: {
  oldDirectory: string;
  oldManifest: QuestionManifest;
  currentDirectory: string;
  currentManifest: QuestionManifest;
  batch: QuestionManifest["batches"][number];
  repeatId?: string;
  oldSnapshot?: BatchSnapshot;
}): Promise<ReuseEvidence> {
  const oldBatch = input.oldManifest.batches.find((entry) => entry.batch_sha256 === input.batch.batch_sha256);
  if (!oldBatch || !sameQuestionInputs(input.oldManifest, input.currentManifest, input.batch.candidate_ids)) {
    return {
      batch_id: input.batch.batch_id,
      repeat_id: input.repeatId ?? null,
      state: "not_compatible",
      reason: "Source, definitions, target descriptors, or exact serialized request differs",
    };
  }
  const oldResult = await readValidatedBatch(input.oldDirectory, input.oldManifest, oldBatch.batch_id, input.repeatId, input.oldSnapshot);
  if (!oldResult)
    return {
      batch_id: input.batch.batch_id,
      repeat_id: input.repeatId ?? null,
      state: "missing",
      reason: "No retained validated response for this exact request",
    };
  const responseText = await readFile(oldResult.responsePath, "utf8");
  const checked = validateBatchResponse(parseDecisionWire(responseText), input.currentManifest, input.batch.batch_id, oldResult.responsePath);
  if (checked.findings.length) throw new Error(`Compatible raw response failed current manifest validation: ${checked.findings.join("; ")}`);
  const responseHash = sha256(responseText);
  const currentRoot = input.repeatId
    ? join(input.currentDirectory, "batches", input.batch.batch_id, "repeats", input.repeatId)
    : join(input.currentDirectory, "batches", input.batch.batch_id);
  await mkdir(currentRoot, { recursive: true });
  await writeJsonAtomic(join(currentRoot, "result.json"), {
    batch_sha256: input.batch.batch_sha256,
    configuration_sha256: input.currentManifest.configuration_sha256,
    response_path: oldResult.responsePath,
    response_sha256: responseHash,
    decisions: checked.decisions,
  });
  await writeJsonAtomic(join(currentRoot, "reuse", `${randomUUID()}.json`), {
    contract_version: "blocks-policy-reuse-v1",
    at_utc: new Date().toISOString(),
    network_request_sent: false,
    reuse_kind: "source-reviewed-policy-rebuild",
    source_sha256: input.currentManifest.source_sha256,
    batch_sha256: input.batch.batch_sha256,
    from_configuration_sha256: input.oldManifest.configuration_sha256,
    to_configuration_sha256: input.currentManifest.configuration_sha256,
    from_policy_sha256: input.oldManifest.policy_sha256,
    to_policy_sha256: input.currentManifest.policy_sha256,
    response_path: oldResult.responsePath,
    response_sha256: responseHash,
    repeat_id: input.repeatId ?? null,
  });
  return {
    batch_id: input.batch.batch_id,
    repeat_id: input.repeatId ?? null,
    state: "reused",
    reason: "Exact source, definitions, target descriptors, serialized request, and validated raw response matched",
    source_response_path: oldResult.responsePath,
  };
}

export async function seedCompatibleStageEvidence(input: { prepared: PreparedBlocksStage; previousOperationDirectory: string; repeatId: string }): Promise<ReuseEvidence[]> {
  const current = input.prepared.manifest;
  const priorStageDirectory = join(input.previousOperationDirectory, "stages", stageName(current.stage_id));
  let parsedOld: Manifest;
  try {
    parsedOld = manifestSchema.parse(await readJson(join(priorStageDirectory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const missing = current.batches.flatMap((batch) => [
      {
        batch_id: batch.batch_id,
        repeat_id: null,
        state: "missing" as const,
        reason: "No tuning stage manifest exists; this final-policy target must be decided live",
      },
      {
        batch_id: batch.batch_id,
        repeat_id: input.repeatId,
        state: "missing" as const,
        reason: "No tuning stage manifest exists; this fresh repeat must be decided live",
      },
    ]);
    await writeJsonAtomic(join(input.prepared.directory, "reuse-evidence.json"), {
      contract_version: "blocks-policy-reuse-summary-v1",
      source_sha256: current.source_sha256,
      source_stage_directory: priorStageDirectory,
      target_stage_directory: input.prepared.directory,
      from_policy_sha256: null,
      to_policy_sha256: current.policy_sha256,
      network_requests_sent_by_rebuild: 0,
      evidence: missing,
    });
    return missing;
  }
  if (parsedOld.contract_version !== "decision-questions-v2") throw new Error("Structure policy reuse requires current question manifests");
  const old = parsedOld;
  const evidence: ReuseEvidence[] = [];
  for (const batch of current.batches) {
    const primary = await seedCompatibleBatchEvidence({
      oldDirectory: priorStageDirectory,
      oldManifest: old,
      currentDirectory: input.prepared.directory,
      currentManifest: current,
      batch,
    });
    evidence.push(primary);
    const repeat = await seedCompatibleBatchEvidence({
      oldDirectory: priorStageDirectory,
      oldManifest: old,
      currentDirectory: input.prepared.directory,
      currentManifest: current,
      batch,
      repeatId: input.repeatId,
    });
    evidence.push(repeat);
  }
  await writeJsonAtomic(join(input.prepared.directory, "reuse-evidence.json"), {
    contract_version: "blocks-policy-reuse-summary-v1",
    source_sha256: current.source_sha256,
    source_stage_directory: priorStageDirectory,
    target_stage_directory: input.prepared.directory,
    from_policy_sha256: old.policy_sha256,
    to_policy_sha256: current.policy_sha256,
    network_requests_sent_by_rebuild: 0,
    evidence,
  });
  return evidence;
}
