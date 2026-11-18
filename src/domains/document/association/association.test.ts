import assert from "node:assert/strict";
import test from "node:test";
import { decodeCapturedSource } from "../discovery/source.js";
import type { BuiltLayout, Component, LayoutBlock, LayoutSection } from "../blocks/types.js";
import type { DecisionRecord, LocalEntity, MentionRecord } from "./types.js";
import { buildDecisionRequest } from "../decisions/request.js";
import { findEntityMentions } from "./mentions.js";
import { associationQuestionId, planInitialAssociationQuestions, planMeaningQuestions, planSectionQuestions, nextContinuationFrontier } from "./planning.js";
import { buildAssociationLinks, buildFoundSections, assembleEntityContexts, renderEntityContextView } from "./context.js";

function sourceComponent(source: ReturnType<typeof decodeCapturedSource>, text: string, role = "text", from = 0): Component {
  const start = source.text.indexOf(text, from);
  assert.notEqual(start, -1, `Missing fixture text: ${text}`);
  const startByte = Buffer.byteLength(source.text.slice(0, start), "utf8");
  const endByte = startByte + Buffer.byteLength(text, "utf8");
  return { start_byte: startByte, end_byte: endByte, text, role };
}

function localEntity(id: string, names: string[], candidateIds = names.map((_, index) => `${id}-candidate-${index}`)): LocalEntity {
  return {
    contract_version: "source-local-entity-v1",
    local_entity_id: id,
    document_id: "test",
    source_sha256: "a".repeat(64),
    source_candidate_ids: candidateIds,
    supported_names: names,
    aliases: [],
    type: "Creature",
    source_descriptor: null,
    qualification_decision_id: `${id}-qualification`,
    type_decision_id: `${id}-type`,
    evidence: [],
    place_proposal_ids: [],
    canonical_status: "source_local_only",
  };
}

function layout(
  source: ReturnType<typeof decodeCapturedSource>,
  sectionBlocks: Array<{
    id: string;
    blocks: Array<{
      id: string;
      text: string;
      kind?: LayoutBlock["kind"];
      attribution?: string | null;
      table?: LayoutBlock["table"];
    }>;
  }>,
): BuiltLayout {
  const sections: LayoutSection[] = [];
  const blocks: LayoutBlock[] = [];
  for (const [sectionIndex, sectionDef] of sectionBlocks.entries()) {
    const sectionId = sectionDef.id;
    const sectionLocal: LayoutBlock[] = sectionDef.blocks.map((blockDef) => {
      const component = sourceComponent(source, blockDef.text);
      const block: LayoutBlock = {
        id: blockDef.id,
        kind: blockDef.kind ?? "paragraph",
        section_id: sectionId,
        item_ids: [blockDef.id],
        components: [component],
        map_entry_number: null,
        table: blockDef.table ?? null,
        attribution: blockDef.attribution ?? null,
      };
      blocks.push(block);
      return block;
    });
    const first = sectionLocal[0]?.components[0];
    const last = sectionLocal.at(-1)?.components.at(-1);
    sections.push({
      id: sectionId,
      kind: "unlabelled",
      label_components: [],
      block_ids: sectionLocal.map((block) => block.id),
      notes: [],
      images: [],
      context: [],
      start_byte: first?.start_byte ?? 0,
      end_byte: last?.end_byte ?? 0,
    });
    assert.ok(sectionIndex >= 0);
  }
  return {
    contract_version: "lore-block-layout-v1",
    capability_status: "complete",
    full_product_status: "not_run",
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    items: [],
    sections,
    blocks,
    map_keys: [],
    place_proposals: [],
    decisions: [],
    findings: [],
  };
}

function decision(
  questionId: string,
  kind: string,
  entityId: string,
  blockId?: string,
  previousBlockId?: string,
  status: DecisionRecord["action"]["status"] = "supported",
): DecisionRecord {
  const entity = { local_entity_id: entityId };
  const block = blockId ? { block_id: blockId } : undefined;
  const previous_block = previousBlockId ? { block_id: previousBlockId } : undefined;
  return {
    contract_version: "decision-questions-v2",
    question_id: questionId,
    target_id: questionId,
    target: { entity, ...(block ? { block } : {}), ...(previous_block ? { previous_block } : {}) },
    question_kind: kind,
    raw_answer: { type: "noul", noul: 1 },
    action: {
      status,
      label: status === "supported" ? "yes" : null,
      policy_version: "test",
      policy_sha256: "b".repeat(64),
      findings: [],
    },
    raw_response_reference: "response.json",
    source_sha256: "a".repeat(64),
    upstream_hashes: {},
  };
}

