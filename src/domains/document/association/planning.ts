import * as questions from "../decisions/questions.js";
import { buildDecisionRequest } from "../decisions/request.js";
import { sha256 } from "../decisions/integrity.js";
import type { BuiltLayout, Component, LayoutBlock, LayoutSection } from "../blocks/types.js";
import type { CapturedSource } from "../discovery/source.js";
import type { DecisionRecord, FoundSection, LocalEntity, MentionRecord } from "./types.js";

export const associationQuestionId = (kind: "blockSubject" | "subjectContinuation" | "sectionSubject" | "documentSubject" | "passageMeaning" | "textOrigin", ...parts: string[]) =>
  `${kind}-${sha256(parts.join("\0")).slice(0, 24)}`;

export function entityQuestionInput(entity: LocalEntity) {
  const names = [...entity.supported_names];
  return {
    local_entity_id: entity.local_entity_id,
    type: entity.type,
    supported_name: names[0] ?? null,
    source_descriptor: entity.source_descriptor,
    aliases: [...new Set([...entity.aliases, ...names.slice(1)])],
    source_candidate_ids: entity.source_candidate_ids,
    qualification_decision_id: entity.qualification_decision_id,
    type_decision_id: entity.type_decision_id,
  };
}

export function blockPayload(source: CapturedSource, block: LayoutBlock, includeText = true) {
  const components = block.components.map((component) => {
    const bytes = source.bytes.subarray(component.start_byte, component.end_byte);
    if (!Buffer.from(component.text, "utf8").equals(bytes)) throw new Error(`Block component does not match source: ${block.id}`);
    return { start_byte: component.start_byte, end_byte: component.end_byte, role: component.role };
  });
  if (!components.length) throw new Error(`Block has no source components: ${block.id}`);
  const table = block.table
    ? {
        rows: block.table.rows.map((row) => ({
          index: row.index,
          kind: row.kind,
          cells: row.cells.map((cell) => ({ start_byte: cell.start_byte, end_byte: cell.end_byte })),
        })),
      }
    : null;
  return {
    block_id: block.id,
    kind: block.kind,
    map_entry_number: block.map_entry_number,
    ...(includeText ? { text: block.components.map((component) => component.text).join("") } : {}),
    source_range: {
      start_byte: Math.min(...components.map((component) => component.start_byte)),
      end_byte: Math.max(...components.map((component) => component.end_byte)),
    },
    source_components: components,
    table,
    speaker: block.attribution,
  };
}

function sectionLabel(section: LayoutSection) {
  return section.label_components.length
    ? {
        text: section.label_components.map((component) => component.text).join(""),
        components: section.label_components.map((component) => ({ ...component })),
      }
    : null;
}

function componentReferences(source: CapturedSource, components: Component[]) {
  return components.map((component) => {
    const bytes = source.bytes.subarray(component.start_byte, component.end_byte);
    if (!Buffer.from(component.text, "utf8").equals(bytes)) throw new Error("Section component differs from source bytes");
    return { start_byte: component.start_byte, end_byte: component.end_byte, role: component.role };
  });
}

function sectionLabelReference(source: CapturedSource, section: LayoutSection) {
  return section.label_components.length
    ? {
        text: section.label_components.map((component) => component.text).join(""),
        components: componentReferences(source, section.label_components),
      }
    : null;
}

function sectionEvidencePayload(
  source: CapturedSource,
  section: LayoutSection,
  blocks: LayoutBlock[],
  kind: string,
  limits: { start_byte: number; end_byte: number },
  compact: boolean,
  sectionId = section.id,
) {
  return {
    section_id: sectionId,
    kind,
    label: compact ? sectionLabelReference(source, section) : sectionLabel(section),
    limits,
    ...(compact ? { source_text_reference: { field: "complete_source", offset_unit: "utf8_byte" } } : {}),
    blocks: blocks.map((block) => blockPayload(source, block, !compact)),
    notes: kind === "found" ? [] : compact ? componentReferences(source, section.notes) : section.notes.map((component) => ({ ...component })),
    images: kind === "found" ? [] : compact ? componentReferences(source, section.images) : section.images.map((component) => ({ ...component })),
    context: kind === "found" ? [] : compact ? componentReferences(source, section.context) : section.context.map((component) => ({ ...component })),
  };
}

