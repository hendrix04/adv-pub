# Identity resolution and reconciliation

## Purpose and when to use it

Use this guide to decide whether a newly admitted mention names an existing canonical entity, a new one, or a still-unresolved referent; to attach supported aliases; and to reconcile accepted assertions into current accumulated knowledge. Retrieval finds candidates. A cited semantic decision establishes identity.

The locked seven entity types and identity requirements are in [ENT-001](../../specification.md#ent-001-locked-entity-definitions) and [ENT-003](../../specification.md#ent-003-stable-source-backed-identities). Final identity model assignment remains open under [open questions](../../specification.md#open-questions-for-development) (D-003). The illustrative interfaces here are pseudocode, not adopted API or persistence contracts; payload and transaction details remain open under D-005 and D-008.

## Document-local linking before classification

A source-local Jev pass can compare candidate names within the complete current document before assigning entity types. Preserve the original names and IDs, exact occurrences, pair decisions, confidence/probabilities, and unresolved links. Use a supported group only as provisional classification context; it creates neither a canonical entity nor a canonical alias. Acronym initials and spelling similarity suggest comparisons, while cited source context establishes the identity decision. Require support for all members before grouping, rather than applying unchecked transitive closure. The later admitted same/new/unresolved canonical identity operation retains the full current/prior source and persistence contracts below.

## Inputs, outputs, and invariants

Inputs: the complete current source; an admitted entity/mention proposal and verified source evidence; candidate canonical entities retrieved through canonical names and aliases, phonetic and semantic signals; and, for each candidate considered, its complete prior supporting source documents and cited claims. Reconciliation also takes all relevant incoming and stored claims, stated dates/periods, attribution, qualifications, and the supplied document order.

Outputs: a persisted, inspectable `same`, `new`, or `unresolved` identity outcome with source citations; an alias addition only when supported; accepted claims attached to a canonical ID; and current projections rebuilt from accumulated accepted evidence.

Invariants:

- A name or title match alone never merges two referents. Formatting normalization may remove explicit formatting; it may not add absent words.
- Retrieval scores and reranking order candidates; neither is an identity decision. Empty retrieval does not prove novelty.
- A semantic decision uses the complete current source and complete prior sources that support bounded candidates. Snippets/cards point to sources but cannot replace them. Reduce the candidate batch to fit; fail if one candidate and its required full sources cannot fit.
- `same` requires cited evidence for both referents and the identity relation. `new` requires positive source-grounded support that this is a distinct referent, not merely lack of a candidate. `unresolved` holds canon changes for review.
- Newer supplied documents can revise earlier facts about the same referent/fact, but never erase earlier evidence. Different periods may be history; omission does not revoke a fact; same-document conflict remains inspectable.
- Permanent ULIDs remain stable. A merge retains redirects, and redirects cannot self-link or cycle.

## Practical method

1. Normalize only explicit surface formatting (for example, `#MatronofDeath` to `Matron of Death`). Search exact canonical names and aliases first, then phonetic and fuzzy name signals. The selected retrieval stack proposes `unaccent`, `pg_trgm`, `fuzzystrmatch`, `pgvector`, Voyage embeddings, and bounded Voyage reranking; verify extension/package/version/SQL type availability under [open questions](../../specification.md#open-questions-for-development) (D-011). PostgreSQL documents [`pg_trgm`](https://www.postgresql.org/docs/current/pgtrgm.html), [`fuzzystrmatch`](https://www.postgresql.org/docs/current/fuzzystrmatch.html), and [`unaccent`](https://www.postgresql.org/docs/current/unaccent.html); pgvector documents its Postgres similarity operators and indexes in its [official project README](https://github.com/pgvector/pgvector).
2. Combine retrieval signals into one bounded shortlist. Keep candidate reasons (exact alias, phonetic/fuzzy, semantic) for diagnostics. Rerank only that bounded list. Do not treat a threshold as a final identity outcome.
3. Build a complete-source decision input from the current source plus the full prior supporting source documents for candidate identities. Validate source hash and byte length before dispatch. Semantic model dispatch lives in [model dispatch](structured-model-calls.md); source pointers and deterministic byte resolution live in [source evidence](source-capture-and-evidence.md); do not duplicate those components.
4. Ask for only `same`, `new`, or `unresolved`, requiring evidence references and an explanation grounded in the supplied sources. The final-identity model, response shape, and numeric calibration remain explicit D-003 decisions.
5. For same-identity outcomes, attach the incoming evidence to the existing stable ID. For new, create a new permanent ID only when the evidence supports a distinct referent. For unresolved, preserve the decision and proposals without changing canonical identity.
6. Reconcile facts after identity is settled: compare incoming and stored assertions for the same referent and fact; give the model all relevant assertions, sources, dates, attribution, and evidence; classify as revision, addition, or difference. Apply document-order precedence to revisions and retain both old and new records. Explicit dates may be normalized only when unambiguous; relative/approximate wording remains wording.

## Worked example

Two complete toy sources are supplied in order. Source A says `The Open Lord Selene welcomed the envoys.` Source B says `The Open Lord Aria spoke with the delegation.` Their title/name similarity creates a retrieval lead, not an identity conclusion. The final decision input includes the full Source B text and the full prior Source A text, not excerpts.

```ts
// Illustrative pseudocode only. Types, functions, payloads, and score policies are not adopted.
type CitedSource = { sourceId: string; startByte: number; endByte: number; quote: string };
type IdentityOutcome =
  | { outcome: "same"; entityId: string; evidence: CitedSource[] }
  | { outcome: "new"; evidence: CitedSource[] }
  | { outcome: "unresolved"; evidence: CitedSource[]; reason: string };

const prior = { sourceId: "A", documentOrder: 1, text: "The Open Lord Selene welcomed the envoys." };
const current = { sourceId: "B", documentOrder: 2, text: "The Open Lord Aria spoke with the delegation." };
const candidates = await retrieveAndBound({
  names: ["The Open Lord Aria"],
  aliases: [],
  priorEntities: [{ entityId: "entity-selene", canonicalName: "Selene", aliases: ["Open Lord"] }],
  signals: ["exact/alias", "phonetic", "semantic"],
});
const ranked = candidates.length ? await rerankBoundedCandidates(candidates) : [];
const fullInput = { current, candidateEvidence: [{ entityId: "entity-selene", completePriorSources: [prior] }] };
assertStoredHashAndLength(fullInput);
const decision: IdentityOutcome = {
  outcome: "unresolved",
  evidence: [
    { sourceId: "A", startByte: 0, endByte: 41, quote: "The Open Lord Selene welcomed the envoys." },
    { sourceId: "B", startByte: 0, endByte: 45, quote: "The Open Lord Aria spoke with the delegation." },
  ],
  reason: "The sources show similar titles but establish neither sameness nor distinctness.",
};
await persistDecision(decision); // no canonical ID is attached or created
```

For this input, expected output is an inspectable unresolved decision citing both full source statements, with no entity merge or creation. If a full source instead explicitly states `Aria is Selene under her later name`, a `same` outcome can cite that sentence and the source establishing Selene's identity. If a full source explicitly states `Aria is a different office-holder from Selene`, a `new` outcome can cite that distinction. A candidate score or empty shortlist alone supports neither result.

For reconciliation, Source A may say `Mira was a scout before the northern campaign.` Source B may say `After the northern campaign, Mira became a guide.` Preserve both claims and their periods; the newer supported role does not automatically erase every repeatable occupation claim. When a newer source revises the same fact and period, prefer it in current understanding while retaining the older claim. If a single source gives incompatible counts, preserve both as an unresolved same-document inconsistency rather than ordering by sentence position.

## Failure modes and verification

- **Same-name shortcut:** review distinct individuals with shared names/titles and inspect complete source evidence for each `same` result.
- **Empty-shortlist means new:** force an empty retrieval case and confirm a cited semantic decision is still required. The outcome can be new or unresolved depending on source support; the empty list alone chooses neither.
- **Only snippets reach the model:** log/redact-check input metadata; compare every supplied complete source's hash and length to storage.
- **Unbounded candidate/source batch:** reduce candidate batch without truncating any required source; fail cleanly if one full evidence set cannot fit.
- **Alias expands a name semantically:** check that the alias occurs or is explicitly supported by source text.
- **Revision overwrites history or sentence order resolves conflict:** trace the document-order rule, prior claim retention, differing time periods, and same-document contradiction handling.
- **Redirect cycle or ID reuse:** validate chains before commit and keep stable IDs with redirects.

## Application to the specification

Applies [ENT-003](../../specification.md#ent-003-stable-source-backed-identities), [SRC-003](../../specification.md#src-003-complete-context-for-semantic-decisions), [REL-002](../../specification.md#rel-002-retain-information-outside-a-positive-edge), [TIME-001](../../specification.md#time-001-explicit-source-dates-and-periods), [KNOW-001](../../specification.md#know-001-current-means-the-latest-accumulated-understanding), [KNOW-002](../../specification.md#know-002-newer-documents-take-precedence-without-erasing-evidence), [KNOW-003](../../specification.md#know-003-preserve-the-rebuildable-evidence-record), and TECH-003/004. The [open questions](../../specification.md#open-questions-for-development) retain D-003's final-identity model selection, D-008's transaction/canon-version/retry boundaries, and D-011's extension, vector, package, and API verification. D-005 still defines payload/evidence shapes. This guide selects no numerical identity or retrieval threshold.