test("mention matching prefers longer names, keeps same-span interpretations, respects word boundaries, and emits UTF-8 byte spans", () => {
  const source = decodeCapturedSource(Buffer.from("é before Elder Serpent; Serpentine; Serpent."));
  const fullText = sourceComponent(source, source.text);
  const layoutInput = layout(source, [{ id: "s1", blocks: [{ id: "b1", text: source.text }] }]);
  layoutInput.blocks[0]!.components = [fullText];
  const mentions = findEntityMentions(source, layoutInput, [
    localEntity("elder", ["Elder Serpent", "Serpent"], ["elder-long", "elder-short"]),
    localEntity("other-elder", ["Elder Serpent"], ["other-source"]),
  ]);
  assert.deepEqual(
    mentions.map((mention) => mention.source_span.text),
    ["Elder Serpent", "Serpent"],
  );
  assert.deepEqual(
    mentions[0]?.interpretations.map((item) => item.local_entity_id),
    ["elder", "other-elder"],
  );
  assert.deepEqual(mentions[0]?.interpretations[0]?.source_candidate_ids, ["elder-long"]);
  assert.equal(mentions[0]?.source_span.start_byte, Buffer.byteLength("é before ", "utf8"));
  for (const mention of mentions)
    assert.deepEqual(source.bytes.subarray(mention.source_span.start_byte, mention.source_span.end_byte), Buffer.from(mention.source_span.text, "utf8"));
});

test("table mentions retain cell, header, whole-row, and quote-source context", () => {
  const text = "| Name | Notes |\n| --- | --- |\n| Éowyn | captain |\n\n> Éowyn spoke.";
  const source = decodeCapturedSource(Buffer.from(text));
  const tableStart = text.indexOf("| Name");
  const tableEnd = text.indexOf("\n\n>");
  const wholeTable = sourceComponent(source, text.slice(tableStart, tableEnd), "table", tableStart);
  const nameCell = sourceComponent(source, "Name");
  const eowynCell = sourceComponent(source, "Éowyn");
  const notesCell = sourceComponent(source, "Notes");
  const captainCell = sourceComponent(source, "captain");
  const tableEvidence = {
    rows: [
      { index: 0, kind: "header" as const, cells: [nameCell, notesCell] },
      { index: 1, kind: "body" as const, cells: [eowynCell, captainCell] },
    ],
  };
  const quote = sourceComponent(source, "> Éowyn spoke.", "quote");
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "table", text: wholeTable.text, kind: "table", table: tableEvidence },
        { id: "quote", text: quote.text, kind: "quote", attribution: "Aria" },
      ],
    },
  ]);
  layoutInput.blocks[0]!.components = [wholeTable];
  layoutInput.blocks[1]!.components = [quote];
  const mentions = findEntityMentions(source, layoutInput, [localEntity("eowyn", ["Éowyn"])]);
  const inTable = mentions.find((mention) => mention.block_id === "table")!;
  const inQuote = mentions.find((mention) => mention.block_id === "quote")!;
  assert.equal(inTable.table_context?.cell.text, "Éowyn");
  assert.equal(inTable.table_context?.header?.text, "Name");
  assert.equal(inTable.table_context?.whole_row.text, "| Éowyn | captain |");
  assert.equal(inQuote.quote_context?.speaker, "Aria");
  assert.deepEqual(inQuote.quote_context?.block_components, [quote]);
  const planned = planInitialAssociationQuestions({
    source,
    layout: layoutInput,
    entities: [localEntity("eowyn", ["Éowyn"])],
    mentions,
    includeOriginNotes: false,
  });
  const blockSubject = planned.questions.find((question) => question.descriptor.question_kind === "blockSubject")!;
  const blockTarget = blockSubject.target.block as {
    text: string;
    source_range: { start_byte: number; end_byte: number };
    source_components: Array<Record<string, unknown>>;
    table: { rows: Array<{ cells: Array<Record<string, unknown>> }> };
  };
  assert.equal(blockTarget.text, wholeTable.text);
  assert.equal(blockTarget.source_range.start_byte, wholeTable.start_byte);
  assert.equal(blockTarget.source_components[0]?.text, undefined, "wire components do not repeat text already present in complete_source and block.text");
  assert.equal(blockTarget.table.rows[1]?.cells[0]?.text, undefined);
  assert.equal(source.bytes.subarray(blockTarget.table.rows[1]!.cells[0]!.start_byte as number, blockTarget.table.rows[1]!.cells[0]!.end_byte as number).toString("utf8"), "Éowyn");
});

