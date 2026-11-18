import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptWithTableInventory, extractMarkdownTables, renderTableInventory } from "./tables.js";

test("table inventory preserves exact source cell text and row lines", () => {
  const source = "Intro\n\n| Name | Value |\n| :--- | ---: |\n| A\\|B |  x  |\n| C | y |\n\nAfter";
  const tables = extractMarkdownTables(source);
  assert.deepEqual(tables, [
    {
      start_line: 3,
      end_line: 6,
      headers: ["Name", "Value"],
      rows: [
        { line: 5, cells: ["A\\|B", "x"] },
        { line: 6, cells: ["C", "y"] },
      ],
    },
  ]);
  assert.match(renderTableInventory(tables), /"line": 5/);
  assert.match(renderTableInventory(tables), /"A\\\\\|B"/);
});

test("table inventory ignores prose and malformed non-table pipes", () => {
  assert.deepEqual(extractMarkdownTables("A | B\n\n| only one row |"), []);
});

test("table inventory is retained separately without adding source-specific prompt text", () => {
  const source = "| A | B |\n| --- | --- |\n| x | y |";
  const built = buildPromptWithTableInventory("prompt", source);
  assert.equal(built.tables.length, 1);
  assert.equal(built.prompt, "prompt");
  assert.equal(built.tables[0]?.rows[0]?.cells[0], "x");
  assert.equal(source, "| A | B |\n| --- | --- |\n| x | y |");
  assert.equal(buildPromptWithTableInventory("prompt", "no tables").prompt, "prompt");
});
