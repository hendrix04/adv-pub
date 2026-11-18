import assert from "node:assert/strict";
import test from "node:test";
import { decodeCapturedSource } from "../discovery/source.js";
import { buildBlocks } from "./build.js";
import { assembleBlocks, questionId } from "./assembly.js";
import { listIntroductionAndMapLabelsTargets, linkPlacementTargets } from "./plan.js";
import { readMarkdown } from "./read.js";
import type { StructureAction, StructureActions } from "./types.js";

const action = (status: StructureAction["status"]): StructureAction => ({ status, label: "yes", findings: [] });

for (const status of ["supported", "provisional", "rejected", "unresolved"] as const) {
  for (const includeProvisional of [false, true]) {
    test(`planner and builder share ${status} eligibility with provisional=${includeProvisional}`, () => {
      const source = decodeCapturedSource(Buffer.from("**Map title**\n\nPlaces:\n\n2. **East Gate**\n2. **West Gate**\n\nhttps://example.test/map"));
      const parsed = readMarkdown(source);
      const paragraphs = parsed.items.filter((item) => item.kind === "paragraph");
      const list = parsed.items.find((item) => item.kind === "list")!;
      const actions: StructureActions = {
        [questionId("title", paragraphs[0]!.id)]: action(status),
        [questionId("listIntroduction", paragraphs[1]!.id)]: action(status),
        [questionId("mapLabels", list.id)]: action(status),
      };
      const eligible = status === "supported" || (status === "provisional" && includeProvisional);
      const layout = buildBlocks({ source, parsed, actions, includeProvisional });
      assert.equal(listIntroductionAndMapLabelsTargets(source, parsed, actions, includeProvisional).titleLabels.size, Number(eligible));
      assert.equal(layout.sections[0]?.label_components.length, Number(eligible));
      assert.equal(layout.map_keys.length, Number(eligible));
      const expected = eligible ? "2. **West Gate**" : "2. **East Gate**\n2. **West Gate**";
      assert.equal(linkPlacementTargets(source, parsed, actions, includeProvisional)[0]?.target.previous_block, expected);
      const neighbor = layout.blocks.at(-1)!;
      assert.equal(neighbor.components.map((component) => component.text).join(""), expected);
      assert.equal(layout.place_proposals.at(-1)?.source_names[0], eligible ? "West Gate" : undefined);
      const introOnly = { [questionId("listIntroduction", paragraphs[1]!.id)]: action(status) };
      const ordinaryLayout = buildBlocks({ source, parsed, actions: introOnly, includeProvisional });
      const ordinaryTarget = linkPlacementTargets(source, parsed, introOnly, includeProvisional)[0]?.target.previous_block;
      const ordinaryText = ordinaryLayout.blocks
        .at(-1)
        ?.components.map((component) => component.text)
        .join("");
      assert.equal(ordinaryTarget, ordinaryText);
      assert.equal(ordinaryText, `${eligible ? "Places:\n\n" : ""}2. **East Gate**\n2. **West Gate**`);
    });
  }
}

test("linkPlacement neighbors and final components agree for joined introduction and gapped quote attribution", () => {
  const source = decodeCapturedSource(
    Buffer.from(
      "Origins:\r\n\r\n1. First\r\n2. Second\r\n\r\nhttps://example.test/origins\r\n\r\n> Spoken words.\r\n\r\n<!-- quote source -->\r\n\r\n![Portrait](aria.png)\r\n\r\n— Aria\r\n\r\nhttps://example.test/quote",
    ),
  );
  const parsed = readMarkdown(source);
  const intro = parsed.items[0]!;
  const actions = { [questionId("listIntroduction", intro.id)]: action("supported") };
  const targets = linkPlacementTargets(source, parsed, actions);
  const assembled = assembleBlocks(source, parsed.items, actions, false);
  const layout = buildBlocks({ source, parsed, actions });
  const text = (index: number) => assembled.blocks[index]!.components.map((component) => component.text).join("");
  assert.equal(targets[0]?.target.previous_block, text(0));
  assert.equal(targets[0]?.target.next_block, text(1));
  assert.equal(targets[1]?.target.previous_block, text(1));
  assert.equal(text(1), "> Spoken words.— Aria");
  assert.equal(layout.sections[0]?.notes.length, 1);
  assert.equal(layout.sections[0]?.images.length, 1);
  assert.equal(
    assembled.blocks[1]?.components.some((component) => component.text.includes("quote source") || component.text.includes("Portrait")),
    false,
  );
  for (const block of assembled.blocks) {
    for (const component of block.components) assert.equal(source.bytes.subarray(component.start_byte, component.end_byte).toString("utf8"), component.text);
  }
  assert.equal(Object.isFrozen(assembled.blocks), true);
  assert.equal(Object.isFrozen(assembled.blocks[1]?.components), true);
  assert.equal(assembled.blocks[1]?.components.length, 2, "builder's link fallback cannot mutate pre-link components");
  assert.equal(
    layout.blocks[1]?.components.some((component) => component.role === "link"),
    true,
  );
});

test("a separate speaker preserves the quote's source-local ID and extends its immutable neighbor range", () => {
  const before = decodeCapturedSource(Buffer.from("> Spoken words.\n\n— Aria\n\nhttps://example.test"));
  const parsed = readMarkdown(before);
  const assembled = assembleBlocks(before, parsed.items, {}, false);
  const quote = assembled.blocks[0]!;
  assert.deepEqual(quote.origin.item_ids, [parsed.items[0]!.id]);
  assert.deepEqual(quote.item_ids, [parsed.items[0]!.id, parsed.items[1]!.id]);
  assert.equal(quote.origin.end, parsed.items[0]?.component.end_byte);
  assert.equal(quote.range.end, parsed.items[1]?.component.end_byte);
});
