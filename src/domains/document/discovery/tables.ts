export type MarkdownTableInventory = {
  start_line: number;
  end_line: number;
  headers: string[];
  rows: Array<{ line: number; cells: string[] }>;
};

function cellsOnLine(line: string): string[] | undefined {
  if (!line.includes("|")) return undefined;
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
    if (character === "\\" && !escaped) escaped = true;
    else escaped = false;
  }
  cells.push(cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length > 1 ? cells : undefined;
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function extractMarkdownTables(text: string): MarkdownTableInventory[] {
  const lines = text.split(/\r?\n/);
  const tables: MarkdownTableInventory[] = [];
  for (let index = 0; index < lines.length - 1; ) {
    const headers = cellsOnLine(lines[index]!);
    const separator = cellsOnLine(lines[index + 1]!);
    if (!headers || !separator || headers.length !== separator.length || !isSeparator(separator)) {
      index += 1;
      continue;
    }
    const start = index;
    const rows: MarkdownTableInventory["rows"] = [];
    index += 2;
    while (index < lines.length) {
      const cells = cellsOnLine(lines[index]!);
      if (!cells || cells.length !== headers.length) break;
      rows.push({ line: index + 1, cells });
      index += 1;
    }
    tables.push({ start_line: start + 1, end_line: rows.at(-1)?.line ?? start + 2, headers, rows });
  }
  return tables;
}

export function renderTableInventory(tables: MarkdownTableInventory[]): string {
  return JSON.stringify(tables, null, 2);
}

export function buildPromptWithTableInventory(prompt: string, sourceText: string): { prompt: string; tables: MarkdownTableInventory[] } {
  const tables = extractMarkdownTables(sourceText);
  return { prompt, tables };
}
