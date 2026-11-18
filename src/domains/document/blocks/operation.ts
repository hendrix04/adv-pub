import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { isAuthorizedDiscoverySource } from "../source-policy.js";
import { decodeCapturedSource, type CapturedSource } from "../discovery/source.js";
import { readJson, writeBytesAtomic, writeJsonAtomic, writeTextAtomic } from "../discovery/artifacts.js";
import { prepareDecisionStage, collectDecisionStage } from "../decisions/stage.js";
import type { PreparedQuestion } from "../decisions/questions.js";
import { questionPolicySchema, type QuestionPolicy } from "../decisions/policy.js";
import { sha256 } from "../decisions/contracts.js";
import { buildBlocks } from "./build.js";
import { titleTargets, listIntroductionAndMapLabelsTargets, linkPlacementTargets } from "./plan.js";
import { readMarkdown } from "./read.js";
import { renderLayoutView } from "./render.js";
import type { BuiltLayout, ParsedDocument, StructureAction, StructureActions } from "./types.js";
import type { JsonObject } from "@hatchet-dev/typescript-sdk/v1/types";

export type BlocksRunInput = {
  capability: "blocks";
  sourcePath: string;
  directory: string;
  operationId: string;
  mode: "new" | "resume";
  inputLimit: number;
  policy: QuestionPolicy;
  repeatId: string;
  provisionalPlanning?: boolean;
  verificationProbe?: boolean;
  reuseEvidenceDirectory?: string;
  endpointPreflight?: JsonObject;
};

export type PreparedBlocksStage = { directory: string; manifest: import("../decisions/contracts.js").QuestionManifest };
export type StageExecutor = (stage: PreparedBlocksStage, repeatId: string) => Promise<void>;

type DecisionRecord = {
  question_id: string;
  raw_answer: unknown;
  action: StructureAction;
  repeat_response_reference: string | null;
};

function identical(left: unknown, right: unknown, message: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message);
}

