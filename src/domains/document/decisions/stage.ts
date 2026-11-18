import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { definitionsVersion, definitionsHash, restoreQuestion, type PreparedQuestion } from "./questions.js";
import { buildDecisionRequest, sharedRuleEvidence, planDecisionBatches } from "./request.js";
import { loadClassificationCriteria } from "./semantic-input.js";
import { manifestSchema, questionManifestSchema, questionDecisionSchema, sha256, type QuestionManifest } from "./contracts.js";
import { questionPolicySchema, applyDecisionPolicy, decisionDiagnostics, type QuestionPolicy } from "./policy.js";
import { type CapturedSource } from "../discovery/source.js";
import { readJson, writeBytesAtomic, writeJsonAtomic } from "../discovery/artifacts.js";
import { identical, assertExecutionCompatibility } from "./retained-stage.js";
import { readValidatedBatches } from "./batch-collection.js";
import { jevExecutionPolicy } from "./execution-policy.js";

export async function prepareDecisionStage(input: {
  directory: string;
  operationId: string;
  stageId: string;
  discoveryDirectory: string;
  source: CapturedSource;
  questions: PreparedQuestion[];
  policy: QuestionPolicy;
  inputLimit: number;
  targetMode: "single" | "batch";
  upstreamPaths?: Record<string, string>;
}): Promise<{
  directory: string;
  manifest: QuestionManifest;
}> {
  const directory = resolve(input.directory);
  questionPolicySchema.parse(input.policy);
  const rules = sharedRuleEvidence(input.questions);
  if (rules) identical(rules, await loadClassificationCriteria(), "Approved rules");
  for (const question of input.questions) identical(question, restoreQuestion(question.descriptor, rules), "Prepared question");
  // Validate global IDs and rules before splitting into independent batches.
  buildDecisionRequest({ source: input.source, questions: input.questions, targetMode: input.targetMode });
  const upstreamPaths = Object.fromEntries(Object.entries(input.upstreamPaths ?? {}).map(([id, path]) => [id, resolve(path)]));
  const upstreamHashes = Object.fromEntries(await Promise.all(Object.entries(upstreamPaths).map(async ([id, path]) => [id, sha256(await readFile(path))])));
  const targets = Object.fromEntries(input.questions.map((q) => [q.id, q.descriptor]));
  const questionsHash = sha256(JSON.stringify(Object.values(targets)));
  const policyHash = sha256(JSON.stringify(input.policy));
  const maximum = input.targetMode === "single" ? 1 : (Math.min(...input.questions.map((q) => q.maximum_questions)) as 10 | 50);
  const config: QuestionManifest["config"] = {
    contract_version: "decision-questions-v2",
    stage_directory: directory,
    stage_id: input.stageId,
    definitions_version: definitionsVersion,
    definitions_sha256: definitionsHash,
    questions_sha256: questionsHash,
    rules_sha256: rules?.sha256 ?? null,
    policy_sha256: policyHash,
    upstream_hashes: upstreamHashes,
    upstream_paths: upstreamPaths,
    target_mode: input.targetMode,
    input_limit: input.inputLimit,
    maximum_questions: maximum,
    model: jevExecutionPolicy.model,
    provider: jevExecutionPolicy.provider,
    allow_fallbacks: jevExecutionPolicy.allowFallbacks,
    sdk_retries: jevExecutionPolicy.sdkRetries,
    retries: jevExecutionPolicy.retries,
    retry_delay_seconds: jevExecutionPolicy.retryDelaySeconds,
    max_concurrent_requests: jevExecutionPolicy.maxConcurrentRequests,
  };
  const hash = sha256(JSON.stringify(config));
  try {
    const retained = manifestSchema.parse(await readJson(join(directory, "manifest.json")));
    if (
      retained.contract_version !== "decision-questions-v2" ||
      retained.configuration_sha256 !== hash ||
      retained.source_sha256 !== input.source.sha256 ||
      retained.operation_id !== input.operationId ||
      retained.discovery_directory !== input.discoveryDirectory
    )
      throw new Error("Stage inputs changed; start a new operation");
    await assertExecutionCompatibility(retained, directory);
    return { directory, manifest: retained };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let batches: QuestionManifest["batches"];
  try {
    batches = planDecisionBatches(input.questions, input.inputLimit, maximum, (questions) =>
      buildDecisionRequest({ source: input.source, questions, targetMode: input.targetMode }),
    );
  } catch (error) {
    await writeBytesAtomic(join(directory, "source.md"), input.source.bytes);
    await writeJsonAtomic(join(directory, "planning-failure.json"), {
      contract_version: "decision-questions-v2",
      source_sha256: input.source.sha256,
      input_limit: input.inputLimit,
      configuration_sha256: hash,
      questions: input.questions,
      findings: [String(error)],
      network_request_sent: false,
    });
    throw error;
  }
  const manifest: QuestionManifest = {
    contract_version: "decision-questions-v2",
    operation_id: input.operationId,
    stage_id: input.stageId,
    discovery_directory: input.discoveryDirectory,
    created_at_utc: new Date().toISOString(),
    source_sha256: input.source.sha256,
    source_byte_length: input.source.byteLength,
    definitions_version: definitionsVersion,
    definitions_sha256: definitionsHash,
    questions_sha256: questionsHash,
    configuration_sha256: hash,
    policy: input.policy,
    policy_sha256: policyHash,
    rules_sha256: rules?.sha256 ?? null,
    rule_evidence: rules,
    upstream_hashes: upstreamHashes,
    question_targets: targets,
    config,
    batches,
  };
  questionManifestSchema.parse(manifest);
  await mkdir(directory, { recursive: true });
  await writeBytesAtomic(join(directory, "source.md"), input.source.bytes);
  await writeJsonAtomic(join(directory, "question-targets.json"), targets);
  await writeJsonAtomic(join(directory, "decision-policy.json"), input.policy);
  if (rules) await writeJsonAtomic(join(directory, "entity-rules.json"), rules);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
  return { directory, manifest };
}
function emptyStageConfiguration(input: {
  stageId: string;
  operationId: string;
  sourceSha256: string;
  sourceByteLength: number;
  policy: QuestionPolicy;
  upstreamPaths: Record<string, string>;
  upstreamHashes: Record<string, string>;
}) {
  return {
    contract_version: "catalog-empty-stage-v1",
    integrity_version: 1,
    stage_id: input.stageId,
    operation_id: input.operationId,
    source_sha256: input.sourceSha256,
    source_byte_length: input.sourceByteLength,
    policy_sha256: sha256(JSON.stringify(input.policy)),
    upstream_paths: input.upstreamPaths,
    upstream_hashes: input.upstreamHashes,
  };
}

export async function writeEmptyDecisionStage(input: {
  directory: string;
  stageId: string;
  operationId: string;
  source: CapturedSource;
  policy: QuestionPolicy;
  upstreamPaths?: Record<string, string>;
}) {
  const directory = resolve(input.directory);
  const upstreamPaths = Object.fromEntries(Object.entries(input.upstreamPaths ?? {}).map(([id, path]) => [id, resolve(path)]));
  const upstreamHashes = Object.fromEntries(await Promise.all(Object.entries(upstreamPaths).map(async ([id, path]) => [id, sha256(await readFile(path))])));
  const config = emptyStageConfiguration({
    stageId: input.stageId,
    operationId: input.operationId,
    sourceSha256: input.source.sha256,
    sourceByteLength: input.source.byteLength,
    policy: input.policy,
    upstreamPaths,
    upstreamHashes,
  });
  const empty = {
    ...config,
    configuration_sha256: sha256(JSON.stringify(config)),
    status: "complete",
    question_count: 0,
    network_requests: 0,
    findings: [],
  };
  let existingEmptyStage = false;
  try {
    await readJson(join(directory, "empty-stage.json"));
    existingEmptyStage = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existingEmptyStage) {
    await readValidatedEmptyDecisionStage({
      directory,
      stageId: input.stageId,
      operationId: input.operationId,
      sourceSha256: input.source.sha256,
      sourceByteLength: input.source.byteLength,
      policy: input.policy,
      upstreamPaths,
    });
    return empty;
  }
  await mkdir(directory, { recursive: true });
  await writeBytesAtomic(join(directory, "source.md"), input.source.bytes);
  await writeJsonAtomic(join(directory, "question-targets.json"), {});
  await writeJsonAtomic(join(directory, "decision-policy.json"), input.policy);
  await writeJsonAtomic(join(directory, "empty-stage.json"), empty);
  await writeJsonAtomic(join(directory, "decisions.json"), []);
  await writeJsonAtomic(join(directory, "validation-findings.json"), []);
  await writeJsonAtomic(join(directory, "result.json"), empty);
  return empty;
}

export async function readValidatedEmptyDecisionStage(input: {
  directory: string;
  stageId: string;
  operationId: string;
  sourceSha256: string;
  sourceByteLength: number;
  policy: QuestionPolicy;
  upstreamPaths?: Record<string, string>;
}) {
  const directory = resolve(input.directory);
  const upstreamPaths = Object.fromEntries(Object.entries(input.upstreamPaths ?? {}).map(([id, path]) => [id, resolve(path)]));
  const upstreamHashes = Object.fromEntries(await Promise.all(Object.entries(upstreamPaths).map(async ([id, path]) => [id, sha256(await readFile(path))])));
  const config = emptyStageConfiguration({
    stageId: input.stageId,
    operationId: input.operationId,
    sourceSha256: input.sourceSha256,
    sourceByteLength: input.sourceByteLength,
    policy: input.policy,
    upstreamPaths,
    upstreamHashes,
  });
  const expected = {
    ...config,
    configuration_sha256: sha256(JSON.stringify(config)),
    status: "complete",
    question_count: 0,
    network_requests: 0,
    findings: [],
  };
  const sourceBytes = await readFile(join(directory, "source.md"));
  if (sha256(sourceBytes) !== input.sourceSha256 || sourceBytes.byteLength !== input.sourceByteLength) throw new Error("Retained empty decision stage source changed");
  identical(await readJson(join(directory, "empty-stage.json")), expected, "Retained empty decision stage metadata");
  identical(await readJson(join(directory, "question-targets.json")), {}, "Retained empty stage targets");
  identical(await readJson(join(directory, "decision-policy.json")), input.policy, "Retained empty stage policy");
  identical(await readJson(join(directory, "decisions.json")), [], "Retained empty stage decisions");
  identical(await readJson(join(directory, "validation-findings.json")), [], "Retained empty stage findings");
  identical(await readJson(join(directory, "result.json")), expected, "Retained empty decision stage result");
  return { manifest: null, decisions: [], result: expected };
}

async function deriveDecisionStage(directory: string, repeatId?: string) {
  const manifest = manifestSchema.parse(await readJson(join(directory, "manifest.json")));
  if (manifest.contract_version !== "decision-questions-v2") throw new Error("Expected decision-questions-v2 stage");
  await assertExecutionCompatibility(manifest, directory);
  const decisions = [];
  const cases = [];
  const findings: string[] = [];
  for await (const { batchId, ordinary, repeat } of readValidatedBatches(directory, manifest, {
    parse: (saved) => questionDecisionSchema.parse(saved),
    repeatId,
  })) {
    if (!ordinary) {
      findings.push(`Missing batch ${batchId}`);
      continue;
    }
    for (const decision of ordinary.decisions) {
      const repeated = repeat?.decisions.find((entry) => entry.question_id === decision.question_id);
      decision.action = applyDecisionPolicy(decision.raw_answer, decision.question_kind, manifest.policy, repeated?.raw_answer);
      decisions.push({ ...decision, repeat_response_reference: repeated?.raw_response_reference ?? null });
      cases.push({
        id: decision.question_id,
        action: decision.action,
        repeatAction: repeated ? applyDecisionPolicy(repeated.raw_answer, decision.question_kind, manifest.policy, decision.raw_answer) : undefined,
      });
    }
  }
  const result = {
    status: findings.length ? "failed" : "complete",
    stage_id: manifest.stage_id,
    contract_version: manifest.contract_version,
    decision_count: decisions.length,
    action_mode: manifest.policy.mode,
    findings,
    diagnostics: decisionDiagnostics(cases),
  };
  return { manifest, decisions, result };
}

/** Read a collected stage by revalidating retained ordinary/repeat responses and policy actions. */
export async function readValidatedDecisionStage(directory: string, repeatId?: string) {
  const derived = await deriveDecisionStage(directory, repeatId);
  if (derived.result.status !== "complete") throw new Error(`Decision stage is incomplete: ${directory}`);
  const savedDecisions = await readJson(join(directory, "decisions.json"));
  const savedResult = await readJson(join(directory, "result.json"));
  identical(savedDecisions, derived.decisions, "Retained decision stage answers/actions");
  identical(savedResult, derived.result, "Retained decision stage result");
  const savedFindings = await readJson(join(directory, "validation-findings.json"));
  identical(savedFindings, derived.result.findings, "Retained decision stage findings");
  return derived;
}

export async function collectDecisionStage(directory: string, repeatId?: string) {
  const { decisions, result } = await deriveDecisionStage(directory, repeatId);
  await writeJsonAtomic(join(directory, "decisions.json"), decisions);
  await writeJsonAtomic(join(directory, "validation-findings.json"), result.findings);
  await writeJsonAtomic(join(directory, "result.json"), result);
  return result;
}
