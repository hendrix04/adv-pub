import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { readJson, writeBytesAtomic, writeJsonAtomic, writeTextAtomic } from "../discovery/artifacts.js";
import { decodeCapturedSource, type CapturedSource } from "../discovery/source.js";
import { loadClassificationCriteria, loadDiscoveryCandidates } from "../decisions/semantic-input.js";
import { prepareDecisionStage, collectDecisionStage, readValidatedDecisionStage, readValidatedEmptyDecisionStage, writeEmptyDecisionStage } from "../decisions/stage.js";
import { questionManifestSchema, questionDecisionSchema, sha256, type QuestionManifest, type Candidate } from "../decisions/contracts.js";
import { assertExecutionCompatibility } from "../decisions/retained-stage.js";
import { entityQualification, entityType } from "../decisions/questions.js";
import type { QuestionPolicy } from "../decisions/policy.js";
import { questionPolicySchema } from "../decisions/policy.js";
import { classificationRepeatId } from "./policy.js";
import { catalogAliasDirectory, loadCatalogAliasGroups } from "../aliases/operation.js";

import { layoutSchema, verifyComponent, planQualificationInputs, type CandidateRecord } from "./qualification-inputs.js";
export { mapNameSpans } from "./qualification-inputs.js";

const operationSchema = z.object({
  contract_version: z.literal("source-local-classification-v1"),
  operation_id: z.string(),
  discovery_directory: z.string(),
  source_sha256: z.string(),
  source_byte_length: z.number().int().nonnegative(),
  candidates_sha256: z.string(),
  alias_directory: z.string(),
  qualification_directory: z.string(),
  typing_directory: z.string(),
  blocks_directory: z.string().nullable(),
  blocks_layout_sha256: z.string().nullable(),
  verification_probe: z.boolean(),
  policy: z.unknown(),
  policy_sha256: z.string(),
});

export type CatalogClassificationInput = {
  discoveryDirectory: string;
  operationId: string;
  blocksDirectory?: string;
  policy: QuestionPolicy;
  inputLimit: number;
  endpointPreflight?: unknown;
  verificationProbe?: boolean;
};
export type PreparedCatalogStage = {
  directory: string;
  manifest?: QuestionManifest;
  emptyStage?: {
    stageId: string;
    operationId: string;
    sourceSha256: string;
    sourceByteLength: number;
    policy: QuestionPolicy;
    upstreamPaths: Record<string, string>;
  };
};

const operationDirectory = (discoveryDirectory: string, operationId: string) => join(resolve(discoveryDirectory), "classifications", operationId);
const entityQualificationDirectory = (root: string) => join(root, "qualification", "catalog-v1");
const entityTypeDirectory = (root: string) => join(root, "typing", "catalog-v1");
type CatalogQuestionKind = "aliasIdentity" | "entityQualification" | "entityType";

function qualificationUpstreamPaths(root: string, operation: z.infer<typeof operationSchema>) {
  return {
    alias_groups: join(operation.alias_directory, "alias-groups.json"),
    alias_result: join(operation.alias_directory, "catalog-result.json"),
    qualification_inputs: join(root, "qualification-inputs.json"),
    map_proposals: join(root, "map-place-proposals.json"),
    corrections: join(root, "discovery-correction-findings.json"),
    ...(operation.blocks_directory ? { blocks_layout: join(operation.blocks_directory, "layout.json") } : {}),
  };
}

function typingUpstreamPaths(root: string, operation: z.infer<typeof operationSchema>) {
  return {
    qualification_decisions: join(operation.qualification_directory, "decisions.json"),
    qualification_inputs: join(root, "qualification-inputs.json"),
    map_proposals: join(root, "map-place-proposals.json"),
  };
}

