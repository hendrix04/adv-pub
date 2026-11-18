import { parseDecisionWire, assertRetainedOutbound, validateBatchResponse } from "./validation.js";
import { assertRetainedIntegrity, assertExecutionCompatibility } from "./retained-stage.js";
import { readFile, mkdir, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { readJson, writeJsonAtomic } from "../discovery/artifacts.js";
import { manifestSchema, retainedDecisionSchema, sha256, requestOf, type BatchInput, type BatchResult, type Manifest, type RetainedDecision } from "./contracts.js";
import { assertSemanticSource } from "./semantic-input.js";
import { callJev } from "./provider.js";
import { loadVerifiedStage } from "./verified-stage.js";

function getBatch(manifest: Manifest, batchId: string) {
  const batch = manifest.batches.find((entry) => entry.batch_id === batchId);
  if (!batch || sha256(JSON.stringify(batch.request)) !== batch.batch_sha256) throw new Error("Unknown or changed batch input");
  return batch;
}

export type BatchSnapshot = { readonly directory: string; readonly manifest: Manifest };
const snapshots = new WeakMap<BatchSnapshot, Map<string, string>>();
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
async function fileHashes(paths: string[]) {
  return new Map(await Promise.all(paths.map(async (path) => [path, sha256(await readFile(path))] as const)));
}
async function assertSnapshotFiles(proof: Map<string, string>) {
  for (const [path, hash] of proof) if (sha256(await readFile(path)) !== hash) throw new Error(`Validated snapshot file changed: ${path}`);
}
function recordSnapshotFile(proof: Map<string, string> | undefined, path: string, hash: string) {
  if (!proof) return;
  if (proof.has(path) && proof.get(path) !== hash) throw new Error(`Validated snapshot evidence changed: ${path}`);
  proof.set(path, hash);
}
/** One owned immutable input snapshot; raw evidence is checked on every read. */
export async function withValidatedBatchSnapshot<T>(directory: string, manifest: Manifest, body: (snapshot: BatchSnapshot) => Promise<T>): Promise<T> {
  directory = resolve(directory);
  const owned = structuredClone(manifest);
  freeze(owned);
  const paths = [join(directory, "manifest.json"), join(directory, "source.md")];
  if (owned.contract_version === "decision-questions-v2")
    paths.push(
      join(directory, "question-targets.json"),
      join(directory, "decision-policy.json"),
      ...(owned.rule_evidence ? [join(directory, "entity-rules.json")] : []),
      ...Object.values(owned.config.upstream_paths),
    );
  else
    paths.push(
      join(directory, "discovery-proposals.json"),
      ...(owned.decision_kind === "document_alias" ? [] : [join(directory, "ontology-criteria.json"), join(owned.alias_directory, "result.json")]),
    );
  const proof = await fileHashes([...new Set(paths)]);
  if (JSON.stringify(manifestSchema.parse(await readJson(join(directory, "manifest.json")))) !== JSON.stringify(owned))
    throw new Error("Snapshot manifest differs from retained manifest");
  await assertExecutionCompatibility(owned, directory);
  await assertSnapshotFiles(proof);
  const snapshot = Object.freeze({ directory, manifest: owned });
  snapshots.set(snapshot, proof);
  let interrupted = false;
  try {
    return await body(snapshot);
  } catch (error) {
    interrupted = error instanceof Error && error.name === "AbortError";
    throw error;
  } finally {
    snapshots.delete(snapshot);
    const check = async () => {
      await assertSnapshotFiles(proof);
      await assertExecutionCompatibility(owned, directory);
    };
    if (interrupted)
      await check().catch(() => undefined); // Preserve durable interruption; no result is published.
    else await check();
  }
}

export async function readValidatedBatch(
  directory: string,
  manifest: Manifest,
  batchId: string,
  repeatId?: string,
  snapshot?: BatchSnapshot,
): Promise<{ decisions: RetainedDecision[]; responsePath: string } | undefined> {
  const proof = snapshot ? snapshots.get(snapshot) : undefined;
  if (snapshot && (!proof || snapshot.directory !== resolve(directory) || snapshot.manifest !== manifest)) throw new Error("Inactive or mismatched validated snapshot");
  if (!snapshot) await assertRetainedIntegrity(manifest, directory);
  const batch = getBatch(manifest, batchId);
  const path = repeatId ? join(directory, "batches", batchId, "repeats", repeatId, "result.json") : join(directory, "batches", batchId, "result.json");
  let saved: {
    batch_sha256: string;
    configuration_sha256: string;
    response_path: string;
    response_sha256: string;
    decisions: unknown[];
  };
  try {
    const bytes = await readFile(path);
    recordSnapshotFile(proof, path, sha256(bytes));
    saved = JSON.parse(bytes.toString("utf8")) as typeof saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (saved.batch_sha256 !== batch.batch_sha256 || saved.configuration_sha256 !== manifest.configuration_sha256) throw new Error("Saved result input hashes differ");
  const responseText = await readFile(saved.response_path, "utf8");
  recordSnapshotFile(proof, saved.response_path, sha256(responseText));
  if (sha256(responseText) !== saved.response_sha256) throw new Error("Saved raw response hash differs");
  const outboundPath = join(dirname(saved.response_path), "outbound-request.json");
  if (proof) recordSnapshotFile(proof, outboundPath, sha256(await readFile(outboundPath)));
  await assertRetainedOutbound(batch.request, saved.response_path);
  const checked = validateBatchResponse(parseDecisionWire(responseText), manifest, batchId, saved.response_path);
  if (checked.findings.length || JSON.stringify(checked.decisions) !== JSON.stringify(saved.decisions)) throw new Error("Saved decisions do not match validated raw response");
  if (snapshot && !snapshots.has(snapshot)) throw new Error("Validated snapshot expired during read");
  return {
    decisions: saved.decisions.map((entry) => {
      retainedDecisionSchema.parse(entry);
      return entry as RetainedDecision;
    }),
    responsePath: saved.response_path,
  };
}

export async function executeDecisionBatch(input: BatchInput, context: { retryCount: number; taskRunId: string; workflowRunId: string }): Promise<BatchResult> {
  if (input.stage.version !== 1) throw new Error("Unsupported stage reference");
  const directory = input.stage.directory;
  if (input.freshRepeatId && !/^[a-zA-Z0-9_-]+$/.test(input.freshRepeatId)) throw new Error("Invalid repeat ID");
  const manifest = await loadVerifiedStage(directory);
  const batch = getBatch(manifest, input.batchId);
  const sourceBytes = await readFile(join(directory, "source.md"));
  const request = requestOf(batch);
  assertSemanticSource(request, sourceBytes);
  if (sha256(sourceBytes) !== manifest.source_sha256) throw new Error("Retained source hash changed");
  const root = input.freshRepeatId ? join(directory, "batches", input.batchId, "repeats", input.freshRepeatId) : join(directory, "batches", input.batchId);
  const savedPath = join(root, "result.json");
  let resultExists = false;
  try {
    await access(savedPath);
    resultExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const saved = resultExists ? await readValidatedBatch(directory, manifest, input.batchId, input.freshRepeatId) : undefined;
  if (saved) {
    await writeJsonAtomic(join(root, "reuse", `${randomUUID()}.json`), {
      ...context,
      at_utc: new Date().toISOString(),
      network_request_sent: false,
    });
    return {
      batchId: input.batchId,
      decisionCount: saved.decisions.length,
      resultPath: join(root, "result.json"),
      reused: true,
    };
  }
  const attempt = join(root, `attempt-${context.retryCount + 1}-${randomUUID()}`);
  await mkdir(attempt, { recursive: true });
  const provenance = {
    ...context,
    request_kind: input.freshRepeatId ? "fresh_repeat" : "ordinary",
    repeat_id: input.freshRepeatId ?? null,
    started_at_utc: new Date().toISOString(),
    configuration_sha256: manifest.configuration_sha256,
    batch_sha256: batch.batch_sha256,
    source_sha256: manifest.source_sha256,
    ...(manifest.contract_version === "decision-questions-v2"
      ? { definitions_version: manifest.definitions_version, definitions_sha256: manifest.definitions_sha256 }
      : { question_version: manifest.question_version }),
    requested_model: request.model,
    requested_provider: request.provider,
  };
  await writeJsonAtomic(join(attempt, "provenance.json"), provenance);
  // Check the source again at the actual call boundary, including after credential/loading work.
  assertSemanticSource(request, await readFile(join(directory, "source.md")));
  const raw = await callJev(request, attempt, Boolean(input.verificationProbe && context.retryCount === 0), sourceBytes, join(directory, "source.md"));
  const rawPath = join(attempt, "response-body.txt");
  let wire: unknown;
  try {
    wire = parseDecisionWire(await readFile(rawPath, "utf8"));
  } catch (error) {
    await writeJsonAtomic(join(attempt, "validation-findings.json"), [String(error)]);
    throw error;
  }
  const validation = validateBatchResponse(wire, manifest, input.batchId, rawPath);
  await writeJsonAtomic(join(attempt, "validation-findings.json"), validation.findings);
  const envelope = raw as Record<string, unknown>;
  await writeJsonAtomic(join(attempt, "provenance.json"), {
    ...provenance,
    finished_at_utc: new Date().toISOString(),
    served_model: envelope.model,
    served_provider: envelope.provider,
    generation_id: envelope.id ?? null,
    usage: envelope.usage ?? null,
    validation_status: validation.findings.length ? "failed" : "valid",
  });
  if (validation.findings.length) throw new Error(`Invalid Jev response: ${validation.findings.join("; ")}`);
  await writeJsonAtomic(join(root, "result.json"), {
    batch_sha256: batch.batch_sha256,
    configuration_sha256: manifest.configuration_sha256,
    response_path: rawPath,
    response_sha256: sha256(await readFile(rawPath)),
    decisions: validation.decisions,
  });
  return {
    batchId: input.batchId,
    decisionCount: validation.decisions.length,
    resultPath: join(root, "result.json"),
    reused: false,
  };
}
