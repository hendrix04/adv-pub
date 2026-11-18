import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { sourceComponent, type CapturedSource } from "../discovery/source.js";
import { sha256 } from "../decisions/contracts.js";
import type { ItemKind, ParsedDocument, ParsedItem, TableEvidence } from "./types.js";

type Node = {
  type: string;
  value?: string;
  ordered?: boolean;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

const TAG_LINE = /^\s*#[\p{L}\p{N}_-]+(?:\s+#[\p{L}\p{N}_-]+)*\s*$/u;
const TAG_HEADING = /^#[^\s#].*$/u;
const URL_ONLY = /^\s*<?https?:\/\/[^\s<>]+>?\s*$/u;

function span(node: Node): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end! < start!) throw new Error(`Markdown ${node.type} has no usable source position`);
  return { start: start!, end: end! };
}

function textOf(node: Node): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function strongTexts(node: Node): string[] {
  if (node.type === "strong") return [textOf(node).trim()].filter(Boolean);
  return (node.children ?? []).flatMap(strongTexts);
}

function whollyEmphasized(node: Node): boolean {
  let visible = false;
  const visit = (current: Node, emphasized: boolean): boolean => {
    const inside = emphasized || current.type === "strong" || current.type === "emphasis";
    if (current.type === "text" || current.type === "inlineCode") {
      const value = current.value ?? "";
      if (value.trim()) visible = true;
      return !value.trim() || inside;
    }
    if (current.type === "image") {
      if ((current.value ?? "").trim()) visible = true;
      return inside;
    }
    if (!current.children?.length) return inside;
    return current.children.every((child) => visit(child, inside));
  };
  return (node.children ?? []).every((child) => visit(child, false)) && visible;
}

function lineRanges(text: string, start: number, end: number) {
  const lines: Array<{ start: number; contentEnd: number; end: number; text: string }> = [];
  for (let cursor = start; cursor < end; ) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline >= 0 && newline < end ? newline + 1 : end;
    let contentEnd = newline >= 0 && newline < end ? newline : end;
    if (contentEnd > cursor && text[contentEnd - 1] === "\r") contentEnd -= 1;
    lines.push({ start: cursor, contentEnd, end: lineEnd, text: text.slice(cursor, contentEnd) });
    cursor = lineEnd;
  }
  return lines;
}

function tableEvidence(source: CapturedSource, node: Node): TableEvidence {
  return {
    rows: (node.children ?? []).map((row, index) => ({
      index,
      kind: index === 0 ? "header" : "body",
      cells: (row.children ?? []).map((cell) => {
        let { start, end } = span(cell);
        // mdast cell positions can include the row's outer pipe delimiters; AST rows/cells remain authoritative.
        while (start < end && /[ \t]/u.test(source.text[start]!)) start += 1;
        if (source.text[start] === "|") start += 1;
        while (start < end && /[ \t]/u.test(source.text[start]!)) start += 1;
        while (end > start && /[ \t]/u.test(source.text[end - 1]!)) end -= 1;
        if (source.text[end - 1] === "|") {
          let escapes = 0;
          for (let cursor = end - 2; cursor >= start && source.text[cursor] === "\\"; cursor -= 1) escapes += 1;
          if (escapes % 2 === 0) end -= 1;
        }
        while (end > start && /[ \t]/u.test(source.text[end - 1]!)) end -= 1;
        return { ...sourceComponent(source, start, end), role: index === 0 ? "table_header_cell" : "table_cell" };
      }),
    })),
  };
}

function createItem(source: CapturedSource, kind: ItemKind, astType: string, start: number, end: number, extras: Partial<ParsedItem> = {}): ParsedItem {
  const component = { ...sourceComponent(source, start, end), role: kind };
  return {
    id: sha256(`${source.sha256}\0${kind}\0${component.start_byte}\0${component.end_byte}`).slice(0, 24),
    kind,
    ast_type: astType,
    component,
    title_candidate: false,
    ordered_numbers: null,
    list_entries: [],
    table: null,
    ...extras,
  };
}

