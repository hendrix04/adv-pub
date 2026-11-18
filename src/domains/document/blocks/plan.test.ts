import assert from "node:assert/strict";
import test from "node:test";
import { decodeCapturedSource } from "../discovery/source.js";
import { titleTargets, listIntroductionAndMapLabelsTargets, linkPlacementTargets } from "./plan.js";
import { readMarkdown } from "./read.js";
import type { StructureActions } from "./types.js";

const provisional = (label: string) => ({ status: "provisional" as const, label, findings: [] });

test("title targets contain a bounded line/following context, then supported yes supplies the next section boundary", () => {
  const source = decodeCapturedSource(Buffer.from("**Title**\n\nLabeled paragraph.\n\n# Next\n\nOther paragraph."));
  const parsed = readMarkdown(source);
  const title = titleTargets(source, parsed);
  assert.equal(title.length, 1);
  assert.equal(title[0]?.target.line, "**Title**");
  assert.match(String(title[0]?.target.following_text), /Labeled paragraph/);
  const actions: StructureActions = { [title[0]!.id]: { ...provisional("yes"), status: "supported" } };
  const targets = listIntroductionAndMapLabelsTargets(source, parsed, actions);
  assert.equal(targets.titleLabels.has(parsed.items[0]!.id), true);
});

test("title retains an emphasized title after leading tag lines are peeled", () => {
  const source = decodeCapturedSource(Buffer.from("#NPC #Location\n**The Keep**\n\nThe road leads north."));
  const parsed = readMarkdown(source);
  const title = parsed.items.find((item) => item.kind === "paragraph")!;
  assert.equal(title.component.text, "**The Keep**");
  assert.equal(title.title_candidate, true);
  assert.equal(titleTargets(source, parsed)[0]?.target.line, "**The Keep**");
});

test("mapLabels plans a sequential list when its peeled section body contains a map image", () => {
  const source = decodeCapturedSource(Buffer.from("#Map\n![Map](map.png)\n\n1. Inn\n2. Bridge"));
  const parsed = readMarkdown(source);
  assert.equal(listIntroductionAndMapLabelsTargets(source, parsed, {}, true).mapLabels.length, 1);
});

test("mapLabels plans a map list when its image-only paragraph separates images with a hard break", () => {
  const source = decodeCapturedSource(Buffer.from("#Map\n![East](east.png)  \n![West](west.png)\n\n1. Inn\n2. Bridge"));
  const parsed = readMarkdown(source);
  assert.equal(listIntroductionAndMapLabelsTargets(source, parsed, {}, true).mapLabels.length, 1);
});

test("listIntroduction/mapLabels targets follow title boundaries and retain nullable map notes and nearby context", () => {
  const source = decodeCapturedSource(Buffer.from("# Area\n**Map title**\n\nPlaces include:\n\n2. The inn.\n5. The bridge.\n"));
  const parsed = readMarkdown(source);
  const title = titleTargets(source, parsed)[0]!;
  const actions: StructureActions = { [title.id]: { ...provisional("yes"), status: "supported" } };
  const targets = listIntroductionAndMapLabelsTargets(source, parsed, actions, true);
  assert.equal(targets.listIntroduction.length, 1);
  assert.equal(targets.mapLabels.length, 1);
  assert.equal(targets.mapLabels[0]?.target.map_notes, null);
  assert.deepEqual(targets.mapLabels[0]?.target.nearby_text, ["Places include:", null]);
  assert.equal(title.target.line, "**Map title**");
  assert.deepEqual(targets.listIntroduction[0]?.target.section_limits, { start_byte: 0, end_byte: source.byteLength });
});

test("linkPlacement names both immediate block neighbors and encodes a missing side as explicit null", () => {
  const source = decodeCapturedSource(Buffer.from("https://example.test\n\nAfter."));
  const parsed = readMarkdown(source);
  const targets = linkPlacementTargets(source, parsed, {});
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.target.previous_block, null);
  assert.equal(targets[0]?.target.next_block, "After.");
});

test("linkPlacement keeps a separate speaker with a blockquote when preparing its previous block", () => {
  const source = decodeCapturedSource(Buffer.from("> Spoken words.\n\n— Aria\n\nhttps://example.test/map\n\nAfter."));
  const parsed = readMarkdown(source);
  const target = linkPlacementTargets(source, parsed, {})[0]?.target;
  assert.equal(target?.previous_block, "> Spoken words.\n\n— Aria");
});

test("linkPlacement keeps a section note out of the joined quote and speaker text", () => {
  const source = decodeCapturedSource(Buffer.from("> Spoken words.\n\n<!-- source note -->\n\n— Aria\n\nhttps://example.test/map"));
  const parsed = readMarkdown(source);
  const target = linkPlacementTargets(source, parsed, {})[0]?.target;
  assert.equal(target?.previous_block, "> Spoken words.— Aria");
  assert.equal(String(target?.previous_block).includes("source note"), false);
});

test("zero-candidate sources produce empty structure stages without invoking the live child", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { runBlocksOperation } = await import("./operation.js");
  const { exploratoryStructurePolicy } = await import("./policy.js");
  const parent = await mkdtemp(join(tmpdir(), "adv-pub-blocks-empty-"));
  let calls = 0;
  try {
    const result = await runBlocksOperation(
      {
        capability: "blocks",
        sourcePath: resolve("Resources/Lore/05-beic-god-of-merchants.md"),
        directory: join(parent, "operation"),
        operationId: "empty-structure-test",
        mode: "new",
        inputLimit: 32_000,
        policy: exploratoryStructurePolicy(),
        repeatId: "structure-repeat-v1",
      },
      async () => {
        calls += 1;
      },
    );
    assert.equal(result.status, "complete");
    assert.equal(calls, 0);
    for (const stage of ["title", "listIntroduction", "mapLabels", "linkPlacement"]) {
      const record = JSON.parse(await (await import("node:fs/promises")).readFile(join(result.directory, "stages", stage, "empty-stage.json"), "utf8"));
      assert.equal(record.question_count, 0);
      assert.equal(record.network_requests, 0);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
