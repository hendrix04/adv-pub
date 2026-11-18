import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditRetainedStage, hash, json } from "./retained-decision-audit.js";

import { assertSourceSpans, assertSame, assertLocalEntityCoverage, assertMapProposalResults, assertQualificationCandidateLineage } from "./catalog-entity-lineage-audit.js";
export {
  assertLocalEntityCoverage,
  assertMapProposalResults,
  assertQualificationCandidateLineage,
} from "./catalog-entity-lineage-audit.js";

const aliasIdentityCriteria = {
  same_entity: "Both names name one entity in this document.",
  different_entities: "The names name different entities.",
  unclear: "The source does not settle the link, or a name has conflicting uses.",
};
const entityQualificationCriteria = {
  yes: "The candidate names one specific entity that fits an approved definition.",
  no: "It is generic content or does not fit any approved definition.",
  unclear: "The source does not settle its identity or qualification, or the candidate mixes different entities.",
};
const entityTypeChoices = ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const keys = (value: Record<string, unknown>) => Object.keys(value).sort();

function deriveAction(answer: any, kind: string, policy: any, repeat?: any) {
  const rule = policy.rules[kind];
  const action = {
    status: "unresolved",
    label: null as string | null,
    policy_version: policy.version,
    policy_sha256: hash(JSON.stringify(policy)),
    findings: [] as string[],
  };
  if (!rule) {
    action.findings.push("No policy for question kind");
    return action;
  }
  if (policy.mode === "supported" && !policy.calibration_evidence_hashes.length) {
    action.findings.push("Supported policy lacks source-review calibration evidence");
    return action;
  }
  const labelOf = (value: any): string | null => {
    if (value.type === "noul") return value.noul > rule.yes_threshold ? "yes" : value.noul < rule.no_threshold ? "no" : null;
    const probabilities = Object.values(value.probabilities) as number[];
    const maximum = Math.max(...probabilities);
    if (
      probabilities.filter((probability) => probability === maximum).length !== 1 ||
      value.probabilities[value.choice] !== maximum ||
      maximum < rule.choice_threshold ||
      value.choice === "unclear"
    )
      return null;
    return value.choice;
  };
  action.label = labelOf(answer);
  if (!action.label) {
    action.findings.push("Tie, unclear answer or insufficient probability");
    return action;
  }
  if (rule.require_repeat && (!repeat || labelOf(repeat) !== action.label || repeat.type !== answer.type)) {
    action.findings.push(repeat ? "Fresh repeat disagrees" : "Fresh repeat required");
    return action;
  }
  action.status = policy.mode === "exploratory" ? "provisional" : action.label === "no" || action.label === "different_entities" ? "rejected" : "supported";
  return action;
}

export function assertDecisionActions(decisions: any[], stageAudit: any, manifest: any) {
  assert.equal(decisions.length, stageAudit.answers.size);
  const ids = decisions.map((decision) => decision.question_id);
  assert.equal(new Set(ids).size, ids.length, "Retained decision IDs must be unique");
  assert.deepEqual([...ids].sort(), [...stageAudit.answers.keys()].sort(), "Retained decision IDs must exactly cover raw response answers");
  for (const decision of decisions) {
    const answer = stageAudit.answers.get(decision.question_id);
    assert.ok(answer, `Missing raw response answer for ${decision.question_id}`);
    assert.deepEqual(decision.raw_answer, answer, `Retained answer differs from raw response for ${decision.question_id}`);
    let repeat;
    if (decision.repeat_response_reference) {
      repeat = stageAudit.repeats.get(decision.repeat_response_reference)?.[decision.question_id];
      assert.ok(repeat, `Missing repeat response answer for ${decision.question_id}`);
    }
    assert.deepEqual(
      decision.action,
      deriveAction(answer, decision.question_kind, manifest.policy, repeat),
      `Retained action differs from the raw answer and policy for ${decision.question_id}`,
    );
  }
}

export function assertCompleteClassificationResult(result: any) {
  assert.equal(result.status, "complete");
  assert.equal(result.full_product_status, "not_run");
}

