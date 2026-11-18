import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { definitionsVersion, definitionsHash, restoreQuestion, type EntityRules } from "./questions.js";
import { buildDecisionRequest, sharedRuleEvidence, planDecisionBatches } from "./request.js";
import { loadClassificationCriteria, buildClassificationRequest, classificationCriteriaFromRules } from "./semantic-input.js";
import { questionManifestSchema, candidateDecisionManifestSchema, sha256, type Manifest, type CandidateDecisionManifest } from "./contracts.js";
import { decodeCapturedSource } from "../discovery/source.js";
import { readJson } from "../discovery/artifacts.js";
import { allCandidatePairs, buildAliasRequest } from "../aliases/semantic-input.js";

// Cache only the last successfully reconstructed plan. Files and upstream hashes
// are still checked on every read; changed in-memory requests also miss this cache.
let verifiedPlanHash: string | undefined;

export function identical(left: unknown, right: unknown, label: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label} changed`);
}
export async function assertRetainedIntegrity(manifest: Manifest, directory = String(manifest.config.stage_directory)) {
  if (manifest.contract_version !== "decision-questions-v2") {
    return assertCandidateDecisionIntegrity(manifest, directory);
  }
  questionManifestSchema.parse(manifest);
  const { config } = manifest;
  const source = decodeCapturedSource(await readFile(join(directory, "source.md")));
  if (source.sha256 !== manifest.source_sha256 || source.byteLength !== manifest.source_byte_length) throw new Error("Retained stage source changed");
  if (
    sha256(JSON.stringify(config)) !== manifest.configuration_sha256 ||
    sha256(JSON.stringify(manifest.policy)) !== manifest.policy_sha256 ||
    sha256(JSON.stringify(Object.values(manifest.question_targets))) !== manifest.questions_sha256
  )
    throw new Error("Policy/configuration/target lineage changed");
  identical(config.stage_directory, resolve(directory), "Stage directory");
  identical(config.stage_id, manifest.stage_id, "Stage ID");
  for (const key of ["definitions_version", "definitions_sha256", "questions_sha256", "rules_sha256", "policy_sha256", "upstream_hashes"] as const)
    identical(config[key], manifest[key], key);
  identical(manifest.policy.definitions_version, manifest.definitions_version, "Policy definitions");
  identical(await readJson(join(directory, "question-targets.json")), manifest.question_targets, "Retained targets");
  identical(await readJson(join(directory, "decision-policy.json")), manifest.policy, "Retained policy");
  if (manifest.rule_evidence) {
    identical(await readJson(join(directory, "entity-rules.json")), manifest.rule_evidence, "Retained rules");
    identical(manifest.rule_evidence.sha256, manifest.rules_sha256, "Rule hash");
  } else {
    if (manifest.rules_sha256 !== null) throw new Error("Missing rules");
    try {
      await access(join(directory, "entity-rules.json"));
      throw new Error("Unused rules file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  identical(Object.keys(config.upstream_paths), Object.keys(manifest.upstream_hashes), "Upstream coverage");
  for (const [id, path] of Object.entries(config.upstream_paths))
    if (sha256(await readFile(path)) !== manifest.upstream_hashes[id]) throw new Error(`Upstream artifact changed: ${id}`);
  const orderedIds = manifest.batches.flatMap((batch) => batch.candidate_ids);
  if (new Set(orderedIds).size !== orderedIds.length || JSON.stringify([...orderedIds].sort()) !== JSON.stringify(Object.keys(manifest.question_targets).sort()))
    throw new Error("Incomplete or duplicate question coverage");
  const planHash = sha256(
    JSON.stringify({
      source: source.sha256,
      config,
      targets: manifest.question_targets,
      rules: manifest.rule_evidence,
      batches: manifest.batches,
    }),
  );
  if (planHash === verifiedPlanHash) return;
  const prepared = orderedIds.map((id) => {
    const descriptor = manifest.question_targets[id]!;
    if (id !== descriptor.question_id || id !== descriptor.target_id) throw new Error("Target ID differs");
    return restoreQuestion(descriptor, manifest.rule_evidence);
  });
  identical(sharedRuleEvidence(prepared), manifest.rule_evidence, "Shared rules");
  const maximum = config.target_mode === "single" ? 1 : Math.min(...prepared.map((q) => q.maximum_questions));
  identical(maximum, config.maximum_questions, "Batch maximum");
  const rebuilt = planDecisionBatches(prepared, config.input_limit, maximum, (questions) => buildDecisionRequest({ source, questions, targetMode: config.target_mode }));
  identical(rebuilt, manifest.batches, "Planned requests");
  verifiedPlanHash = planHash;
}
export async function assertExecutionCompatibility(manifest: Manifest, directory = String(manifest.config.stage_directory)) {
  await assertRetainedIntegrity(manifest, directory);
  if (manifest.contract_version !== "decision-questions-v2") return;
  if (manifest.definitions_version !== definitionsVersion || manifest.definitions_sha256 !== definitionsHash) throw new Error("Definitions changed; start a new operation");
  if (manifest.rule_evidence) identical(manifest.rule_evidence, await loadClassificationCriteria(), "Approved rules");
}

function equal(left: unknown, right: unknown, label: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`Candidate decision ${label} differs`);
}
export async function assertCandidateDecisionIntegrity(manifest: CandidateDecisionManifest, directory: string) {
  candidateDecisionManifestSchema.parse(manifest);
  const source = decodeCapturedSource(await readFile(join(directory, "source.md")));
  if (source.sha256 !== manifest.source_sha256 || source.byteLength !== manifest.source_byte_length) throw new Error("Candidate decision source differs");
  if (sha256(JSON.stringify(manifest.config)) !== manifest.configuration_sha256) throw new Error("Candidate decision configuration hash differs");
  const config = manifest.config;
  if (
    config.model !== "typesafe/jev-1.13" ||
    config.sdk_retries !== "disabled" ||
    config.retries !== 2 ||
    config.retry_delay_seconds !== 30 ||
    (config.max_concurrent_requests !== 4 && config.max_concurrent_requests !== 10)
  )
    throw new Error("Candidate decision pinned configuration differs");
  if (manifest.decision_kind === "document_alias") {
    if (config.provider !== "typesafe") throw new Error("Candidate decision provider differs");
  } else equal(config.provider, { only: ["typesafe"], allow_fallbacks: false }, "provider route");
  const ids = manifest.batches.flatMap((batch) => batch.candidate_ids);
  if (new Set(ids).size !== ids.length) throw new Error("Candidate decision duplicated batch coverage");
  let rules: EntityRules | undefined;
  const proposals = await readFile(join(directory, "discovery-proposals.json"), "utf8");
  equal(sha256(proposals), manifest.candidates_sha256, "proposal hash");
  const names = (
    JSON.parse(proposals) as {
      entities: string[];
    }
  ).entities;
  const originals = manifest.decision_kind === "document_alias" ? manifest.candidates : manifest.original_candidates;
  equal(
    names,
    originals.map((c) => c.name),
    "candidate names",
  );
  for (const c of originals)
    for (const occurrence of c.occurrences) equal(source.bytes.subarray(occurrence.start_byte, occurrence.end_byte).toString("utf8"), c.name, "candidate occurrence");
  if (manifest.decision_kind === "document_alias") equal(manifest.alias_pairs, allCandidatePairs(manifest.candidates), "alias pairs");
  else {
    rules = (await readJson(join(directory, "ontology-criteria.json"))) as EntityRules;
    equal(rules.sha256, sha256(JSON.stringify({ criteria: rules.criteria, governingRules: rules.governingRules })), "ontology evidence hash");
    equal(rules.sha256, manifest.config.ontology_sha256, "ontology config hash");
    equal(sha256(await readFile(join(manifest.alias_directory, "result.json"))), manifest.alias_result_sha256, "alias upstream hash");
    const groups = (
      (await readJson(join(manifest.alias_directory, "result.json"))) as {
        groups: unknown;
      }
    ).groups;
    equal(groups, manifest.candidates, "alias groups");
  }
  equal(
    [...ids].sort(),
    (manifest.decision_kind === "document_alias" ? manifest.alias_pairs.map((p) => p.pair_id) : manifest.candidates.map((c) => c.candidate_id)).sort(),
    "complete coverage",
  );
  for (const batch of manifest.batches) {
    if (sha256(JSON.stringify(batch.request)) !== batch.batch_sha256) throw new Error("Candidate decision request hash differs");
    let rebuilt;
    if (manifest.decision_kind === "document_alias") {
      const state = batch.request.state as Record<string, unknown>;
      if (typeof state.governing_rules !== "string") throw new Error("Candidate decision alias rules absent");
      const originalRules = classificationCriteriaFromRules(state.governing_rules);
      equal(originalRules.sha256, manifest.config.ontology_sha256, "alias rules hash");
      equal(sha256(String(state.alias_instructions)), manifest.config.instructions_sha256, "alias instructions hash");
      rebuilt = buildAliasRequest(
        source,
        manifest.candidates,
        manifest.alias_pairs.filter((p) => batch.candidate_ids.includes(p.pair_id)),
        state.governing_rules,
      );
    } else
      rebuilt = buildClassificationRequest(
        source,
        manifest.candidates.filter((c) => batch.candidate_ids.includes(c.candidate_id)),
        rules!,
      );
    equal(rebuilt, batch.request, "reconstructed request");
  }
}