async function readCatalogDecisionStage(input: {
  directory: string;
  stageId: string;
  operation: z.infer<typeof operationSchema>;
  policy: QuestionPolicy;
  upstreamPaths: Record<string, string>;
}) {
  let raw: unknown;
  try {
    raw = await readJson(join(input.directory, "manifest.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readValidatedEmptyDecisionStage({
      directory: input.directory,
      stageId: input.stageId,
      operationId: input.operation.operation_id,
      sourceSha256: input.operation.source_sha256,
      sourceByteLength: input.operation.source_byte_length,
      policy: input.policy,
      upstreamPaths: input.upstreamPaths,
    });
  }
  const manifest = questionManifestSchema.parse(raw);
  if (
    manifest.stage_id !== input.stageId ||
    manifest.operation_id !== input.operation.operation_id ||
    manifest.discovery_directory !== input.operation.discovery_directory ||
    manifest.source_sha256 !== input.operation.source_sha256 ||
    manifest.source_byte_length !== input.operation.source_byte_length ||
    manifest.policy_sha256 !== input.operation.policy_sha256 ||
    JSON.stringify(manifest.policy) !== JSON.stringify(input.policy) ||
    JSON.stringify(manifest.config.upstream_paths) !== JSON.stringify(Object.fromEntries(Object.entries(input.upstreamPaths).map(([id, path]) => [id, resolve(path)])))
  ) {
    throw new Error(`Catalog ${input.stageId} operation lineage differs`);
  }
  const repeatId = classificationRepeatId(manifest.stage_id, manifest.policy, questionKindForStage(manifest.stage_id));
  return readValidatedDecisionStage(input.directory, repeatId);
}

export function catalogResumeBlocksDirectory(operation: { blocks_directory: string | null }, explicit?: string) {
  return explicit === undefined ? (operation.blocks_directory ?? undefined) : resolve(explicit);
}

