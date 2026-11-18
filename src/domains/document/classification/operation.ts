import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readJson, writeJsonAtomic, writeTextAtomic, writeBytesAtomic } from "../discovery/artifacts.js";
import { buildClassificationRequest, loadClassificationCriteria, loadDiscoveryCandidates } from "../decisions/semantic-input.js";
import { loadAliasGroups } from "../aliases/operation.js";
import { planDecisionBatches } from "../decisions/request.js";
import { preflightJev } from "../decisions/provider.js";
import {
  classificationManifestSchema,
  sha256,
  jevModel,
  jevProvider,
  classificationQuestionVersion,
  classificationDecisionSchema,
  type ClassificationManifest as Manifest,
  type ClassificationInput,
  type ClassificationResult,
  type Decision,
} from "../decisions/contracts.js";
import { inspectCoverage } from "../decisions/validation.js";
import { readValidatedBatches } from "../decisions/batch-collection.js";
import { jevExecutionPolicy } from "../decisions/execution-policy.js";

export {
  prepareCatalogQualification,
  collectCatalogQualification,
  prepareCatalogTyping,
  collectCatalogTyping,
  collectCatalogClassification,
  verifyCatalogClassificationLineage,
} from "./catalog-operation.js";
export type { CatalogClassificationInput, PreparedCatalogStage } from "./catalog-operation.js";

export async function prepareClassification(input: ClassificationInput): Promise<{ directory: string; manifest: Manifest }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new Error("Classification operation ID must be a UUID");
  const { discovery, bytes, proposalText, captured, candidatesHash, candidates: originalCandidates } = await loadDiscoveryCandidates(input.discoveryDirectory);
  const ontology = await loadClassificationCriteria();
  const aliasDirectory = join(discovery, "classifications", input.operationId, "aliases");
  const linked = await loadAliasGroups(aliasDirectory, captured.sha256, candidatesHash);
  const candidates = linked.groups;
  const directory = join(discovery, "classifications", input.operationId);
  const config = {
    model: jevModel,
    provider: { only: [jevProvider], allow_fallbacks: jevExecutionPolicy.allowFallbacks },
    question_version: classificationQuestionVersion,
    ontology_sha256: ontology.sha256,
    response_contract_version: "choice-with-confidence-v1",
    batch_size: 10,
    max_concurrent_requests: jevExecutionPolicy.maxConcurrentRequests,
    sdk_retries: jevExecutionPolicy.sdkRetries,
    retries: jevExecutionPolicy.retries,
    retry_delay_seconds: jevExecutionPolicy.retryDelaySeconds,
    request_timeout_ms: jevExecutionPolicy.requestTimeoutMs,
    child_timeout: jevExecutionPolicy.executionTimeout,
    verification_probe: Boolean(input.verificationProbe),
    admission_thresholds: null,
    alias_result_sha256: linked.sha256,
  };
  const configurationHash = sha256(JSON.stringify(config));
  try {
    const manifest = classificationManifestSchema.parse(await readJson(join(directory, "manifest.json"))) as Manifest;
    if (manifest.configuration_sha256 !== configurationHash || manifest.source_sha256 !== captured.sha256 || manifest.candidates_sha256 !== candidatesHash) {
      throw new Error("Existing classification inputs changed; start a new operation");
    }
    return { directory, manifest };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true });
  const preflight = await preflightJev();
  await writeJsonAtomic(join(directory, "endpoint-preflight.json"), preflight);
  const batches = planDecisionBatches(candidates, preflight.inputLimit, 10, (slice) => buildClassificationRequest(captured, slice, ontology));
  const manifest: Manifest = {
    operation_id: input.operationId,
    discovery_directory: discovery,
    source_sha256: captured.sha256,
    source_byte_length: captured.byteLength,
    candidates_sha256: candidatesHash,
    configuration_sha256: configurationHash,
    decision_kind: "entity_type",
    original_candidates: originalCandidates,
    alias_directory: aliasDirectory,
    alias_result_sha256: linked.sha256,
    question_version: classificationQuestionVersion,
    created_at_utc: new Date().toISOString(),
    config,
    candidates,
    batches,
  };
  await writeBytesAtomic(join(directory, "source.md"), bytes);
  await writeTextAtomic(join(directory, "discovery-proposals.json"), proposalText);
  await writeJsonAtomic(join(directory, "ontology-criteria.json"), ontology);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
  return { directory, manifest };
}

export async function collectClassification(directory: string, orchestrationFailure?: string): Promise<ClassificationResult> {
  const manifest = classificationManifestSchema.parse(await readJson(join(directory, "manifest.json"))) as Manifest;
  const decisions: Decision[] = [];
  const findings: string[] = orchestrationFailure ? [orchestrationFailure] : [];
  for await (const { batchId, ordinary } of readValidatedBatches(directory, manifest, {
    parse: (entry) => classificationDecisionSchema.parse(entry),
    onError: (error, batchId) => findings.push(`${batchId}: ${error instanceof Error ? error.message : String(error)}`),
  })) {
    if (!ordinary) {
      findings.push(`${batchId}: no validated result`);
      continue;
    }
    decisions.push(...ordinary.decisions);
  }
  const coverage = inspectCoverage(manifest, decisions);
  findings.push(...coverage.findings);
  const result: ClassificationResult = {
    status: findings.length || coverage.missing.length ? "failed" : "complete",
    classificationDirectory: directory,
    candidateCount: manifest.candidates.length,
    originalCandidateCount: manifest.original_candidates.length,
    decisionCount: decisions.length,
    missingCandidateIds: coverage.missing,
    findings,
  };
  decisions.sort((left, right) => left.index - right.index);
  await writeJsonAtomic(join(directory, "decisions.json"), decisions);
  await writeJsonAtomic(join(directory, "validation-findings.json"), {
    ...result,
    candidate_findings: manifest.candidates.filter((entry) => entry.findings.length),
  });
  await writeJsonAtomic(join(directory, "result.json"), result);
  const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = decisions.map(
    (entry) =>
      `| ${entry.index + 1} | ${escape(entry.members?.map((member) => member.name).join(" / ") ?? entry.name)} | ${entry.answer} | ${entry.confidence} | ${escape(JSON.stringify(entry.option_probabilities))} | ${escape(entry.findings.join("; "))} |`,
  );
  await writeTextAtomic(
    join(directory, "classification-view.md"),
    [
      "# Document 01 classification proposals",
      "",
      `Status: ${result.status}; ${decisions.length}/${manifest.candidates.length} valid answers. Admission thresholds remain uncalibrated.`,
      "",
      "| # | Candidate | Jev choice | Confidence | Option probabilities | Candidate findings |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
  return result;
}
