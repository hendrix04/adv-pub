# Provenance and persistence

## Purpose and when to use it

Use this guide when a source, extraction proposal, semantic decision, accepted claim, retained passage, or derived projection must be stored or retried. It explains how to keep inspectable evidence authoritative while making retries safe and profiles/articles rebuildable.

This is design guidance for the Node.js, TypeScript, PostgreSQL, and Drizzle stack selected in TECH-001. The schema in TECH-004 is proposed; exact payloads and transaction boundaries remain open under D-005 and D-008. Code below is illustrative pseudocode, not an adopted schema or transaction contract.

## Inputs, outputs, and invariants

Inputs include immutable source bytes, their hash and order, the exact decoded reading copy and byte map; model/configuration provenance; raw discovery responses and proposals; verified evidence; decisions; and retained claims/passages. Outputs include inspectable evidence records and rebuildable current profiles, embeddings, indexes, and article versions.

Preserve these invariants:

- Store full source bytes and SHA-256. Keep the reading copy byte-identical after UTF-8 decoding; source ranges are zero-based, half-open UTF-8 byte ranges into the original.
- Persist the original proposal before resolving evidence or semantics. Preserve unresolved pointers and findings; require verified evidence and an acceptance decision before a claim becomes canonical.
- Keep source evidence, rejected/unresolved proposals, decisions, accepted claims, and passages independently inspectable. A projection rebuild never edits its inputs.
- A retry with identical source and pinned processing configuration must not duplicate accepted knowledge or invoke discovery again after a durable result exists. Changed source/configuration is not a completed result.
- Apply supplied document order to revisions. Preserve earlier, negative, attributed, time-qualified, and same-document inconsistent claims; omission does not erase evidence.

