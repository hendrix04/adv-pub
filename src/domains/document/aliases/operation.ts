import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson, writeBytesAtomic, writeJsonAtomic, writeTextAtomic } from "../discovery/artifacts.js";
import { loadDiscoveryCandidates, loadClassificationCriteria } from "../decisions/semantic-input.js";
import { planDecisionBatches } from "../decisions/request.js";
import { preflightJev } from "../decisions/provider.js";
import { readValidatedBatches } from "../decisions/batch-collection.js";
import { jevExecutionPolicy } from "../decisions/execution-policy.js";
import {
  aliasDecisionSchema,
  candidateSchema,
  aliasManifestSchema,
  aliasQuestionVersion,
  sha256,
  jevModel,
  jevProvider,
  type AliasDecision,
  type Candidate,
  type ClassificationInput,
  type AliasManifest as Manifest,
} from "../decisions/contracts.js";
import { aliasInstructions, linkThreshold, allCandidatePairs, buildAliasRequest } from "./semantic-input.js";
import { buildReferentGroups, buildCatalogReferentGroups } from "./groups.js";
import { z } from "zod";
import { buildCatalogAliasQuestions } from "./semantic-input.js";
import { prepareDecisionStage, collectDecisionStage, readValidatedDecisionStage, readValidatedEmptyDecisionStage, writeEmptyDecisionStage } from "../decisions/stage.js";
import { questionManifestSchema, questionDecisionSchema, type QuestionManifest } from "../decisions/contracts.js";
import { assertExecutionCompatibility } from "../decisions/retained-stage.js";
import { questionPolicySchema, type QuestionPolicy } from "../decisions/policy.js";
import { classificationRepeatId } from "../classification/policy.js";

export async function prepareAliasLinking(input: ClassificationInput): Promise<{ directory: string; manifest: Manifest }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new Error("Operation ID must be a UUID");
  const material = await loadDiscoveryCandidates(input.discoveryDirectory);
  const ontology = await loadClassificationCriteria();
  const directory = join(material.discovery, "classifications", input.operationId, "aliases");
  const config = {
    model: jevModel,
    provider: jevProvider,
    allow_fallbacks: jevExecutionPolicy.allowFallbacks,
    question_version: aliasQuestionVersion,
    instructions_sha256: sha256(aliasInstructions),
    ontology_sha256: ontology.sha256,
    candidate_policy: "all_unordered_pairs",
    batch_size: 50,
    max_concurrent_requests: jevExecutionPolicy.maxConcurrentRequests,
    minimum_confidence: linkThreshold,
    minimum_same_probability: linkThreshold,
    grouping_policy: "all_member_pairs_supported",
    retries: jevExecutionPolicy.retries,
    retry_delay_seconds: jevExecutionPolicy.retryDelaySeconds,
    sdk_retries: jevExecutionPolicy.sdkRetries,
    verification_probe: Boolean(input.verificationProbe),
  };
  const configurationHash = sha256(JSON.stringify(config));
  try {
    const manifest = aliasManifestSchema.parse(await readJson(join(directory, "manifest.json"))) as Manifest;
    if (manifest.configuration_sha256 !== configurationHash || manifest.candidates_sha256 !== material.candidatesHash || manifest.source_sha256 !== material.captured.sha256) {
      throw new Error("Alias inputs changed; start a new operation");
    }
    return { directory, manifest };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true });
  const preflight = await preflightJev();
  await writeJsonAtomic(join(directory, "endpoint-preflight.json"), preflight);
  const pairs = allCandidatePairs(material.candidates);
  const batches = planDecisionBatches(pairs, preflight.inputLimit, 50, (slice) => buildAliasRequest(material.captured, material.candidates, slice, ontology.governingRules));
  const manifest: Manifest = {
    operation_id: input.operationId,
    decision_kind: "document_alias",
    discovery_directory: material.discovery,
    source_sha256: material.captured.sha256,
    source_byte_length: material.captured.byteLength,
    candidates_sha256: material.candidatesHash,
    configuration_sha256: configurationHash,
    question_version: aliasQuestionVersion,
    created_at_utc: new Date().toISOString(),
    config,
    candidates: material.candidates,
    alias_pairs: pairs,
    batches,
  };
  await writeBytesAtomic(join(directory, "source.md"), material.bytes);
  await writeTextAtomic(join(directory, "discovery-proposals.json"), material.proposalText);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
  return { directory, manifest };
}