export function sectionPayload(source: CapturedSource, layout: BuiltLayout, section: LayoutSection, kind = section.kind, compact = false) {
  const blocks = section.block_ids.map((id) => layout.blocks.find((block) => block.id === id)!).filter(Boolean);
  return sectionEvidencePayload(source, section, blocks, kind, { start_byte: section.start_byte, end_byte: section.end_byte }, compact);
}

function foundSectionPayload(source: CapturedSource, layout: BuiltLayout, section: LayoutSection, found: FoundSection, compact: boolean) {
  const blocks = found.block_ids.map((id) => layout.blocks.find((block) => block.id === id)!).filter(Boolean);
  return sectionEvidencePayload(source, section, blocks, "found", { start_byte: found.start_byte, end_byte: found.end_byte }, compact, found.found_section_id);
}

function sectionQuestion(
  source: CapturedSource,
  entity: ReturnType<typeof entityQuestionInput>,
  id: string,
  fullSection: ReturnType<typeof sectionPayload>,
  compactSection: ReturnType<typeof sectionPayload>,
  inputLimit: number,
) {
  const full = questions.sectionSubject({ id, target: { entity, section: fullSection } });
  const fullRequest = buildDecisionRequest({ source, questions: [full], targetMode: "single" });
  if (Buffer.byteLength(JSON.stringify(fullRequest)) + 2048 <= inputLimit) return full;
  return questions.sectionSubject({ id, target: { entity, section: compactSection } });
}

function nearbyBlocks(source: CapturedSource, layout: BuiltLayout, block: LayoutBlock) {
  const section = layout.sections.find((entry) => entry.id === block.section_id)!;
  const index = section.block_ids.indexOf(block.id);
  const previous = index > 0 ? layout.blocks.find((entry) => entry.id === section.block_ids[index - 1]) : undefined;
  const next = index >= 0 ? layout.blocks.find((entry) => entry.id === section.block_ids[index + 1]) : undefined;
  return [previous ? blockPayload(source, previous) : null, next ? blockPayload(source, next) : null];
}

export function planInitialAssociationQuestions(input: {
  source: CapturedSource;
  layout: BuiltLayout;
  entities: LocalEntity[];
  mentions: MentionRecord[];
  includeOriginNotes: boolean;
}) {
  const questionsPlanned: questions.PreparedQuestion[] = [];
  const blockSubjectLedger: Array<{
    question_id: string;
    local_entity_id: string;
    block_id: string;
    section_id: string;
    literal_mention_ids: string[];
    no_literal_hit: boolean;
  }> = [];
  for (const entity of input.entities) {
    const entityInput = entityQuestionInput(entity);
    for (const block of input.layout.blocks) {
      const id = associationQuestionId("blockSubject", entity.local_entity_id, block.id);
      const section = input.layout.sections.find((entry) => entry.id === block.section_id)!;
      const label = sectionLabel(section);
      const mentionIds = input.mentions
        .filter((mention) => mention.block_id === block.id && mention.interpretations.some((entry) => entry.local_entity_id === entity.local_entity_id))
        .map((mention) => mention.mention_id);
      questionsPlanned.push(
        questions.blockSubject({
          id,
          target: {
            entity: entityInput,
            block: blockPayload(input.source, block),
            section_label: label,
            nearby_blocks: nearbyBlocks(input.source, input.layout, block),
          },
        }),
      );
      blockSubjectLedger.push({
        question_id: id,
        local_entity_id: entity.local_entity_id,
        block_id: block.id,
        section_id: block.section_id,
        literal_mention_ids: mentionIds,
        no_literal_hit: mentionIds.length === 0,
      });
    }
    questionsPlanned.push(
      questions.documentSubject({
        id: associationQuestionId("documentSubject", entity.local_entity_id),
        target: { entity: entityInput },
      }),
    );
  }
  if (input.includeOriginNotes) {
    for (const block of input.layout.blocks) {
      const section = input.layout.sections.find((entry) => entry.id === block.section_id)!;
      const notes = section.notes;
      const target = {
        block: blockPayload(input.source, block),
        nearby_blocks: nearbyBlocks(input.source, input.layout, block),
        ...(notes.length ? { source_note: notes.map((note) => ({ ...note })) } : {}),
      };
      questionsPlanned.push(questions.textOrigin({ id: associationQuestionId("textOrigin", block.id), target }));
    }
  }
  return { questions: questionsPlanned, blockSubjectLedger };
}

