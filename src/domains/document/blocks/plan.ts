import type { CapturedSource } from "../discovery/source.js";
import * as questions from "../decisions/questions.js";
import { mapKeyCandidateIds } from "./read.js";
import { assembleBlocks, questionId, supportedTitleIds } from "./assembly.js";
export { questionId } from "./assembly.js";
import { itemText, type ParsedDocument, type ParsedItem, type StructureActions } from "./types.js";

export type SectionSlice = {
  start_byte: number;
  end_byte: number;
  label_item_ids: string[];
  item_ids: string[];
};

function isBoundary(item: ParsedItem, titleLabels: ReadonlySet<string>) {
  return item.kind === "label" || item.kind === "break" || titleLabels.has(item.id);
}

export function sectionSlices(parsed: ParsedDocument, titleLabels: ReadonlySet<string> = new Set()): SectionSlice[] {
  const sections: SectionSlice[] = [];
  let current: SectionSlice = { start_byte: 0, end_byte: parsed.source_byte_length, label_item_ids: [], item_ids: [] };
  let currentHasContent = false;
  const finish = (endByte: number) => {
    current.end_byte = endByte;
    if (current.item_ids.length || current.label_item_ids.length) sections.push(current);
  };
  for (const item of parsed.items) {
    if (item.kind === "break") {
      finish(item.component.start_byte);
      current = {
        start_byte: item.component.end_byte,
        end_byte: parsed.source_byte_length,
        label_item_ids: [],
        item_ids: [],
      };
      currentHasContent = false;
      continue;
    }
    if (item.kind === "label" || titleLabels.has(item.id)) {
      if (currentHasContent || (!current.label_item_ids.length && current.item_ids.length)) {
        finish(item.component.start_byte);
        current = {
          start_byte: item.component.start_byte,
          end_byte: parsed.source_byte_length,
          label_item_ids: [],
          item_ids: [],
        };
        currentHasContent = false;
      } else if (!current.label_item_ids.length) {
        current.start_byte = item.component.start_byte;
      }
      current.label_item_ids.push(item.id);
      continue;
    }
    if (!current.item_ids.length && !current.label_item_ids.length) current.start_byte = item.component.start_byte;
    current.item_ids.push(item.id);
    currentHasContent = true;
  }
  finish(parsed.source_byte_length);
  return sections;
}

export function titleTargets(source: CapturedSource, parsed: ParsedDocument): questions.PreparedQuestion[] {
  const preliminary = sectionSlices(parsed);
  return parsed.items.flatMap((item, index) => {
    if (item.kind !== "paragraph" || !item.title_candidate) return [];
    const section = preliminary.find((candidate) => candidate.item_ids.includes(item.id));
    const nextBoundary = parsed.items.slice(index + 1).find((entry) => entry.kind === "label" || entry.kind === "break");
    const endByte = nextBoundary?.component.start_byte ?? source.byteLength;
    const following = source.bytes.subarray(item.component.end_byte, endByte).toString("utf8");
    const id = questionId("title", item.id);
    return [
      questions.title({
        id,
        target: {
          line: itemText(source, item),
          following_text: following,
          section_limits: section ? { start_byte: section.start_byte, end_byte: section.end_byte } : { start_byte: item.component.start_byte, end_byte: endByte },
        },
      }),
    ];
  });
}

export function listIntroductionAndMapLabelsTargets(source: CapturedSource, parsed: ParsedDocument, actions: StructureActions, includeProvisional = false) {
  const titleLabels = supportedTitleIds(actions, includeProvisional);
  const sections = sectionSlices(parsed, titleLabels);
  const listIntroduction: questions.PreparedQuestion[] = [];
  const mapLabels: questions.PreparedQuestion[] = [];
  const mapCandidates = new Set(mapKeyCandidateIds(parsed, titleLabels));
  for (let index = 0; index < parsed.items.length; index += 1) {
    const item = parsed.items[index]!;
    if (isBoundary(item, titleLabels) || item.kind !== "paragraph" || parsed.items[index + 1]?.kind !== "list") continue;
    const next = parsed.items[index + 1]!;
    const section = sections.find((entry) => entry.item_ids.includes(item.id));
    if (section)
      listIntroduction.push(
        questions.listIntroduction({
          id: questionId("listIntroduction", item.id),
          target: {
            paragraph: itemText(source, item),
            next_list: itemText(source, next),
            section_limits: { start_byte: section.start_byte, end_byte: section.end_byte },
          },
        }),
      );
  }
  for (const item of parsed.items) {
    if (!mapCandidates.has(item.id)) continue;
    const section = sections.find((entry) => entry.item_ids.includes(item.id));
    if (!section) continue;
    const peers = section.item_ids.map((id) => parsed.items.find((entry) => entry.id === id)!).filter((entry) => entry.id !== item.id);
    const before = peers.filter((entry) => entry.component.start_byte < item.component.start_byte).at(-1);
    const after = peers.find((entry) => entry.component.start_byte > item.component.start_byte);
    const notes = peers.filter((entry) => entry.kind === "note").map((entry) => itemText(source, entry));
    const id = questionId("mapLabels", item.id);
    mapLabels.push(
      questions.mapLabels({
        id,
        target: {
          list: itemText(source, item),
          nearby_text: [before ? itemText(source, before) : null, after ? itemText(source, after) : null],
          map_notes: notes.length ? notes.join("\n") : null,
        },
      }),
    );
  }
  return { listIntroduction, mapLabels, titleLabels };
}

export function linkPlacementTargets(source: CapturedSource, parsed: ParsedDocument, actions: StructureActions, includeProvisional = false) {
  const titles = supportedTitleIds(actions, includeProvisional);
  const sections = sectionSlices(parsed, titles);
  const output: questions.PreparedQuestion[] = [];
  for (const section of sections) {
    const items = section.item_ids.map((id) => parsed.items.find((item) => item.id === id)!);
    const { blocks } = assembleBlocks(source, items, actions, includeProvisional);
    for (const link of items.filter((item) => item.kind === "link")) {
      const previous = blocks.filter((item) => item.range.end <= link.component.start_byte).at(-1);
      const next = blocks.find((item) => item.range.start >= link.component.end_byte);
      output.push(
        questions.linkPlacement({
          id: questionId("linkPlacement", link.id),
          target: {
            link: itemText(source, link),
            previous_block: previous?.components.map((component) => component.text).join("") ?? null,
            next_block: next?.components.map((component) => component.text).join("") ?? null,
            section_limits: { start_byte: section.start_byte, end_byte: section.end_byte },
          },
        }),
      );
    }
  }
  return output;
}