export async function collectAliasLinks(directory: string, orchestrationFailure?: string) {
  const manifest = aliasManifestSchema.parse(await readJson(join(directory, "manifest.json"))) as Manifest;
  const findings = orchestrationFailure ? [orchestrationFailure] : [];
  const decisions: AliasDecision[] = [];
  for await (const { batchId, ordinary } of readValidatedBatches(directory, manifest, {
    parse: (decision) => aliasDecisionSchema.parse(decision),
    onError: (error) => findings.push(String(error)),
  })) {
    if (!ordinary) findings.push(`${batchId}: no validated response`);
    else decisions.push(...ordinary.decisions);
  }
  const expected = manifest.alias_pairs;
  const seen = new Set(decisions.map((decision) => decision.pair_id));
  if (seen.size !== decisions.length || expected.length !== decisions.length || expected.some((pair) => !seen.has(pair.pair_id)))
    findings.push("Incomplete or duplicated alias pair coverage");
  const grouped = buildReferentGroups(manifest.candidates, decisions);
  const result = {
    status: findings.length ? "failed" : "complete",
    source_sha256: manifest.source_sha256,
    candidates_sha256: manifest.candidates_sha256,
    configuration_sha256: manifest.configuration_sha256,
    candidate_count: manifest.candidates.length,
    pair_count: expected.length,
    decision_count: decisions.length,
    referent_count: grouped.groups.length,
    findings,
    ...grouped,
  };
  await writeJsonAtomic(join(directory, "decisions.json"), decisions);
  await writeJsonAtomic(join(directory, "result.json"), result);
  const escape = (value: string) => value.replaceAll("|", "\\|");
  await writeTextAtomic(
    join(directory, "alias-view.md"),
    [
      "# Document-local referent groups",
      "",
      `Status: ${result.status}. ${result.candidate_count} names; ${result.pair_count} pair decisions; ${result.referent_count} provisional referents.`,
      "",
      "| Referent | Preserved names |",
      "| --- | --- |",
      ...grouped.groups.map((group) => `| ${group.candidate_id} | ${escape(group.members!.map((member) => member.name).join(" / "))} |`),
      "",
      `Supported pair links withheld from groups due to incomplete/conflicting group evidence: ${grouped.unappliedLinkIds.length}.`,
      "",
    ].join("\n"),
  );
  return result;
}

export async function loadAliasGroups(directory: string, sourceHash: string, candidatesHash: string) {
  const text = await readFile(join(directory, "result.json"), "utf8");
  const result = z
    .object({
      status: z.literal("complete"),
      source_sha256: z.literal(sourceHash),
      candidates_sha256: z.literal(candidatesHash),
      groups: z.array(candidateSchema),
    })
    .parse(JSON.parse(text));
  const manifest = aliasManifestSchema.parse(await readJson(join(directory, "manifest.json"))) as Manifest;
  const decisions: AliasDecision[] = [];
  for await (const { ordinary } of readValidatedBatches(directory, manifest, {
    parse: (entry) => aliasDecisionSchema.parse(entry),
  })) {
    if (!ordinary) throw new Error("Alias grouping has an incomplete raw-response lineage");
    decisions.push(...ordinary.decisions);
  }
  if (JSON.stringify(buildReferentGroups(manifest.candidates, decisions).groups) !== JSON.stringify(result.groups)) {
    throw new Error("Alias groups do not match validated model responses");
  }
  return { groups: result.groups, sha256: sha256(text) };
}

export type CatalogAliasStage = { directory: string; manifest?: QuestionManifest };

export function catalogAliasDirectory(discoveryDirectory: string, operationId: string) {
  return join(resolve(discoveryDirectory), "classifications", operationId, "aliases", "catalog-v1");
}

