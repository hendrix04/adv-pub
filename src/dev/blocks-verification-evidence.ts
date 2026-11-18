import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isAuthorizedDiscoverySource } from "../domains/document/source-policy.js";
import type { CalibrationObservation, ReviewedStructureCase } from "../domains/document/blocks/calibration.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { assertSemanticSource } from "../domains/document/decisions/semantic-input.js";
import { manifestSchema, questionDecisionSchema, requestOf } from "../domains/document/decisions/contracts.js";
import { readValidatedBatch } from "../domains/document/decisions/operation.js";
import { sha256 } from "../domains/document/decisions/integrity.js";
import { questionKindSchema, type QuestionKind } from "../domains/document/decisions/questions.js";

type ReviewCase = ReviewedStructureCase & {
  source_path: string;
  source_sha256: string;
  evidence: {
    start_byte: number;
    end_byte: number;
    text?: string;
    sha256?: string;
    map_note?: { start_byte: number; end_byte: number; sha256: string; text: string };
    [key: string]: unknown;
  };
  reason: string;
  evidence_sha256: string;
};
export async function artifactExists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function loadReview(path: string): Promise<{ cases: ReviewCase[]; artifact: Record<string, unknown> }> {
  const artifact = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (
    artifact.contract_version !== "blocks-source-review-v1" ||
    artifact.verdict !== "PASS" ||
    typeof artifact.reviewer !== "string" ||
    !artifact.reviewer.includes("GPT-6.1 Sol xhigh")
  )
    throw new Error("Source-review artifact is missing its independent PASS provenance");
  if (!Array.isArray(artifact.cases) || !artifact.cases.length) throw new Error("Source-review artifact has no reviewed cases");
  const cases: ReviewCase[] = [];
  for (const raw of artifact.cases) {
    const entry = raw as Omit<ReviewCase, "evidence_sha256">;
    const sourcePath = resolve(entry.source_path);
    if (!isAuthorizedDiscoverySource(sourcePath)) throw new Error(`Source review includes an unauthorized source: ${entry.source_path}`);
    const source = decodeCapturedSource(await readFile(sourcePath));
    if (source.sha256 !== entry.source_sha256) throw new Error(`Source-review hash differs for ${entry.source_path}`);
    const evidence = source.bytes.subarray(entry.evidence.start_byte, entry.evidence.end_byte);
    const evidenceHash = sha256(evidence);
    if (
      entry.evidence.end_byte < entry.evidence.start_byte ||
      (entry.evidence.text !== undefined ? evidence.toString("utf8") !== entry.evidence.text : entry.evidence.sha256 !== evidenceHash)
    )
      throw new Error(`Source-review evidence span differs for ${entry.question_id}`);
    if (entry.evidence.map_note) {
      const note = source.bytes.subarray(entry.evidence.map_note.start_byte, entry.evidence.map_note.end_byte);
      if (sha256(note) !== entry.evidence.map_note.sha256 || note.toString("utf8") !== entry.evidence.map_note.text)
        throw new Error(`Source-review map note span differs for ${entry.question_id}`);
    }
    const questionKind = questionKindSchema.parse(entry.question_kind) as QuestionKind;
    const reviewEvidenceHash = sha256(
      JSON.stringify({
        question_id: entry.question_id,
        question_kind: questionKind,
        expected: entry.expected,
        source_sha256: source.sha256,
        start_byte: entry.evidence.start_byte,
        end_byte: entry.evidence.end_byte,
        evidence_sha256: evidenceHash,
        map_note_sha256: entry.evidence.map_note?.sha256 ?? null,
      }),
    );
    cases.push({ ...entry, question_kind: questionKind, evidence_sha256: reviewEvidenceHash });
  }
  if (new Set(cases.map((entry) => entry.question_id)).size !== cases.length) throw new Error("Duplicate source-reviewed question IDs");
  return { cases, artifact };
}