test("initial planning covers every entity/block pair, one document question per entity, and every block origin note", () => {
  const source = decodeCapturedSource(Buffer.from("First block.\n\nSecond block."));
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "b1", text: "First block." },
        { id: "b2", text: "Second block." },
      ],
    },
  ]);
  const entities = [localEntity("e1", ["First"]), localEntity("e2", ["Second"])];
  const planned = planInitialAssociationQuestions({
    source,
    layout: layoutInput,
    entities,
    mentions: [],
    includeOriginNotes: true,
  });
  assert.equal(planned.blockSubjectLedger.length, 4);
  assert.equal(new Set(planned.blockSubjectLedger.map((target) => `${target.local_entity_id}:${target.block_id}`)).size, 4);
  assert.ok(planned.blockSubjectLedger.every((target) => target.no_literal_hit));
  assert.equal(planned.questions.filter((question) => question.descriptor.question_kind === "blockSubject").length, 4);
  assert.equal(planned.questions.filter((question) => question.descriptor.question_kind === "documentSubject").length, 2);
  assert.equal(planned.questions.filter((question) => question.descriptor.question_kind === "textOrigin").length, 2);
});

test("meaning planning asks per supported literal occurrence and adds a pronoun-only passage without filtering origin questions", () => {
  const source = decodeCapturedSource(Buffer.from("A meets A.\n\nB."));
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "b1", text: "A meets A." },
        { id: "b2", text: "B." },
      ],
    },
  ]);
  const entities = [localEntity("a", ["A"]), localEntity("b", ["B"])];
  const blockSubject = [decision("a-b1", "blockSubject", "a", "b1"), decision("a-b2", "blockSubject", "a", "b2"), decision("b-b2", "blockSubject", "b", "b2")];
  const mention = (id: string, entityId: string, text: string, blockId: string, startAt: number): MentionRecord => {
    const span = sourceComponent(source, text, "entity_mention", startAt);
    return {
      contract_version: "source-entity-mention-v1",
      mention_id: id,
      source_span: span,
      interpretations: [{ local_entity_id: entityId, matched_name: text, source_candidate_ids: [`${entityId}-candidate-0`] }],
      source_candidate_ids: [`${entityId}-candidate-0`],
      block_id: blockId,
      section_id: "s1",
      label_id: null,
      table_context: null,
      quote_context: null,
    };
  };
  const mentions = [mention("a-1", "a", "A", "b1", 0), mention("a-2", "a", "A", "b1", source.text.indexOf("A", 1)), mention("b-1", "b", "B", "b2", 0)];
  const planned = planMeaningQuestions(source, layoutInput, entities, mentions, blockSubject);
  assert.equal(planned.length, 4);
  assert.equal(planned.filter((question) => (question.target.passage as { basis: string }).basis === "literal_mention").length, 3);
  assert.equal(planned.filter((question) => (question.target.passage as { basis: string }).basis === "supported_pronoun_only").length, 1);
});