export type ContinuationTarget = { local_entity_id: string; previous_block_id: string; block_id: string };

export function planContinuationQuestions(source: CapturedSource, layout: BuiltLayout, entities: LocalEntity[], targets: ContinuationTarget[]) {
  const entityById = new Map(entities.map((entity) => [entity.local_entity_id, entity]));
  const questionsPlanned: questions.PreparedQuestion[] = [];
  for (const target of targets) {
    const entity = entityById.get(target.local_entity_id);
    const previous = layout.blocks.find((block) => block.id === target.previous_block_id);
    const block = layout.blocks.find((entry) => entry.id === target.block_id);
    if (!entity || !previous || !block || previous.section_id !== block.section_id)
      throw new Error("subjectContinuation continuation target crosses a missing or different section");
    const section = layout.sections.find((entry) => entry.id === block.section_id)!;
    questionsPlanned.push(
      questions.subjectContinuation({
        id: associationQuestionId("subjectContinuation", entity.local_entity_id, previous.id, block.id),
        target: {
          entity: entityQuestionInput(entity),
          previous_block: blockPayload(source, previous),
          block: blockPayload(source, block),
          section_limits: {
            section_id: section.id,
            start_byte: section.start_byte,
            end_byte: section.end_byte,
            label: sectionLabel(section),
          },
        },
      }),
    );
  }
  return questionsPlanned;
}

export function planSectionQuestions(source: CapturedSource, layout: BuiltLayout, entities: LocalEntity[], foundSections: FoundSection[], inputLimit = 32_000) {
  const entityById = new Map(entities.map((entity) => [entity.local_entity_id, entity]));
  const planned: Array<{
    question: questions.PreparedQuestion;
    scope: "section" | "found_section";
    targetId: string;
    localEntityId: string;
    blockIds: string[];
  }> = [];
  for (const entity of entities) {
    for (const section of layout.sections.filter((entry) => entry.kind === "labelled")) {
      const id = associationQuestionId("sectionSubject", entity.local_entity_id, "labelled", section.id);
      planned.push({
        question: sectionQuestion(
          source,
          entityQuestionInput(entity),
          id,
          sectionPayload(source, layout, section),
          sectionPayload(source, layout, section, section.kind, true),
          inputLimit,
        ),
        scope: "section",
        targetId: section.id,
        localEntityId: entity.local_entity_id,
        blockIds: [...section.block_ids],
      });
    }
  }
  for (const found of foundSections) {
    const entity = entityById.get(found.local_entity_id);
    const section = layout.sections.find((entry) => entry.id === found.section_id);
    if (!entity || !section) throw new Error("Found section lost its entity or source section");
    const id = associationQuestionId("sectionSubject", entity.local_entity_id, "found", found.found_section_id);
    planned.push({
      question: sectionQuestion(
        source,
        entityQuestionInput(entity),
        id,
        foundSectionPayload(source, layout, section, found, false),
        foundSectionPayload(source, layout, section, found, true),
        inputLimit,
      ),
      scope: "found_section",
      targetId: found.found_section_id,
      localEntityId: entity.local_entity_id,
      blockIds: [...found.block_ids],
    });
  }
  return planned;
}

function positive(record: DecisionRecord | undefined): boolean {
  return Boolean(record && record.action.label === "yes" && ["supported", "provisional"].includes(record.action.status));
}

