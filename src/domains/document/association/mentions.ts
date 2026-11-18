import type { CapturedSource } from "../discovery/source.js";
import { sha256 } from "../decisions/integrity.js";
import type { BuiltLayout, Component, LayoutBlock, LayoutSection } from "../blocks/types.js";
import type { LocalEntity, MentionInterpretation, MentionRecord } from "./types.js";

type PatternMatch = { start: number; end: number; matchedName: string; interpretation: MentionInterpretation };
type SpanMatch = { start: number; end: number; interpretations: MentionInterpretation[] };

const wordCharacter = /^[\p{L}\p{N}\p{M}_]$/u;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function previousCodePoint(text: string, offset: number): string {
  if (offset <= 0) return "";
  const last = text.charCodeAt(offset - 1);
  return last >= 0xdc00 && last <= 0xdfff && offset > 1 ? text.slice(offset - 2, offset) : text.slice(offset - 1, offset);
}

function nextCodePoint(text: string, offset: number): string {
  return offset < text.length ? String.fromCodePoint(text.codePointAt(offset)!) : "";
}

function hasWordBoundaries(text: string, start: number, end: number): boolean {
  const before = previousCodePoint(text, start);
  const after = nextCodePoint(text, end);
  return (!before || !wordCharacter.test(before)) && (!after || !wordCharacter.test(after));
}

function candidateLineage(entity: LocalEntity, matchedName: string): string[] {
  const normalized = matchedName.toLowerCase();
  const matchingNameIndex = entity.supported_names.findIndex((name) => name.toLowerCase() === normalized);
  if (matchingNameIndex >= 0 && entity.source_candidate_ids[matchingNameIndex]) return [entity.source_candidate_ids[matchingNameIndex]!];
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.toLowerCase() === normalized && typeof record.candidate_id === "string") ids.add(record.candidate_id);
    if (Array.isArray(record.members)) record.members.forEach(visit);
  };
  entity.evidence.forEach(visit);
  return ids.size ? [...ids].sort() : [...entity.source_candidate_ids].sort();
}

function findMatches(source: CapturedSource, entities: LocalEntity[]): SpanMatch[] {
  const bySpan = new Map<string, SpanMatch>();
  const patterns = new Map<string, Array<{ entity: LocalEntity; matchedName: string }>>();
  for (const entity of entities) {
    for (const name of [...entity.supported_names, ...entity.aliases]) {
      if (!name.trim()) continue;
      const normalized = name.toLowerCase();
      const entries = patterns.get(normalized) ?? [];
      entries.push({ entity, matchedName: name });
      patterns.set(normalized, entries);
    }
  }

  const candidates: PatternMatch[] = [];
  for (const entries of patterns.values()) {
    const name = entries.map((entry) => entry.matchedName).sort((a, b) => b.length - a.length || a.localeCompare(b))[0]!;
    const regex = new RegExp(escapeRegExp(name), "giu");
    for (const match of source.text.matchAll(regex)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (!hasWordBoundaries(source.text, start, end)) continue;
      for (const { entity, matchedName } of entries)
        candidates.push({
          start,
          end,
          matchedName,
          interpretation: {
            local_entity_id: entity.local_entity_id,
            matched_name: matchedName,
            source_candidate_ids: candidateLineage(entity, matchedName),
          },
        });
    }
  }

  for (const candidate of candidates) {
    const startByte = Buffer.byteLength(source.text.slice(0, candidate.start), "utf8");
    const endByte = Buffer.byteLength(source.text.slice(0, candidate.end), "utf8");
    const key = `${startByte}:${endByte}`;
    const existing = bySpan.get(key) ?? { start: startByte, end: endByte, interpretations: [] };
    if (
      !existing.interpretations.some(
        (entry) => entry.local_entity_id === candidate.interpretation.local_entity_id && entry.matched_name.toLowerCase() === candidate.interpretation.matched_name.toLowerCase(),
      )
    ) {
      existing.interpretations.push(candidate.interpretation);
    }
    bySpan.set(key, existing);
  }

  const ordered = [...bySpan.values()].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start || a.end - b.end);
  const selected: SpanMatch[] = [];
  for (const candidate of ordered) {
    if (selected.some((current) => candidate.start < current.end && current.start < candidate.end)) continue;
    candidate.interpretations.sort((a, b) =>
      a.local_entity_id < b.local_entity_id ? -1 : a.local_entity_id > b.local_entity_id ? 1 : a.matched_name < b.matched_name ? -1 : a.matched_name > b.matched_name ? 1 : 0,
    );
    selected.push(candidate);
  }
  return selected.sort((a, b) => a.start - b.start || a.end - b.end);
}