async function prepareOperation(input: BlocksRunInput): Promise<{ directory: string; sourcePath: string; source: CapturedSource; parsed: ParsedDocument }> {
  const directory = resolve(input.directory);
  const sourcePath = resolve(input.sourcePath);
  if (!isAuthorizedDiscoverySource(sourcePath)) throw new Error("Block reading is limited to the nine supplied lore sources");
  const source = decodeCapturedSource(await readFile(sourcePath));
  const parsed = readMarkdown(source);
  const policy = questionPolicySchema.parse(input.policy);
  const preflightEvidence = input.endpointPreflight ?? { input_limit: input.inputLimit };
  const stablePreflight =
    typeof preflightEvidence === "object" && preflightEvidence !== null
      ? Object.fromEntries(Object.entries(preflightEvidence).filter(([key]) => key !== "checked_at_utc"))
      : preflightEvidence;
  const config = {
    contract_version: "lore-to-blocks-operation-v1",
    operation_id: input.operationId,
    source_path: sourcePath,
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    input_limit: input.inputLimit,
    policy,
    policy_sha256: sha256(JSON.stringify(policy)),
    repeat_id: input.repeatId,
    provisional_planning: Boolean(input.provisionalPlanning),
    verification_probe: Boolean(input.verificationProbe),
    reuse_evidence_directory: input.reuseEvidenceDirectory ? resolve(input.reuseEvidenceDirectory) : null,
    endpoint_preflight_sha256: sha256(JSON.stringify(stablePreflight)),
  };
  if (input.mode === "new") {
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
    await writeBytesAtomic(join(directory, "source.md"), source.bytes);
    await writeJsonAtomic(join(directory, "source-manifest.json"), {
      source_path: sourcePath,
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeJsonAtomic(join(directory, "operation.json"), {
      ...config,
      configuration_sha256: sha256(JSON.stringify(config)),
      created_at_utc: new Date().toISOString(),
    });
    await writeJsonAtomic(join(directory, "parsed.json"), parsed);
    await writeJsonAtomic(join(directory, "items.json"), parsed.items);
    await writeJsonAtomic(join(directory, "endpoint-preflight.json"), preflightEvidence);
  } else {
    const saved = (await readJson(join(directory, "operation.json"))) as Record<string, unknown>;
    const { configuration_sha256, created_at_utc, ...savedConfig } = saved;
    identical(savedConfig, config, "Resume inputs differ from the retained source, policy, or configuration; start a new operation");
    if (configuration_sha256 !== sha256(JSON.stringify(config))) throw new Error("Retained block operation configuration hash differs");
    const retainedPreflight = await readJson(join(directory, "endpoint-preflight.json"));
    const retainedStablePreflight =
      typeof retainedPreflight === "object" && retainedPreflight !== null
        ? Object.fromEntries(Object.entries(retainedPreflight).filter(([key]) => key !== "checked_at_utc"))
        : retainedPreflight;
    identical(sha256(JSON.stringify(retainedStablePreflight)), config.endpoint_preflight_sha256, "Retained endpoint preflight evidence differs");
    const sourceBytes = await readFile(join(directory, "source.md"));
    const retained = decodeCapturedSource(sourceBytes);
    identical(retained.sha256, source.sha256, "Source changed since the retained block operation was prepared");
    identical(
      await readJson(join(directory, "source-manifest.json")),
      { source_path: sourcePath, sha256: source.sha256, byte_length: source.byteLength },
      "Retained source manifest differs",
    );
    const savedParsed = await readJson(join(directory, "parsed.json"));
    identical(savedParsed, parsed, "Parsed source changed since the retained block operation was prepared");
    const retainedItems = await readJson(join(directory, "items.json"));
    identical(retainedItems, parsed.items, "Retained parsed items changed since preparation");
  }
  return { directory, sourcePath, source, parsed };
}

async function saveLayout(directory: string, parsed: ParsedDocument, layout: BuiltLayout) {
  await writeJsonAtomic(join(directory, "items.json"), parsed.items);
  await writeJsonAtomic(join(directory, "layout.json"), layout);
  await writeTextAtomic(join(directory, "layout-view.md"), renderLayoutView(layout));
}

async function prepareStage(input: {
  directory: string;
  operationId: string;
  sourcePath: string;
  source: CapturedSource;
  questions: PreparedQuestion[];
  policy: QuestionPolicy;
  inputLimit: number;
  stageName: string;
  upstreamPaths?: Record<string, string>;
}) {
  const directory = join(input.directory, "stages", input.stageName);
  if (!input.questions.length) {
    await mkdir(directory, { recursive: true });
    const result = {
      status: "complete",
      stage_id: input.stageName,
      contract_version: "lore-block-empty-stage-v1",
      question_count: 0,
      network_requests: 0,
      findings: [],
    };
    await writeJsonAtomic(join(directory, "empty-stage.json"), {
      ...result,
      source_sha256: input.source.sha256,
      policy_sha256: sha256(JSON.stringify(input.policy)),
      upstream_paths: input.upstreamPaths ?? {},
    });
    await writeJsonAtomic(join(directory, "decisions.json"), []);
    await writeJsonAtomic(join(directory, "result.json"), result);
    return undefined;
  }
  return prepareDecisionStage({
    directory,
    operationId: input.operationId,
    stageId: `blocks-${input.stageName}`,
    discoveryDirectory: input.directory,
    source: input.source,
    questions: input.questions,
    policy: input.policy,
    inputLimit: input.inputLimit,
    targetMode: "batch",
    upstreamPaths: input.upstreamPaths,
  });
}

async function stageOutput(directory: string) {
  const [records, result] = await Promise.all([
    readJson(join(directory, "decisions.json")) as Promise<DecisionRecord[]>,
    readJson(join(directory, "result.json")) as Promise<{ status: string; [key: string]: unknown }>,
  ]);
  return { records, result };
}

function actionsFrom(records: DecisionRecord[]): StructureActions {
  return Object.fromEntries(records.map((record) => [record.question_id, record.action]));
}

export function actionOutcomeCounts(actions: StructureActions) {
  const outcomes = { rejected_count: 0, unresolved_count: 0 };
  for (const action of Object.values(actions)) {
    if (action.status === "rejected") outcomes.rejected_count += 1;
    if (action.status === "unresolved") outcomes.unresolved_count += 1;
  }
  return outcomes;
}

function mergeActions(...sets: StructureActions[]): StructureActions {
  return Object.assign({}, ...sets);
}

function evidenceFrom(...sets: DecisionRecord[][]) {
  return sets.flat().map((record) => ({ ...record, action: record.action }));
}

async function executeQuestionStage(input: { directory: string; stageName: string; prepared: Awaited<ReturnType<typeof prepareStage>>; execute: StageExecutor; repeatId: string }) {
  if (!input.prepared)
    return {
      records: [] as DecisionRecord[],
      result: { status: "complete", question_count: 0 },
      directory: join(input.directory, "stages", input.stageName),
    };
  const prepared = { directory: input.prepared.directory, manifest: input.prepared.manifest };
  await input.execute(prepared, input.repeatId);
  const collected = await collectDecisionStage(prepared.directory, input.repeatId);
  const output = await stageOutput(prepared.directory);
  if (collected.status !== "complete" || output.result.status !== "complete") throw new Error(`${input.stageName} stage incomplete; see ${prepared.directory}/result.json`);
  return { ...output, directory: prepared.directory };
}

export async function runBlocksOperation(
  input: BlocksRunInput,
  execute: StageExecutor,
): Promise<{
  status: "complete" | "failed";
  directory: string;
  layout: BuiltLayout;
  stage_directories: Record<string, string>;
  failure?: string;
}> {
  const session = await prepareOperation(input);
  const actions: StructureActions[] = [];
  const records: DecisionRecord[][] = [];
  const stageDirectories: Record<string, string> = {};
  let failure: string | undefined;
  const prepareAndRun = async (name: string, questions: PreparedQuestion[], upstreamPaths?: Record<string, string>) => {
    const prepared = await prepareStage({
      directory: session.directory,
      operationId: input.operationId,
      sourcePath: session.sourcePath,
      source: session.source,
      questions,
      policy: input.policy,
      inputLimit: input.inputLimit,
      stageName: name,
      upstreamPaths,
    });
    const output = await executeQuestionStage({
      directory: session.directory,
      stageName: name,
      prepared,
      execute,
      repeatId: input.repeatId,
    });
    stageDirectories[name] = output.directory;
    actions.push(actionsFrom(output.records));
    records.push(output.records);
    return output;
  };
  try {
    const title = await prepareAndRun("title", titleTargets(session.source, session.parsed));
    const listAndMapTargets = listIntroductionAndMapLabelsTargets(session.source, session.parsed, actionsFrom(title.records), Boolean(input.provisionalPlanning));
    const listIntroduction = await prepareAndRun("listIntroduction", listAndMapTargets.listIntroduction, { title: join(stageDirectories.title!, "result.json") });
    const mapLabels = await prepareAndRun("mapLabels", listAndMapTargets.mapLabels, { title: join(stageDirectories.title!, "result.json") });
    const afterMapLabels = mergeActions(actions[0] ?? {}, actions[1] ?? {}, actions[2] ?? {});
    const linkPlacement = await prepareAndRun("linkPlacement", linkPlacementTargets(session.source, session.parsed, afterMapLabels, Boolean(input.provisionalPlanning)), {
      title: join(stageDirectories.title!, "result.json"),
      listIntroduction: join(stageDirectories.listIntroduction!, "result.json"),
      mapLabels: join(stageDirectories.mapLabels!, "result.json"),
    });
    const combined = mergeActions(...actions);
    const layout = buildBlocks({
      source: session.source,
      parsed: session.parsed,
      actions: combined,
      decisions: evidenceFrom(...records),
      includeProvisional: Boolean(input.provisionalPlanning),
      stageComplete: true,
    });
    const outcomes = actionOutcomeCounts(combined);
    await saveLayout(session.directory, session.parsed, layout);
    await writeJsonAtomic(join(session.directory, "result.json"), {
      status: "complete",
      capability: "source-local-structure",
      full_product_status: "not_run",
      operation_id: input.operationId,
      source_sha256: session.source.sha256,
      source_byte_length: session.source.byteLength,
      stage_directories: stageDirectories,
      question_counts: {
        title: title.records.length,
        listIntroduction: listIntroduction.records.length,
        mapLabels: mapLabels.records.length,
        linkPlacement: linkPlacement.records.length,
      },
      block_count: layout.blocks.length,
      section_count: layout.sections.length,
      map_key_count: layout.map_keys.length,
      place_proposal_count: layout.place_proposals.length,
      ...outcomes,
      findings: layout.findings,
    });
    return { status: "complete", directory: session.directory, layout, stage_directories: stageDirectories };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    failure = error instanceof Error ? error.message : String(error);
    const combined = mergeActions(...actions);
    const layout = buildBlocks({
      source: session.source,
      parsed: session.parsed,
      actions: combined,
      decisions: evidenceFrom(...records),
      includeProvisional: Boolean(input.provisionalPlanning),
      stageComplete: false,
    });
    await saveLayout(session.directory, session.parsed, layout);
    await writeJsonAtomic(join(session.directory, "failure.json"), {
      at_utc: new Date().toISOString(),
      failure,
      stage_directories: stageDirectories,
      source_sha256: session.source.sha256,
    });
    await writeJsonAtomic(join(session.directory, "result.json"), {
      status: "failed",
      capability: "source-local-structure",
      full_product_status: "not_run",
      failure,
      stage_directories: stageDirectories,
      findings: layout.findings,
    });
    return { status: "failed", directory: session.directory, layout, stage_directories: stageDirectories, failure };
  }
}