test("sectionSubject keeps whole-section evidence as exact references into the complete source", () => {
  const body = `The Elder Dragon returns. ${"The campaign remembers a dragon. ".repeat(700)}`;
  const tableText = "| Name | Lore |\n| --- | --- |\n| Tiamat | Dragon |";
  const source = decodeCapturedSource(Buffer.from(`## Factions\n\n${body}\n\n${tableText}\n\nA copied note.`));
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "b1", text: body },
        {
          id: "table",
          kind: "table",
          text: tableText,
          table: {
            rows: [
              { index: 0, kind: "header", cells: [sourceComponent(source, "Name"), sourceComponent(source, "Lore")] },
              { index: 1, kind: "body", cells: [sourceComponent(source, "Tiamat"), sourceComponent(source, "Dragon")] },
            ],
          },
        },
        { id: "b2", text: "A copied note." },
      ],
    },
  ]);
  const section = layoutInput.sections[0]!;
  section.kind = "labelled";
  section.label_components = [sourceComponent(source, "## Factions\n", "label")];
  section.notes = [sourceComponent(source, "A copied note.", "note")];

  const entity = localEntity("e1", ["Elder Dragon"]);
  const blockSubject = [decision("seed", "blockSubject", "e1", "b1")];
  const subjectContinuation = [decision("follow", "subjectContinuation", "e1", "table", "b1")];
  const found = buildFoundSections(layoutInput, [entity], blockSubject, subjectContinuation);
  const plannedQuestions = planSectionQuestions(source, layoutInput, [entity], found);
  const planned = plannedQuestions[0]!;
  const target = planned.question.target.section as {
    limits: { start_byte: number; end_byte: number };
    source_text_reference: { field: string; offset_unit: string };
    label: { text: string; components: Array<{ start_byte: number; end_byte: number; role: string }> };
    blocks: Array<{
      block_id: string;
      source_components: Array<{ start_byte: number; end_byte: number; role: string }>;
      table: {
        rows: Array<{ index: number; kind: string; cells: Array<{ start_byte: number; end_byte: number }> }>;
      } | null;
      text?: string;
    }>;
    notes: Array<{ start_byte: number; end_byte: number; role: string }>;
  };

  assert.deepEqual(target.source_text_reference, { field: "complete_source", offset_unit: "utf8_byte" });
  assert.equal(source.bytes.subarray(target.limits.start_byte, target.limits.end_byte).toString("utf8"), `${body}\n\n${tableText}\n\nA copied note.`);
  assert.equal(target.label.text, "## Factions\n");
  assert.equal(source.bytes.subarray(target.label.components[0]!.start_byte, target.label.components[0]!.end_byte).toString("utf8"), target.label.text);
  assert.deepEqual(
    target.blocks.map((block) => block.block_id),
    ["b1", "table", "b2"],
  );
  for (const block of target.blocks) {
    assert.equal(block.text, undefined, "sectionSubject does not duplicate block text already present in complete_source");
    const original = layoutInput.blocks.find((entry) => entry.id === block.block_id)!;
    assert.deepEqual(
      block.source_components,
      original.components.map(({ start_byte, end_byte, role }) => ({ start_byte, end_byte, role })),
    );
    for (const [index, component] of block.source_components.entries()) {
      assert.equal(source.bytes.subarray(component.start_byte, component.end_byte).toString("utf8"), original.components[index]!.text);
    }
  }
  assert.deepEqual(
    target.blocks[1]!.table?.rows.map((row) => row.cells.map((cell) => source.bytes.subarray(cell.start_byte, cell.end_byte).toString("utf8"))),
    [
      ["Name", "Lore"],
      ["Tiamat", "Dragon"],
    ],
  );
  assert.equal(source.bytes.subarray(target.notes[0]!.start_byte, target.notes[0]!.end_byte).toString("utf8"), "A copied note.");
  const request = buildDecisionRequest({ source, questions: [planned.question], targetMode: "single" });
  assert.ok(Buffer.byteLength(JSON.stringify(request)) + 2048 <= 32_000);
  const foundPlanned = plannedQuestions.find((entry) => entry.scope === "found_section")!;
  const foundTarget = foundPlanned.question.target.section as { blocks: Array<{ block_id: string; text?: string }> };
  assert.deepEqual(
    foundTarget.blocks.map((block) => block.block_id),
    ["b1", "table"],
  );
  assert.equal(
    foundTarget.blocks.every((block) => block.text === undefined),
    true,
  );
});