export async function operationObservations(directory: string, repeatId: string): Promise<{ observations: CalibrationObservation[]; requestCount: number; repeatCount: number }> {
  const observations: CalibrationObservation[] = [];
  let requestCount = 0;
  let repeatCount = 0;
  for (const stageName of ["title", "listIntroduction", "mapLabels", "linkPlacement"]) {
    const stageDirectory = join(directory, "stages", stageName);
    if (!(await artifactExists(join(stageDirectory, "manifest.json")))) continue;
    const manifest = manifestSchema.parse(await readJson(join(stageDirectory, "manifest.json")));
    if (manifest.contract_version !== "decision-questions-v2") throw new Error(`Unexpected decision contract in ${stageDirectory}`);
    for (const batch of manifest.batches) {
      const primary = await readValidatedBatch(stageDirectory, manifest, batch.batch_id);
      const repeat = await readValidatedBatch(stageDirectory, manifest, batch.batch_id, repeatId);
      if (!primary || !repeat) throw new Error(`Missing primary or fresh repeat in ${stageDirectory}/${batch.batch_id}`);
      requestCount += 1;
      repeatCount += 1;
      const repeated = new Map(
        repeat.decisions.map((raw) => {
          const decision = questionDecisionSchema.parse(raw);
          return [decision.question_id, decision];
        }),
      );
      for (const raw of primary.decisions) {
        const decision = questionDecisionSchema.parse(raw);
        const fresh = repeated.get(decision.question_id);
        if (!fresh) throw new Error(`Fresh repeat lacks ${decision.question_id}`);
        observations.push({
          question_id: decision.question_id,
          question_kind: decision.question_kind,
          primary: decision.raw_answer,
          repeat: fresh.raw_answer,
        });
      }
    }
  }
  return { observations, requestCount, repeatCount };
}

function addComponent(source: Buffer, value: unknown, state: { count: number }) {
  if (!value || typeof value !== "object") throw new Error("Missing source component");
  const component = value as { start_byte?: unknown; end_byte?: unknown; text?: unknown };
  if (!Number.isInteger(component.start_byte) || !Number.isInteger(component.end_byte) || typeof component.text !== "string") throw new Error("Malformed source component");
  const start = component.start_byte as number;
  const end = component.end_byte as number;
  if (start < 0 || end < start || end > source.byteLength || source.subarray(start, end).toString("utf8") !== component.text)
    throw new Error(`Source component does not reconstruct at ${start}:${end}`);
  state.count += 1;
}

function auditComponents(source: Buffer, parsed: Awaited<ReturnType<typeof readJson>>, layout: Awaited<ReturnType<typeof readJson>>) {
  const state = { count: 0 };
  const parsedDoc = parsed as { items: Array<Record<string, any>> };
  for (const item of parsedDoc.items) {
    addComponent(source, item.component, state);
    for (const entry of item.list_entries ?? []) addComponent(source, entry.component, state);
    for (const image of item.image_references ?? []) addComponent(source, image, state);
    for (const row of item.table?.rows ?? []) for (const cell of row.cells ?? []) addComponent(source, cell, state);
  }
  const built = layout as { sections: Array<Record<string, any>>; blocks: Array<Record<string, any>> };
  for (const section of built.sections)
    for (const field of ["label_components", "notes", "images", "context"]) for (const component of section[field] ?? []) addComponent(source, component, state);
  for (const block of built.blocks) for (const component of block.components) addComponent(source, component, state);
  return { exact: true, components_checked: state.count };
}

