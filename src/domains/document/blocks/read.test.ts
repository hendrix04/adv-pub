import assert from "node:assert/strict";
import test from "node:test";
import { decodeCapturedSource } from "../discovery/source.js";
import { mapKeyCandidateIds, readMarkdown } from "./read.js";

const parse = (text: string) => {
  const source = decodeCapturedSource(Buffer.from(text, "utf8"));
  return { source, parsed: readMarkdown(source) };
};

test("Markdown reading keeps paragraphs, nested lists, and GFM table cells whole with exact UTF-8 evidence", () => {
  const { source, parsed } = parse("# Places\r\n**🚀 A short title**\r\n\r\n- first\r\n  - nested\r\n\r\n| name\\|alias | place |\r\n| --- | --- |\r\n| A\\|B | **C** |\r\n");
  assert.deepEqual(
    parsed.items.map((item) => item.kind),
    ["label", "paragraph", "list", "table"],
  );
  const title = parsed.items[1]!;
  assert.equal(title.title_candidate, true);
  const list = parsed.items[2]!;
  assert.equal(list.component.text, "- first\r\n  - nested");
  assert.equal(list.list_entries.length, 1, "nested list stays inside its parent entry");
  const table = parsed.items[3]!;
  assert.equal(table.table?.rows.length, 2);
  assert.equal(table.table?.rows[0]?.kind, "header");
  assert.equal(table.table?.rows[1]?.cells[0]?.text, "A\\|B");
  for (const item of parsed.items) {
    assert.equal(source.bytes.subarray(item.component.start_byte, item.component.end_byte).toString("utf8"), item.component.text);
  }
  assert.ok(Buffer.byteLength(title.component.text) > title.component.text.length, "non-BMP text uses more UTF-8 bytes than UTF-16 code units");
});

test("tag paragraphs peel all leading tag lines and keep the body as a separate original span", () => {
  const { source, parsed } = parse("#NPC #Location\r\n#Council\r\nThe council meets here.\r\n");
  assert.deepEqual(
    parsed.items.map((item) => item.kind),
    ["label", "label", "paragraph"],
  );
  assert.deepEqual(
    parsed.items.map((item) => item.component.text),
    ["#NPC #Location\r\n", "#Council\r\n", "The council meets here."],
  );
  const joined = parsed.items.map((item) => item.component).sort((a, b) => a.start_byte - b.start_byte);
  assert.equal(joined.map((part) => part.text).join(""), source.bytes.subarray(0, joined.at(-1)!.end_byte).toString("utf8"));
});

test("reader retains front matter, code, quote, attribution, image, note, break, and bare URL records", () => {
  const { parsed } = parse(
    [
      "---",
      "title: Camp",
      "---",
      "",
      "```ts",
      "const x = 1",
      "```",
      "",
      "> quoted words",
      "",
      "— Mara",
      "",
      "<!-- map note -->",
      "![map](map.png)",
      "",
      "---",
      "",
      "https://example.test/map",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    parsed.items.map((item) => item.kind),
    ["meta", "meta", "quote", "paragraph", "note", "image", "break", "link"],
  );
  assert.equal(parsed.items[0]?.ast_type, "yaml");
  assert.equal(parsed.items[1]?.ast_type, "code");
  assert.equal(parsed.items[5]?.component.text, "![map](map.png)");
});

test("image-reference metadata is added only when a paragraph contains multiple images", () => {
  const { parsed } = parse("Text.\n\n![Single](one.png)\n\n![East](east.png) ![West](west.png)");
  const imageItems = parsed.items.filter((item) => item.kind === "image");
  assert.equal(Object.hasOwn(parsed.items[0]!, "image_references"), false);
  assert.equal(Object.hasOwn(imageItems[0]!, "image_references"), false);
  assert.deepEqual(
    imageItems[1]?.image_references?.map((image) => image.text),
    ["![East](east.png)", "![West](west.png)"],
  );
});

test("image-only bodies after peeled tags retain direct and reference-style images", () => {
  const fixtures = [
    {
      text: "#Map\n![East](east.png) ![West](west.png)\n\n1. Inn\n2. Bridge",
      images: ["![East](east.png)", "![West](west.png)"],
    },
    {
      text: "#Map\n![East][e] ![West][w]\n\n1. Inn\n2. Bridge\n\n[e]: east.png\n[w]: west.png",
      images: ["![East][e]", "![West][w]"],
    },
    {
      text: "[e]: east.png\n[w]: west.png\n\n#Map\n![East][e] ![West][w]\n\n1. Inn\n2. Bridge",
      images: ["![East][e]", "![West][w]"],
    },
  ];
  for (const fixture of fixtures) {
    const { source, parsed } = parse(fixture.text);
    const image = parsed.items.find((item) => item.kind === "image");
    const list = parsed.items.find((item) => item.kind === "list")!;
    assert.ok(image);
    assert.deepEqual(
      image.image_references?.map((reference) => reference.text),
      fixture.images,
    );
    assert.ok(mapKeyCandidateIds(parsed).includes(list.id));
    for (const reference of image.image_references ?? []) {
      assert.equal(source.bytes.subarray(reference.start_byte, reference.end_byte).toString("utf8"), reference.text);
    }
  }
});

test("image-only paragraphs keep separate image spans across a Markdown hard break", () => {
  const { source, parsed } = parse("#Map\n![East](east.png)  \n![West](west.png)\n\n1. Inn\n2. Bridge");
  const image = parsed.items.find((item) => item.kind === "image");
  assert.ok(image);
  assert.equal(image.component.text, "![East](east.png)  \n![West](west.png)");
  assert.deepEqual(
    image.image_references?.map((reference) => reference.text),
    ["![East](east.png)", "![West](west.png)"],
  );
  for (const reference of image.image_references ?? []) {
    assert.equal(source.bytes.subarray(reference.start_byte, reference.end_byte).toString("utf8"), reference.text);
  }
});

test("map candidate selection flags nonsequential ordered lists and map notes but ignores a plain 1..n list", () => {
  const { parsed } = parse("# Plain\n\n1. one\n2. two\n\n# Map\n<!-- labels -->\n\n1. one\n2. two\n\n# Broken\n\n2. two\n5. five\n");
  const candidates = new Set(mapKeyCandidateIds(parsed));
  const lists = parsed.items.filter((item) => item.kind === "list");
  assert.equal(candidates.has(lists[0]!.id), false);
  assert.equal(candidates.has(lists[1]!.id), true);
  assert.equal(candidates.has(lists[2]!.id), true);
});