export function eligibleForEntityTyping<T extends { action: { status: string; label: string | null } }>(decisions: T[], policyMode: QuestionPolicy["mode"] = "supported"): T[] {
  return decisions.filter(
    (decision) => decision.action.label === "yes" && (decision.action.status === "supported" || (policyMode === "exploratory" && decision.action.status === "provisional")),
  );
}
function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
async function writeOrAssertJson(path: string, value: unknown, label: string) {
  try {
    const retained = await readJson(path);
    if (JSON.stringify(retained) !== JSON.stringify(value)) throw new Error(`${label} changed; start a new operation`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeJsonAtomic(path, value);
}
function localId(source: CapturedSource, candidateId: string) {
  return `local-${sha256(`${source.sha256}\0${candidateId}`).slice(0, 24)}`;
}
function requireSame(left: unknown, right: unknown, label: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label} lineage differs`);
}

async function writeEmptyStage(input: {
  directory: string;
  stageId: string;
  operationId: string;
  discoveryDirectory: string;
  source: CapturedSource;
  policy: QuestionPolicy;
  upstreamPaths?: Record<string, string>;
}) {
  await writeEmptyDecisionStage({
    directory: input.directory,
    stageId: input.stageId,
    operationId: input.operationId,
    source: input.source,
    policy: input.policy,
    upstreamPaths: input.upstreamPaths,
  });
}

async function prepareStage(input: {
  directory: string;
  stageId: string;
  operationId: string;
  discoveryDirectory: string;
  source: CapturedSource;
  questions: ReturnType<typeof entityQualification>[];
  policy: QuestionPolicy;
  inputLimit: number;
  upstreamPaths: Record<string, string>;
  endpointPreflight?: unknown;
}): Promise<PreparedCatalogStage> {
  await mkdir(input.directory, { recursive: true });
  if (input.endpointPreflight !== undefined) await writeJsonAtomic(join(input.directory, "endpoint-preflight.json"), input.endpointPreflight);
  if (!input.questions.length) {
    await writeEmptyStage(input);
    return {
      directory: input.directory,
      emptyStage: {
        stageId: input.stageId,
        operationId: input.operationId,
        sourceSha256: input.source.sha256,
        sourceByteLength: input.source.byteLength,
        policy: input.policy,
        upstreamPaths: input.upstreamPaths,
      },
    };
  }
  const prepared = await prepareDecisionStage({
    directory: input.directory,
    operationId: input.operationId,
    stageId: input.stageId,
    discoveryDirectory: input.discoveryDirectory,
    source: input.source,
    questions: input.questions,
    policy: input.policy,
    inputLimit: input.inputLimit,
    targetMode: "batch",
    upstreamPaths: input.upstreamPaths,
  });
  return { directory: input.directory, manifest: prepared.manifest };
}

async function loadOperation(root: string) {
  return operationSchema.parse(await readJson(join(root, "classification-operation.json")));
}

async function assertNoDiscoveryCorrections(root: string) {
  const retained = (await readJson(join(root, "discovery-correction-findings.json"))) as { findings?: unknown[] };
  if (retained.findings?.length) throw new Error("Compatible discovery correction is required before entityQualification qualification");
}

function questionKindForStage(stageId: string): CatalogQuestionKind {
  if (stageId === "catalog-aliases-v1") return "aliasIdentity";
  if (stageId === "catalog-qualification-v1") return "entityQualification";
  if (stageId === "catalog-typing-v1") return "entityType";
  throw new Error(`Unknown catalog decision stage ${stageId}`);
}

async function collectStage(prepared: PreparedCatalogStage, repeatId?: string) {
  if (prepared.manifest) {
    const activeRepeatId = repeatId ?? classificationRepeatId(prepared.manifest.stage_id, prepared.manifest.policy, questionKindForStage(prepared.manifest.stage_id));
    return collectDecisionStage(prepared.directory, activeRepeatId);
  }
  if (!prepared.emptyStage) throw new Error("Prepared catalog stage lacks its empty-stage lineage");
  return (await readValidatedEmptyDecisionStage({ directory: prepared.directory, ...prepared.emptyStage })).result;
}

export async function prepareCatalogQualification(input: CatalogClassificationInput): Promise<PreparedCatalogStage> {
  const material = await loadDiscoveryCandidates(input.discoveryDirectory);
  const aliasDirectory = catalogAliasDirectory(material.discovery, input.operationId);
  const aliases = await loadCatalogAliasGroups(aliasDirectory, material.captured.sha256, material.candidatesHash);
  const aliasInputs = (await readJson(join(aliasDirectory, "alias-inputs.json"))) as {
    acronym_scan?: { discovery_findings?: Array<Record<string, unknown>> };
  };
  const scanFindings = aliasInputs.acronym_scan?.discovery_findings ?? [];
  const root = operationDirectory(material.discovery, input.operationId);
  const qualificationDirectory = entityQualificationDirectory(root);
  const typingDirectory = entityTypeDirectory(root);
  let layout: z.infer<typeof layoutSchema> | undefined;
  let layoutHash: string | null = null;
  if (input.blocksDirectory) {
    const layoutBytes = await readFile(join(resolve(input.blocksDirectory), "layout.json"));
    layoutHash = sha256(layoutBytes);
    layout = layoutSchema.parse(JSON.parse(layoutBytes.toString("utf8")));
    if (layout.source_sha256 !== material.captured.sha256 || layout.source_byte_length !== material.captured.byteLength)
      throw new Error("Map proposal layout source differs from discovery source");
    for (const block of layout.blocks) for (const component of block.components) verifyComponent(material.captured, component);
  }
  const operation = {
    contract_version: "source-local-classification-v1" as const,
    operation_id: input.operationId,
    discovery_directory: material.discovery,
    source_sha256: material.captured.sha256,
    source_byte_length: material.captured.byteLength,
    candidates_sha256: material.candidatesHash,
    alias_directory: aliasDirectory,
    qualification_directory: qualificationDirectory,
    typing_directory: typingDirectory,
    blocks_directory: input.blocksDirectory ? resolve(input.blocksDirectory) : null,
    blocks_layout_sha256: layoutHash,
    verification_probe: Boolean(input.verificationProbe),
    policy: input.policy,
    policy_sha256: sha256(JSON.stringify(input.policy)),
  };
  await mkdir(root, { recursive: true });
  try {
    const retained = await loadOperation(root);
    if (JSON.stringify(retained) !== JSON.stringify(operation)) throw new Error("Catalog entityQualification/entityType resume inputs changed; start a new operation");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeJsonAtomic(join(root, "classification-operation.json"), operation);
  const rules = await loadClassificationCriteria();

  const { questions, inputs, mapProposals } = planQualificationInputs(material.captured, aliases.groups, layout, rules, new Set(aliases.conflictedGroupIds));
  const missingByName = new Map<string, Record<string, unknown>>();
  for (const finding of scanFindings) {
    const span = finding.source_span as Record<string, unknown> | null;
    missingByName.set(`${String(finding.candidate_id)}:${String(finding.name)}`, {
      ...finding,
      source_spans: span ? [span] : [],
      related_source_span: finding.related_span ?? null,
    });
  }
  for (const proposal of mapProposals) {
    const entries = proposal.source_names as Array<{ name: string; source_spans: unknown[] }>;
    for (const entry of entries)
      if (proposal.missing_source_names && (proposal.missing_source_names as string[]).includes(entry.name)) {
        const key = `map:${entry.name}`;
        missingByName.set(key, {
          name: entry.name,
          reason: "Source-backed map-entry name is absent from discovery candidates; do not insert it into saved Sol output.",
          source_spans: entry.source_spans,
          place_proposal_id: proposal.id,
        });
      }
  }
  const sourceManifest = (await readJson(join(material.discovery, "source-manifest.json"))) as { source_path: string };
  const correctionFindings = [...missingByName.values()].map((finding) => ({
    ...finding,
    discovery_directory: material.discovery,
    source_sha256: material.captured.sha256,
    discovery_correction_required: true,
    recommended_command: `npm run discover -- ${shellQuote(sourceManifest.source_path)} --new-iteration`,
  }));
  await writeOrAssertJson(
    join(root, "map-place-proposals.json"),
    {
      contract_version: "map-place-proposals-v1",
      source_sha256: material.captured.sha256,
      layout_directory: operation.blocks_directory,
      layout_sha256: layoutHash,
      association_stage: "not_run",
      place_proposals: mapProposals,
    },
    "Map place proposals",
  );
  await writeOrAssertJson(
    join(root, "discovery-correction-findings.json"),
    {
      contract_version: "discovery-correction-findings-v1",
      source_sha256: material.captured.sha256,
      discovery_directory: material.discovery,
      status: correctionFindings.length ? "correction_required" : "clear",
      qualification_blocked: correctionFindings.length > 0,
      findings: correctionFindings,
    },
    "Discovery correction findings",
  );
  if (correctionFindings.length) {
    await writeJsonAtomic(join(root, "qualification-preparation-result.json"), {
      status: "blocked",
      source_sha256: material.captured.sha256,
      finding_count: correctionFindings.length,
      network_requests: 0,
      findings: correctionFindings,
    });
    throw new Error("Compatible discovery correction is required before entityQualification qualification");
  }
  await writeOrAssertJson(join(root, "qualification-inputs.json"), inputs, "entityQualification qualification inputs");
  const upstreamPaths = qualificationUpstreamPaths(root, operationSchema.parse(operation));
  const prepared = await prepareStage({
    directory: qualificationDirectory,
    stageId: "catalog-qualification-v1",
    operationId: input.operationId,
    discoveryDirectory: material.discovery,
    source: material.captured,
    questions,
    policy: input.policy,
    inputLimit: input.inputLimit,
    upstreamPaths,
    endpointPreflight: input.endpointPreflight,
  });
  await writeJsonAtomic(join(root, "qualification-preparation-result.json"), {
    status: "prepared",
    source_sha256: material.captured.sha256,
    question_count: questions.length,
    network_requests: 0,
    findings: [],
  });
  return prepared;
}

export async function collectCatalogQualification(prepared: PreparedCatalogStage) {
  await assertNoDiscoveryCorrections(resolve(prepared.directory, "../.."));
  const result = await collectStage(prepared);
  await writeJsonAtomic(join(resolve(prepared.directory, "../.."), "qualification-result.json"), result);
  return result;
}

export async function prepareCatalogTyping(input: CatalogClassificationInput): Promise<PreparedCatalogStage> {
  const root = operationDirectory(input.discoveryDirectory, input.operationId);
  await assertNoDiscoveryCorrections(root);
  const operation = await loadOperation(root);
  if (operation.policy_sha256 !== sha256(JSON.stringify(input.policy)) || Boolean(operation.verification_probe) !== Boolean(input.verificationProbe)) {
    throw new Error("entityType resume policy or verification settings differ from aliasIdentity/entityQualification");
  }
  const source = decodeCapturedSource(await readFile(join(operation.discovery_directory, "source.md")));
  if (source.sha256 !== operation.source_sha256) throw new Error("Classification source differs from operation manifest");
  const qualificationDirectory = operation.qualification_directory;
  const policy = questionPolicySchema.parse(input.policy);
  const entityQualificationStage = await readCatalogDecisionStage({
    directory: qualificationDirectory,
    stageId: "catalog-qualification-v1",
    operation,
    policy,
    upstreamPaths: qualificationUpstreamPaths(root, operation),
  });
  if (entityQualificationStage.result.status !== "complete") throw new Error("entityQualification must complete before entityType targets can be prepared");
  const decisions = z.array(questionDecisionSchema).parse(entityQualificationStage.decisions);
  const inputs = z
    .record(
      z.string(),
      z.object({
        candidate: z.record(z.string(), z.unknown()),
        source_candidate_ids: z.array(z.string()),
        place_proposal_ids: z.array(z.string()),
        kind: z.enum(["source_group", "map_place_descriptor"]),
      }),
    )
    .parse(await readJson(join(root, "qualification-inputs.json")));
  const rules = await loadClassificationCriteria();
  const questions = eligibleForEntityTyping(decisions, input.policy.mode).map((decision) =>
    entityType({
      id: `entityType-${decision.question_id}`,
      target: { candidate: inputs[decision.question_id]!.candidate as never },
      entityRules: rules,
    }),
  );
  await writeOrAssertJson(
    join(root, "typing-inputs.json"),
    Object.fromEntries(
      questions.map((question) => {
        const entityQualificationId = question.id.slice("entityType-".length);
        return [
          question.id,
          {
            entity_qualification_decision_id: entityQualificationId,
            candidate: inputs[entityQualificationId]!.candidate,
            source_candidate_ids: inputs[entityQualificationId]!.source_candidate_ids,
            place_proposal_ids: inputs[entityQualificationId]!.place_proposal_ids,
            candidate_kind: inputs[entityQualificationId]!.kind,
          },
        ];
      }),
    ),
    "entityType typing inputs",
  );
  const upstreamPaths = typingUpstreamPaths(root, operation);
  return prepareStage({
    directory: operation.typing_directory,
    stageId: "catalog-typing-v1",
    operationId: input.operationId,
    discoveryDirectory: operation.discovery_directory,
    source,
    questions,
    policy: input.policy,
    inputLimit: input.inputLimit,
    upstreamPaths,
    endpointPreflight: input.endpointPreflight,
  });
}

export async function collectCatalogTyping(prepared: PreparedCatalogStage) {
  await assertNoDiscoveryCorrections(resolve(prepared.directory, "../.."));
  const result = await collectStage(prepared);
  await writeJsonAtomic(join(resolve(prepared.directory, "../.."), "typing-result.json"), result);
  return result;
}

export async function collectCatalogClassification(input: { discoveryDirectory: string; operationId: string }) {
  const root = operationDirectory(input.discoveryDirectory, input.operationId);
  await assertNoDiscoveryCorrections(root);
  const operation = await loadOperation(root);
  const policy = questionPolicySchema.parse(operation.policy);
  if (
    operation.operation_id !== input.operationId ||
    operation.discovery_directory !== resolve(input.discoveryDirectory) ||
    operation.policy_sha256 !== sha256(JSON.stringify(policy))
  )
    throw new Error("Catalog operation root lineage differs");
  const material = await loadDiscoveryCandidates(operation.discovery_directory);
  if (
    material.captured.sha256 !== operation.source_sha256 ||
    material.captured.byteLength !== operation.source_byte_length ||
    material.candidatesHash !== operation.candidates_sha256
  ) {
    throw new Error("Catalog operation source or discovery candidates changed");
  }
  const aliases = await loadCatalogAliasGroups(operation.alias_directory, operation.source_sha256, operation.candidates_sha256);
  const conflictedGroupIds = new Set(aliases.conflictedGroupIds);
  const entityQualificationStage = await readCatalogDecisionStage({
    directory: operation.qualification_directory,
    stageId: "catalog-qualification-v1",
    operation,
    policy,
    upstreamPaths: qualificationUpstreamPaths(root, operation),
  });
  const entityTypeStage = await readCatalogDecisionStage({
    directory: operation.typing_directory,
    stageId: "catalog-typing-v1",
    operation,
    policy,
    upstreamPaths: typingUpstreamPaths(root, operation),
  });
  const entityQualification = z.array(questionDecisionSchema).parse(entityQualificationStage.decisions);
  const entityType = z.array(questionDecisionSchema).parse(entityTypeStage.decisions);
  const typingInputs = z
    .record(
      z.string(),
      z.object({
        entity_qualification_decision_id: z.string(),
        candidate: z.record(z.string(), z.unknown()),
        source_candidate_ids: z.array(z.string()),
        place_proposal_ids: z.array(z.string()),
        candidate_kind: z.enum(["source_group", "map_place_descriptor"]),
      }),
    )
    .parse(await readJson(join(root, "typing-inputs.json")));
  const qualificationInputs = z
    .record(
      z.string(),
      z.object({
        candidate: z.record(z.string(), z.unknown()),
        source_candidate_ids: z.array(z.string()),
        place_proposal_ids: z.array(z.string()),
        kind: z.enum(["source_group", "map_place_descriptor"]),
      }),
    )
    .parse(await readJson(join(root, "qualification-inputs.json")));
  const entityQualificationById = new Map(entityQualification.map((decision) => [decision.question_id, decision]));
  requireSame(Object.keys(qualificationInputs).sort(), [...entityQualificationById.keys()].sort(), "entityQualification input/decision ID");
  for (const [entityQualificationId, qualificationInput] of Object.entries(qualificationInputs)) {
    if (entityQualificationStage.manifest)
      requireSame(
        entityQualificationStage.manifest.question_targets[entityQualificationId]?.target.candidate,
        qualificationInput.candidate,
        `entityQualification request candidate ${entityQualificationId}`,
      );
  }
  const entityTypeIds = new Set(entityType.map((decision) => decision.question_id));
  requireSame(Object.keys(typingInputs).sort(), [...entityTypeIds].sort(), "entityType input/decision ID");
  for (const [entityTypeId, typingInput] of Object.entries(typingInputs)) {
    const expectedEntityTypeId = `entityType-${typingInput.entity_qualification_decision_id}`;
    const qualificationInput = qualificationInputs[typingInput.entity_qualification_decision_id];
    const qualification = entityQualificationById.get(typingInput.entity_qualification_decision_id);
    if (
      entityTypeId !== expectedEntityTypeId ||
      !qualificationInput ||
      !qualification ||
      qualification.action.label !== "yes" ||
      !(qualification.action.status === "supported" || (policy.mode === "exploratory" && qualification.action.status === "provisional"))
    ) {
      throw new Error(`entityType target is not linked to an eligible entityQualification target: ${entityTypeId}`);
    }
    requireSame(typingInput.candidate, qualificationInput.candidate, `entityType candidate ${entityTypeId}`);
    requireSame(typingInput.source_candidate_ids, qualificationInput.source_candidate_ids, `entityType source candidates ${entityTypeId}`);
    requireSame(typingInput.place_proposal_ids, qualificationInput.place_proposal_ids, `entityType map proposals ${entityTypeId}`);
    requireSame(typingInput.candidate_kind, qualificationInput.kind, `entityType candidate kind ${entityTypeId}`);
    if (entityTypeStage.manifest)
      requireSame(entityTypeStage.manifest.question_targets[entityTypeId]?.target.candidate, typingInput.candidate, `entityType request candidate ${entityTypeId}`);
  }
  const entityTypesByQualification = new Map(entityType.map((decision) => [typingInputs[decision.question_id]!.entity_qualification_decision_id, decision]));
  const entityRecords: Array<Record<string, unknown>> = [];
  const source = decodeCapturedSource(await readFile(join(operation.discovery_directory, "source.md")));
  for (const qualification of entityQualification.filter((decision) => decision.action.status === "supported" && decision.action.label === "yes")) {
    const typing = entityTypesByQualification.get(qualification.question_id);
    if (!typing) throw new Error(`Supported entityQualification result has no later entityType decision: ${qualification.question_id}`);
    const target = typingInputs[typing.question_id]!;
    if (target.candidate_kind === "source_group" && conflictedGroupIds.has(String(target.candidate.candidate_id))) continue;
    if (typing.action.status !== "supported" || !typing.action.label) continue;
    const candidate = target.candidate;
    const sourceNames = Array.isArray(candidate.names) ? candidate.names.filter((name): name is string => typeof name === "string") : [];
    entityRecords.push({
      contract_version: "source-local-entity-v1",
      local_entity_id: localId(source, qualification.question_id),
      document_id:
        ((await readJson(join(operation.discovery_directory, "source-manifest.json"))) as { source_path?: string }).source_path?.split(/[\\/]/u).at(-1)?.replace(/\.md$/iu, "") ??
        operation.source_sha256,
      source_sha256: operation.source_sha256,
      source_candidate_ids: target.source_candidate_ids,
      supported_names: sourceNames,
      aliases: sourceNames.slice(1),
      type: typing.action.label,
      source_descriptor: typeof candidate.source_descriptor === "string" ? candidate.source_descriptor : null,
      qualification_decision_id: qualification.question_id,
      type_decision_id: typing.question_id,
      evidence: candidate.source_evidence ?? candidate.members ?? [],
      place_proposal_ids: target.place_proposal_ids,
      canonical_status: "source_local_only",
    });
  }
  const mapFile = (await readJson(join(root, "map-place-proposals.json"))) as {
    place_proposals?: Array<Record<string, unknown>>;
  };
  const proposals: Array<Record<string, unknown>> = (mapFile.place_proposals ?? []).map((proposal) => {
    const entityQualificationIds = proposal.qualification_question_ids as string[];
    const entityQualificationActions = entityQualificationIds.map((id) => entityQualificationById.get(id)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const entityTypeDecisions = entityQualificationActions
      .map((decision) => entityTypesByQualification.get(decision.question_id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const locationEntities = entityRecords.filter(
      (entity) => entity.place_proposal_ids && (entity.place_proposal_ids as string[]).includes(String(proposal.id)) && entity.type === "Location",
    );
    const missing = Array.isArray(proposal.missing_source_names) && proposal.missing_source_names.length > 0;
    const identityConflict = (proposal.candidate_group_ids as string[]).some((id) => conflictedGroupIds.has(id));
    const status = missing
      ? "discovery_correction_required"
      : identityConflict
        ? "unresolved"
      : locationEntities.length
        ? "qualified_location_proposal"
        : entityQualificationActions.some((decision) => decision.action.status === "unresolved") || entityTypeDecisions.some((decision) => decision.action.status === "unresolved")
          ? "unresolved"
          : entityQualificationActions.some((decision) => decision.action.status === "provisional")
            ? "provisional"
            : "no_supported_location";
    return {
      ...proposal,
      qualification_outcomes: entityQualificationActions.map((decision) => ({
        question_id: decision.question_id,
        action: decision.action,
      })),
      typing_outcomes: entityTypeDecisions.map((decision) => ({
        question_id: decision.question_id,
        choice: decision.action.label,
        action: decision.action,
      })),
      local_entity_ids: locationEntities.map((entity) => entity.local_entity_id),
      status,
    };
  });
  await writeJsonAtomic(join(root, "map-place-proposal-results.json"), {
    contract_version: "map-place-proposal-results-v1",
    source_sha256: operation.source_sha256,
    input_path: join(root, "map-place-proposals.json"),
    association_stage: "not_run",
    place_proposals: proposals,
  });
  await writeJsonAtomic(join(root, "local-entities.json"), {
    contract_version: "source-local-entities-v1",
    source_sha256: operation.source_sha256,
    entities: entityRecords,
  });
  const entityQualificationResult = (await readJson(join(operation.qualification_directory, "result.json"))) as {
    status: string;
    findings?: string[];
  };
  const entityTypeResult = (await readJson(join(operation.typing_directory, "result.json"))) as {
    status: string;
    findings?: string[];
  };
  const corrections = (await readJson(join(root, "discovery-correction-findings.json"))) as { findings?: unknown[] };
  const findings = [
    ...(entityQualificationResult.findings ?? []),
    ...(entityTypeResult.findings ?? []),
    ...aliases.conflictedGroupIds.map((groupId) => `${groupId}: supported alias link is unapplied; source-local entity withheld pending identity resolution`),
  ];
  const result = {
    contract_version: "source-local-classification-result-v1",
    status: entityQualificationResult.status === "complete" && entityTypeResult.status === "complete" ? "complete" : "failed",
    capability: "source-local-qualified-entities",
    full_product_status: "not_run",
    operation_id: input.operationId,
    source_sha256: operation.source_sha256,
    alias_directory: operation.alias_directory,
    qualification_directory: operation.qualification_directory,
    typing_directory: operation.typing_directory,
    policy_mode: (operation.policy as { mode?: string }).mode,
    alias_identity_question_count: ((await readJson(join(operation.alias_directory, "decisions.json"))) as unknown[]).length,
    entity_qualification_question_count: entityQualification.length,
    entity_type_question_count: entityType.length,
    local_entity_count: entityRecords.length,
    map_place_proposal_count: proposals.length,
    discovery_correction_count: corrections.findings?.length ?? 0,
    findings,
    discovery_correction_required: (corrections.findings?.length ?? 0) > 0,
  };
  await writeJsonAtomic(join(root, "result.json"), result);
  await writeTextAtomic(
    join(root, "classification-view.md"),
    [
      "# Catalog alias identity and entity type classification",
      "",
      `Status: ${result.status}; policy mode: ${result.policy_mode}; alias identity ${result.alias_identity_question_count}, entity qualification ${entityQualification.length}, entity type ${entityType.length}.`,
      `Local entities: ${entityRecords.length}; map proposals: ${proposals.length}; discovery corrections required: ${result.discovery_correction_count}.`,
      "",
      "## Source-local entities",
      "",
      ...entityRecords.map((entity) => `- ${entity.local_entity_id}: ${(entity.supported_names as string[]).join(" / ") || "unnamed map descriptor"} (${entity.type})`),
      "",
      "## Map place proposals",
      "",
      ...proposals.map(
        (proposal) =>
          `- ${String(proposal.display_label)}: ${String(proposal.status)}; source names ${(proposal.source_names as Array<{ name: string }>).map((entry) => entry.name).join(" / ") || "none"}; later supported subjects ${(proposal.supported_subject_names as string[]).join(" / ") || "not run"}`,
      ),
      "",
      ...findings.map((finding) => `- Finding: ${finding}`),
      "",
    ].join("\n"),
  );
  return result;
}

export async function readCatalogClassificationOperation(directory: string) {
  const root = resolve(directory);
  const operation = await loadOperation(root);
  const source = decodeCapturedSource(await readFile(join(operation.discovery_directory, "source.md")));
  if (source.sha256 !== operation.source_sha256 || source.byteLength !== operation.source_byte_length) throw new Error("Classification operation source differs");
  return { operation, source };
}

export async function verifyCatalogClassificationLineage(directory: string) {
  const root = resolve(directory);
  const { operation, source } = await readCatalogClassificationOperation(root);
  const qualificationSource = decodeCapturedSource(await readFile(join(operation.qualification_directory, "source.md")));
  if (qualificationSource.sha256 !== source.sha256 || qualificationSource.byteLength !== source.byteLength) throw new Error("Classification stage source differs");
  for (const [stageDirectory, stageId] of [
    [operation.alias_directory, "catalog-aliases-v1"],
    [operation.qualification_directory, "catalog-qualification-v1"],
    [operation.typing_directory, "catalog-typing-v1"],
  ] as const) {
    try {
      const manifest = questionManifestSchema.parse(await readJson(join(stageDirectory, "manifest.json")));
      if (manifest.stage_id !== stageId || manifest.source_sha256 !== operation.source_sha256) throw new Error(`Unexpected retained stage lineage: ${stageId}`);
      await assertExecutionCompatibility(manifest, stageDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const empty = (await readJson(join(stageDirectory, "empty-stage.json"))) as {
        stage_id?: string;
        source_sha256?: string;
        status?: string;
      };
      if (empty.stage_id !== stageId || empty.source_sha256 !== operation.source_sha256 || empty.status !== "complete") throw new Error(`Empty stage lineage differs: ${stageId}`);
    }
  }
  return { operation, source };
}
