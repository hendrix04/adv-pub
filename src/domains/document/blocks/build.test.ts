import assert from "node:assert/strict";
import test from "node:test";
import { decodeCapturedSource } from "../discovery/source.js";
import { questionId } from "./plan.js";
import { readMarkdown } from "./read.js";
import { buildBlocks } from "./build.js";
import type { StructureAction, StructureActions } from "./types.js";

function build(text: string, actions: StructureActions = {}, includeProvisional = false) {
  const source = decodeCapturedSource(Buffer.from(text, "utf8"));
  const parsed = readMarkdown(source);
  return { source, parsed, layout: buildBlocks({ source, parsed, actions, includeProvisional }) };
}

const action = (status: StructureAction["status"], label: string | null, findings: string[] = []): StructureAction => ({
  status,
  label,
  findings,
});

test("consecutive labels and final label-only sections stay visible, with source-local blocks", () => {
  const { layout } = build("Preamble.\n\n---\n\n# Start\n## Alias\n\nBody.\n\n---\n\n### Empty end\n");
  assert.equal(layout.sections.length, 3);
  assert.deepEqual(
    layout.sections.map((section) => section.kind),
    ["unlabelled", "labelled", "labelled"],
  );
  assert.equal(layout.sections[0]?.block_ids.length, 1);
  assert.equal(layout.sections[1]?.label_components.length, 2);
  assert.equal(layout.sections[1]?.block_ids.length, 1);
  assert.equal(layout.sections[2]?.block_ids.length, 0);
});

test("listIntroduction joins a supported introduction with a normal list and preserves the original separator", () => {
  const text = "Origins include:\n\n1. first\n2. second";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const intro = parsed.items.find((item) => item.kind === "paragraph")!;
  const actions = { [questionId("listIntroduction", intro.id)]: action("supported", "yes") };
  const layout = buildBlocks({ source, parsed, actions });
  assert.equal(layout.blocks.length, 1);
  assert.equal(layout.blocks[0]?.kind, "list");
  assert.deepEqual(layout.blocks[0]?.item_ids, [intro.id, parsed.items.find((item) => item.kind === "list")!.id]);
  assert.equal(layout.blocks[0]?.components.map((component) => component.text).join(""), text);
  const fallback = build(text).layout;
  assert.deepEqual(
    fallback.blocks.map((block) => block.kind),
    ["paragraph", "list"],
  );
});

test("mapLabels splits only a confirmed map key into numbered whole-entry blocks and one proposal per entry", () => {
  const text = "# Winterhaven\n<!-- labels on map -->\n![Map](winterhaven.png)\n\n2. **Wrafton's Inn** serves travelers.\n3. The temple stands north.";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const list = parsed.items.find((item) => item.kind === "list")!;
  const question = questionId("mapLabels", list.id);
  const layout = buildBlocks({ source, parsed, actions: { [question]: action("supported", "yes") } });
  assert.deepEqual(
    layout.blocks.map((block) => block.map_entry_number),
    ["2", "3"],
  );
  assert.equal(layout.map_keys.length, 1);
  assert.equal(layout.map_keys[0]?.image?.text, "![Map](winterhaven.png)");
  assert.equal(layout.place_proposals.length, 2);
  assert.equal(layout.place_proposals[0]?.source_names[0], "Wrafton's Inn");
  assert.equal(layout.place_proposals[0]?.naming_basis, "bold");
  assert.equal(layout.place_proposals[1]?.display_label, "Winterhaven, entry 3");
  assert.equal(layout.place_proposals[1]?.qualification_status, "not_run_out_of_scope");
  assert.equal(layout.blocks[1]?.components[0]?.text, "3. The temple stands north.");
});

test("multiple image references in one map paragraph remain separate and unattached", () => {
  const text = "#Winterhaven\n![Local map](local.png) ![Regional map](regional.png)\n\n1. **North Gate**\n2. Market square";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const imageItem = parsed.items.find((item) => item.kind === "image")!;
  const imageReferences = imageItem.image_references!;
  assert.deepEqual(
    imageReferences.map((image) => image.text),
    ["![Local map](local.png)", "![Regional map](regional.png)"],
  );
  const list = parsed.items.find((item) => item.kind === "list")!;
  const layout = buildBlocks({ source, parsed, actions: { [questionId("mapLabels", list.id)]: action("supported", "yes") } });
  assert.equal(layout.sections[0]?.images.length, 2);
  assert.equal(layout.map_keys[0]?.image, null);
  assert.match(layout.map_keys[0]?.findings.join(" ") ?? "", /image attachment is ambiguous/u);
  for (const image of imageReferences) {
    assert.equal(source.bytes.subarray(image.start_byte, image.end_byte).toString("utf8"), image.text);
  }
});