async function auditEmptyStage(
  directory: string,
  expected: {
    stageId: string;
    operationId: string;
    sourceHash: string;
    sourceByteLength: number;
    policy: any;
    upstreamPaths: Record<string, string>;
  },
) {
  const [empty, decisions] = await Promise.all([json(join(directory, "empty-stage.json")), json(join(directory, "decisions.json"))]);
  const upstreamPaths = Object.fromEntries(Object.entries(expected.upstreamPaths).map(([id, path]) => [id, resolve(path)]));
  const upstreamHashes: Record<string, string> = {};
  for (const [id, path] of Object.entries(upstreamPaths)) upstreamHashes[id] = hash(await readFile(path));
  const config = {
    contract_version: "catalog-empty-stage-v1",
    integrity_version: 1,
    stage_id: expected.stageId,
    operation_id: expected.operationId,
    source_sha256: expected.sourceHash,
    source_byte_length: expected.sourceByteLength,
    policy_sha256: hash(JSON.stringify(expected.policy)),
    upstream_paths: upstreamPaths,
    upstream_hashes: upstreamHashes,
  };
  const expectedEmpty = {
    ...config,
    configuration_sha256: hash(JSON.stringify(config)),
    status: "complete",
    question_count: 0,
    network_requests: 0,
    findings: [],
  };
  assert.deepEqual(empty, expectedEmpty);
  const source = await readFile(join(directory, "source.md"));
  assert.equal(hash(source), expected.sourceHash);
  assert.equal(source.byteLength, expected.sourceByteLength);
  assert.deepEqual(await json(join(directory, "decision-policy.json")), expected.policy);
  assert.deepEqual(await json(join(directory, "question-targets.json")), {});
  assert.deepEqual(decisions, []);
  assert.deepEqual(await json(join(directory, "validation-findings.json")), []);
  assert.deepEqual(await json(join(directory, "result.json")), expectedEmpty);
  return {
    manifest: null,
    answers: new Map<string, any>(),
    report: {
      batches: 0,
      live_calls: 0,
      peak_concurrent_requests: 0,
      retry_delays_seconds: [],
      reuse_receipts: 0,
      reported_cost_usd: 0,
    },
  };
}

async function auditCatalogStage(
  directory: string,
  expected: {
    stageId: string;
    operationId: string;
    discoveryDirectory: string;
    sourceHash: string;
    sourceByteLength: number;
    policy: any;
    upstreamPaths: Record<string, string>;
  },
  requireReuse: boolean,
) {
  const manifest = await json(join(directory, "manifest.json")).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (!manifest) return auditEmptyStage(directory, expected);
  assert.equal(manifest.contract_version, "decision-questions-v2");
  assert.equal(manifest.stage_id, expected.stageId);
  assert.equal(manifest.operation_id, expected.operationId);
  assert.equal(manifest.discovery_directory, expected.discoveryDirectory);
  assert.equal(manifest.source_sha256, expected.sourceHash);
  assert.equal(manifest.source_byte_length, expected.sourceByteLength);
  assert.deepEqual(manifest.policy, expected.policy);
  assert.equal(manifest.policy_sha256, hash(JSON.stringify(expected.policy)));
  assert.deepEqual(manifest.config.upstream_paths, Object.fromEntries(Object.entries(expected.upstreamPaths).map(([id, path]) => [id, resolve(path)])));
  return auditRetainedStage(directory, requireReuse);
}