export async function prepareCatalogAliasStage(
  input: ClassificationInput & { policy: QuestionPolicy; inputLimit: number; endpointPreflight?: unknown },
): Promise<CatalogAliasStage> {
  if (!/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new Error("Classification operation ID must be a UUID");
  const material = await loadDiscoveryCandidates(input.discoveryDirectory);
  const planned = buildCatalogAliasQuestions(material.captured, material.candidates);
  const directory = catalogAliasDirectory(material.discovery, input.operationId);
  const preflight = input.endpointPreflight ?? (await preflightJev());
  const stablePreflight =
    typeof preflight === "object" && preflight !== null ? Object.fromEntries(Object.entries(preflight).filter(([key]) => key !== "checked_at_utc")) : preflight;
  const preflightHash = sha256(JSON.stringify(stablePreflight));
  await mkdir(directory, { recursive: true });
  const aliasInputs = {
    contract_version: "catalog-alias-inputs-v1",
    operation_id: input.operationId,
    source_sha256: material.captured.sha256,
    candidates_sha256: material.candidatesHash,
    verification_probe: Boolean(input.verificationProbe),
    input_limit: input.inputLimit,
    endpoint_preflight_sha256: preflightHash,
    candidates: material.candidates,
    pairs: planned.pairs,
    acronym_scan: planned.scan,
  };
  let priorAliasInputs: unknown;
  try {
    priorAliasInputs = await readJson(join(directory, "alias-inputs.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (priorAliasInputs !== undefined && JSON.stringify(priorAliasInputs) !== JSON.stringify(aliasInputs)) {
    throw new Error("Catalog aliasIdentity resume inputs changed; start a new operation");
  }
  let priorManifest: QuestionManifest | undefined;
  try {
    priorManifest = questionManifestSchema.parse(await readJson(join(directory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (priorManifest) {
    if (
      priorManifest.stage_id !== "catalog-aliases-v1" ||
      priorManifest.operation_id !== input.operationId ||
      priorManifest.source_sha256 !== material.captured.sha256 ||
      priorManifest.policy_sha256 !== sha256(JSON.stringify(input.policy))
    )
      throw new Error("Catalog aliasIdentity resume policy or lineage changed; start a new operation");
    await assertExecutionCompatibility(priorManifest, directory);
  } else {
    let priorEmpty: unknown;
    try {
      priorEmpty = await readJson(join(directory, "empty-stage.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (priorEmpty !== undefined) {
      const savedPolicy = questionPolicySchema.parse(await readJson(join(directory, "decision-policy.json")));
      if (JSON.stringify(savedPolicy) !== JSON.stringify(input.policy)) throw new Error("Catalog aliasIdentity resume policy changed; start a new operation");
      await readValidatedEmptyDecisionStage({
        directory,
        stageId: "catalog-aliases-v1",
        operationId: input.operationId,
        sourceSha256: material.captured.sha256,
        sourceByteLength: material.captured.byteLength,
        policy: savedPolicy,
        upstreamPaths: {
          discovery_candidates: join(material.discovery, "decoded-proposals.json"),
          discovery_source_manifest: join(material.discovery, "source-manifest.json"),
          acronym_scan: join(directory, "alias-inputs.json"),
        },
      });
    }
  }
  await writeJsonAtomic(join(directory, "endpoint-preflight.json"), preflight);
  await writeJsonAtomic(join(directory, "alias-inputs.json"), aliasInputs);
  if (!planned.questions.length) {
    await writeEmptyDecisionStage({
      directory,
      operationId: input.operationId,
      stageId: "catalog-aliases-v1",
      source: material.captured,
      policy: input.policy,
      upstreamPaths: {
        discovery_candidates: join(material.discovery, "decoded-proposals.json"),
        discovery_source_manifest: join(material.discovery, "source-manifest.json"),
        acronym_scan: join(directory, "alias-inputs.json"),
      },
    });
    return { directory };
  }
  const prepared = await prepareDecisionStage({
    directory,
    operationId: input.operationId,
    stageId: "catalog-aliases-v1",
    discoveryDirectory: material.discovery,
    source: material.captured,
    questions: planned.questions,
    policy: input.policy,
    inputLimit: input.inputLimit,
    targetMode: "batch",
    upstreamPaths: {
      discovery_candidates: join(material.discovery, "decoded-proposals.json"),
      discovery_source_manifest: join(material.discovery, "source-manifest.json"),
      acronym_scan: join(directory, "alias-inputs.json"),
    },
  });
  return { directory, manifest: prepared.manifest };
}

export async function collectCatalogAliasStage(directory: string, orchestrationFailure?: string, repeatId?: string) {
  let stage: { status: string; findings?: string[] };
  let manifest: QuestionManifest | undefined;
  try {
    manifest = questionManifestSchema.parse(await readJson(join(directory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (manifest) {
    const activeRepeatId = repeatId ?? classificationRepeatId(manifest.stage_id, manifest.policy, "aliasIdentity");
    stage = await collectDecisionStage(directory, activeRepeatId);
    await assertExecutionCompatibility(manifest, directory);
  } else {
    const policy = questionPolicySchema.parse(await readJson(join(directory, "decision-policy.json")));
    const emptyInputs = (await readJson(join(directory, "alias-inputs.json"))) as {
      operation_id: string;
      source_sha256: string;
    };
    const source = await readFile(join(directory, "source.md"));
    stage = (
      await readValidatedEmptyDecisionStage({
        directory,
        stageId: "catalog-aliases-v1",
        operationId: emptyInputs.operation_id,
        sourceSha256: emptyInputs.source_sha256,
        sourceByteLength: source.byteLength,
        policy,
        upstreamPaths: {
          discovery_candidates: resolve(directory, "../../../../decoded-proposals.json"),
          discovery_source_manifest: resolve(directory, "../../../../source-manifest.json"),
          acronym_scan: join(directory, "alias-inputs.json"),
        },
      })
    ).result;
  }
  const input = z
    .object({
      contract_version: z.literal("catalog-alias-inputs-v1"),
      operation_id: z.string(),
      source_sha256: z.string(),
      verification_probe: z.boolean().optional(),
      candidates_sha256: z.string(),
      candidates: z.array(candidateSchema),
      pairs: z.array(z.object({ pair_id: z.string(), left_id: z.string(), right_id: z.string() })),
      acronym_scan: z.record(z.string(), z.unknown()),
    })
    .parse(await readJson(join(directory, "alias-inputs.json")));
  if (input.source_sha256 !== (manifest?.source_sha256 ?? (stage as { source_sha256?: string }).source_sha256) || (manifest && input.operation_id !== manifest.operation_id))
    throw new Error("Catalog alias input lineage differs from its stage");
  const decisions = z.array(questionDecisionSchema).parse(await readJson(join(directory, "decisions.json")));
  const candidatesById = new Map(input.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const missingSourcePairs = new Set<string>();
  for (const decision of decisions) {
    const clues = decision.target.name_clues as { candidate_ids?: unknown };
    const ids = Array.isArray(clues?.candidate_ids) ? clues.candidate_ids.filter((id): id is string => typeof id === "string") : [];
    if (ids.length !== 2 || ids.some((id) => !candidatesById.get(id)?.occurrences.length)) {
      const reason = "aliasIdentity retained but unresolved because at least one candidate has no exact source occurrence";
      decision.action = {
        status: "unresolved",
        label: null,
        policy_version: manifest!.policy.version,
        policy_sha256: manifest!.policy_sha256,
        findings: [...decision.action.findings, reason],
      };
      missingSourcePairs.add(decision.question_id);
    }
  }
  const policyMode = manifest?.policy.mode ?? "supported";
  const grouped = buildCatalogReferentGroups(input.candidates, decisions, policyMode);
  const findings = [
    ...(stage.findings ?? []),
    ...(orchestrationFailure ? [orchestrationFailure] : []),
    ...grouped.findings,
    ...[...missingSourcePairs].map((pairId) => `${pairId}: exact source evidence is missing; the retained aliasIdentity action is unresolved and was withheld from grouping.`),
  ];
  const result = {
    contract_version: "catalog-alias-result-v1",
    status: stage.status === "complete" && !orchestrationFailure ? "complete" : "failed",
    source_sha256: input.source_sha256,
    candidates_sha256: input.candidates_sha256,
    configuration_sha256: manifest?.configuration_sha256 ?? null,
    question_count: decisions.length,
    candidate_count: input.candidates.length,
    pair_count: input.pairs.length,
    acronym_count: (input.acronym_scan as { acronyms?: unknown[] }).acronyms?.length ?? 0,
    unresolved_acronym_count: (input.acronym_scan as { unresolved?: unknown[] }).unresolved?.length ?? 0,
    missing_source_pair_ids: [...missingSourcePairs],
    groups: grouped.groups,
    unapplied_link_ids: grouped.unappliedLinkIds,
    findings,
  };
  await writeJsonAtomic(join(directory, "decisions.json"), decisions);
  await writeJsonAtomic(join(directory, "alias-groups.json"), {
    contract_version: "catalog-alias-groups-v1",
    source_sha256: input.source_sha256,
    groups: grouped.groups,
    unapplied_link_ids: grouped.unappliedLinkIds,
    findings,
  });
  await writeJsonAtomic(join(directory, "catalog-result.json"), result);
  await writeTextAtomic(
    join(directory, "alias-view.md"),
    [
      "# Catalog aliasIdentity alias proposals",
      "",
      `Status: ${result.status}; ${result.pair_count} unordered pairs retained.`,
      `Acronym clues: ${result.acronym_count}; unresolved acronym occurrences: ${result.unresolved_acronym_count}.`,
      `Policy: ${manifest?.policy.mode ?? "exploratory"} (${manifest?.policy.version ?? "empty stage"}); ${policyMode === "exploratory" ? "provisional same_entity pairs are trial groups only." : "only supported same_entity pairs can group."}`,
      "",
      ...grouped.groups.map((group) => `- ${group.candidate_id}: ${(group.members ?? [group]).map((member) => member.name).join(" / ")}`),
      "",
      ...findings.map((finding) => `- Finding: ${finding}`),
      "",
    ].join("\n"),
  );
  return result;
}

export async function loadCatalogAliasGroups(directory: string, sourceHash: string, candidatesHash: string) {
  let manifest: QuestionManifest | undefined;
  try {
    manifest = questionManifestSchema.parse(await readJson(join(directory, "manifest.json")));
    await assertExecutionCompatibility(manifest, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (manifest && (manifest.stage_id !== "catalog-aliases-v1" || manifest.source_sha256 !== sourceHash)) throw new Error("Catalog aliasIdentity stage lineage differs");
  const input = (await readJson(join(directory, "alias-inputs.json"))) as {
    candidates: Candidate[];
    candidates_sha256: string;
    pairs: Array<{ pair_id: string }>;
  };
  if (input.candidates_sha256 !== candidatesHash || input.candidates.some((candidate) => candidate.candidate_id === undefined))
    throw new Error("Discovery candidate set changed; start a new classification operation");
  let decisions: z.infer<typeof questionDecisionSchema>[];
  if (!manifest) {
    const empty = (await readJson(join(directory, "empty-stage.json"))) as { operation_id?: string };
    const policy = questionPolicySchema.parse(await readJson(join(directory, "decision-policy.json")));
    const source = await readFile(join(directory, "source.md"));
    await readValidatedEmptyDecisionStage({
      directory,
      stageId: "catalog-aliases-v1",
      operationId: String(empty.operation_id),
      sourceSha256: sourceHash,
      sourceByteLength: source.byteLength,
      policy,
      upstreamPaths: {
        discovery_candidates: resolve(directory, "../../../../decoded-proposals.json"),
        discovery_source_manifest: resolve(directory, "../../../../source-manifest.json"),
        acronym_scan: join(directory, "alias-inputs.json"),
      },
    });
    decisions = [];
  } else {
    const repeatId = classificationRepeatId(manifest.stage_id, manifest.policy, "aliasIdentity");
    decisions = (await readValidatedDecisionStage(directory, repeatId)).decisions as z.infer<typeof questionDecisionSchema>[];
  }
  const result = (await readJson(join(directory, "catalog-result.json"))) as {
    status?: string;
    source_sha256?: string;
    candidates_sha256?: string;
    question_count?: number;
    pair_count?: number;
  };
  if (
    result.status !== "complete" ||
    result.source_sha256 !== sourceHash ||
    result.candidates_sha256 !== candidatesHash ||
    result.question_count !== decisions.length ||
    result.pair_count !== input.pairs.length ||
    decisions.length !== input.pairs.length
  ) {
    throw new Error("Catalog aliasIdentity stage is incomplete or does not cover every candidate pair");
  }
  const grouped = buildCatalogReferentGroups(input.candidates, decisions, manifest?.policy.mode ?? "supported");
  const retained = (await readJson(join(directory, "alias-groups.json"))) as {
    source_sha256?: string;
    groups?: Candidate[];
    unapplied_link_ids?: string[];
  };
  if (
    retained.source_sha256 !== sourceHash ||
    JSON.stringify(retained.groups) !== JSON.stringify(grouped.groups) ||
    JSON.stringify(retained.unapplied_link_ids) !== JSON.stringify(grouped.unappliedLinkIds)
  ) {
    throw new Error("Catalog alias groups differ from source-backed supported aliasIdentity pairs");
  }
  return { groups: grouped.groups, conflictedGroupIds: grouped.conflictedGroupIds, directory, sha256: sha256(JSON.stringify(retained)) };
}
