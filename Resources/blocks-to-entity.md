# Giving blocks to names

Oct 3, 2026 · @Hendrix

## In brief

This doc starts from a document that is already split into blocks and labelled sections, together with the names proposed for it, and decides which blocks each name gets. Every name gets each block it is really mentioned in, whole. A section or a document goes whole to whatever it is about, and there is no limit on how many blocks a name collects.

- **Jev** reads the whole document at once and answers yes/no questions: where an unmarked section runs, what each block, section and document is about, which text is taken from another work, and which mentions are only a made-up example.
- **Some text gives no context.** Material taken from another work, like the Marvel excerpt in doc 01, gives nothing to anyone. Tables stay part of their section for search, and the names in them are recorded with their column.
- **On your nine files**, a name's context inside one document has a median of 167 tokens and a p90 of 489. The largest is all of doc 04 at 2,150 tokens, well under Jev's 32,000-token state.

The scope is one document at a time. Deciding whether a name is a real entity, and combining a name's blocks across documents, are not covered here.

&#91;embedded content: doc 01 · 19 blocks in 9 groups · who gets what\]

Every block above the Marvel excerpt goes to the Unified Church of the Realms, because the whole document is about it. Inside that, each name gets the blocks it is named in. The made-up example and the Marvel excerpt give nothing.

## Input

Each document arrives already split, with the names proposed for it:

- **The text** of the document.
- **Blocks**, in document order, each with its kind and its span of the text. A block is one markdown element: a paragraph, a whole list, a table or a quote, with any introduction, bare link or quoted speaker already joined to it. A list whose numbers label places on a map arrives as one block per entry, each carrying its number.
- **Labelled sections.** A tag line, heading or title starts one, and it runs until the next. Each has its label, its blocks and its notes, such as an HTML comment. Text before the first label is a section without one.
- **The proposed names** for the document, as plain strings.

Your nine files arrive as 116 blocks in 15 sections, 12 of them labelled, with 516 proposed name strings.

## Sections

A section is a run of consecutive blocks about one subject. Labelled sections arrive with the input, 12 in your files. This step adds two more kinds:

- **Found.** Nothing in the file marks it. A block that is about something starts one, and each following block that Jev says continues the same subject joins it. Doc 09's Luskan entry is one: the paragraph naming Luskan, the paragraph after it, the quote with its speaker and the paragraph on its government, 391 tokens. A found section never crosses into the next labelled section. Your files have four, all in doc 09.
- **Excluded.** A run of blocks taken from another work, plus the line that introduces it. Doc 01's Marvel excerpt is the only one in your files.

A map key's entries are blocks like any other. Wrafton's Inn gets its own 119-token entry, while Winterhaven, the subject of the section, gets the whole section, every entry included: 646 tokens.

Each entry also stands for a place, so it is recorded as a place to create, with the entry as its context, even when no proposed name matches it and no map is in the file. The place is named by the entry's bold name, else by the first name Jev says the entry is about, else by its section and number. In Winterhaven that gives Wrafton's Inn, Market Square, Bairwin’s Grand Shoppe, Valthrun’s Tower and Lord Mayor's home, plus "Winterhaven, label 5" for the smithy and cooper, which have no name of their own.

## What gets nothing

Your nine files hold 759 mentions. 601 are real mentions in a block and bring that block with them. The other 158 bring nothing:

- **37 are in the excluded section.** No name gets any of it, and nothing in it counts as evidence that a name is real. Hells is named there too, but it also appears in the Elturgard paragraph, so it gets that block.
- **92 are in tables.** A table stays part of its section's and document's context, so the Unified Church gets the Pantheon table. No one else gets a table yet. Each name in a table is recorded with its column's header (Deity, Leader, Patron) for the step that creates entities.
- **22 are in labels**: 20 in tag lines and 2 in title lines. Labels are offered as candidates when Jev is asked what a section or document is about.
- **7 are in a made-up example.** "e.g. Caine asks Eilistralee to bless a midnight dance festival" illustrates the Dogma; it is not something Caine did, so he gets nothing from it. The block still belongs to the document and its subject. Had it reported something Caine actually did, even in passing, he would get the block.

## Who gets which blocks

1. Every real mention gets its whole block.
2. A section's subjects get the whole section.
3. A document's subjects get the whole document, minus excluded sections.
4. A block, a section or a document can have more than one subject.
5. There is no limit on how many blocks a name collects.

