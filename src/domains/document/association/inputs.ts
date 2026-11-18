import { readFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { decodeCapturedSource, type CapturedSource } from "../discovery/source.js";
import { isAuthorizedDiscoverySource } from "../source-policy.js";
import { sha256 } from "../decisions/integrity.js";
import { readJson } from "../discovery/artifacts.js";
import type { BuiltLayout, Component } from "../blocks/types.js";
import { localEntitiesFileSchema, type LocalEntity } from "./types.js";

export type AssociationInputs = {
  sourcePath: string;
  structureDirectory: string;
  classificationDirectory: string;
};

export type LoadedAssociationInputs = {
  sourcePath: string;
  structureDirectory: string;
  classificationDirectory: string;
  source: CapturedSource;
  layout: BuiltLayout;
  entities: LocalEntity[];
  hashes: {
    layout_sha256: string;
    structure_source_sha256: string;
    structure_result_sha256: string;
    classification_operation_sha256: string;
    classification_result_sha256: string;
    local_entities_sha256: string;
  };
};

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertSourceComponent(source: CapturedSource, component: Component) {
  if (
    !Number.isInteger(component.start_byte) ||
    !Number.isInteger(component.end_byte) ||
    component.start_byte < 0 ||
    component.end_byte < component.start_byte ||
    component.end_byte > source.byteLength
  ) {
    throw new Error("Upstream layout contains an invalid byte range");
  }
  const bytes = source.bytes.subarray(component.start_byte, component.end_byte);
  if (!Buffer.from(component.text, "utf8").equals(bytes)) throw new Error("Upstream layout component differs from original source bytes");
}

function assertLayoutComponents(source: CapturedSource, layout: BuiltLayout) {
  const components: Component[] = [];
  for (const item of layout.items) {
    components.push(item.component, ...(item.image_references ?? []));
    for (const row of item.table?.rows ?? []) components.push(...row.cells);
    for (const entry of item.list_entries) components.push(entry.component);
  }
  for (const section of layout.sections) components.push(...section.label_components, ...section.notes, ...section.images, ...section.context);
  for (const block of layout.blocks) {
    components.push(...block.components);
    for (const row of block.table?.rows ?? []) components.push(...row.cells);
  }
  for (const component of components) assertSourceComponent(source, component);
}

export async function loadAssociationInputs(input: AssociationInputs): Promise<LoadedAssociationInputs> {
  const sourcePath = resolve(input.sourcePath);
  const structureDirectory = resolve(input.structureDirectory);
  const classificationDirectory = resolve(input.classificationDirectory);
  if (!isAuthorizedDiscoverySource(sourcePath)) throw new Error("Association source is outside the nine-document allowlist");
  const source = decodeCapturedSource(await readFile(sourcePath));
  const layoutPath = join(structureDirectory, "layout.json");
  const structureSourcePath = join(structureDirectory, "source.md");
  const structureResultPath = join(structureDirectory, "result.json");
  const classificationOperationPath = join(classificationDirectory, "classification-operation.json");
  const classificationResultPath = join(classificationDirectory, "result.json");
  const localEntitiesPath = join(classificationDirectory, "local-entities.json");
  const [layoutBytes, structureSourceBytes, structureResultBytes, classificationOperationBytes, classificationResultBytes, localEntitiesBytes] = await Promise.all([
    readFile(layoutPath),
    readFile(structureSourcePath),
    readFile(structureResultPath),
    readFile(classificationOperationPath),
    readFile(classificationResultPath),
    readFile(localEntitiesPath),
  ]);
  const layoutValue: unknown = JSON.parse(layoutBytes.toString("utf8"));
  assertRecord(layoutValue, "Accepted structure layout");
  if (
    layoutValue.contract_version !== "lore-block-layout-v1" ||
    layoutValue.capability_status !== "complete" ||
    layoutValue.full_product_status !== "not_run" ||
    !Array.isArray(layoutValue.sections) ||
    !Array.isArray(layoutValue.blocks)
  ) {
    throw new Error("Accepted structure layout has an unsupported contract or incomplete status");
  }
  const layout = layoutValue as unknown as BuiltLayout;
  const retainedStructureSource = decodeCapturedSource(structureSourceBytes);
  if (
    source.sha256 !== layout.source_sha256 ||
    source.byteLength !== layout.source_byte_length ||
    retainedStructureSource.sha256 !== source.sha256 ||
    retainedStructureSource.byteLength !== source.byteLength
  ) {
    throw new Error("Structure source lineage differs from the current original source");
  }
  assertLayoutComponents(source, layout);
  const structureResult: unknown = JSON.parse(structureResultBytes.toString("utf8"));
  assertRecord(structureResult, "Accepted structure result");
  if (
    structureResult.status !== "complete" ||
    structureResult.capability !== "source-local-structure" ||
    structureResult.source_sha256 !== source.sha256 ||
    structureResult.block_count !== layout.blocks.length
  ) {
    throw new Error("Accepted structure result does not match its layout and source");
  }

  const classificationOperation: unknown = JSON.parse(classificationOperationBytes.toString("utf8"));
  assertRecord(classificationOperation, "Accepted classification operation");
  if (
    classificationOperation.contract_version !== "source-local-classification-v1" ||
    classificationOperation.source_sha256 !== source.sha256 ||
    classificationOperation.source_byte_length !== source.byteLength ||
    typeof classificationOperation.operation_id !== "string"
  ) {
    throw new Error("Accepted classification operation lineage differs from the current source");
  }
  const classificationResult: unknown = JSON.parse(classificationResultBytes.toString("utf8"));
  assertRecord(classificationResult, "Accepted classification result");
  if (
    classificationResult.contract_version !== "source-local-classification-result-v1" ||
    classificationResult.status !== "complete" ||
    classificationResult.full_product_status !== "not_run" ||
    classificationResult.source_sha256 !== source.sha256 ||
    classificationResult.operation_id !== classificationOperation.operation_id
  ) {
    throw new Error("Accepted classification result is incomplete or mismatched");
  }
  const localEntities = localEntitiesFileSchema.parse(JSON.parse(localEntitiesBytes.toString("utf8")));
  if (
    localEntities.source_sha256 !== source.sha256 ||
    localEntities.entities.some((entity) => entity.source_sha256 !== source.sha256 || entity.document_id !== basename(sourcePath, ".md"))
  ) {
    throw new Error("Accepted local entities have a different source or document identity");
  }
  if (classificationResult.local_entity_count !== localEntities.entities.length) throw new Error("Accepted local entity count differs from the classification result");
  if (new Set(localEntities.entities.map((entity) => entity.local_entity_id)).size !== localEntities.entities.length) throw new Error("Accepted local entity IDs are not unique");

  return {
    sourcePath,
    structureDirectory,
    classificationDirectory,
    source,
    layout,
    entities: localEntities.entities,
    hashes: {
      layout_sha256: sha256(layoutBytes),
      structure_source_sha256: sha256(structureSourceBytes),
      structure_result_sha256: sha256(structureResultBytes),
      classification_operation_sha256: sha256(classificationOperationBytes),
      classification_result_sha256: sha256(classificationResultBytes),
      local_entities_sha256: sha256(localEntitiesBytes),
    },
  };
}
