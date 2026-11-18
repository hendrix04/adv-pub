import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeCapturedSource, sourceComponent } from "../discovery/source.js";
import { readJson, writeJsonAtomic, writeBytesAtomic } from "../discovery/artifacts.js";
import { prepareCatalogAliasStage, collectCatalogAliasStage } from "../aliases/operation.js";
import { classificationRepeatId, supportedClassificationPolicy } from "./policy.js";
import { catalogResumeBlocksDirectory, collectCatalogQualification, prepareCatalogQualification, prepareCatalogTyping, type PreparedCatalogStage } from "./catalog-operation.js";
import { mapNameSpans, eligibleForEntityTyping } from "./catalog-operation.js";
import { sha256 } from "../decisions/contracts.js";
import { questionManifestSchema } from "../decisions/contracts.js";
import { DecisionsRequest$outboundSchema } from "@openrouter/sdk/models";
import { validateBatchResponse } from "../decisions/validation.js";
import { assertExecutionCompatibility } from "../decisions/retained-stage.js";
import { loadCatalogAliasGroups } from "../aliases/operation.js";
import { buildCatalogReferentGroups } from "../aliases/groups.js";
import { buildCatalogAliasQuestions } from "../aliases/semantic-input.js";
import { sourceCandidates, loadClassificationCriteria } from "../decisions/semantic-input.js";
import { planQualificationInputs } from "./qualification-inputs.js";

test("unresolved alias components do not receive Q06 targets while separate groups do", async () => {
  const source = decodeCapturedSource(Buffer.from("Alpha Order, Beta Order, Gamma Order, and Delta Order."));
  const candidates = sourceCandidates(["Alpha Order", "Beta Order", "Gamma Order", "Delta Order"], source, "qualification-conflict");
  const selected = buildCatalogAliasQuestions(source, candidates).questions.slice(0, 2);
  const grouped = buildCatalogReferentGroups(candidates, selected.map((question) => ({
    question_id: question.id,
    target: question.target,
    action: { status: "supported" as const, label: "same_entity", policy_version: "reviewed", policy_sha256: "hash", findings: [] },
  })));
  const layout = {
    contract_version: "lore-block-layout-v1" as const,
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    blocks: [{ id: "entry-1", section_id: "section-1", components: [sourceComponent(source, 0, source.text.length)] }],
    place_proposals: [{
      id: "place-1", map_key_id: "map-1", block_id: "entry-1", number: "1", source_names: ["Alpha Order"],
      display_label: "Entry 1", naming_basis: "bold" as const, qualification_status: "not_run",
    }],
  };
  const planned = planQualificationInputs(source, grouped.groups, layout, await loadClassificationCriteria(), new Set(grouped.conflictedGroupIds));
  assert.equal(planned.questions.length, 1);
  assert.deepEqual(Object.values(planned.inputs).map((input) => input.candidate.candidate_id), [grouped.groups[2]!.candidate_id]);
  assert.deepEqual(planned.mapProposals[0]!.candidate_group_ids, [grouped.groups[0]!.candidate_id]);
  assert.deepEqual(planned.mapProposals[0]!.qualification_question_ids, []);
  assert.deepEqual(planned.mapProposals[0]!.missing_source_names, []);
  assert.equal(planned.mapProposals[0]!.status, "unresolved");
});