A name's context in a document is everything those rules give it. Measured on your nine files, with my own reading standing in for Jev's answers:

| What a name gets in one document | Names | Median tokens | Largest |
| :-- | --: | --: | :-- |
| The whole document | 11 | 1,328 | 2,150: Ridur's Tale and Aura, doc 04 |
| A section | 18 | 432 | 838: Neverwinter and Neverember, doc 09 |
| Only blocks | 334 | 165 | 983: Sword Coast, named in many doc 06 paragraphs |
| All | 363 | 167 (p90 489) | 2,150 |

Names are counted once per document and as written, so "Unified Church" and "Unified Church of the Realms" count separately. Joining them is the later step.

## What Jev decides

Every question about a document shares one state: the whole document, with each block marked b1, b2, … and each mention marked m1, m2, …. The largest of your documents is about 3,700 tokens.

All the questions are yes/no. A block can have several subjects, and a separate yes for each allows that; a single choice among them would force them to share one probability and favour whichever is listed first.

| Question | Asked for | In your nine files |
| :-- | :-- | --: |
| Is bN taken from another work, or does it introduce text that is? | Every block | 116 |
| Is bN still about the subject of the block before it? | Every block after the first in its section | 101 |
| Is bN about mK? | Each name in each block | 541 |
| Does bN report something true of mK, or something mK actually did, rather than use mK in a made-up example? | Each name in each block | 541 |
| Is this document about X? | Each name and label in the document | 463 |
| Is section sJ about X? | Each name and label in a labelled section, when a document has more than one | 96 |

That is 1,858 questions for the sample.

## The code

`context.ts`, TypeScript, clean under strict type-checking. Its input types describe a document already split into blocks and labelled sections. `findMentions` finds the proposed names, `tableMentions` records the names inside tables, `mapKeyPlaces` records one place per map-key entry, and `assemble` applies Jev's answers. Given my reading as Jev's answers, it produces the measurements above.

