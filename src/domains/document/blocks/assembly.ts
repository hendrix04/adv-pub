import type { CapturedSource } from "../discovery/source.js";
import { inlineQuoteSpeaker, isQuotedParagraph, separateSpeaker } from "./read.js";
import { itemText, type Component, type LayoutBlock, type ParsedItem, type StructureActions } from "./types.js";

export const questionId = (kind: "title" | "listIntroduction" | "mapLabels" | "linkPlacement", itemId: string) => `${kind}-${itemId}`;

export function effective(action: StructureActions[string] | undefined, includeProvisional: boolean) {
  return Boolean(action?.label && (action.status === "supported" || (includeProvisional && action.status === "provisional")));
}

export function supportedTitleIds(actions: StructureActions, includeProvisional: boolean): Set<string> {
  return new Set(
    Object.entries(actions).flatMap(([id, action]) =>
      id.startsWith("title-") && action.label === "yes" && effective(action, includeProvisional) ? [id.slice("title-".length)] : [],
    ),
  );
}

function componentAtBytes(source: CapturedSource, start: number, end: number, role: string): Component {
  return { start_byte: start, end_byte: end, text: source.bytes.subarray(start, end).toString("utf8"), role };
}

export function whitespaceComponent(source: CapturedSource, start: number, end: number, role: string): Component | undefined {
  const text = source.bytes.subarray(start, end).toString("utf8");
  return /^\s*$/u.test(text) ? componentAtBytes(source, start, end, role) : undefined;
}

export function mergeComponents(source: CapturedSource, components: readonly Component[], role: string): Component[] {
  const ordered = [...components].sort((left, right) => left.start_byte - right.start_byte || left.end_byte - right.end_byte);
  const out: Component[] = [];
  for (const component of ordered) {
    const previous = out.at(-1);
    if (previous && component.start_byte > previous.end_byte) {
      const gap = whitespaceComponent(source, previous.end_byte, component.start_byte, `${role}_separator`);
      if (gap) out.push(gap);
    }
    out.push(component);
  }
  return out;
}

type MutableBlock = Pick<LayoutBlock, "kind" | "components" | "item_ids" | "map_entry_number" | "table" | "attribution"> & {
  // Attribution extends the neighbor range; the block ID uses the quote’s own components.
  origin: { start: number; end: number; item_ids: string[] };
  range: { start: number; end: number };
  map_item: ParsedItem | null;
};

export type AssembledBlock = Readonly<Omit<MutableBlock, "components" | "item_ids" | "origin" | "range">> & {
  readonly components: readonly Component[];
  readonly item_ids: readonly string[];
  readonly origin: Readonly<{ start: number; end: number; item_ids: readonly string[] }>;
  readonly range: Readonly<{ start: number; end: number }>;
};

/** Assemble lore blocks before linkPlacement attachment, without IDs, sections or metadata mutation. */
export function assembleBlocks(source: CapturedSource, items: readonly ParsedItem[], actions: StructureActions, includeProvisional: boolean) {
  const blocks: MutableBlock[] = [];
  const findings: string[] = [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const add = (
    kind: LayoutBlock["kind"],
    parts: Component[],
    itemIds: string[],
    number: string | null = null,
    mapItem: ParsedItem | null = null,
    table: LayoutBlock["table"] = null,
    attribution: string | null = null,
  ) => {
    const components = mergeComponents(source, parts, "block");
    const range = {
      start: Math.min(...components.map((component) => component.start_byte)),
      end: Math.max(...components.map((component) => component.end_byte)),
    };
    blocks.push({
      kind,
      components,
      item_ids: itemIds,
      map_entry_number: number,
      table,
      attribution,
      map_item: mapItem,
      origin: { ...range, item_ids: [...itemIds] },
      range,
    });
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "paragraph" && items[index + 1]?.kind === "list") {
      const list = items[index + 1]!;
      const listIntroduction = actions[questionId("listIntroduction", item.id)];
      const mapLabels = actions[questionId("mapLabels", list.id)];
      if (effective(listIntroduction, includeProvisional) && listIntroduction?.label === "yes" && !(effective(mapLabels, includeProvisional) && mapLabels?.label === "yes")) {
        const gap = whitespaceComponent(source, item.component.end_byte, list.component.start_byte, "introduction_list_separator");
        add("list", [item.component, ...(gap ? [gap] : []), list.component], [item.id, list.id]);
        index += 1;
        continue;
      }
      if (listIntroduction?.label === "yes" && mapLabels?.label === "yes")
        findings.push(`${questionId("listIntroduction", item.id)}: map entries retain the introduction separately to avoid duplicating it across entries`);
    }
    if (item.kind === "list") {
      const mapLabels = actions[questionId("mapLabels", item.id)];
      if (effective(mapLabels, includeProvisional) && mapLabels?.label === "yes") {
        for (const entry of item.list_entries) {
          const number = entry.number ?? "";
          if (!number) findings.push(`${questionId("mapLabels", item.id)}: list entry number could not be read from source`);
          add("entry", [entry.component], [item.id], number, item);
        }
        continue;
      }
    }
    if (!["paragraph", "quote", "list", "table"].includes(item.kind)) continue;
    const raw = itemText(source, item);
    const previous = blocks.at(-1);
    const precedingItem = previous ? itemById.get(previous.item_ids.at(-1)!) : undefined;
    const previousText = precedingItem ? itemText(source, precedingItem) : "";
    const speaker = item.kind === "paragraph" ? separateSpeaker(raw) : null;
    if (speaker && previous && (precedingItem?.kind === "quote" || isQuotedParagraph(previousText))) {
      const gap = whitespaceComponent(source, previous.range.end, item.component.start_byte, "quote_attribution_separator");
      previous.components = mergeComponents(source, [...previous.components, ...(gap ? [gap] : []), item.component], "quote");
      previous.item_ids.push(item.id);
      previous.attribution = speaker;
      previous.range.end = item.component.end_byte;
      continue;
    }
    add(item.kind as LayoutBlock["kind"], [item.component], [item.id], null, null, item.table, item.kind === "paragraph" ? inlineQuoteSpeaker(raw) : null);
  }
  const immutable: readonly AssembledBlock[] = Object.freeze(
    blocks.map((block) =>
      Object.freeze({
        ...block,
        components: Object.freeze(block.components.map((component) => Object.freeze({ ...component }))),
        item_ids: Object.freeze([...block.item_ids]),
        origin: Object.freeze({ ...block.origin, item_ids: Object.freeze([...block.origin.item_ids]) }),
        range: Object.freeze({ ...block.range }),
      }),
    ),
  );
  return { blocks: immutable, findings };
}
