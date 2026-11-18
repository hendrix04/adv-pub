import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readJson, writeBytesAtomic, writeJsonAtomic } from "../discovery/artifacts.js";
import type { CapturedSource } from "../discovery/source.js";
import { sha256 } from "../decisions/integrity.js";
import { questionPolicySchema, type QuestionPolicy } from "../decisions/policy.js";
import { collectDecisionStage, prepareDecisionStage, readValidatedDecisionStage, writeEmptyDecisionStage } from "../decisions/stage.js";
import type { PreparedQuestion } from "../decisions/questions.js";
import { buildAssociationLinks, buildFoundSections, assembleEntityContexts, renderEntityContextView } from "./context.js";
import { loadAssociationInputs, type AssociationInputs, type LoadedAssociationInputs } from "./inputs.js";
import { findEntityMentions } from "./mentions.js";
import { exploratoryAssociationPolicy } from "./policy.js";
import { nextContinuationFrontier, planContinuationQuestions, planInitialAssociationQuestions, planMeaningQuestions, planSectionQuestions } from "./planning.js";
import type { AssociationLink, DecisionRecord, FoundSection } from "./types.js";

export type AssociationRunInput = AssociationInputs & {
  capability: "associate";
  directory: string;
  operationId: string;
  mode: "new" | "resume";
  inputLimit: number;
  repeatId: string;
  policy?: QuestionPolicy;
  includeOriginNotes?: boolean;
  endpointPreflight?: Record<string, unknown>;
};
export type AssociationWorkflowInput = Omit<AssociationRunInput, "inputLimit" | "endpointPreflight">;

export type AssociationStage = { directory: string; manifest: import("../decisions/contracts.js").QuestionManifest };
export type AssociationStageExecutor = (stage: AssociationStage, repeatId: string) => Promise<void>;

type AssociationSession = LoadedAssociationInputs & {
  directory: string;
  operationId: string;
  policy: QuestionPolicy;
  repeatId: string;
  includeOriginNotes: boolean;
};

function identical(left: unknown, right: unknown, message: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(message);
}

function assertAssociationPolicy(policy: QuestionPolicy) {
  questionPolicySchema.parse(policy);
  for (const kind of ["blockSubject", "subjectContinuation", "sectionSubject", "documentSubject"] as const) {
    if (!policy.rules[kind]?.require_repeat) throw new Error(`${kind} requires a fresh repeat under the approved association design`);
  }
  for (const kind of ["blockSubject", "subjectContinuation", "sectionSubject", "documentSubject", "passageMeaning", "textOrigin"] as const) {
    if (!policy.rules[kind]) throw new Error(`Association policy has no rule for ${kind}`);
  }
  if (policy.mode === "supported" && !policy.calibration_evidence_hashes.length) throw new Error("Supported association policy requires source-review calibration evidence hashes");
}