async function retainFixtureChoice(prepared: PreparedCatalogStage, choice: string, repeatId?: string) {
  assert.ok(prepared.manifest);
  const responsePaths: string[] = [];
  for (const batch of prepared.manifest.batches) {
    const answers = Object.fromEntries(
      batch.candidate_ids.map((id) => {
        const question = (batch.request.questions as Record<string, any>)[id];
        const options = Object.keys(question.criteria);
        return [
          id,
          {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(options.map((option) => [option, option === choice ? 1 : 0])),
          },
        ];
      }),
    );
    const raw = { model: "typesafe/jev-1.13", provider: "TypeSafe", answers };
    const resultRoot = join(prepared.directory, "batches", batch.batch_id, ...(repeatId ? ["repeats", repeatId] : []));
    const responsePath = join(resultRoot, "attempt-fixture", "response-body.txt");
    responsePaths.push(responsePath);
    await writeJsonAtomic(responsePath, raw);
    await writeJsonAtomic(join(resultRoot, "attempt-fixture", "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batch.request));
    const validation = validateBatchResponse(raw, prepared.manifest, batch.batch_id, responsePath);
    assert.deepEqual(validation.findings, []);
    await writeJsonAtomic(join(resultRoot, "result.json"), {
      batch_sha256: batch.batch_sha256,
      configuration_sha256: prepared.manifest.configuration_sha256,
      response_path: responsePath,
      response_sha256: sha256(await readFile(responsePath)),
      decisions: validation.decisions,
    });
  }
  return responsePaths;
}

test("entityType receives supported yes decisions in production and provisional yes only in exploratory trials", () => {
  const decisions = [
    { question_id: "supported", action: { status: "supported", label: "yes" } },
    { question_id: "no", action: { status: "rejected", label: "no" } },
    { question_id: "unclear", action: { status: "unresolved", label: null } },
    { question_id: "provisional-yes", action: { status: "provisional", label: "yes" } },
  ];
  assert.deepEqual(
    eligibleForEntityTyping(decisions, "supported").map((decision) => decision.question_id),
    ["supported"],
  );
  assert.deepEqual(
    eligibleForEntityTyping(decisions, "exploratory").map((decision) => decision.question_id),
    ["supported", "provisional-yes"],
  );
});

test("positional catalog resume restores saved blocks path unless the caller explicitly overrides it", () => {
  const operation = { blocks_directory: "/saved/blocks/operation" };
  assert.equal(catalogResumeBlocksDirectory(operation), "/saved/blocks/operation");
  assert.equal(catalogResumeBlocksDirectory(operation, "/new/blocks/operation"), resolve("/new/blocks/operation"));
  assert.equal(catalogResumeBlocksDirectory({ blocks_directory: null }), undefined);
});

test("catalog repeat policy produces a stable stage-scoped request identity", () => {
  const policy = supportedClassificationPolicy({
    version: "repeat-fixture",
    choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
    evidenceHashes: [sha256("fixture")],
  });
  policy.rules.aliasIdentity!.require_repeat = true;
  const id = classificationRepeatId("catalog-aliases-v1", policy, "aliasIdentity");
  assert.equal(id, classificationRepeatId("catalog-aliases-v1", policy, "aliasIdentity"));
  assert.match(id!, /^catalog-aliases-v1-repeat-[0-9a-f]{16}$/u);
  assert.equal(classificationRepeatId("catalog-typing-v1", policy, "entityType"), undefined);
});

test("catalog aliasIdentity collection applies a retained fresh repeat from its reviewed policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-aliasIdentity-repeat-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    await mkdir(discovery, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR)"));
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: "Resources/Lore/01-unified-church-of-the-realms.md",
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeFile(join(discovery, "decoded-proposals.json"), JSON.stringify({ entities: ["Unified Church of the Realms", "UCR"] }));
    const policy = supportedClassificationPolicy({
      version: "repeat-fixture",
      choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
      evidenceHashes: [sha256("fixture")],
    });
    policy.rules.aliasIdentity!.require_repeat = true;
    const prepared = await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId: "12345678-1234-1234-1234-123456789012",
      policy,
      inputLimit: 32_000,
      endpointPreflight: { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 },
    });
    assert.ok(prepared.manifest);
    const repeatId = classificationRepeatId("catalog-aliases-v1", policy, "aliasIdentity");
    assert.ok(repeatId);
    await retainFixtureChoice(prepared, "same_entity");
    await retainFixtureChoice(prepared, "same_entity", repeatId);
    assert.equal((await collectCatalogAliasStage(prepared.directory)).status, "complete");
    const decisions = (await readJson(join(prepared.directory, "decisions.json"))) as any[];
    assert.equal(decisions[0].action.status, "supported");
    assert.ok(decisions[0].repeat_response_reference);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("map names retain all exact entry spans while display labels never become source evidence", () => {
  const source = decodeCapturedSource(Buffer.from("East Gate is beside the East Gate road."));
  const block = { components: [sourceComponent(source, 0, source.text.length)] } as Parameters<typeof mapNameSpans>[1];
  const spans = mapNameSpans(source, block, "East Gate");
  assert.equal(spans.length, 2);
  for (const span of spans) assert.equal(source.bytes.subarray(span.start_byte, span.end_byte).toString("utf8"), "East Gate");
  assert.deepEqual(mapNameSpans(source, block, "Winterhaven, entry 3"), []);
});