export function nextContinuationFrontier(
  layout: BuiltLayout,
  entities: LocalEntity[],
  blockSubject: DecisionRecord[],
  subjectContinuation: DecisionRecord[],
): ContinuationTarget[] {
  const subjectContinuationById = new Map(subjectContinuation.map((record) => [record.question_id, record]));
  const visited = new Set(subjectContinuation.map((record) => record.question_id));
  const entityIds = new Set(entities.map((entity) => entity.local_entity_id));
  const next: ContinuationTarget[] = [];
  const seen = new Set<string>();
  for (const subject of blockSubject) {
    const target = subject.target;
    const entity = (target.entity as { local_entity_id?: string } | undefined)?.local_entity_id;
    const block = (target.block as { block_id?: string } | undefined)?.block_id;
    if (!entity || !block || !entityIds.has(entity) || !positive(subject)) continue;
    const section = layout.sections.find((entry) => entry.block_ids.includes(block));
    const index = section?.block_ids.indexOf(block) ?? -1;
    if (!section || index < 0 || index + 1 >= section.block_ids.length) continue;
    const adjacent = { local_entity_id: entity, previous_block_id: block, block_id: section.block_ids[index + 1]! };
    const id = associationQuestionId("subjectContinuation", adjacent.local_entity_id, adjacent.previous_block_id, adjacent.block_id);
    if (!visited.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(adjacent);
    }
  }
  for (const record of subjectContinuation) {
    if (!positive(record)) continue;
    const target = record.target;
    const entity = (target.entity as { local_entity_id?: string } | undefined)?.local_entity_id;
    const block = (target.block as { block_id?: string } | undefined)?.block_id;
    if (!entity || !block || !entityIds.has(entity)) continue;
    const section = layout.sections.find((entry) => entry.block_ids.includes(block));
    const index = section?.block_ids.indexOf(block) ?? -1;
    if (!section || index < 0 || index + 1 >= section.block_ids.length) continue;
    const adjacent = { local_entity_id: entity, previous_block_id: block, block_id: section.block_ids[index + 1]! };
    const id = associationQuestionId("subjectContinuation", adjacent.local_entity_id, adjacent.previous_block_id, adjacent.block_id);
    if (!visited.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(adjacent);
    }
  }
  return next;
}

export function planMeaningQuestions(source: CapturedSource, layout: BuiltLayout, entities: LocalEntity[], mentions: MentionRecord[], blockSubject: DecisionRecord[]) {
  const entityById = new Map(entities.map((entity) => [entity.local_entity_id, entity]));
  const planned: questions.PreparedQuestion[] = [];
  for (const decision of blockSubject) {
    if (!positive(decision)) continue;
    const target = decision.target;
    const entityId = (target.entity as { local_entity_id?: string } | undefined)?.local_entity_id;
    const blockId = (target.block as { block_id?: string } | undefined)?.block_id;
    const entity = entityId ? entityById.get(entityId) : undefined;
    const block = blockId ? layout.blocks.find((entry) => entry.id === blockId) : undefined;
    if (!entity || !block) continue;
    const section = layout.sections.find((entry) => entry.id === block.section_id)!;
    const relevant = mentions.filter((mention) => mention.block_id === block.id && mention.interpretations.some((entry) => entry.local_entity_id === entity.local_entity_id));
    const passages = relevant.length
      ? relevant.map((mention) => ({
          passage_id: mention.mention_id,
          mention,
          basis: "literal_mention" as const,
        }))
      : [
          {
            passage_id: associationQuestionId("passageMeaning", entity.local_entity_id, block.id, "pronoun-only"),
            mention: null,
            basis: "supported_pronoun_only" as const,
          },
        ];
    for (const passage of passages) {
      const index = section.block_ids.indexOf(block.id);
      const previous = index > 0 ? layout.blocks.find((entry) => entry.id === section.block_ids[index - 1]) : undefined;
      const next = index >= 0 ? layout.blocks.find((entry) => entry.id === section.block_ids[index + 1]) : undefined;
      const payload = {
        block: blockPayload(source, block),
        basis: passage.basis,
        occurrence: passage.mention
          ? {
              ...passage.mention.source_span,
              table_context: passage.mention.table_context,
              quote_context: passage.mention.quote_context,
            }
          : null,
        block_subject_question_id: decision.question_id,
      };
      const target = {
        entity: entityQuestionInput(entity),
        passage: payload,
        nearby_text: [previous ? blockPayload(source, previous) : null, next ? blockPayload(source, next) : null],
        passage_id: passage.passage_id,
        ...(block.attribution ? { speaker: block.attribution } : {}),
      };
      planned.push(
        questions.passageMeaning({
          id: associationQuestionId("passageMeaning", entity.local_entity_id, passage.passage_id),
          target,
        }),
      );
    }
  }
  return planned;
}

export function componentText(components: Component[]): string {
  return components.map((component) => component.text).join("");
}