async function prepareSession(input: AssociationRunInput): Promise<AssociationSession> {
  const directory = resolve(input.directory);
  const upstream = await loadAssociationInputs(input);
  const policy = input.policy ?? exploratoryAssociationPolicy();
  assertAssociationPolicy(policy);
  const includeOriginNotes = input.includeOriginNotes ?? true;
  const stablePreflight = input.endpointPreflight
    ? Object.fromEntries(Object.entries(input.endpointPreflight).filter(([key]) => key !== "checked_at_utc"))
    : { input_limit: input.inputLimit };
  const config = {
    contract_version: "source-local-association-v1",
    operation_id: input.operationId,
    source_path: upstream.sourcePath,
    structure_directory: upstream.structureDirectory,
    classification_directory: upstream.classificationDirectory,
    output_directory: directory,
    source_sha256: upstream.source.sha256,
    source_byte_length: upstream.source.byteLength,
    upstream_hashes: upstream.hashes,
    input_limit: input.inputLimit,
    endpoint_preflight_sha256: sha256(JSON.stringify(stablePreflight)),
    policy,
    policy_sha256: sha256(JSON.stringify(policy)),
    repeat_id: input.repeatId,
    include_origin_notes: includeOriginNotes,
  };
  const configurationSha256 = sha256(JSON.stringify(config));
  if (input.mode === "new") {
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
    await writeBytesAtomic(join(directory, "source.md"), upstream.source.bytes);
    await writeJsonAtomic(join(directory, "source-manifest.json"), {
      source_path: upstream.sourcePath,
      sha256: upstream.source.sha256,
      byte_length: upstream.source.byteLength,
    });
    await writeJsonAtomic(join(directory, "operation.json"), {
      ...config,
      configuration_sha256: configurationSha256,
      created_at_utc: new Date().toISOString(),
    });
    await writeJsonAtomic(join(directory, "endpoint-preflight.json"), input.endpointPreflight ?? { input_limit: input.inputLimit });
    await writeJsonAtomic(join(directory, "entities.json"), {
      contract_version: "source-local-entities-v1",
      source_sha256: upstream.source.sha256,
      entities: upstream.entities,
    });
  } else {
    const saved = (await readJson(join(directory, "operation.json"))) as Record<string, unknown>;
    const { configuration_sha256, created_at_utc, ...savedConfig } = saved;
    identical(savedConfig, config, "Association resume inputs differ from retained source, layout, entities, policy, or configuration");
    if (configuration_sha256 !== configurationSha256) throw new Error("Retained association configuration hash differs");
    const sourceBytes = await readFile(join(directory, "source.md"));
    if (!sourceBytes.equals(upstream.source.bytes)) throw new Error("Retained association source differs from original source bytes");
    identical(
      await readJson(join(directory, "source-manifest.json")),
      { source_path: upstream.sourcePath, sha256: upstream.source.sha256, byte_length: upstream.source.byteLength },
      "Retained association source manifest differs",
    );
    identical(
      await readJson(join(directory, "entities.json")),
      {
        contract_version: "source-local-entities-v1",
        source_sha256: upstream.source.sha256,
        entities: upstream.entities,
      },
      "Retained association entities differ from the accepted upstream result",
    );
    const retainedPreflight = (await readJson(join(directory, "endpoint-preflight.json"))) as Record<string, unknown>;
    const retainedStable = Object.fromEntries(Object.entries(retainedPreflight).filter(([key]) => key !== "checked_at_utc"));
    identical(sha256(JSON.stringify(retainedStable)), config.endpoint_preflight_sha256, "Retained association endpoint metadata differs");
  }
  return {
    ...upstream,
    directory,
    operationId: input.operationId,
    policy,
    repeatId: input.repeatId,
    includeOriginNotes,
  };
}

async function runQuestionStage(input: {
  session: AssociationSession;
  name: string;
  questions: PreparedQuestion[];
  inputLimit: number;
  repeatId: string;
  execute: AssociationStageExecutor;
}): Promise<DecisionRecord[]> {
  const directory = join(input.session.directory, "stages", input.name);
  const upstreamPaths = {
    layout: join(input.session.structureDirectory, "layout.json"),
    structure_result: join(input.session.structureDirectory, "result.json"),
    local_entities: join(input.session.classificationDirectory, "local-entities.json"),
    classification_operation: join(input.session.classificationDirectory, "classification-operation.json"),
    classification_result: join(input.session.classificationDirectory, "result.json"),
  };
  if (!input.questions.length) {
    await writeEmptyDecisionStage({
      directory,
      stageId: `association-${input.name}`,
      operationId: input.session.operationId,
      source: input.session.source,
      policy: input.session.policy,
      upstreamPaths,
    });
    return [];
  }
  const prepared = await prepareDecisionStage({
    directory,
    operationId: input.session.operationId,
    stageId: `association-${input.name}`,
    discoveryDirectory: input.session.directory,
    source: input.session.source,
    questions: input.questions,
    policy: input.session.policy,
    inputLimit: input.inputLimit,
    targetMode: "batch",
    upstreamPaths,
  });
  await input.execute({ directory: prepared.directory, manifest: prepared.manifest }, input.repeatId);
  const collected = await collectDecisionStage(prepared.directory, input.repeatId);
  if (collected.status !== "complete") throw new Error(`${input.name} stage incomplete; inspect ${prepared.directory}/result.json`);
  return (await readValidatedDecisionStage(prepared.directory, input.repeatId)).decisions as DecisionRecord[];
}

function recordsFor(records: DecisionRecord[], kind: string) {
  return records.filter((record) => record.question_kind === kind);
}