The proposed lore tables and retry/reset boundary are described in [TECH-004](../../specification.md#tech-004-complete-proposed-schema-and-persistence-rules), [D-005](../../specification.md#d-005-source-discovery-and-evidence-contract), and [D-008](../../specification.md#open-questions-for-development).

## Practical method

1. Read source bytes once, hash them, decode strict UTF-8, and persist the immutable source plus order, reading copy, byte map, and pinned configuration provenance. Use PostgreSQL `bytea` for original bytes; Node's `Buffer` is a byte sequence, and JavaScript string indexes count UTF-16 code units, not source bytes. See [Node Buffer](https://nodejs.org/api/buffer.html) and [PostgreSQL binary data](https://www.postgresql.org/docs/current/datatype-binary.html).
2. Give each source-local operation a stable retry key based on source identity and pinned input/configuration. Keep operational attempt IDs distinct so retry charges and failures remain accountable. Write a completed raw discovery response and its proposal rows durably before later validation or semantic work. Persist validation findings beside those proposals, including missing, ambiguous, or invalid ranges.
3. Let the evidence resolver own quote/range resolution; see [source evidence](source-capture-and-evidence.md). Let the model-dispatch guide own pinned requests and attempt provenance; see [model dispatch](structured-model-calls.md). Let [candidate admission and support](candidate-admission-and-support.md) own semantic support decisions. Do not reimplement these components here.
4. In the persistence adapter, use Drizzle parameterized writes, uniqueness constraints, and transactions for a logically atomic domain transition. An illustrative Drizzle shape is:

```ts
// Illustrative pseudocode only. Table names and atomicity boundary are unresolved.
await db.transaction(async (tx) => {
  await persistDecision(tx, decision);
  if (decision.outcome === "accept") {
    await persistAcceptedClaimsAndPassages(tx, verifiedPayload);
  }
});
```

Drizzle documents transaction and conflict-handling APIs, but their existence does not settle this project's transaction boundary: [transactions](https://orm.drizzle.team/docs/transactions), [PostgreSQL inserts/upserts](https://orm.drizzle.team/docs/insert).

5. Keep current profile and article data as disposable projections keyed to the accepted evidence/canon version. Rebuild from retained records after changed support, accepted identity reconciliation, or publication rules. Never delete or rewrite the evidence to make a projection fit.
6. Record completion only after the required evidence and publication writes are committed. An interrupted operation resumes from durable results and can safely repeat idempotent writes; exact completion/finalization behavior remains D-008.

When defining D-008, include stale-state and conflicting-retry checks. A decision made against canon version V must not blindly apply after its relevant evidence has changed. One technique is to compare the decision's observed version/input identity with the state loaded inside the write transaction, then conditionally finalize only when they still match. For an existing retry key, compare the retained outcome and support with the incoming result rather than overwriting a different decision. Preserve any stale or conflicting outcome for inspection. Exact locking, comparison fields, recomputation, and version-increment policy remain D-008; this technique adds no table or approved transaction boundary.

## Worked example

Suppose the complete source is the ASCII text `Mira is a scout.` Discovery proposes an occupation assertion, and its proposed evidence quote is exactly `Mira is a scout.` This small trace shows retry and admission ordering. Its function names and record shapes are illustrative pseudocode, not adopted contracts.

```ts
// Illustrative pseudocode; storage helpers and exact keys are not adopted contracts.
const original = Buffer.from("Mira is a scout.", "utf8");
const sourceHash = sha256(original); // deterministic hash of these exact bytes
const configHash = sha256(Buffer.from("toy-config-v1", "utf8"));
const sourceKey = `example.md:${sourceHash}:${configHash}`;

// First attempt: persist source and raw proposal before resolving or deciding.
await persistSource({ key: sourceKey, originalBytes: original, documentOrder: 1 });
const proposal = {
  candidateKey: "example.md:occupation:1",
  proposedClaim: { subject: "Mira", predicate: "occupation", value: "scout" },
  proposedQuote: "Mira is a scout.",
};
await persistDiscoveryResult({ sourceKey, rawResponse: proposal, proposals: [proposal] });
// Crash here. No verified claim or acceptance decision has been written.

// Retry: exact source/config finds the durable proposal, so do not call discovery again.
const retained = await findDiscoveryResult(sourceKey);
const evidence = await evidenceResolver.resolve({
  originalBytes: original,
  quote: retained.proposals[0].proposedQuote,
}); // use the source guide's resolver; expected result: verified [0,16)
if (evidence.status !== "verified") {
  await persistFinding(sourceKey, evidence);
  throw new Error("proposal remains inspectable; no claim accepted");
}

// Deterministic byte verification is not semantic admission. A separate decision
// evaluates the complete source and proposal; this toy example records accept.
const decision = await recordDecision({
  sourceKey,
  candidateKey: retained.proposals[0].candidateKey,
  outcome: "accept",
  evidence: [{ startByte: evidence.startByte, endByte: evidence.endByte }],
});
if (decision.outcome === "accept") {
  await persistAcceptedClaim({ ...retained.proposals[0].proposedClaim, decisionId: decision.id, evidence });
}
```

The stable `sourceKey` combines the example path, exact source hash, and pinned configuration hash for retry lookup; it is not a new source uniqueness rule or permission to store several processing configurations in one build. The crash leaves one durable source and proposal, but no claim. The retry reuses that result, asks the source resolver for verified evidence, stores a separate cited acceptance decision, and persists the occupation claim once. Reproduce the expected quote with `Buffer.from("Mira is a scout.").subarray(0,16).toString("utf8")`. This storage example defines no second resolution algorithm. In production the accept must be backed by the semantic decision procedure and complete-source checks; the toy outcome does not define that policy. D-005 leaves exact keys/payloads open, and D-008 leaves the atomic transaction and completion boundary open.

## Failure modes and verification

- **String offsets used as bytes:** non-ASCII text or CRLF can shift citations. Recompute every cited range against original bytes and compare the quoted bytes exactly.
- **Raw proposal overwritten by cleaned output:** retain the original response and separate validation/admission results.
- **Retry duplicates claims or repeats paid discovery:** interrupt between durable stages, retry identical inputs, and inspect unique persisted results and call history.
- **Stale decision or conflicting retry:** change relevant canon after computing a decision, or retry the same decision key with different support. Verify the chosen D-008 contract detects the mismatch without silently overwriting accepted evidence or incrementing canon twice.
- **Projection becomes the only record:** delete/rebuild a development projection from sources, accepted claims, decisions, and passages; compare supported meaning and citations.
- **Completion precedes publication:** interrupt before and after each durable boundary; ensure an incomplete required article is not reported as successful.
- **History lost during revision:** verify newer-document precedence while earlier evidence remains available; ensure same-document conflicts are retained unresolved.

The evidence and acceptance requirements are [KNOW-002](../../specification.md#know-002-newer-documents-take-precedence-without-erasing-evidence) and [KNOW-003](../../specification.md#know-003-preserve-the-rebuildable-evidence-record). [D-005](../../specification.md#d-005-source-discovery-and-evidence-contract) leaves exact candidate/value payloads open; [D-008](../../specification.md#open-questions-for-development) leaves exact idempotency/finalization boundaries open.

## Application to the specification

This guide applies SRC-001, SRC-003, CAP-002, CAP-003, CAP-004, KNOW-001 through KNOW-003, OPS-001, and TECH-004. It preserves the nine lore tables as the proposed schema boundary, including SOURCE_DOCUMENTS, CANDIDATES, DECISIONS, CLAIMS, PASSAGES, ENTITY_CURRENT, ENTITY_EMBEDDINGS, and ARTICLES plus ENTITIES. It does not settle their SQL nullability, keys, JSON shapes, FK policies, versioning, or transaction boundaries. No per-trait table, processing-version history, or separate temporal solver is implied. See [D-005](../../specification.md#d-005-source-discovery-and-evidence-contract) and [open questions](../../specification.md#open-questions-for-development) for D-008 and D-011.