function retainedParagraph(text: string, start: number, fallback: Node): Node {
  const tree = fromMarkdown(text.slice(start), {
    extensions: [gfm(), frontmatter(["yaml", "toml"])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml", "toml"])],
  }) as unknown as Node;
  return tree.children?.[0] ?? fallback;
}

export function isQuotedParagraph(text: string): boolean {
  const value = text.trim();
  return /^[“"]\S[\s\S]*[”"]$/u.test(value);
}

export function separateSpeaker(text: string): string | null {
  return /^\s*[—–]\s*(\S[^\r\n]*?)\s*$/u.exec(text)?.[1]?.trim() || null;
}

export function inlineQuoteSpeaker(text: string): string | null {
  const match = /\r?\n[ \t]*[—–][ \t]*(\S[^\r\n]*?)[ \t]*$/u.exec(text);
  if (!match || !isQuotedParagraph(text.slice(0, match.index))) return null;
  return match[1]?.trim() || null;
}

function appendParagraph(source: CapturedSource, node: Node, out: ParsedItem[]) {
  const range = span(node);
  const lines = lineRanges(source.text, range.start, range.end);
  let firstBody = 0;
  while (firstBody < lines.length) {
    const line = lines[firstBody]!;
    if (!(TAG_LINE.test(line.text) || (firstBody === 0 && TAG_HEADING.test(line.text)))) break;
    out.push(createItem(source, "label", "paragraph_tag", line.start, line.end));
    firstBody += 1;
  }
  if (firstBody === lines.length) return;
  const bodyStart = lines[firstBody]!.start;
  const body = source.text.slice(bodyStart, range.end);
  const bodyChildren = (node.children ?? []).filter((child) => span(child).end > bodyStart);
  const imageNodes = bodyChildren.filter((child) => child.type === "image" || child.type === "imageReference");
  const onlyImages =
    bodyChildren.length > 0 &&
    bodyChildren.every((child) => {
      const childRange = span(child);
      if (child.type === "image" || child.type === "imageReference") return childRange.start >= bodyStart;
      if (child.type === "break") return true;
      return child.type === "text" && !source.text.slice(Math.max(bodyStart, childRange.start), childRange.end).trim();
    });
  if (onlyImages) {
    const imageReferences = imageNodes.map((child) => {
      const imageRange = span(child);
      return { ...sourceComponent(source, imageRange.start, imageRange.end), role: "image" };
    });
    out.push(createItem(source, "image", node.type, bodyStart, range.end, imageReferences.length > 1 ? { image_references: imageReferences } : {}));
    return;
  }
  if (URL_ONLY.test(body)) {
    out.push(createItem(source, "link", node.type, bodyStart, range.end));
    return;
  }
  const bodyNode = firstBody === 0 ? node : retainedParagraph(source.text, bodyStart, node);
  const plainText = textOf(bodyNode).trim();
  const words = plainText ? plainText.split(/\s+/u).length : 0;
  const oneLine = !/[\r\n]/u.test(body);
  out.push(
    createItem(source, "paragraph", node.type, bodyStart, range.end, {
      title_candidate: oneLine && words <= 12 && whollyEmphasized(bodyNode),
    }),
  );
}

function appendList(source: CapturedSource, node: Node, out: ParsedItem[]) {
  const range = span(node);
  const entries = (node.children ?? []).map((child) => {
    const item = span(child);
    const raw = source.text.slice(item.start, item.end);
    const number = node.ordered ? (/^ {0,3}(\d+)[.)](?:[ \t]|$)/u.exec(raw)?.[1] ?? null) : null;
    return {
      component: { ...sourceComponent(source, item.start, item.end), role: "list_entry" },
      number,
      bold_names: strongTexts(child),
    };
  });
  out.push(
    createItem(source, "list", node.type, range.start, range.end, {
      ordered_numbers: node.ordered ? entries.map((entry) => entry.number ?? "") : null,
      list_entries: entries,
    }),
  );
}

export function readMarkdown(source: CapturedSource): ParsedDocument {
  const tree = fromMarkdown(source.text, {
    extensions: [gfm(), frontmatter(["yaml", "toml"])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml", "toml"])],
  }) as unknown as Node;
  const items: ParsedItem[] = [];
  for (const node of tree.children ?? []) {
    const { start, end } = span(node);
    switch (node.type) {
      case "heading":
        items.push(createItem(source, "label", node.type, start, end));
        break;
      case "thematicBreak":
        items.push(createItem(source, "break", node.type, start, end));
        break;
      case "html":
        items.push(createItem(source, "note", node.type, start, end));
        break;
      case "yaml":
      case "toml":
      case "code":
        items.push(createItem(source, "meta", node.type, start, end));
        break;
      case "table":
        items.push(createItem(source, "table", node.type, start, end, { table: tableEvidence(source, node) }));
        break;
      case "blockquote":
        items.push(createItem(source, "quote", node.type, start, end));
        break;
      case "list":
        appendList(source, node, items);
        break;
      case "paragraph":
        appendParagraph(source, node, items);
        break;
      default:
        items.push(createItem(source, "meta", node.type, start, end));
    }
  }
  return {
    contract_version: "markdown-layout-v1",
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
    items,
  };
}

export function mapKeyCandidateIds(parsed: ParsedDocument, titleLabels: ReadonlySet<string> = new Set()): string[] {
  const items = parsed.items;
  return items.flatMap((item, index) => {
    if (item.kind !== "list" || !item.ordered_numbers) return [];
    const numbers = item.ordered_numbers;
    const sequence = numbers[0] === "1" && numbers.every((number, offset) => Number(number) === offset + 1);
    let left = index;
    let right = index;
    const boundary = (entry: ParsedItem) => ["label", "break"].includes(entry.kind) || titleLabels.has(entry.id);
    while (left > 0 && !boundary(items[left - 1]!)) left -= 1;
    while (right + 1 < items.length && !boundary(items[right + 1]!)) right += 1;
    const mapContext = items.slice(left, right + 1).some((entry) => entry.kind === "image" || entry.kind === "note");
    return sequence && !mapContext ? [] : [item.id];
  });
}
