import { type CapturedSource } from "../discovery/source.js";
import { sha256 } from "../decisions/contracts.js";
import { sectionSlices } from "./plan.js";
import { assembleBlocks, effective, mergeComponents, questionId, supportedTitleIds, whitespaceComponent } from "./assembly.js";
import {
  type BuiltLayout,
  type Component,
  type LayoutBlock,
  type LayoutSection,
  type MapKey,
  type ParsedDocument,
  type ParsedItem,
  type PlaceProposal,
  type StructureActions,
} from "./types.js";

type DecisionEvidence = {
  question_id: string;
  raw_answer: unknown;
  action: StructureActions[string];
  repeat_response_reference: string | null;
};
type PendingKey = { item: ParsedItem; key: MapKey };

function id(source: CapturedSource, role: string, parts: Array<string | number>) {
  return sha256([source.sha256, role, ...parts].join("\0")).slice(0, 24);
}

function sectionDisplayLabel(section: LayoutSection, ordinal: number): string {
  const label = section.label_components
    .map((component) => component.text.trim())
    .map((text) =>
      text
        .replace(/^#{1,6}\s*/u, "")
        .replace(/^\s*#+/u, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
  return label || `Unlabelled section ${ordinal}`;
}

export function buildBlocks(input: {
  source: CapturedSource;
  parsed: ParsedDocument;
  actions: StructureActions;
  decisions?: DecisionEvidence[];
  includeProvisional?: boolean;
  stageComplete?: boolean;
}): BuiltLayout {
  const { source, parsed, actions } = input;
  const includeProvisional = input.includeProvisional ?? false;
  const titleLabels = supportedTitleIds(actions, includeProvisional);
  const slices = sectionSlices(parsed, titleLabels);
  const itemById = new Map(parsed.items.map((item) => [item.id, item]));
  const sections: LayoutSection[] = [];
  const blocks: LayoutBlock[] = [];
  const pendingKeys: PendingKey[] = [];
  // These ranges identify each block's original neighbors for every linkPlacement link.
  const blockRanges = new Map<string, { start: number; end: number }>();
  const findings: string[] = [];

  for (const slice of slices) {
    const labels = slice.label_item_ids.map((itemId) => itemById.get(itemId)!).map((item) => item.component);
    const sectionId = id(source, "section", [slice.start_byte, slice.end_byte, ...slice.label_item_ids]);
    const section: LayoutSection = {
      id: sectionId,
      kind: labels.length ? "labelled" : "unlabelled",
      label_components: labels,
      block_ids: [],
      notes: [],
      images: [],
      context: [],
      start_byte: slice.start_byte,
      end_byte: slice.end_byte,
    };
    sections.push(section);
    const items = slice.item_ids.map((itemId) => itemById.get(itemId)!);
    for (const item of items) {
      if (item.kind === "note") section.notes.push(item.component);
      else if (item.kind === "image") section.images.push(...(item.image_references ?? [item.component]));
      else if (!["paragraph", "quote", "list", "table", "link"].includes(item.kind)) section.context.push(item.component);
    }
    const assembled = assembleBlocks(source, items, actions, includeProvisional);
    findings.push(...assembled.findings);
    const keysByItem = new Map<string, MapKey>();
    for (const spec of assembled.blocks) {
      const { start, end, item_ids: originItems } = spec.origin;
      const blockId = id(source, "block", [spec.kind, start, end, spec.map_entry_number ?? "", ...originItems]);
      const block: LayoutBlock = {
        id: blockId,
        kind: spec.kind,
        section_id: sectionId,
        item_ids: [...spec.item_ids],
        components: spec.components.map((component) => ({ ...component })),
        map_entry_number: spec.map_entry_number,
        table: spec.table,
        attribution: spec.attribution,
      };
      blocks.push(block);
      section.block_ids.push(blockId);
      blockRanges.set(blockId, { ...spec.range });
      if (spec.map_item) {
        let key = keysByItem.get(spec.map_item.id);
        if (!key) {
          key = {
            id: id(source, "map-key", [sectionId, spec.map_item.id]),
            section_id: sectionId,
            image: null,
            entries: [],
            findings: [],
          };
          keysByItem.set(spec.map_item.id, key);
          pendingKeys.push({ item: spec.map_item, key });
        }
        key.entries.push({ number: spec.map_entry_number!, block_id: blockId });
      }
    }
    section.context.sort((left, right) => left.start_byte - right.start_byte);
  }

  const mapKeys: MapKey[] = [];
  const placeProposals: PlaceProposal[] = [];
  for (const { item, key } of pendingKeys) {
    const section = sections.find((entry) => entry.id === key.section_id)!;
    if (section.images.length === 1) key.image = section.images[0]!;
    else if (section.images.length > 1) {
      key.findings.push("Multiple images in the map-key section; image attachment is ambiguous");
      findings.push(`${key.id}: ${key.findings.at(-1)}`);
    }
    mapKeys.push(key);
    for (const [entryIndex, entry] of key.entries.entries()) {
      const names = item.list_entries[entryIndex]?.bold_names ?? [];
      const sectionName = sectionDisplayLabel(section, sections.indexOf(section) + 1);
      const displayLabel = names[0] ?? `${sectionName}, entry ${entry.number}`;
      const blockId = entry.block_id;
      placeProposals.push({
        id: id(source, "place-proposal", [key.id, entry.number, blockId]),
        map_key_id: key.id,
        block_id: blockId,
        number: entry.number,
        source_names: names,
        display_label: displayLabel,
        naming_basis: names.length ? "bold" : "section_number",
        qualification_status: "not_run_out_of_scope",
      });
    }
  }

  for (const section of sections) {
    const links =
      sectionSlices(parsed, titleLabels)
        .find((slice) => slice.start_byte === section.start_byte && slice.end_byte === section.end_byte)
        ?.item_ids.map((itemId) => itemById.get(itemId)!)
        .filter((item) => item.kind === "link") ?? [];
    for (const link of links) {
      const question = questionId("linkPlacement", link.id);
      const action = actions[question];
      const previous = blocks.filter((block) => block.section_id === section.id && blockRanges.get(block.id)!.end <= link.component.start_byte).at(-1);
      const next = blocks.find((block) => block.section_id === section.id && blockRanges.get(block.id)!.start >= link.component.end_byte);
      const attach = (block: LayoutBlock | undefined, beforeLink: boolean) => {
        if (!block) return false;
        const range = blockRanges.get(block.id)!;
        const gap = beforeLink
          ? whitespaceComponent(source, range.end, link.component.start_byte, "link_separator")
          : whitespaceComponent(source, link.component.end_byte, range.start, "link_separator");
        block.components = mergeComponents(source, [...block.components, ...(gap ? [gap] : []), link.component], "block");
        return true;
      };
      const actionIsEffective = effective(action, includeProvisional);
      let placed = false;
      if (actionIsEffective) {
        if (action!.label === "before") placed = attach(previous, true);
        else if (action!.label === "after") placed = attach(next, false);
        else if (action!.label === "both") placed = attach(previous, true) && attach(next, false);
        else if (action!.label === "neither") {
          section.context.push(link.component);
          placed = true;
        }
      }
      if (actionIsEffective && !placed) findings.push(`${question}: selected linkPlacement neighbor is missing; no neighbor was fabricated`);
      if (!placed) {
        if (next && attach(next, false)) findings.push(`${question}: provisional next-block placement fallback`);
        else {
          section.context.push(link.component);
          findings.push(`${question}: no next block in this section; link retained as section context`);
        }
      }
    }
    section.context.sort((left, right) => left.start_byte - right.start_byte);
  }

  for (const [questionIdValue, action] of Object.entries(actions)) {
    if (action.status === "unresolved") findings.push(`${questionIdValue}: ${action.findings.join("; ") || "decision unresolved"}`);
    else if (action.status === "rejected" && action.findings.length) findings.push(`${questionIdValue}: rejected: ${action.findings.join("; ")}`);
  }
  const decisions = (input.decisions ?? []).map((entry) => ({
    question_id: entry.question_id,
    action: entry.action,
    raw_answer: entry.raw_answer,
    repeat_response_reference: entry.repeat_response_reference,
  }));
  return {
    contract_version: "lore-block-layout-v1",
    capability_status: input.stageComplete === false ? "partial" : "complete",
    full_product_status: "not_run",
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    items: parsed.items,
    sections,
    blocks,
    map_keys: mapKeys,
    place_proposals: placeProposals,
    decisions,
    findings: [...new Set(findings)],
  };
}