test("unnamed map place descriptors enter entityQualification with whole-entry evidence and separate fallback labels", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-catalog-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    const blocks = join(root, "blocks");
    await mkdir(discovery, { recursive: true });
    await mkdir(blocks, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("1. Old Tower — stone bridge and three gates."));
    const sourcePath = resolve("Resources/Lore/01-unified-church-of-the-realms.md");
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: sourcePath,
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeFile(join(discovery, "decoded-proposals.json"), JSON.stringify({ entities: [] }));
    const entry = sourceComponent(source, 0, source.text.length);
    const layout = {
      contract_version: "lore-block-layout-v1",
      source_sha256: source.sha256,
      source_byte_length: source.byteLength,
      blocks: [{ id: "entry-1", section_id: "winterhaven", components: [entry] }],
      place_proposals: [
        {
          id: "place-1",
          map_key_id: "map-1",
          block_id: "entry-1",
          number: "1",
          source_names: [],
          display_label: "Winterhaven, entry 1",
          naming_basis: "section_number",
          qualification_status: "not_run_out_of_scope",
        },
      ],
    };
    await writeJsonAtomic(join(blocks, "layout.json"), layout);
    const policy = supportedClassificationPolicy({
      version: "fixture-reviewed-policy",
      choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
      evidenceHashes: [sha256("local test fixture only")],
    });
    const preflight = { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 };
    const alias = await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId: "12345678-1234-1234-1234-123456789012",
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.equal(alias.manifest, undefined);
    assert.equal((await collectCatalogAliasStage(alias.directory)).status, "complete");
    const qualification = await prepareCatalogQualification({
      discoveryDirectory: discovery,
      operationId: "12345678-1234-1234-1234-123456789012",
      blocksDirectory: blocks,
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.ok(qualification.manifest);
    const operationRoot = join(discovery, "classifications", "12345678-1234-1234-1234-123456789012");
    const inputs = (await readJson(join(operationRoot, "qualification-inputs.json"))) as Record<string, any>;
    const candidate = Object.values(inputs)[0]!.candidate;
    assert.equal(candidate.kind, "unnamed_map_place_descriptor");
    assert.equal(candidate.source_descriptor, source.text);
    assert.equal(candidate.names, undefined);
    const proposals = (await readJson(join(discovery, "classifications", "12345678-1234-1234-1234-123456789012", "map-place-proposals.json"))) as any;
    assert.equal(proposals.place_proposals[0].display_label, "Winterhaven, entry 1");
    assert.deepEqual(proposals.place_proposals[0].source_names, []);
    assert.notEqual(candidate.source_descriptor, proposals.place_proposals[0].display_label);

    const entityQualificationResponses = await retainFixtureChoice(qualification, "yes");
    assert.equal((await collectCatalogQualification(qualification)).status, "complete");
    const typing = await prepareCatalogTyping({
      discoveryDirectory: discovery,
      operationId: "12345678-1234-1234-1234-123456789012",
      blocksDirectory: blocks,
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.ok(typing.manifest);
    const typeRequest = typing.manifest.batches[0]!.request as any;
    const typeQuestion = typeRequest.questions[Object.keys(typing.manifest.question_targets)[0]!] as any;
    assert.deepEqual(Object.keys(typeQuestion.criteria).sort(), ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"].sort());
    assert.ok(!Object.hasOwn(typeQuestion.criteria, "not_an_entity"));
    await rm(entityQualificationResponses[0]!);
    await assert.rejects(
      prepareCatalogTyping({
        discoveryDirectory: discovery,
        operationId: "12345678-1234-1234-1234-123456789012",
        blocksDirectory: blocks,
        policy,
        inputLimit: 32_000,
        endpointPreflight: preflight,
      }),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unmatched uppercase headers and clues do not block saved entityQualification preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-unmatched-clues-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    await mkdir(discovery, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("| FACTION | PATRON |\n| Order | None |\nUNKNOWN and X.Y.Z. remain unexplained."));
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: "Resources/Lore/06-factions-and-organizations.md",
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeJsonAtomic(join(discovery, "decoded-proposals.json"), { entities: ["Order"] });
    const policy = supportedClassificationPolicy({
      version: "fixture-reviewed-policy",
      choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
      evidenceHashes: [sha256("local test fixture only")],
    });
    const input = {
      capability: "classify" as const,
      discoveryDirectory: discovery,
      operationId: "12345678-1234-1234-1234-123456789012",
      policy,
      inputLimit: 32_000,
      endpointPreflight: { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 },
    };
    const aliases = await prepareCatalogAliasStage(input);
    assert.equal((await collectCatalogAliasStage(aliases.directory)).status, "complete");
    const scan = ((await readJson(join(aliases.directory, "alias-inputs.json"))) as any).acronym_scan;
    assert.deepEqual(
      scan.unresolved.map((entry: any) => entry.acronym.text),
      ["FACTION", "PATRON", "UNKNOWN", "X.Y.Z."],
    );
    const qualification = await prepareCatalogQualification(input);
    assert.ok(qualification.manifest);
    assert.equal(Object.keys(qualification.manifest.question_targets).length, 1);
    const corrections = (await readJson(join(discovery, "classifications", input.operationId, "discovery-correction-findings.json"))) as any;
    assert.equal(corrections.qualification_blocked, false);
    assert.deepEqual(corrections.findings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing written acronym expansions are retained and block entityQualification until compatible discovery is rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-correction-gate-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    await mkdir(discovery, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR)"));
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: "Resources/Lore/01-unified-church-of-the-realms.md",
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeFile(join(discovery, "decoded-proposals.json"), JSON.stringify({ entities: ["UCR"] }));
    const policy = supportedClassificationPolicy({
      version: "fixture-reviewed-policy",
      choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
      evidenceHashes: [sha256("local test fixture only")],
    });
    const preflight = { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 };
    const operationId = "12345678-1234-1234-1234-123456789012";
    const alias = await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId,
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.equal(alias.manifest, undefined);
    await collectCatalogAliasStage(alias.directory);

    await assert.rejects(
      prepareCatalogQualification({
        discoveryDirectory: discovery,
        operationId,
        policy,
        inputLimit: 32_000,
        endpointPreflight: preflight,
      }),
      /Compatible discovery correction/u,
    );
    const operationRoot = join(discovery, "classifications", operationId);
    const corrections = (await readJson(join(operationRoot, "discovery-correction-findings.json"))) as any;
    const finding = corrections.findings.find((entry: any) => entry.name === "Unified Church of the Realms");
    assert.equal(corrections.status, "correction_required");
    assert.equal(corrections.qualification_blocked, true);
    assert.equal(finding.source_span.text, "Unified Church of the Realms");
    assert.equal(finding.related_source_span.text, "UCR");
    assert.equal(((await readJson(join(operationRoot, "qualification-preparation-result.json"))) as { status: string }).status, "blocked");
    await assert.rejects(readJson(join(operationRoot, "qualification", "catalog-v1", "manifest.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nonempty aliasIdentity retains parsed-manifest integrity and supports offline collect and resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-aliasIdentity-resume-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    await mkdir(discovery, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("Unified Church of the Realms (UCR)"));
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: "Resources/Lore/01-unified-church-of-the-realms.md",
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeFile(join(discovery, "decoded-proposals.json"), JSON.stringify({ entities: ["Unified Church of the Realms", "UCR"] }));
    const policy = supportedClassificationPolicy({
      version: "fixture-reviewed-policy",
      choiceThresholds: { aliasIdentity: 0.5, entityQualification: 0.5, entityType: 0.5 },
      evidenceHashes: [sha256("local test fixture only")],
    });
    const preflight = { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 };
    const operationId = "12345678-1234-1234-1234-123456789012";
    const alias = await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId,
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.ok(alias.manifest);
    const parsed = questionManifestSchema.parse(await readJson(join(alias.directory, "manifest.json")));
    await assertExecutionCompatibility(parsed, alias.directory);
    const batch = parsed.batches[0]!;
    const questionId = batch.candidate_ids[0]!;
    const attempt = join(alias.directory, "batches", batch.batch_id, "attempt-fixture");
    const responsePath = join(attempt, "response-body.txt");
    const raw = {
      model: "typesafe/jev-1.13",
      provider: "TypeSafe",
      answers: {
        [questionId]: {
          type: "choice",
          choice: "same_entity",
          confidence: 0.85,
          probabilities: { same_entity: 0.9, different_entities: 0.05, unclear: 0.05 },
        },
      },
    };
    await writeJsonAtomic(responsePath, raw);
    await writeJsonAtomic(join(attempt, "outbound-request.json"), DecisionsRequest$outboundSchema.parse(batch.request));
    const validation = validateBatchResponse(raw, parsed, batch.batch_id, responsePath);
    assert.deepEqual(validation.findings, []);
    await writeJsonAtomic(join(alias.directory, "batches", batch.batch_id, "result.json"), {
      batch_sha256: batch.batch_sha256,
      configuration_sha256: parsed.configuration_sha256,
      response_path: responsePath,
      response_sha256: sha256(await readFile(responsePath)),
      decisions: validation.decisions,
    });

    const resumed = await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId,
      policy,
      inputLimit: 32_000,
      endpointPreflight: preflight,
    });
    assert.ok(resumed.manifest);
    assert.equal((await collectCatalogAliasStage(resumed.directory)).status, "complete");
    const inputs = (await readJson(join(resumed.directory, "alias-inputs.json"))) as { candidates_sha256: string };
    const groups = await loadCatalogAliasGroups(resumed.directory, source.sha256, inputs.candidates_sha256);
    assert.equal(groups.groups.length, 1);
    assert.equal(groups.groups[0]!.members?.length, 2);
    await rm(responsePath);
    await assert.rejects(loadCatalogAliasGroups(resumed.directory, source.sha256, inputs.candidates_sha256), {
      code: "ENOENT",
    });
    const priorInputs = (await readJson(join(resumed.directory, "alias-inputs.json"))) as any;
    delete priorInputs.acronym_scan.disposition_version;
    await writeJsonAtomic(join(resumed.directory, "alias-inputs.json"), priorInputs);
    await assert.rejects(
      prepareCatalogAliasStage({
        capability: "classify",
        discoveryDirectory: discovery,
        operationId,
        policy,
        inputLimit: 32_000,
        endpointPreflight: preflight,
      }),
      /resume inputs changed/,
    );
    assert.deepEqual(await readJson(join(resumed.directory, "alias-inputs.json")), priorInputs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