```typescript
// Input: one document, already split into blocks and labelled sections.
export interface Span { start: number; end: number }
export type BlockKind = 'paragraph' | 'quote' | 'list' | 'entry' | 'table';   // entry: one entry of a map key
export interface Block extends Span { kind: BlockKind; key?: string }   // key: a map-key entry's number
export interface Section { label: string[]; blocks: number[]; notes: string[] }   // blocks: indexes into Layout.blocks
export interface Layout { blocks: Block[]; sections: Section[] }

export interface Mention extends Span { surface: string }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Proposed strings matched case-insensitively on word boundaries, longest first;
 *  a match that overlaps one already taken is skipped. */
export function findMentions(text: string, strings: string[]): Mention[] {
  const taken = new Uint8Array(text.length);
  const out: Mention[] = [];
  const longestFirst = [...new Set(strings)]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const s of longestFirst) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(s)}(?![\\p{L}\\p{N}_])`, 'giu');
    for (const m of text.matchAll(re)) {
      const start = m.index, end = start + m[0].length;
      if (taken.subarray(start, end).some(Boolean)) continue;
      taken.fill(1, start, end);
      out.push({ start, end, surface: m[0] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Names inside tables, each with its column's header. The table is not their context;
 *  this record is what a later step uses to create them. */
export function tableMentions(text: string, layout: Layout, strings: string[]): { surface: string; column: string }[] {
  const out: { surface: string; column: string }[] = [];
  const mentions = findMentions(text, strings);
  for (const t of layout.blocks.filter(b => b.kind === 'table')) {
    const lines = text.slice(t.start, t.end).split('\n');
    const header = lines[0].split('|').slice(1, -1).map(c => c.trim());
    let pos = t.start;
    lines.forEach((line, i) => {
      if (i >= 2) for (const m of mentions) if (m.start >= pos && m.start < pos + line.length) {
        const cell = line.slice(0, m.start - pos).split('|').length - 2;
        out.push({ surface: m.surface, column: header.at(cell) ?? '' });
      }
      pos += line.length + 1;
    });
  }
  return out;
}

/** Jev's answers about content, asked with the whole document as the state. */
export interface ContentAnswers {
  outside(b: number): boolean;               // taken from another work, or introduces such text
  continues(b: number): boolean;             // still about the subject of the block before
  about(b: number): string[];                // names this block is about (several allowed)
  real(b: number, name: string): boolean;    // a real mention, not a made-up example
  documentAbout: string[];                   // names the whole document is about
  sectionAbout(s: number): string[];         // names a section with a label is about
}

/** One place per map-key entry, whether or not a proposed name matches it. Its name is the entry's bold
 *  name, else the first name Jev says the entry is about, else its section and number. The entry is the
 *  place's context; this record is what a later step uses to create it. */
export function mapKeyPlaces(text: string, layout: Layout, jev: Pick<ContentAnswers, 'about'>): { block: number; key: string; name: string }[] {
  const out: { block: number; key: string; name: string }[] = [];
  layout.blocks.forEach((b, i) => {
    if (b.kind !== 'entry') return;
    const bold = /\*\*\s*([^*]+?)\s*\*\*/.exec(text.slice(b.start, b.end))?.[1];
    const where = layout.sections.find(s => s.blocks.includes(i))?.label.at(-1)?.replace(/^#+\s*/, '') ?? 'Map';
    out.push({ block: i, key: b.key ?? '', name: bold ?? jev.about(i)[0] ?? `${where}, label ${b.key}` });
  });
  return out;
}

export type Scope = 'document' | 'section' | 'block';
export interface Context { scope: Scope; blocks: Set<number> }

const LINKABLE = new Set<BlockKind>(['paragraph', 'quote', 'list', 'entry']);
const RANK: Record<Scope, number> = { block: 0, section: 1, document: 2 };
const key = (s: string) => s.toLowerCase();

/** Which blocks of one document go to which name. */
export function assemble(text: string, strings: string[], layout: Layout, jev: ContentAnswers): Map<string, Context> {
  const { blocks, sections } = layout;
  const secOf: number[] = [];
  sections.forEach((s, si) => s.blocks.forEach(b => { secOf[b] = si; }));
  const kept = (b: number) => !jev.outside(b);
  const out = new Map<string, Context>();
  const give = (name: string, scope: Scope, bs: Iterable<number>) => {
    const c = out.get(key(name)) ?? { scope, blocks: new Set<number>() };
    if (RANK[scope] > RANK[c.scope]) c.scope = scope;
    for (const b of bs) if (kept(b)) c.blocks.add(b);
    out.set(key(name), c);
  };
  // 1. Every real mention gets its whole block.
  for (const m of findMentions(text, strings)) {
    const b = blocks.findIndex(x => x.start <= m.start && m.start < x.end);
    if (b < 0 || !kept(b) || !LINKABLE.has(blocks[b].kind) || !jev.real(b, m.surface)) continue;
    give(m.surface, 'block', [b]);
  }
  // 2. A found section: a block with a subject, plus the blocks after it that continue it.
  for (let b = 0; b < blocks.length; b++) {
    const subjects = kept(b) ? jev.about(b) : [];
    if (!subjects.length) continue;
    let end = b + 1;
    while (end < blocks.length && secOf[end] === secOf[b] && kept(end) && jev.continues(end)) end++;
    if (end - b < 2) continue;
    const run = Array.from({ length: end - b }, (_, i) => b + i);
    for (const s of subjects) give(s, 'section', run);
  }
  // 3. Labelled sections and the whole document go to what they are about.
  sections.forEach((sec, si) => { for (const s of jev.sectionAbout(si)) give(s, 'section', sec.blocks); });
  for (const s of jev.documentAbout) give(s, 'document', blocks.map((_, b) => b));
  return out;
}
```

## Checking it without labels

No one labels anything by hand. Three checks run on Jev's own answers:

1. **Agreement with structure.** Where tags, headings and bold entry names already mark a subject or a section, Jev's answers should agree. The agreement rate is the estimate for text that has no markings.
2. **A second opinion.** A clone such as Kev answers the same questions, and disagreements are flagged.
3. **Repeatability.** The same question against the same state should get the same answer.

A subject or continuation answer that fails a check is dropped. The names in the block still get the block; it just isn't grouped into a larger section.

## Choices for you

1. **Where yes starts.** Every question counts as yes at a probability of 0.5. The outside-material question could ask for more, since excluding real lore by mistake loses it from every name.
2. **Notes on sources.** The wiki note in doc 01 is treated as an ordinary block, so "Forgotten Realms wiki" gets it. It could be excluded like outside material instead.
