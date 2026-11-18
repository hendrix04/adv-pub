# Article projections and citations

## Purpose and when to use it

Use this guide to build current entity profiles, indexes, eligibility/quality results, infoboxes, articles, citations, index stubs, and supported cross-references from accumulated accepted claims and retained passages. Everything here is a projection: source documents, decisions, claims, and passages remain the evidence record.

The locked rules in WIKI-001 through WIKI-006 govern output. D-007 leaves exact word counting, overlap/deduplication policy, section assignment/folding payloads, citation/link payloads, and composition/support-call contracts open. Examples are illustrative pseudocode, not adopted models or payloads. Model dispatch belongs in [model dispatch](structured-model-calls.md), source-byte evidence resolution in [source evidence](source-capture-and-evidence.md), and semantic statement support in [candidate admission and support](candidate-admission-and-support.md).

## Inputs, outputs, and invariants

Inputs: all accepted current and historical claims, retained passages and their original-byte ranges, attribution and linked-mention ranges, canonical identities/redirects, supported relationships, prior supporting source documents, and the locked entity-type section order.

Outputs: rebuilt entity profiles and retrieval embeddings; complete type and applicable subtype indexes; an article or visible stub for each canonical entity; source-backed eligibility and quality; eligible prose and infoboxes; factual-statement citations; and Event cross-references with page-aware links.

Invariants:

- Read all accumulated evidence, not only the newest document or an in-world cutoff. Every populated projected field traces to supporting claims or allowed campaign input.
- An article is required when all eligibility fields for its type are populated from sources **or** quality rating is at least 1. Do not add fields to the eligibility test. Quality 0/1/2/3 means zero/one/two/three-or-more article sections that meet the 100-word source-backed bar. `Overview` counts; `Notable Events` does not. `Other` remains available for uncertain placement and counts when it meets the same bar.
- Use the exact ordered sections in WIKI-003. A section heading requires 100 words of source-backed material; shorter material folds into Overview for display while retaining original assignment and citations. `Other` retains uncertain-placement material. Generated wording cannot increase source-backed counts. The reproducible treatment of overlapping spans and duplicate material remains D-007.
- Every factual article statement and infobox fact maps to exact original-byte evidence and a nearby reader-facing citation. Finished prose must pass semantic support review against complete cited sources before publication.
- Every canonical entity appears in its type index and applicable subtype index. Without an eligible article, it still has a visible stub. Event references derive from accepted relations, reuse the Event's source-backed lead, and never arise from co-occurrence alone.

## Practical method

