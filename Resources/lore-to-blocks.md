# Splitting lore into blocks

Oct 4, 2026 · @Hendrix

## In brief

A lore document is split into **blocks**, each one markdown element: a paragraph, a whole list, a table or a quote. Nothing is cut smaller than an element, and a few small pieces join the element next to them. Tag lines, headings and titles are not blocks; they label the section below them.

- **Code** parses the markdown, peels tag lines off the paragraphs they were folded into, and flags four kinds of thing it can't settle alone.
- **Jev** settles each of those with one yes/no question, reading the whole document: whether a short line is a title, whether a paragraph introduces the list after it, whether a numbered list is the key to a map, and whether a link on its own line goes with the block before it.
- **On your nine files** that gives 116 blocks and 12 labelled sections, from 6 Jev questions. The median block is 103 tokens, and the largest outside a table is 333.

Making blocks needs only the document's text. It uses no list of names, and it decides nothing about what any block is about.

## Blocks

Code parses each file as markdown, with GitHub-style tables, and takes each top-level element as a block. Lines with no blank line between them are one paragraph, so doc 03's "spectres," and "and wraiths." stay together, and so do the Commandments line and the three rules under it. A whole list is one block, because its items are related: doc 02's thirteen groups come as one block. A list stays one block however long it gets.

| Kind | What it is | In your nine files |
| :-- | :-- | --: |
| Paragraph | Lines with no blank line between them | 107 |
| List | A whole bulleted or numbered list, nested lists included | 1 |
| Map-key entry | One numbered entry of a list that labels a map | 6 |
| Table | A whole table | 2 |
| Quote | A whole quote written with `>` | 0 |

Your quotes are written as paragraphs, so they count there. The median block is 103 tokens, and the largest outside a table is 333, in doc 04. The faction table in doc 06 is the largest of all, at 652.

## What joins a block

A few small pieces can't stand alone, and join the block next to them:

- **A speaker joins a quote.** A quote with "— Name" on the next line is already one paragraph, and a speaker's line set off by a blank line still joins the quote before it. All four quotes in your files come out whole.
- **An introduction joins its list.** A paragraph that introduces the list after it becomes part of that list's block. Markdown doesn't mark this, and position isn't enough: the paragraph before the Winterhaven list is about Lord Padraig. So Jev decides. Doc 02's "Common origins of the peoples of Swordmount…" is the one in your files; with it, the list block is 142 tokens.
- **A link goes where Jev puts it.** A bare URL on its own line joins either the block before it or the block after it, and Jev decides which. Doc 01's wiki link goes with the one after, "The Forgotten Realms wiki is a primary source…".

## What isn't a block

- **Labels.** Tag lines, headings and title lines name the section below them. A tag line with no blank line after it, as in docs 01, 02 and 06, would be folded into the paragraph by markdown, so code peels it off. A line of up to 12 words set entirely in bold or italics may be a title, and Jev decides. In your files, doc 04's "**Ridur's Tale**" and "*Castle Swordmount, Fall 1510*" are titles.
- **Notes.** An HTML comment is a remark about its section and stays with the section, like doc 03's note that the list numbers are map labels.
- **Breaks and metadata.** A `---` line ends a section. Front matter and code blocks are not lore. None of these are in your files yet.

A label starts a **labelled section**, which runs until the next label. Labels in a row form one label, so doc 04's tag line and its two title lines head a single section. Your files have 12 labelled sections, six of them in doc 03. Text before the first label, as in docs 07 and 09 and the top of doc 02, forms a section without one.

## Map keys

A numbered list can be the key to a map: its numbers label places on a picture instead of putting them in order. Doc 03's Winterhaven list is one. Its numbers run 2, 3, 5, 7, 6, 14, and the map isn't in the file yet.

Code flags a numbered list when its numbers don't count 1, 2, 3, or when its section holds a picture or a note. Jev confirms with one question. A confirmed key is split differently from a list:

- **Each entry is its own block.** The places are related by where they sit on the map, not by being listed together, so Wrafton's Inn is a 119-token entry instead of part of a 457-token list.
- **Each entry keeps its number.** Once a picture is in the section, the entries attach to it by number, without reprocessing the text. Until then they stay untied.
- **The note describes the key** instead of being a block.

## Jev's structure questions

Every question about a document shares one state: the whole document, with each line or list being asked about marked. The largest of your documents is about 3,700 tokens, well under Jev's 32,000-token state. All four questions are yes/no.

| Question | Asked for | In your nine files |
| :-- | :-- | --: |
| Is this line a title for what follows, rather than part of the text? | Each one-line paragraph of up to 12 words set entirely in bold or italics | 2 |
| Does this paragraph introduce the list right after it? | Each paragraph directly before a list | 2 |
| Do the numbers in this list label places on a map or picture, rather than put them in order? | Each numbered list code flags | 1 |
| Does this link belong with the block before it, rather than the block after it? | Each URL on its own line | 1 |