async function stageAudit(directory: string, sourceBytes: Buffer, repeatId: string) {
  const stages: Record<string, unknown> = {};
  const total = {
    primary_batches: 0,
    fresh_repeat_batches: 0,
    questions: 0,
    source_wire_checks: 0,
    raw_response_paths: [] as string[],
  };
  for (const stageName of ["title", "listIntroduction", "mapLabels", "linkPlacement"]) {
    const stageDirectory = join(directory, "stages", stageName);
    if (!(await artifactExists(join(stageDirectory, "manifest.json")))) {
      const empty = (await readJson(join(stageDirectory, "empty-stage.json"))) as {
        question_count?: number;
        network_requests?: number;
      };
      if (empty.question_count !== 0 || empty.network_requests !== 0) throw new Error(`${stageName} empty stage is not a valid no-call stage`);
      stages[stageName] = { status: "empty", question_count: 0, network_requests: 0 };
      continue;
    }
    const manifest = manifestSchema.parse(await readJson(join(stageDirectory, "manifest.json")));
    if (manifest.contract_version !== "decision-questions-v2" || manifest.source_sha256 !== sha256(sourceBytes)) throw new Error(`Unexpected stage manifest ${stageDirectory}`);
    const questionIds = Object.keys(manifest.question_targets);
    const responses: Array<{ batch_id: string; primary: string; repeat: string }> = [];
    for (const batch of manifest.batches) {
      const request = requestOf(batch);
      assertSemanticSource(request, sourceBytes);
      const primary = await readValidatedBatch(stageDirectory, manifest, batch.batch_id);
      const repeat = await readValidatedBatch(stageDirectory, manifest, batch.batch_id, repeatId);
      if (!primary || !repeat) throw new Error(`Missing primary/fresh repeat response for ${stageDirectory}/${batch.batch_id}`);
      total.primary_batches += 1;
      total.fresh_repeat_batches += 1;
      total.questions += primary.decisions.length;
      total.source_wire_checks += 2;
      total.raw_response_paths.push(primary.responsePath, repeat.responsePath);
      responses.push({ batch_id: batch.batch_id, primary: primary.responsePath, repeat: repeat.responsePath });
    }
    stages[stageName] = {
      status: "complete",
      question_ids: questionIds,
      batch_count: manifest.batches.length,
      response_paths: responses,
      policy_sha256: manifest.policy_sha256,
      configuration_sha256: manifest.configuration_sha256,
    };
  }
  return { stages, totals: total };
}

export async function auditOperation(sourcePath: string, directory: string, repeatId: string) {
  const expectedSource = decodeCapturedSource(await readFile(sourcePath));
  const retainedSource = decodeCapturedSource(await readFile(join(directory, "source.md")));
  const sourceManifest = (await readJson(join(directory, "source-manifest.json"))) as {
    sha256: string;
    byte_length: number;
  };
  if (
    retainedSource.sha256 !== expectedSource.sha256 ||
    retainedSource.byteLength !== expectedSource.byteLength ||
    sourceManifest.sha256 !== expectedSource.sha256 ||
    sourceManifest.byte_length !== expectedSource.byteLength
  )
    throw new Error(`Retained source bytes differ for ${sourcePath}`);
  const operation = (await readJson(join(directory, "operation.json"))) as {
    repeat_id: string;
    source_sha256: string;
    source_byte_length: number;
  };
  const result = (await readJson(join(directory, "result.json"))) as Record<string, any>;
  if (
    operation.repeat_id !== repeatId ||
    operation.source_sha256 !== expectedSource.sha256 ||
    operation.source_byte_length !== expectedSource.byteLength ||
    result.status !== "complete" ||
    result.full_product_status !== "not_run"
  )
    throw new Error(`Operation result/integrity differs for ${sourcePath}`);
  const parsed = await readJson(join(directory, "parsed.json"));
  const layout = (await readJson(join(directory, "layout.json"))) as Record<string, any>;
  if (layout.source_sha256 !== expectedSource.sha256 || layout.source_byte_length !== expectedSource.byteLength) throw new Error(`Layout source lineage differs for ${sourcePath}`);
  const byteAudit = auditComponents(expectedSource.bytes, parsed, layout);
  const stageResult = await stageAudit(directory, expectedSource.bytes, repeatId);
  return {
    source_path: sourcePath,
    source_sha256: expectedSource.sha256,
    source_byte_length: expectedSource.byteLength,
    component_audit: byteAudit,
    question_counts: result.question_counts,
    parsed_item_counts: Object.fromEntries(
      [...new Set((parsed as { items: Array<{ kind: string }> }).items.map((item) => item.kind))].map((kind) => [
        kind,
        (parsed as { items: Array<{ kind: string }> }).items.filter((item) => item.kind === kind).length,
      ]),
    ),
    block_count: layout.blocks.length,
    section_count: layout.sections.length,
    map_key_count: layout.map_keys.length,
    place_proposal_count: layout.place_proposals.length,
    findings: layout.findings,
    decisions: layout.decisions,
    stages: stageResult.stages,
    request_totals: stageResult.totals,
  };
}
