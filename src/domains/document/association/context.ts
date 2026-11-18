import { sha256 } from "../decisions/integrity.js";
import type { BuiltLayout, Component, LayoutBlock } from "../blocks/types.js";
import { associationQuestionId } from "./planning.js";
import type { AssociationLink, DecisionRecord, EntityContext, FoundSection, LocalEntity, MentionRecord } from "./types.js";

const positive = (record: DecisionRecord | undefined) => Boolean(record && record.action.label === "yes" && ["supported", "provisional"].includes(record.action.status));

function targetEntityId(record: DecisionRecord): string | undefined {
  const entity = record.target.entity as { local_entity_id?: unknown } | undefined;
  return typeof entity?.local_entity_id === "string" ? entity.local_entity_id : undefined;
}

function targetBlockId(record: DecisionRecord, field: "block" | "previous_block" = "block"): string | undefined {
  const block = record.target[field] as { block_id?: unknown } | undefined;
  return typeof block?.block_id === "string" ? block.block_id : undefined;
}

function rangeOf(block: LayoutBlock) {
  const components = block.components;
  return {
    start: Math.min(...components.map((component) => component.start_byte)),
    end: Math.max(...components.map((component) => component.end_byte)),
  };
}

export function buildFoundSections(
  layout: BuiltLayout,
  entities: LocalEntity[],
  blockSubjectRecords: DecisionRecord[],
  subjectContinuationRecords: DecisionRecord[],
): FoundSection[] {
  const entityIds = new Set(entities.map((entity) => entity.local_entity_id));
  const subjectContinuationByPair = new Map<string, DecisionRecord>();
  for (const record of subjectContinuationRecords) {
    const entity = targetEntityId(record);
    const previous = targetBlockId(record, "previous_block");
    const block = targetBlockId(record);
    if (entity && previous && block) subjectContinuationByPair.set(`${entity}\0${previous}\0${block}`, record);
  }
  const output: FoundSection[] = [];
  const seen = new Set<string>();
  for (const seed of blockSubjectRecords) {
    if (!positive(seed)) continue;
    const entityId = targetEntityId(seed);
    const seedBlock = targetBlockId(seed);
    if (!entityId || !seedBlock || !entityIds.has(entityId)) continue;
    const section = layout.sections.find((entry) => entry.block_ids.includes(seedBlock));
    if (!section) throw new Error(`blockSubject seed block is absent from the source layout: ${seedBlock}`);
    const blockIds = [seedBlock];
    const continuationIds: string[] = [];
    let cursor = section.block_ids.indexOf(seedBlock);
    while (cursor >= 0 && cursor + 1 < section.block_ids.length) {
      const nextId = section.block_ids[cursor + 1]!;
      const record = subjectContinuationByPair.get(`${entityId}\0${section.block_ids[cursor]}\0${nextId}`);
      if (!record || !positive(record)) break;
      blockIds.push(nextId);
      continuationIds.push(record.question_id);
      cursor += 1;
    }
    const key = `${entityId}\0${section.id}\0${blockIds.join("\0")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = layout.blocks.find((block) => block.id === blockIds[0])!;
    const last = layout.blocks.find((block) => block.id === blockIds.at(-1))!;
    const firstRange = rangeOf(first);
    const lastRange = rangeOf(last);
    output.push({
      contract_version: "entity-found-section-v1",
      found_section_id: `found-${sha256(key).slice(0, 24)}`,
      local_entity_id: entityId,
      section_id: section.id,
      block_ids: blockIds,
      seed_question_id: seed.question_id,
      continuation_question_ids: continuationIds,
      start_byte: firstRange.start,
      end_byte: lastRange.end,
    });
  }
  return output;
}

function linkStatus(record: DecisionRecord): AssociationLink["status"] {
  return record.action.status;
}
function linkId(questionIds: string[]) {
  return `link-${sha256(questionIds.join("\0")).slice(0, 24)}`;
}

export function buildAssociationLinks(input: {
  layout: BuiltLayout;
  entities: LocalEntity[];
  blockAndDocumentSubjectDecisions: DecisionRecord[];
  sectionDecisions: DecisionRecord[];
  sectionQuestionMetadata: Array<{
    question_id: string;
    scope: "section" | "found_section";
    target_id: string;
    local_entity_id: string;
    block_ids: string[];
    provenance_question_ids?: string[];
  }>;
}): AssociationLink[] {
  const links: AssociationLink[] = [];
  for (const record of input.blockAndDocumentSubjectDecisions) {
    const entityId = targetEntityId(record);
    if (!entityId || !input.entities.some((entity) => entity.local_entity_id === entityId)) continue;
    if (record.question_kind === "blockSubject") {
      const blockId = targetBlockId(record);
      if (!blockId) continue;
      links.push({
        contract_version: "source-entity-link-v1",
        link_id: linkId([record.question_id]),
        local_entity_id: entityId,
        scope: "block",
        target_id: blockId,
        status: linkStatus(record),
        question_ids: [record.question_id],
        block_ids: [blockId],
      });
    } else if (record.question_kind === "documentSubject") {
      links.push({
        contract_version: "source-entity-link-v1",
        link_id: linkId([record.question_id]),
        local_entity_id: entityId,
        scope: "document",
        target_id: "document",
        status: linkStatus(record),
        question_ids: [record.question_id],
        block_ids: input.layout.blocks.map((block) => block.id),
      });
    }
  }
  const decisionsById = new Map(input.sectionDecisions.map((record) => [record.question_id, record]));
  for (const metadata of input.sectionQuestionMetadata) {
    const record = decisionsById.get(metadata.question_id);
    if (!record) continue;
    const questionIds = [...new Set([...(metadata.provenance_question_ids ?? []), record.question_id])];
    links.push({
      contract_version: "source-entity-link-v1",
      link_id: linkId(questionIds),
      local_entity_id: metadata.local_entity_id,
      scope: metadata.scope,
      target_id: metadata.target_id,
      status: linkStatus(record),
      question_ids: questionIds,
      block_ids: [...metadata.block_ids],
    });
  }
  return links.sort((a, b) => {
    const index = (link: AssociationLink) => Math.min(...link.block_ids.map((id) => input.layout.blocks.findIndex((block) => block.id === id)), Number.MAX_SAFE_INTEGER);
    return index(a) - index(b) || a.local_entity_id.localeCompare(b.local_entity_id) || a.link_id.localeCompare(b.link_id);
  });
}

function componentKey(component: Component) {
  return `${component.start_byte}:${component.end_byte}:${sha256(component.text)}`;
}

export function assembleEntityContexts(input: {
  layout: BuiltLayout;
  entities: LocalEntity[];
  mentions: MentionRecord[];
  links: AssociationLink[];
  meaningNotes: DecisionRecord[];
  originNotes: DecisionRecord[];
}): EntityContext[] {
  const sectionById = new Map(input.layout.sections.map((section) => [section.id, section]));
  const contexts: EntityContext[] = [];
  for (const entity of input.entities) {
    const links = input.links.filter((link) => link.local_entity_id === entity.local_entity_id && link.status === "supported");
    const blockIds = new Set(links.flatMap((link) => link.block_ids));
    const blocks = input.layout.blocks
      .filter((block) => blockIds.has(block.id))
      .map((block) => {
        const section = sectionById.get(block.section_id);
        if (!section) throw new Error(`Context block has no section: ${block.id}`);
        return { block, text: block.components.map((component) => component.text).join(""), section };
      });
    const components = new Map<string, Component & { block_ids: string[] }>();
    for (const { block } of blocks) {
      for (const component of block.components) {
        const key = componentKey(component);
        const current = components.get(key) ?? { ...component, block_ids: [] };
        if (!current.block_ids.includes(block.id)) current.block_ids.push(block.id);
        components.set(key, current);
      }
    }
    const includedBlockIds = new Set(blocks.map(({ block }) => block.id));
    const mentionIds = input.mentions
      .filter((mention) => includedBlockIds.has(mention.block_id ?? "") && mention.interpretations.some((entry) => entry.local_entity_id === entity.local_entity_id))
      .map((mention) => mention.mention_id);
    const meaningNoteIds = input.meaningNotes
      .filter(
        (note) =>
          targetEntityId(note) === entity.local_entity_id && includedBlockIds.has(String((note.target.passage as { block?: { block_id?: string } } | undefined)?.block?.block_id)),
      )
      .map((note) => note.question_id);
    const originNoteIds = input.originNotes
      .filter((note) => includedBlockIds.has(String((note.target.block as { block_id?: string } | undefined)?.block_id)))
      .map((note) => note.question_id);
    contexts.push({
      contract_version: "source-entity-context-v1",
      local_entity_id: entity.local_entity_id,
      block_ids: blocks.map(({ block }) => block.id),
      blocks,
      source_components: [...components.values()].sort((a, b) => a.start_byte - b.start_byte || a.end_byte - b.end_byte),
      link_ids: links.map((link) => link.link_id),
      mention_ids: [...new Set(mentionIds)],
      meaning_note_ids: [...new Set(meaningNoteIds)],
      origin_note_ids: [...new Set(originNoteIds)],
    });
  }
  return contexts;
}

function fenced(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

export function renderEntityContextView(input: { entities: LocalEntity[]; links: AssociationLink[]; contexts: EntityContext[] }): string {
  const nameById = new Map(input.entities.map((entity) => [entity.local_entity_id, entity.supported_names[0] ?? entity.local_entity_id]));
  const lines = [
    "# Source-local entity context",
    "",
    "Contexts include complete source blocks attached by supported links. Section notes remain source metadata; this output does not claim canonical identity or wiki delivery.",
    "",
  ];
  for (const context of input.contexts) {
    lines.push(`## ${nameById.get(context.local_entity_id) ?? context.local_entity_id}`, "", `Entity ID: \`${context.local_entity_id}\``, "");
    const links = input.links.filter((link) => context.link_ids.includes(link.link_id));
    lines.push("### Supported link provenance", "");
    if (!links.length) lines.push("No supported links.", "");
    for (const link of links)
      lines.push(
        `- \`${link.link_id}\` ${link.scope} \`${link.target_id}\`; questions: ${link.question_ids.map((id) => `\`${id}\``).join(", ")}; blocks: ${link.block_ids.map((id) => `\`${id}\``).join(", ")}`,
      );
    lines.push("", "### Ordered context blocks", "");
    if (!context.blocks.length) lines.push("No supported context blocks.", "");
    for (const entry of context.blocks) {
      lines.push(
        `#### ${entry.block.id}`,
        "",
        `Section: \`${entry.section.id}\` (${entry.section.kind})`,
        `Source components: ${entry.block.components.map((component) => `\`${component.start_byte}:${component.end_byte}\` ${component.role}`).join(", ")}`,
        "",
        fenced(entry.text),
        "",
        `Section notes: ${JSON.stringify(entry.section.notes)}`,
        `Section images: ${JSON.stringify(entry.section.images)}`,
        `Section context: ${JSON.stringify(entry.section.context)}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function questionIdForPair(entityId: string, blockId: string) {
  return associationQuestionId("blockSubject", entityId, blockId);
}