function fromByteRange(source: CapturedSource, start: number, end: number, role: string): Component {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.byteLength) throw new Error("Invalid mention context byte span");
  const bytes = source.bytes.subarray(start, end);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("Mention context span splits a UTF-8 code point");
  return { start_byte: start, end_byte: end, text, role };
}

function enclosingComponent(components: Component[], start: number, end: number): Component | undefined {
  return components.find((component) => component.start_byte <= start && component.end_byte >= end);
}

function rowSpan(source: CapturedSource, start: number, end: number): Component {
  const before = source.bytes.lastIndexOf(0x0a, Math.max(0, start - 1));
  const lineStart = before < 0 ? 0 : before + 1;
  const nextLine = source.bytes.indexOf(0x0a, end);
  const lineEnd = nextLine < 0 ? source.byteLength : nextLine;
  return fromByteRange(source, lineStart, lineEnd, "table_row");
}

function tableContext(source: CapturedSource, block: LayoutBlock, start: number, end: number) {
  if (!block.table) return null;
  for (const row of block.table.rows) {
    const cellIndex = row.cells.findIndex((cell) => cell.start_byte <= start && cell.end_byte >= end);
    if (cellIndex < 0) continue;
    const cell = row.cells[cellIndex]!;
    const header = row.kind === "header" ? null : (block.table.rows.find((entry) => entry.kind === "header")?.cells[cellIndex] ?? null);
    const tableSpan = enclosingComponent(block.components, cell.start_byte, cell.end_byte) ?? block.components[0];
    if (!tableSpan) throw new Error("Table mention has no source table component");
    return {
      table_span: tableSpan,
      whole_row: rowSpan(source, cell.start_byte, cell.end_byte),
      cell: { ...cell },
      header: header ? { ...header } : null,
      row_index: row.index,
      cell_index: cellIndex,
    };
  }
  return null;
}

function sectionForMention(layout: BuiltLayout, block: LayoutBlock | undefined, start: number, end: number): { section?: LayoutSection; label?: Component } {
  if (block) return { section: layout.sections.find((entry) => entry.id === block.section_id) };
  for (const section of layout.sections) {
    const label = section.label_components.find((component) => component.start_byte <= start && component.end_byte >= end);
    if (label) return { section, label };
  }
  return {};
}

export function findEntityMentions(source: CapturedSource, layout: BuiltLayout, entities: LocalEntity[]): MentionRecord[] {
  const blocks = layout.blocks;
  return findMatches(source, entities).map((match) => {
    const sourceSpan = fromByteRange(source, match.start, match.end, "entity_mention");
    const block = blocks.find((entry) => enclosingComponent(entry.components, match.start, match.end));
    const { section, label } = sectionForMention(layout, block, match.start, match.end);
    const interpretations = match.interpretations;
    const sourceCandidateIds = [...new Set(interpretations.flatMap((entry) => entry.source_candidate_ids))].sort();
    return {
      contract_version: "source-entity-mention-v1" as const,
      mention_id: `mention-${sha256(`${source.sha256}\0${match.start}\0${match.end}`).slice(0, 24)}`,
      source_span: sourceSpan,
      interpretations,
      source_candidate_ids: sourceCandidateIds,
      block_id: block?.id ?? null,
      section_id: section?.id ?? null,
      label_id: label ? `${section!.id}:label:${label.start_byte}` : null,
      table_context: block ? tableContext(source, block, match.start, match.end) : null,
      quote_context: block?.kind === "quote" ? { block_components: block.components.map((component) => ({ ...component })), speaker: block.attribution } : null,
    };
  });
}