test("hard-break map images stay separate and ambiguous after mapLabels splits its entries", () => {
  const text = "#Map\n![East](east.png)  \n![West](west.png)\n\n1. Inn\n2. Bridge";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const list = parsed.items.find((item) => item.kind === "list")!;
  const layout = buildBlocks({ source, parsed, actions: { [questionId("mapLabels", list.id)]: action("supported", "yes") } });
  assert.deepEqual(
    layout.sections[0]?.images.map((image) => image.text),
    ["![East](east.png)", "![West](west.png)"],
  );
  assert.equal(layout.map_keys[0]?.image, null);
  assert.match(layout.map_keys[0]?.findings.join(" ") ?? "", /image attachment is ambiguous/u);
});

test("repeated written map numbers keep each entry's own bold source name", () => {
  const text = "# Map\n\n2. **East Gate**\n2. **West Gate**\n\n<!-- Both entries identify gates at map marker 2. -->";
  const { parsed, source } = build(text);
  const list = parsed.items.find((item) => item.kind === "list")!;
  const layout = buildBlocks({ source, parsed, actions: { [questionId("mapLabels", list.id)]: action("supported", "yes") } });
  assert.deepEqual(
    layout.blocks.map((block) => block.map_entry_number),
    ["2", "2"],
  );
  assert.deepEqual(
    layout.place_proposals.map((proposal) => proposal.source_names),
    [["East Gate"], ["West Gate"]],
  );
  assert.deepEqual(
    layout.place_proposals.map((proposal) => proposal.display_label),
    ["East Gate", "West Gate"],
  );
});

test("a single reference-style map image defined before its peeled tag attaches", () => {
  const text = "[map]: map.png\n\n#Map\n![Map][map]\n\n1. Inn\n2. Bridge";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const image = parsed.items.find((item) => item.kind === "image");
  const list = parsed.items.find((item) => item.kind === "list")!;
  assert.equal(image?.component.text, "![Map][map]");
  const layout = buildBlocks({ source, parsed, actions: { [questionId("mapLabels", list.id)]: action("supported", "yes") } });
  assert.equal(layout.map_keys[0]?.image?.text, "![Map][map]");
  assert.equal(layout.sections.find((section) => section.id === layout.map_keys[0]?.section_id)?.images.length, 1);
  assert.equal(
    layout.findings.some((finding) => finding.includes("image attachment is ambiguous")),
    false,
  );
});

for (const placement of ["before", "after", "both", "neither", "unclear"] as const) {
  test(`linkPlacement ${placement} keeps neighboring paragraphs separate and retains exact link components`, () => {
    const text = "# Section\n\nprevious block\n\nhttps://example.test/map\n\nnext block\n\nlast block";
    const source = decodeCapturedSource(Buffer.from(text));
    const parsed = readMarkdown(source);
    const link = parsed.items.find((item) => item.kind === "link")!;
    const decision = placement === "unclear" ? action("unresolved", null, ["Answer unclear"]) : action("supported", placement);
    const layout = buildBlocks({ source, parsed, actions: { [questionId("linkPlacement", link.id)]: decision } });
    assert.equal(layout.blocks.length, 3);
    const links = layout.blocks.map((block) => block.components.filter((component) => component.role === "link").length);
    if (placement === "before") assert.deepEqual(links, [1, 0, 0]);
    if (placement === "after") assert.deepEqual(links, [0, 1, 0]);
    if (placement === "both") assert.deepEqual(links, [1, 1, 0]);
    if (placement === "neither") {
      assert.deepEqual(links, [0, 0, 0]);
      assert.ok(layout.sections[0]?.context.some((component) => component.role === "link"));
    }
    if (placement === "unclear") assert.deepEqual(links, [0, 1, 0], "unclear uses a provisional next-block fallback");
    assert.equal(
      layout.blocks[0]?.components.some((component) => component.text.includes("next block")),
      false,
    );
    if (placement === "both") {
      const shared = layout.blocks.slice(0, 2).map((block) => block.components.find((component) => component.role === "link")!);
      assert.equal(shared[0]?.start_byte, shared[1]?.start_byte);
      assert.equal(shared[0]?.end_byte, shared[1]?.end_byte);
    }
  });
}

test("linkPlacement with a missing requested neighbor records a finding and falls back within the section", () => {
  const sourceText = "# Section\n\nhttps://example.test/map\n\nfirst block";
  const source = decodeCapturedSource(Buffer.from(sourceText));
  const parsed = readMarkdown(source);
  const link = parsed.items.find((item) => item.kind === "link")!;
  const layout = buildBlocks({
    source,
    parsed,
    actions: { [questionId("linkPlacement", link.id)]: action("supported", "before") },
  });
  assert.equal(layout.blocks.length, 1);
  assert.ok(layout.blocks[0]?.components.some((component) => component.role === "link"));
  assert.ok(layout.findings.some((finding) => finding.includes("selected linkPlacement neighbor is missing")));
});