export async function runAssociationOperation(
  input: AssociationRunInput,
  execute: AssociationStageExecutor,
): Promise<{
  status: "complete" | "failed";
  directory: string;
  result: Record<string, unknown>;
  links?: AssociationLink[];
  foundSections?: FoundSection[];
}> {
  const directory = resolve(input.directory);
  let session: AssociationSession | undefined;
  try {
    session = await prepareSession(input);
    const mentions = findEntityMentions(session.source, session.layout, session.entities);
    if (input.mode === "new") await writeJsonAtomic(join(directory, "mentions.json"), mentions);
    else identical(await readJson(join(directory, "mentions.json")), mentions, "Retained association mentions differ from original source and accepted entities");

    const initial = planInitialAssociationQuestions({
      source: session.source,
      layout: session.layout,
      entities: session.entities,
      mentions,
      includeOriginNotes: session.includeOriginNotes,
    });
    if (initial.blockSubjectLedger.length !== session.entities.length * session.layout.blocks.length)
      throw new Error("blockSubject target ledger is not the complete entity/block Cartesian product");
    await writeJsonAtomic(join(directory, "block-subject-target-ledger.json"), {
      contract_version: "association-block-subject-target-ledger-v1",
      source_sha256: session.source.sha256,
      layout_sha256: session.hashes.layout_sha256,
      local_entities_sha256: session.hashes.local_entities_sha256,
      entity_count: session.entities.length,
      block_count: session.layout.blocks.length,
      expected_pair_count: session.entities.length * session.layout.blocks.length,
      targets: initial.blockSubjectLedger,
    });
    const firstRecords = await runQuestionStage({
      session,
      name: "initial-subjects-and-origin",
      questions: initial.questions,
      inputLimit: input.inputLimit,
      repeatId: session.repeatId,
      execute,
    });
    const blockSubjectRecords = recordsFor(firstRecords, "blockSubject");
    const documentSubjectRecords = recordsFor(firstRecords, "documentSubject");
    const textOriginRecords = recordsFor(firstRecords, "textOrigin");

    const subjectContinuationRecords: DecisionRecord[] = [];
    let frontier = nextContinuationFrontier(session.layout, session.entities, blockSubjectRecords, subjectContinuationRecords);
    let round = 0;
    while (frontier.length && round < session.layout.blocks.length) {
      round += 1;
      const name = `subject-continuation-round-${String(round).padStart(3, "0")}`;
      const stageQuestions = planContinuationQuestions(session.source, session.layout, session.entities, frontier);
      const records = await runQuestionStage({
        session,
        name,
        questions: stageQuestions,
        inputLimit: input.inputLimit,
        repeatId: session.repeatId,
        execute,
      });
      subjectContinuationRecords.push(...records);
      await writeJsonAtomic(join(directory, `subject-continuation-round-${String(round).padStart(3, "0")}-frontier.json`), {
        contract_version: "association-subject-continuation-frontier-v1",
        round,
        planned: frontier,
        decisions: records.map((record) => ({ question_id: record.question_id, action: record.action })),
      });
      frontier = nextContinuationFrontier(session.layout, session.entities, blockSubjectRecords, subjectContinuationRecords);
    }
    if (frontier.length) throw new Error("subjectContinuation continuation planning exceeded the source block count");
    if (round === 0)
      await runQuestionStage({
        session,
        name: "subject-continuation-round-001",
        questions: [],
        inputLimit: input.inputLimit,
        repeatId: session.repeatId,
        execute,
      });

    const foundSections = buildFoundSections(session.layout, session.entities, blockSubjectRecords, subjectContinuationRecords);
    await writeJsonAtomic(join(directory, "found-sections.json"), foundSections);
    const plannedSections = planSectionQuestions(session.source, session.layout, session.entities, foundSections, input.inputLimit);
    const sectionSubjectRecords = await runQuestionStage({
      session,
      name: "sectionSubject",
      questions: plannedSections.map((entry) => entry.question),
      inputLimit: input.inputLimit,
      repeatId: session.repeatId,
      execute,
    });
    const meaningQuestions = planMeaningQuestions(session.source, session.layout, session.entities, mentions, blockSubjectRecords);
    const passageMeaningRecords = await runQuestionStage({
      session,
      name: "passageMeaning",
      questions: meaningQuestions,
      inputLimit: input.inputLimit,
      repeatId: session.repeatId,
      execute,
    });

    const foundById = new Map(foundSections.map((found) => [found.found_section_id, found]));
    const links = buildAssociationLinks({
      layout: session.layout,
      entities: session.entities,
      blockAndDocumentSubjectDecisions: [...blockSubjectRecords, ...documentSubjectRecords],
      sectionDecisions: sectionSubjectRecords,
      sectionQuestionMetadata: plannedSections.map(({ question, scope, targetId, localEntityId, blockIds }) => {
        const found = scope === "found_section" ? foundById.get(targetId) : undefined;
        return {
          question_id: question.id,
          scope,
          target_id: targetId,
          local_entity_id: localEntityId,
          block_ids: blockIds,
          provenance_question_ids: found ? [found.seed_question_id, ...found.continuation_question_ids] : [],
        };
      }),
    });
    const contexts = assembleEntityContexts({
      layout: session.layout,
      entities: session.entities,
      mentions,
      links,
      meaningNotes: passageMeaningRecords,
      originNotes: textOriginRecords,
    });
    const allDecisions = [...firstRecords, ...subjectContinuationRecords, ...sectionSubjectRecords, ...passageMeaningRecords];
    await Promise.all([
      writeJsonAtomic(join(directory, "links.json"), links),
      writeJsonAtomic(join(directory, "meaning-notes.json"), passageMeaningRecords),
      writeJsonAtomic(join(directory, "origin-notes.json"), textOriginRecords),
      writeJsonAtomic(join(directory, "context.json"), contexts),
      writeJsonAtomic(join(directory, "map-place-proposals.json"), {
        contract_version: "source-local-map-place-proposals-v1",
        source_sha256: session.source.sha256,
        layout_sha256: session.hashes.layout_sha256,
        proposals: session.layout.place_proposals,
      }),
      writeJsonAtomic(join(directory, "context-view.md"), renderEntityContextView({ entities: session.entities, links, contexts })),
    ]);
    const result = {
      contract_version: "source-local-association-result-v1",
      status: "complete",
      capability: "source-local-association",
      full_product_status: "not_run",
      operation_id: session.operationId,
      source_sha256: session.source.sha256,
      source_byte_length: session.source.byteLength,
      input_hashes: session.hashes,
      policy_mode: session.policy.mode,
      policy_sha256: sha256(JSON.stringify(session.policy)),
      entity_count: session.entities.length,
      block_count: session.layout.blocks.length,
      mention_count: mentions.length,
      block_subject_pair_count: blockSubjectRecords.length,
      block_subject_expected_pair_count: session.entities.length * session.layout.blocks.length,
      document_subject_entity_count: documentSubjectRecords.length,
      subject_continuation_question_count: subjectContinuationRecords.length,
      section_subject_question_count: sectionSubjectRecords.length,
      passage_meaning_count_count: passageMeaningRecords.length,
      text_origin_count_count: textOriginRecords.length,
      include_origin_notes: session.includeOriginNotes,
      map_place_proposal_count: session.layout.place_proposals.length,
      found_section_count: foundSections.length,
      supported_link_count: links.filter((link) => link.status === "supported").length,
      provisional_link_count: links.filter((link) => link.status === "provisional").length,
      rejected_link_count: links.filter((link) => link.status === "rejected").length,
      unresolved_link_count: links.filter((link) => link.status === "unresolved").length,
      context_block_count: contexts.reduce((total, context) => total + context.block_ids.length, 0),
      unresolved_question_ids: allDecisions.filter((record) => record.action.status === "unresolved").map((record) => record.question_id),
      findings: allDecisions.flatMap((record) => record.action.findings.map((finding) => `${record.question_id}: ${finding}`)),
    };
    await writeJsonAtomic(join(directory, "result.json"), result);
    return { status: "complete", directory, result, links, foundSections };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (input.mode === "new") {
      try {
        await mkdir(dirname(directory), { recursive: true });
        await mkdir(directory);
      } catch (createError) {
        if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
      }
      await writeJsonAtomic(join(directory, "failure.json"), {
        contract_version: "source-local-association-failure-v1",
        failure: message,
        at_utc: new Date().toISOString(),
      });
      const result = {
        contract_version: "source-local-association-result-v1",
        status: "failed",
        capability: "source-local-association",
        full_product_status: "not_run",
        failure: message,
        source_sha256: session?.source.sha256 ?? null,
        input_hashes: session?.hashes ?? null,
      };
      await writeJsonAtomic(join(directory, "result.json"), result);
      return { status: "failed", directory, result };
    }
    throw error;
  }
}

export function newAssociationOperationId() {
  return randomUUID();
}
export { exploratoryAssociationPolicy };