/** Independent raw-wire and lineage audit. It deliberately imports no catalog constructors, policy, grouping, or validation code. */
export async function auditCatalogClassification(directory: string, requireReuse = false) {
  const root = resolve(directory);
  const operation = await json(join(root, "classification-operation.json"));
  const policyMode = operation.policy.mode as "exploratory" | "supported";
  const discoveryDirectory = resolve(operation.discovery_directory);
  assert.equal(operation.contract_version, "source-local-classification-v1");
  assert.equal(resolve(root), join(discoveryDirectory, "classifications", operation.operation_id));
  assert.equal(operation.policy_sha256, hash(JSON.stringify(operation.policy)));
  assert.equal(resolve(operation.alias_directory), join(root, "aliases", "catalog-v1"));
  assert.equal(resolve(operation.qualification_directory), join(root, "qualification", "catalog-v1"));
  assert.equal(resolve(operation.typing_directory), join(root, "typing", "catalog-v1"));
  const source = await readFile(join(operation.discovery_directory, "source.md"));
  assert.equal(hash(source), operation.source_sha256);
  assert.equal(source.byteLength, operation.source_byte_length);
  const sourceManifest = await json(join(discoveryDirectory, "source-manifest.json"));
  assert.equal(sourceManifest.sha256, operation.source_sha256);
  assert.equal(sourceManifest.byte_length, operation.source_byte_length);
  const proposalText = await readFile(join(discoveryDirectory, "decoded-proposals.json"), "utf8");
  const proposalData = JSON.parse(proposalText);
  const aliasDirectory = operation.alias_directory as string;
  const entityQualificationDirectory = operation.qualification_directory as string;
  const entityTypeDirectory = operation.typing_directory as string;
  const aliasInputs = await json(join(aliasDirectory, "alias-inputs.json"));
  assert.equal(aliasInputs.source_sha256, operation.source_sha256);
  assert.equal(aliasInputs.operation_id, operation.operation_id);
  assert.equal(aliasInputs.candidates_sha256, hash(proposalText));
  assert.deepEqual(
    aliasInputs.candidates.map((candidate: any) => candidate.name),
    proposalData.entities,
  );
  for (const clue of aliasInputs.acronym_scan.pair_clues as any[]) {
    for (const span of [clue.acronym, ...clue.full_name_evidence, ...clue.written_expansion_evidence]) {
      assert.equal(source.subarray(span.start_byte, span.end_byte).toString("utf8"), span.text);
    }
  }
  for (const finding of aliasInputs.acronym_scan.discovery_findings as any[]) {
    for (const span of [finding.source_span, finding.related_span].filter(Boolean)) {
      assert.equal(source.subarray(span.start_byte, span.end_byte).toString("utf8"), span.text);
    }
  }
  const candidates: any[] = aliasInputs.candidates;
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  for (const candidate of candidates)
    for (const span of candidate.occurrences) {
      assert.equal(source.subarray(span.start_byte, span.end_byte).toString("utf8"), candidate.name);
    }

  const aliasIdentityAudit = await auditCatalogStage(
    aliasDirectory,
    {
      stageId: "catalog-aliases-v1",
      operationId: operation.operation_id,
      discoveryDirectory,
      sourceHash: operation.source_sha256,
      sourceByteLength: operation.source_byte_length,
      policy: operation.policy,
      upstreamPaths: {
        discovery_candidates: join(discoveryDirectory, "decoded-proposals.json"),
        discovery_source_manifest: join(discoveryDirectory, "source-manifest.json"),
        acronym_scan: join(aliasDirectory, "alias-inputs.json"),
      },
    },
    requireReuse,
  );
  const aliasIdentityManifest = aliasIdentityAudit.manifest;
  const pairs: any[] = aliasInputs.pairs;
  assert.equal(pairs.length, (candidates.length * (candidates.length - 1)) / 2);
  const pairKey = (left: string, right: string) => [left, right].sort().join("/");
  const plannedPairKeys = new Set<string>();
  for (const pair of pairs) {
    assert.ok(candidateById.has(pair.left_id) && candidateById.has(pair.right_id));
    assert.notEqual(pair.left_id, pair.right_id);
    const key = pairKey(pair.left_id, pair.right_id);
    assert.ok(!plannedPairKeys.has(key), `Duplicate aliasIdentity pair ${key}`);
    plannedPairKeys.add(key);
  }
  assert.equal(aliasIdentityAudit.answers.size, pairs.length);
  const aliasIdentityDecisions: any[] = await json(join(aliasDirectory, "decisions.json"));
  assert.equal(aliasIdentityDecisions.length, pairs.length);
  if (aliasIdentityManifest) assertDecisionActions(aliasIdentityDecisions, aliasIdentityAudit, aliasIdentityManifest);
  if (aliasIdentityManifest) {
    assert.deepEqual(Object.keys(aliasIdentityManifest.question_targets).sort(), pairs.map((pair) => pair.pair_id).sort());
    for (const batch of aliasIdentityManifest.batches) {
      const state = batch.request.state;
      const questions = batch.request.questions;
      assert.equal(state.complete_source, source.toString("utf8"));
      for (const id of batch.candidate_ids) {
        const descriptor = aliasIdentityManifest.question_targets[id];
        const target = state.targets[id];
        assert.deepEqual(target, descriptor.target);
        assert.equal(questions[id].type, "choice");
        assert.deepEqual(questions[id].criteria, aliasIdentityCriteria);
        const nameA = `targets[${JSON.stringify(id)}].name_a`;
        const nameB = `targets[${JSON.stringify(id)}].name_b`;
        const question =
          descriptor.definition_variant === "acronym"
            ? `In \`complete_source\`, is \`${nameB}\` an acronym for \`${nameA}\`?`
            : `In \`complete_source\`, are \`${nameA}\` and \`${nameB}\` aliases for the same entity?`;
        assert.equal(
          questions[id].instructions,
          `${question}\n\nUse the names' meaning in the full source. Shared words or matching initials alone do not prove an alias. The source does not have to spell out the full name if its use of the names makes the link clear.`,
        );
        const pair = pairs.find((entry) => entry.pair_id === id)!;
        const clue = (aliasInputs.acronym_scan.pair_clues as any[]).find(
          (entry) =>
            entry.full_name_candidate_id &&
            entry.acronym_candidate_id &&
            pairKey(entry.full_name_candidate_id, entry.acronym_candidate_id) === pairKey(pair.left_id, pair.right_id),
        );
        if (clue) {
          assert.equal(descriptor.definition_variant, "acronym");
          assert.equal(target.name_a, clue.full_name);
          assert.equal(target.name_b, clue.acronym.text);
        } else {
          assert.equal(descriptor.definition_variant, "standard");
          assert.deepEqual(new Set([target.name_a, target.name_b]), new Set([candidateById.get(pair.left_id).name, candidateById.get(pair.right_id).name]));
        }
        for (const record of target.name_clues.source_evidence)
          for (const occurrence of record.occurrences) {
            assert.equal(source.subarray(occurrence.start_byte, occurrence.end_byte).toString("utf8"), record.name);
          }
      }
    }
  }

  const aliasResult = await json(join(aliasDirectory, "catalog-result.json"));
  const aliasGroups = await json(join(aliasDirectory, "alias-groups.json"));
  const groups: any[] = aliasGroups.groups;
  const groupedIds = groups.flatMap((group) => (group.members ?? [group]).map((member: any) => member.candidate_id));
  assert.deepEqual([...groupedIds].sort(), candidates.map((candidate) => candidate.candidate_id).sort());
  assert.equal(new Set(groupedIds).size, candidates.length);
  for (const group of groups)
    for (const member of group.members ?? [group]) {
      const sourceCandidate = candidateById.get(member.candidate_id);
      assert.ok(sourceCandidate, `aliasIdentity group has unknown source candidate ${member.candidate_id}`);
      assertSame(
        {
          candidate_id: member.candidate_id,
          index: member.index,
          name: member.name,
          occurrences: member.occurrences,
          findings: member.findings,
        },
        {
          candidate_id: sourceCandidate.candidate_id,
          index: sourceCandidate.index,
          name: sourceCandidate.name,
          occurrences: sourceCandidate.occurrences,
          findings: sourceCandidate.findings,
        },
        `aliasIdentity member ${member.candidate_id}`,
      );
    }
  const aliasIdentityDecisionByKey = new Map(aliasIdentityDecisions.map((decision) => [pairKey(...(decision.target.name_clues.candidate_ids as [string, string])), decision]));
  for (const group of groups) {
    const members = group.members ?? [group];
    for (let left = 0; left < members.length; left += 1)
      for (const right of members.slice(left + 1)) {
        const decision = aliasIdentityDecisionByKey.get(pairKey(members[left].candidate_id, right.candidate_id));
        const statusAllowed = decision?.action.status === "supported" || (policyMode === "exploratory" && decision?.action.status === "provisional");
        assert.ok(decision && statusAllowed && decision.action.label === "same_entity", "A grouped alias pair lacks policy-eligible aliasIdentity evidence");
      }
  }
  for (const decision of aliasIdentityDecisions) {
    const statusAllowed = decision.action.status === "supported" || (policyMode === "exploratory" && decision.action.status === "provisional");
    if (statusAllowed && decision.action.label === "same_entity") {
      const ids = decision.target.name_clues.candidate_ids as [string, string];
      const sameGroup = groups.some((group) => {
        const members = group.members ?? [group];
        return members.some((member: any) => member.candidate_id === ids[0]) && members.some((member: any) => member.candidate_id === ids[1]);
      });
      assert.ok(sameGroup || aliasGroups.unapplied_link_ids.includes(decision.question_id));
    }
  }

  const qualificationInputs = await json(join(root, "qualification-inputs.json"));
  const entityQualificationAudit = await auditCatalogStage(
    entityQualificationDirectory,
    {
      stageId: "catalog-qualification-v1",
      operationId: operation.operation_id,
      discoveryDirectory,
      sourceHash: operation.source_sha256,
      sourceByteLength: operation.source_byte_length,
      policy: operation.policy,
      upstreamPaths: {
        alias_groups: join(aliasDirectory, "alias-groups.json"),
        alias_result: join(aliasDirectory, "catalog-result.json"),
        qualification_inputs: join(root, "qualification-inputs.json"),
        map_proposals: join(root, "map-place-proposals.json"),
        corrections: join(root, "discovery-correction-findings.json"),
        ...(operation.blocks_directory ? { blocks_layout: join(operation.blocks_directory, "layout.json") } : {}),
      },
    },
    requireReuse,
  );
  const entityQualificationManifest = entityQualificationAudit.manifest;
  const entityQualificationDecisions: any[] = await json(join(entityQualificationDirectory, "decisions.json"));
  if (entityQualificationManifest) assertDecisionActions(entityQualificationDecisions, entityQualificationAudit, entityQualificationManifest);
  const mapFile = await json(join(root, "map-place-proposals.json"));
  assert.equal(mapFile.source_sha256, operation.source_sha256);
  if (operation.blocks_directory) {
    const layout = await json(join(operation.blocks_directory, "layout.json"));
    assert.equal(hash(await readFile(join(operation.blocks_directory, "layout.json"))), operation.blocks_layout_sha256);
    assert.equal(layout.source_sha256, operation.source_sha256);
  }
  const expectedEntityQualificationIds = assertQualificationCandidateLineage({
    groups,
    qualificationInputs,
    mapProposals: mapFile.place_proposals,
    sourceCandidates: candidates,
    source,
  });
  assert.equal(entityQualificationDecisions.length, expectedEntityQualificationIds.length);
  assert.equal(entityQualificationAudit.answers.size, entityQualificationDecisions.length);
  if (entityQualificationManifest)
    for (const batch of entityQualificationManifest.batches) {
      const state = batch.request.state;
      const questions = batch.request.questions;
      assert.equal(state.complete_source, source.toString("utf8"));
      assert.equal(state.entity_rules, entityQualificationManifest.rule_evidence.governingRules);
      for (const id of batch.candidate_ids) {
        assert.deepEqual(batch.request.state.targets[id], entityQualificationManifest.question_targets[id].target);
        assertSame(entityQualificationManifest.question_targets[id].target.candidate, qualificationInputs[id].candidate, `entityQualification request candidate ${id}`);
        assertSame(batch.request.state.targets[id].candidate, qualificationInputs[id].candidate, `entityQualification outbound candidate ${id}`);
        assert.equal(questions[id].type, "choice");
        assert.deepEqual(questions[id].criteria, entityQualificationCriteria);
      }
    }

  const entityTypeAudit = await auditCatalogStage(
    entityTypeDirectory,
    {
      stageId: "catalog-typing-v1",
      operationId: operation.operation_id,
      discoveryDirectory,
      sourceHash: operation.source_sha256,
      sourceByteLength: operation.source_byte_length,
      policy: operation.policy,
      upstreamPaths: {
        qualification_decisions: join(entityQualificationDirectory, "decisions.json"),
        qualification_inputs: join(root, "qualification-inputs.json"),
        map_proposals: join(root, "map-place-proposals.json"),
      },
    },
    requireReuse,
  );
  const entityTypeManifest = entityTypeAudit.manifest;
  const entityTypeDecisions: any[] = await json(join(entityTypeDirectory, "decisions.json"));
  const typingInputs = await json(join(root, "typing-inputs.json"));
  if (entityTypeManifest) assertDecisionActions(entityTypeDecisions, entityTypeAudit, entityTypeManifest);
  const expectedEntityTypeIds = entityQualificationDecisions
    .filter((decision) => decision.action.label === "yes" && (decision.action.status === "supported" || (policyMode === "exploratory" && decision.action.status === "provisional")))
    .map((decision) => `entityType-${decision.question_id}`)
    .sort();
  assert.deepEqual(entityTypeManifest ? Object.keys(entityTypeManifest.question_targets).sort() : [], expectedEntityTypeIds);
  assert.equal(entityTypeDecisions.length, expectedEntityTypeIds.length);
  assert.equal(entityTypeAudit.answers.size, entityTypeDecisions.length);
  const entityQualificationById = new Map(entityQualificationDecisions.map((decision) => [decision.question_id, decision]));
  assert.deepEqual(Object.keys(typingInputs).sort(), expectedEntityTypeIds);
  for (const [entityTypeId, typedInput] of Object.entries(typingInputs) as Array<[string, any]>) {
    const entityQualificationId = entityTypeId.slice("entityType-".length);
    const entityQualificationInput = qualificationInputs[entityQualificationId];
    const entityQualification = entityQualificationById.get(entityQualificationId);
    assert.ok(
      entityQualificationInput &&
        entityQualification?.action.label === "yes" &&
        (entityQualification.action.status === "supported" || (policyMode === "exploratory" && entityQualification.action.status === "provisional")),
    );
    assert.equal(typedInput.entity_qualification_decision_id, entityQualificationId);
    assertSame(typedInput.candidate, entityQualificationInput.candidate, `entityType candidate ${entityTypeId}`);
    assertSame(typedInput.source_candidate_ids, entityQualificationInput.source_candidate_ids, `entityType source candidate IDs ${entityTypeId}`);
    assertSame(typedInput.place_proposal_ids, entityQualificationInput.place_proposal_ids, `entityType map proposal IDs ${entityTypeId}`);
    assertSame(typedInput.candidate_kind, entityQualificationInput.kind, `entityType candidate kind ${entityTypeId}`);
    assertSourceSpans(typedInput.candidate, source, `entityType candidate ${entityTypeId}`);
    if (entityTypeManifest) assertSame(entityTypeManifest.question_targets[entityTypeId]?.target.candidate, typedInput.candidate, `entityType request candidate ${entityTypeId}`);
  }
  if (entityTypeManifest)
    for (const batch of entityTypeManifest.batches) {
      const state = batch.request.state;
      const questions = batch.request.questions;
      assert.equal(state.complete_source, source.toString("utf8"));
      assert.equal(state.entity_rules, entityTypeManifest.rule_evidence.governingRules);
      for (const id of batch.candidate_ids) {
        const entityQualificationId = id.slice("entityType-".length);
        const entityQualification = entityQualificationById.get(entityQualificationId);
        assert.ok(
          entityQualification?.action.label === "yes" &&
            (entityQualification.action.status === "supported" || (policyMode === "exploratory" && entityQualification.action.status === "provisional")),
        );
        assertSame(entityTypeManifest.question_targets[id]?.target.candidate, typingInputs[id].candidate, `entityType outbound candidate ${id}`);
        assertSame(batch.request.state.targets[id]?.candidate, typingInputs[id].candidate, `entityType request target ${id}`);
        assert.equal(questions[id].type, "choice");
        assert.deepEqual(keys(questions[id].criteria), [...entityTypeChoices].sort());
        assert.ok(!Object.hasOwn(questions[id].criteria, "not_an_entity"));
        for (const key of entityTypeChoices) assert.equal(questions[id].criteria[key], entityTypeManifest.rule_evidence.criteria[key]);
      }
    }

  const localPackage = await json(join(root, "local-entities.json"));
  assert.equal(localPackage.source_sha256, operation.source_sha256);
  const localEntities: any[] = localPackage.entities;
  const entityTypeById = new Map(entityTypeDecisions.map((decision) => [decision.question_id, decision]));
  assertLocalEntityCoverage(entityQualificationDecisions, entityTypeDecisions, localEntities);
  for (const entity of localEntities) {
    const qualification = entityQualificationById.get(entity.qualification_decision_id);
    const typing = entityTypeById.get(entity.type_decision_id);
    assert.equal(qualification?.action.status, "supported");
    assert.equal(qualification?.action.label, "yes");
    assert.equal(typing?.action.status, "supported");
    assert.equal(entity.canonical_status, "source_local_only");
    assert.equal(entity.source_sha256, operation.source_sha256);
    assert.ok(entityTypeChoices.includes(entity.type));
    assert.equal(entity.type, typing.action.label);
    assert.equal(entity.type_decision_id, `entityType-${entity.qualification_decision_id}`);
    assert.equal(entity.local_entity_id, `local-${hash(`${operation.source_sha256}\0${entity.qualification_decision_id}`).slice(0, 24)}`);
    assert.deepEqual(entity.source_candidate_ids, typingInputs[entity.type_decision_id].source_candidate_ids);
    assert.deepEqual(entity.place_proposal_ids, typingInputs[entity.type_decision_id].place_proposal_ids);
    const typedInput = typingInputs[entity.type_decision_id];
    assertSame(entity.evidence, typedInput.candidate.source_evidence ?? typedInput.candidate.members ?? [], `Local entity evidence ${entity.local_entity_id}`);
    assertSourceSpans(entity.evidence, source, `Local entity evidence ${entity.local_entity_id}`);
    if (typedInput.candidate.kind === "source_candidate_group") {
      assert.deepEqual(entity.supported_names, typedInput.candidate.names);
      assert.deepEqual(entity.aliases, typedInput.candidate.aliases);
      assert.ok(entity.supported_names.every((name: string) => source.includes(Buffer.from(name))));
    } else {
      assert.deepEqual(entity.supported_names, []);
      assert.deepEqual(entity.aliases, []);
      assert.equal(entity.source_descriptor, typedInput.candidate.source_descriptor);
      assertSourceSpans(entity.source_descriptor ? typedInput.candidate.source_evidence : [], source, `Local entity descriptor ${entity.local_entity_id}`);
    }
  }

  for (const proposal of mapFile.place_proposals as any[]) {
    assert.equal(proposal.supported_subject_names.length, 0, "blockSubject subject results are deferred from this capability");
    for (const name of proposal.source_names) {
      for (const span of name.source_spans) assert.equal(source.subarray(span.start_byte, span.end_byte).toString("utf8"), name.name);
    }
    const descriptors = proposal.entry_components as Array<{ start_byte: number; end_byte: number; text: string }>;
    for (const component of descriptors) assert.equal(source.subarray(component.start_byte, component.end_byte).toString("utf8"), component.text);
    if (proposal.unnamed_descriptor_question_id) {
      const descriptor = qualificationInputs[proposal.unnamed_descriptor_question_id].candidate;
      assert.equal(descriptor.kind, "unnamed_map_place_descriptor");
      assert.equal(descriptor.source_descriptor, proposal.entry_text);
    }
    if (proposal.missing_source_names.length) assert.equal(proposal.status, "discovery_correction_required");
  }
  const proposalResults = await json(join(root, "map-place-proposal-results.json"));
  assert.equal(proposalResults.source_sha256, operation.source_sha256);
  assert.equal(proposalResults.association_stage, "not_run");
  assert.equal(proposalResults.input_path, join(root, "map-place-proposals.json"));
  assertMapProposalResults(mapFile.place_proposals, proposalResults, entityQualificationDecisions, entityTypeDecisions, localEntities);
  const corrections = await json(join(root, "discovery-correction-findings.json"));
  assert.equal(corrections.source_sha256, operation.source_sha256);
  assert.equal(Boolean(corrections.qualification_blocked), corrections.findings.length > 0);
  for (const finding of corrections.findings) assert.equal(finding.discovery_correction_required, true);
  for (const finding of aliasInputs.acronym_scan.discovery_findings as any[]) {
    assert.ok(
      corrections.findings.some(
        (retained: any) => retained.name === finding.name && same(retained.source_span, finding.source_span) && same(retained.related_span ?? null, finding.related_span ?? null),
      ),
      `aliasIdentity correction finding was not retained for ${finding.name}`,
    );
  }
  const result = await json(join(root, "result.json"));
  assertCompleteClassificationResult(result);
  return {
    verdict: "PASS",
    scope: "retained aliasIdentity-entityType wire, gate, map, and source-local lineage audit; live semantic acceptance not implied",
    directory: root,
    source_sha256: operation.source_sha256,
    alias_identity_pairs: pairs.length,
    alias_identity_groups: groups.length,
    entity_qualification_decisions: entityQualificationDecisions.length,
    entity_type_decisions: entityTypeDecisions.length,
    local_entities: localEntities.length,
    map_place_proposals: mapFile.place_proposals.length,
    discovery_corrections: corrections.findings.length,
    wire_reports: { aliasIdentity: aliasIdentityAudit.report, entityQualification: entityQualificationAudit.report, entityType: entityTypeAudit.report },
  };
}