Each answer is checked without hand labels. A clone such as Kev answers the same question and the two must agree, and the same question asked again against the same state must get the same answer. An answer that fails a check falls back to the plain reading: the line stays text rather than becoming a title, the paragraph stays its own block, the list stays one list, and a link joins the block after it.

## Output

The result is a layout of the document:

- **Blocks**, in document order, each with its kind and its span of the text. A map-key entry also carries its number.
- **Sections**, each with its label if it has one, its blocks and its notes.
- **Map keys**, each with its section, its picture once there is one, and its numbered entries.

On your nine files that is 116 blocks in 15 sections, 12 of them labelled, and one map key with six entries.

## The code

`blocks.ts`, TypeScript, clean under strict type-checking. It uses the mdast markdown parser with its GitHub and front-matter extensions. `read` is what code does alone, `mapKeyCandidates` picks the lists Jev is asked about, and `build` applies Jev's answers to produce the layout. On your nine files, with my reading standing in for Jev's answers, it produces the counts above.

```typescript
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';

export interface Span { start: number; end: number }

// ---------- 1. Code reads the markdown ----------

export type ItemKind =
  | 'label'                                  // tag line, tag heading or heading: names the section below
  | 'paragraph' | 'quote' | 'list' | 'table'
  | 'link'                                   // a bare URL on its own line: Jev picks the block it joins
  | 'note'                                   // an HTML comment: a remark about its section
  | 'image'                                  // a picture on its own line, such as a map
  | 'break'                                  // a --- line: ends the section
  | 'meta';                                  // front matter or a code block: not lore

export interface Item extends Span {
  kind: ItemKind;
  titleCandidate?: boolean;                  // short line that may be a title: Jev decides
  numbers?: string[];                        // an ordered list's numbers, as the author wrote them
  entries?: Span[];                          // a list's items
}

// \p{L}\p{N}_ is a Unicode-aware \w (plain \w in JS is ASCII-only).
const TAG_LINE = /^\s*#[\p{L}\p{N}_-]+(\s+#[\p{L}\p{N}_-]+)*\s*$/u;
const TAG_HEADING = /^#[^\s#]/;
const URL_ONLY = /^\s*<?https?:\/\/\S+>?\s*$/;
const ALL_EMPHASIS = /^\s*(\*\*|__|\*|_)(?!\s).*\1\s*$/;
const ATTRIBUTION = /^\s*[—–]\s/;

export function read(text: string): Item[] {
  const tree = fromMarkdown(text, {
    extensions: [gfm(), frontmatter(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
  });
  const out: Item[] = [];
  for (const node of tree.children) {
    let start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    switch (node.type) {
      case 'heading': out.push({ kind: 'label', start, end }); break;
      case 'thematicBreak': out.push({ kind: 'break', start, end }); break;
      case 'html': out.push({ kind: 'note', start, end }); break;
      case 'yaml': case 'code': out.push({ kind: 'meta', start, end }); break;
      case 'table': out.push({ kind: 'table', start, end }); break;
      case 'blockquote': out.push({ kind: 'quote', start, end }); break;
      case 'list': {
        const entries = node.children.map(li => ({ start: li.position!.start.offset!, end: li.position!.end.offset! }));
        const numbers = node.ordered
          ? entries.map(e => /^\s*(\d+)[.)]/.exec(text.slice(e.start, e.end))?.[1] ?? '') : undefined;
        out.push({ kind: 'list', start, end, entries, numbers });
        break;
      }
      case 'paragraph': {
        // A tag line with no blank line after it is folded into the paragraph by markdown: peel it off.
        const lines = text.slice(start, end).split('\n');
        let k = 0;
        while (k < lines.length && (TAG_LINE.test(lines[k]) || (k === 0 && TAG_HEADING.test(lines[k])))) k++;
        if (k > 0) {
          const cut = start + lines.slice(0, k).join('\n').length;
          out.push({ kind: 'label', start, end: cut });
          if (k === lines.length) break;
          start = cut + 1;
        }
        const rest = text.slice(start, end);
        const onlyImage = node.children.every(c => c.type === 'image' || (c.type === 'text' && !c.value.trim()));
        if (k === 0 && onlyImage) { out.push({ kind: 'image', start, end }); break; }
        if (URL_ONLY.test(rest)) { out.push({ kind: 'link', start, end }); break; }
        const oneLine = !rest.trim().includes('\n'), words = rest.trim().split(/\s+/).length;
        const titleCandidate = oneLine && words <= 12 && ALL_EMPHASIS.test(rest);
        out.push({ kind: 'paragraph', start, end, titleCandidate });
        break;
      }
    }
  }
  return out;
}

/** Lists Jev is asked about: numbered lists whose numbers don't count 1, 2, 3, or that share a section
 *  with a picture or a note. */
export function mapKeyCandidates(items: Item[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.kind !== 'list' || !it.numbers) return;
    const counts = it.numbers.every((n, j) => Number(n) === Number(it.numbers![0]) + j) && it.numbers[0] === '1';
    let a = i, z = i;                         // the section around the list
    while (a > 0 && !['label', 'break'].includes(items[a - 1].kind)) a--;
    while (z < items.length - 1 && !['label', 'break'].includes(items[z + 1].kind)) z++;
    const nearby = items.slice(a, z + 1).some(x => x.kind === 'image' || x.kind === 'note');
    if (!counts || nearby) out.push(i);
  });
  return out;
}

// ---------- 2. Jev settles the structure (round 1) ----------

export interface StructureAnswers {
  isTitle(item: number): boolean;            // "Is this line a title for what follows, rather than part of the text?"
  introduces(item: number): boolean;         // "Does this paragraph introduce the list right after it?"
  isMapKey(item: number): boolean;           // "Do the numbers in this list label places on a map or picture?"
  linkJoinsBefore(item: number): boolean;    // "Does this link belong with the block before it, rather than the block after it?"
}

export type BlockKind = 'paragraph' | 'quote' | 'list' | 'entry' | 'table';
export interface Block extends Span { kind: BlockKind; key?: string }    // key: an entry's number on its map
export interface Section { label: string[]; blocks: number[]; notes: string[] }
export interface MapKey { section: number; image: Span | null; entries: { key: string; block: number }[] }
export interface Layout { blocks: Block[]; sections: Section[]; keys: MapKey[] }

export function build(text: string, items: Item[], jev: StructureAnswers): Layout {
  const blocks: Block[] = [], sections: Section[] = [], keys: MapKey[] = [];
  let sec: Section = { label: [], blocks: [], notes: [] }, image: Span | null = null;
  let carry: number | null = null;           // start of a link or an introduction waiting for its block
  const close = () => {
    if (carry !== null) { sec.notes.push(text.slice(carry, items.find(x => x.start === carry)!.end)); carry = null; }
    if (sec.blocks.length) {
      sections.push(sec);
      for (const k of keys) if (k.section === sections.length - 1) k.image = image;
    }
    sec = { label: [], blocks: [], notes: [] }; image = null;
  };
  const push = (b: Block) => {
    if (carry !== null) { b.start = carry; carry = null; }
    sec.blocks.push(blocks.length); blocks.push(b);
  };
  items.forEach((it, i) => {
    const raw = text.slice(it.start, it.end);
    const isLabel = it.kind === 'label' || (it.kind === 'paragraph' && it.titleCandidate && jev.isTitle(i));
    if (isLabel) { if (sec.blocks.length) close(); sec.label.push(raw.trim()); return; }
    switch (it.kind) {
      case 'break': close(); break;
      case 'note': sec.notes.push(raw.trim()); break;
      case 'image': image = { start: it.start, end: it.end }; break;
      case 'meta': break;
      case 'link': {                         // Jev's yes joins the block before; a no, or nothing before, joins the next
        const last = blocks[sec.blocks.at(-1) ?? -1];
        if (jev.linkJoinsBefore(i) && last && carry === null) { last.end = it.end; break; }
        carry = carry ?? it.start;
        break;
      }
      case 'table': push({ kind: 'table', start: it.start, end: it.end }); break;
      case 'quote': push({ kind: 'quote', start: it.start, end: it.end }); break;
      case 'paragraph': {
        const last = blocks[sec.blocks.at(-1) ?? -1];
        if (ATTRIBUTION.test(raw) && last && (last.kind === 'paragraph' || last.kind === 'quote')) { last.end = it.end; break; }
        if (items[i + 1]?.kind === 'list' && jev.introduces(i)) { carry = carry ?? it.start; break; }
        push({ kind: 'paragraph', start: it.start, end: it.end });
        break;
      }
      case 'list': {
        if (!jev.isMapKey(i)) { push({ kind: 'list', start: it.start, end: it.end }); break; }
        if (carry !== null) push({ kind: 'paragraph', start: carry, end: it.start - 1 });
        const key: MapKey = { section: sections.length, image: null, entries: [] };
        it.entries!.forEach((e, j) => {
          key.entries.push({ key: it.numbers![j], block: blocks.length });
          push({ kind: 'entry', start: e.start, end: e.end, key: it.numbers![j] });
        });
        keys.push(key);
        break;
      }
    }
  });
  close();
  return { blocks, sections, keys };
}
```