test("subjectContinuation traversal and found sections stay entity-specific and stop at a section boundary", () => {
  const source = decodeCapturedSource(Buffer.from("Opening.\n\nContinues.\n\nOther section."));
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "b1", text: "Opening." },
        { id: "b2", text: "Continues." },
      ],
    },
    { id: "s2", blocks: [{ id: "b3", text: "Other section." }] },
  ]);
  const entity = localEntity("e1", ["Opening"]);
  const blockSubject = [decision("seed", "blockSubject", "e1", "b1")];
  const firstFrontier = nextContinuationFrontier(layoutInput, [entity], blockSubject, []);
  assert.deepEqual(firstFrontier, [{ local_entity_id: "e1", previous_block_id: "b1", block_id: "b2" }]);
  const subjectContinuation = [decision(associationQuestionId("subjectContinuation", "e1", "b1", "b2"), "subjectContinuation", "e1", "b2", "b1")];
  assert.deepEqual(nextContinuationFrontier(layoutInput, [entity], blockSubject, subjectContinuation), []);
  const found = buildFoundSections(layoutInput, [entity], blockSubject, subjectContinuation);
  assert.deepEqual(
    found.map((entry) => entry.block_ids),
    [["b1", "b2"]],
  );
  const sectionSubject = planSectionQuestions(source, layoutInput, [entity], found)[0]!;
  const foundTarget = sectionSubject.question.target.section as {
    section_id: string;
    blocks: Array<{ text?: string }>;
    notes: unknown[];
    images: unknown[];
    context: unknown[];
  };
  assert.equal(foundTarget.section_id, found[0]!.found_section_id);
  assert.ok(
    foundTarget.blocks.every((block) => typeof block.text === "string"),
    "small whole-section targets keep their established wire shape",
  );
  assert.deepEqual([foundTarget.notes, foundTarget.images, foundTarget.context], [[], [], []]);
  const links = buildAssociationLinks({
    layout: layoutInput,
    entities: [entity],
    blockAndDocumentSubjectDecisions: [],
    sectionDecisions: [decision(sectionSubject.question.id, "sectionSubject", "e1")],
    sectionQuestionMetadata: [
      {
        question_id: sectionSubject.question.id,
        scope: sectionSubject.scope,
        target_id: sectionSubject.targetId,
        local_entity_id: sectionSubject.localEntityId,
        block_ids: sectionSubject.blockIds,
        provenance_question_ids: [found[0]!.seed_question_id, ...found[0]!.continuation_question_ids],
      },
    ],
  });
  assert.deepEqual(links[0]?.question_ids, ["seed", subjectContinuation[0]!.question_id, sectionSubject.question.id]);
});

test("entity context includes complete supported blocks and ignores rejected links", () => {
  const source = decodeCapturedSource(Buffer.from("Supported whole block.\n\nRejected whole block."));
  const layoutInput = layout(source, [
    {
      id: "s1",
      blocks: [
        { id: "b1", text: "Supported whole block." },
        { id: "b2", text: "Rejected whole block." },
      ],
    },
  ]);
  const entity = localEntity("e1", ["Supported"]);
  const links = [
    {
      contract_version: "source-entity-link-v1" as const,
      link_id: "l1",
      local_entity_id: "e1",
      scope: "block" as const,
      target_id: "b1",
      status: "supported" as const,
      question_ids: ["q1"],
      block_ids: ["b1"],
    },
    {
      contract_version: "source-entity-link-v1" as const,
      link_id: "l2",
      local_entity_id: "e1",
      scope: "block" as const,
      target_id: "b2",
      status: "rejected" as const,
      question_ids: ["q2"],
      block_ids: ["b2"],
    },
  ];
  const contexts = assembleEntityContexts({
    layout: layoutInput,
    entities: [entity],
    mentions: [],
    links,
    meaningNotes: [],
    originNotes: [],
  });
  assert.deepEqual(contexts[0]?.block_ids, ["b1"]);
  assert.equal(contexts[0]?.blocks[0]?.text, "Supported whole block.");
  assert.deepEqual(contexts[0]?.link_ids, ["l1"]);
  const view = renderEntityContextView({ entities: [entity], links, contexts });
  assert.match(view, /Supported whole block\./u);
  assert.match(view, /l1/u);
  assert.doesNotMatch(view, /Rejected whole block\./u);
});