test("linkPlacement placements on consecutive links use each block's original neighboring range", () => {
  const text = "# Section\n\nPrevious block.\n\nhttps://example.test/one\n\nhttps://example.test/two\n\nNext block.";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const links = parsed.items.filter((item) => item.kind === "link");
  const layout = buildBlocks({
    source,
    parsed,
    actions: {
      [questionId("linkPlacement", links[0]!.id)]: action("supported", "both"),
      [questionId("linkPlacement", links[1]!.id)]: action("supported", "after"),
    },
  });
  const previous = layout.blocks.find((block) => block.components.some((component) => component.text === "Previous block."))!;
  const next = layout.blocks.find((block) => block.components.some((component) => component.text === "Next block."))!;
  assert.deepEqual(
    previous.components.filter((component) => component.role === "link").map((component) => component.text),
    ["https://example.test/one"],
  );
  assert.deepEqual(
    next.components.filter((component) => component.role === "link").map((component) => component.text),
    ["https://example.test/one", "https://example.test/two"],
  );
  assert.equal(
    layout.findings.some((finding) => finding.includes("selected linkPlacement neighbor is missing")),
    false,
  );
  assert.equal(
    layout.findings.some((finding) => finding.includes("provisional next-block placement fallback")),
    false,
  );
});

test("separate attribution joins a Markdown quote without absorbing unrelated source text", () => {
  const { layout } = build("> Spoken words.\n\n— Aria\n\nAfterward, the door closed.");
  assert.equal(layout.blocks.length, 2);
  assert.equal(layout.blocks[0]?.kind, "quote");
  assert.equal(layout.blocks[0]?.attribution, "Aria");
  assert.equal(layout.blocks[0]?.components.map((component) => component.text).join(""), "> Spoken words.\n\n— Aria");
  assert.equal(
    layout.blocks[0]?.components.some((component) => component.text.includes("Afterward")),
    false,
  );
});

test("a section note stays outside a quote joined with its speaker", () => {
  const { layout } = build("> Spoken words.\n\n<!-- source note -->\n\n— Aria\n\nAfterward.");
  assert.equal(layout.blocks.length, 2);
  assert.equal(layout.blocks[0]?.attribution, "Aria");
  assert.ok(layout.sections[0]?.notes.some((note) => note.text.includes("source note")));
  assert.equal(
    layout.blocks[0]?.components.some((component) => component.text.includes("source note")),
    false,
  );
});

test("paragraph quotes retain inline and separated speakers, and linkPlacement sees the complete quote", async () => {
  const { linkPlacementTargets } = await import("./plan.js");
  const text = '"The gate is sealed."\n— Aria\n\nhttps://example.test/map\n\nThe guards wait.';
  const { source, parsed, layout } = build(text);
  const quote = layout.blocks[0]!;
  assert.equal(quote.kind, "paragraph");
  assert.equal(quote.attribution, "Aria");
  assert.equal(linkPlacementTargets(source, parsed, {})[0]?.target.previous_block, '\"The gate is sealed.\"\n— Aria');
  const sameParagraph = build('"Stay back."\n— Mira').layout.blocks[0]!;
  assert.equal(sameParagraph.attribution, "Mira");
  assert.equal(quote.components.map((component) => component.text).join(""), '\"The gate is sealed.\"\n— Aria');
  assert.equal(layout.blocks.length, 2);
});

test("linkPlacement does not absorb an HTML note or image that lies in the link separator", () => {
  const text = "Before.\n\n<!-- section note -->\n\nhttps://example.test/map\n\n![Map](map.png)\n\nAfter.";
  const source = decodeCapturedSource(Buffer.from(text));
  const parsed = readMarkdown(source);
  const link = parsed.items.find((item) => item.kind === "link")!;
  const layout = buildBlocks({
    source,
    parsed,
    actions: { [questionId("linkPlacement", link.id)]: action("supported", "after") },
  });
  assert.ok(layout.sections[0]?.notes.some((note) => note.text === "<!-- section note -->"));
  assert.ok(layout.sections[0]?.images.some((image) => image.text === "![Map](map.png)"));
  const after = layout.blocks.find((block) => block.components.some((component) => component.text === "After."))!;
  assert.equal(
    after.components.some((component) => component.text.includes("section note") || component.text.includes("![Map]")),
    false,
  );
  assert.equal(after.components.filter((component) => component.role === "link").length, 1);
});

test("a rejected negative decision is retained as rejected without being mislabeled unresolved", () => {
  const text = "**No title**";
  const { parsed } = build(text);
  const title = parsed.items[0]!;
  const question = questionId("title", title.id);
  const rejected = action("rejected", "no");
  const layout = buildBlocks({
    source: decodeCapturedSource(Buffer.from(text)),
    parsed,
    actions: { [question]: rejected },
    decisions: [
      {
        question_id: question,
        action: rejected,
        raw_answer: { choice: "no" },
        repeat_response_reference: "fresh-repeat",
      },
    ],
  });
  assert.equal(layout.decisions[0]?.action.status, "rejected");
  assert.equal(
    layout.findings.some((finding) => finding.includes("decision unresolved")),
    false,
  );
  assert.equal(layout.blocks[0]?.kind, "paragraph");
});