1. Rebuild the current profile from accepted claims, retaining field-support claim IDs and historical/uncertain values. Apply document-order precedence only to supported revisions. Keep source evidence unchanged.
2. Calculate eligibility using the exact per-type field table in [WIKI-002](../../specification.md#wiki-002-locked-article-eligibility-and-quality-rating); separately calculate source-backed section counts and quality. Keep the counting implementation replaceable until D-007's duplicate/overlap contract is decided.
3. Assign retained passages and supported claims to the locked section order. Keep all short and uncertain material, folding short sections into Overview only for display. Create Notable Events from accepted Event relationships, not from source passages or quality counts.
4. Render every entity into the type index and every supported Creature subtype into its subtype index. Link to an article only when one exists; otherwise render a useful visible stub with canonical name/type and no article link. Index rows derive from canonical entities and profiles, not stored index pages.
5. For eligible entities, compose a connected lead/body from accumulated evidence and a compact supported infobox. Each factual statement gets citation references to verified original-byte ranges and applicable claim IDs. Keep citations adjacent to the statement.
6. Run the semantic support guide on finished prose with each cited complete document. Revise, omit, or flag unsupported/misattributed wording. If a required page cannot pass, publication is incomplete. Persist supported versions by canonical version; rebuild affected outputs when accepted evidence changes.

## Worked example

Here is a complete small trace. Fictional Source A contains `Mira is an elf (Humanoid), alive, and a scout. She wears a silver clasp on her cloak.` Fictional Source B, later in supplied order, contains `After the northern campaign, Mira became a guide.` The accepted claims are `C1` (`type=Humanoid`, `subtype=Elf`, `vital_status=Alive`, `occupation=scout`) supported by Source A bytes `[0,46)`; `C2` (`occupation=guide`, stated period `after the northern campaign`) supported by Source B bytes `[0,49)`. Retained passage `P1` (`section=Appearance`) is `She wears a silver clasp on her cloak.` at Source A bytes `[47,85)`. These half-open offsets are the actual UTF-8 byte boundaries for the ASCII example text shown above. Each section's source material in this small input is clearly under 100 words; exact duplicate/overlap counting remains open under D-007. The short Appearance material folds into Overview. Creature eligibility is true because type, subtype, vital_status, and occupation are all populated from cited sources; quality is independently 0.

```ts
// Illustrative pseudocode and payload only; exact interfaces/counting contracts are open.
type Citation = { sourceId: string; startByte: number; endByte: number; claimIds: string[] };
type SupportedStatement = { text: string; citations: Citation[]; passageIds?: string[] };

const inputs = {
  entityId: "MIRA_ULID", // placeholder for the permanent canonical ULID
  entityType: "Creature",
  fields: { type: "Humanoid", subtype: "Elf", vital_status: "Alive", occupation: ["scout", "guide"] },
  acceptedClaims: [
    { id: "C1", sourceId: "Source A", span: [0, 46], quote: "Mira is an elf (Humanoid), alive, and a scout." },
    { id: "C2", sourceId: "Source B", span: [0, 49], quote: "After the northern campaign, Mira became a guide." },
  ],
  passages: [
    { id: "P1", section: "Appearance", sourceId: "Source A", span: [47, 85], quote: "She wears a silver clasp on her cloak." },
  ],
};
const sectionWordCounts = calculateSourceBackedSectionCounts(inputs); // D-007 counting contract
const qualifyingSections = Object.entries(sectionWordCounts)
  .filter(([section, words]) => section !== "Notable Events" && words >= 100).length;
const qualityRating = Math.min(3, qualifyingSections);
const requiredCreatureFields = ["type", "subtype", "vital_status", "occupation"];
const allEligibilityFieldsPopulated = requiredCreatureFields.every((field) => Boolean(inputs.fields[field]));
const eligible = allEligibilityFieldsPopulated || qualityRating >= 1;
const foldedIntoOverview = ["P1"];

const draft: SupportedStatement[] = [
  {
    text: "Mira is an elf, is alive, and has served as a scout and a guide.",
    citations: [
      { sourceId: "Source A", startByte: 0, endByte: 46, claimIds: ["C1"] },
      { sourceId: "Source B", startByte: 0, endByte: 49, claimIds: ["C2"] },
    ],
  },
  {
    text: "She wears a silver clasp on her cloak.",
    citations: [{ sourceId: "Source A", startByte: 47, endByte: 85, claimIds: [] }],
    passageIds: ["P1"],
  },
];
const rejectedWriterSentence = {
  text: "The clasp belonged to Mira's royal family.",
  reason: "Neither complete cited source states ownership or royal-family connection.",
};
const publication = {
  article: {
    sections: ["Overview"],
    statements: draft,
    infobox: [
      { label: "Type", value: "Humanoid", citations: [{ sourceId: "Source A", startByte: 0, endByte: 46, claimIds: ["C1"] }] },
      { label: "Subtype", value: "Elf", citations: [{ sourceId: "Source A", startByte: 0, endByte: 46, claimIds: ["C1"] }] },
      { label: "Occupation", value: ["scout", "guide"], citations: [{ sourceId: "Source A", startByte: 0, endByte: 46, claimIds: ["C1"] }, { sourceId: "Source B", startByte: 0, endByte: 49, claimIds: ["C2"] }] },
    ],
  },
  rejected: [rejectedWriterSentence],
};
// Index projection lists every canonical Creature, links Mira to her article,
// and leaves any ineligible Creature as a visible row without an article link.
```

The lead and infobox occupation cite their actual source ranges. Source A and Source B establish the two occupation assertions but do not explicitly say the scout role ended; projection retains both rather than erasing a repeatable occupation. The unsupported ownership/royalty inference is excluded after the support check. Short Appearance content remains stored with its intended section and citation while displaying in Overview; no Appearance heading is earned. Other canonical Creatures remain visible in the index as rows with no article link until their own eligibility/quality result provides an article. If Mira participates in a supported Event, that Event's source-backed lead can appear in derived Notable Events with a link to its article only when that article exists; otherwise render stub text or link to an existing index row, not a missing article. A mere mention alongside the Event creates no cross-reference.

## Failure modes and verification

- **Projection uses only the latest file:** rebuild after adding older and newer evidence; verify accumulated history and supported current fields.
- **Eligibility drifts:** enumerate each type's exact required fields and compare results; ensure quality alone can qualify at rating 1. In the worked trace, Mira qualifies through fields while quality remains 0.
- **Generated prose inflates quality:** change writer verbosity without changing evidence; rating must remain the same.
- **Short material disappears or becomes a new unsupported fact:** inspect stored passages and citations before/after folding into Overview.
- **Citation uses normalized-string coordinates:** resolve citations against original bytes and hash; verify the exact quoted bytes and framing.
- **Uncited inference, attribution loss, or proposal becomes accomplishment:** check every prose sentence and infobox row with complete cited sources and semantic support review.
- **Missing entities vanish from navigation:** compare canonical entities against type/subtype indexes; require an article link or a visible stub for each.
- **Cross-reference made from co-occurrence or absent page:** inspect accepted relationship evidence, Event lead reuse, canonical ID, and page/stub link target.
- **Projection overwrites evidence:** compare sources, proposals, decisions, claims, and passages before/after article and index rebuilds.

## Application to the specification

Applies [KNOW-001](../../specification.md#know-001-current-means-the-latest-accumulated-understanding), [KNOW-002](../../specification.md#know-002-newer-documents-take-precedence-without-erasing-evidence), [KNOW-003](../../specification.md#know-003-preserve-the-rebuildable-evidence-record), and [WIKI-001](../../specification.md#wiki-001-complete-indexes-and-correct-article-links), [WIKI-002](../../specification.md#wiki-002-locked-article-eligibility-and-quality-rating), [WIKI-003](../../specification.md#wiki-003-locked-sections-and-retained-short-material), [WIKI-004](../../specification.md#wiki-004-supported-infoboxes-and-readable-prose), [WIKI-005](../../specification.md#wiki-005-statement-support-before-publication), and [WIKI-006](../../specification.md#wiki-006-event-cross-references-and-source-mentions), with source citations constrained by SRC-001/003 and claims/passages by CAP-002/003 and TECH-004. It preserves the seven entity-type eligibility-field sets, rating scale, ordered sections, 100-word bar, folding behavior, Overview/Notable Events exclusions, index stubs, citation proximity, support gate, and Event cross-reference rules. [Open questions](../../specification.md#open-questions-for-development) keeps D-007's reproducible source-word counts (including duplicate and overlapping material) and exact projection payloads unresolved, and D-003's article-writer and support-check model assignments open. It does not create a new article section, eligibility requirement, minimum page size, citation format, or source-count rule.
