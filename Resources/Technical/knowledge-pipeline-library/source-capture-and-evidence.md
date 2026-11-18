# Source capture and evidence

## Purpose and when to use it

Use this capability at ingestion and whenever a claim, passage, or published statement must be tied back to a source. It keeps source bytes authoritative while giving semantic stages a complete, readable copy and exact citation coordinates. Discovery and model dispatch are covered in [candidate admission and support](candidate-admission-and-support.md) and [structured model calls](structured-model-calls.md).

## Inputs, outputs, and invariants

Input is one complete supplied Markdown file as bytes, with its stable source identity and processing configuration. Output is an immutable byte record, SHA-256 digest, exact UTF-8 decoded reading copy, source order, and evidence references expressed as zero-based half-open byte spans `[start_byte, end_byte)` into the original.

Keep these invariants:

- Decode strict UTF-8; invalid input fails capture rather than replacing bytes.
- Preserve Markdown framing, line endings, whitespace, comments, tables, lists, and quotations in the reading copy.
- Because the reading copy is the exact decode, its UTF-8 byte positions map identically to original bytes. JavaScript string indexes count UTF-16 code units and are not byte offsets.
- Evidence quotes must resolve to the proposed span. Repeated quotes require disambiguating adjacent context; never select the first matching occurrence arbitrarily.
- A proposal may remain stored with missing, ambiguous, or invalid evidence. Verified evidence is required before claim acceptance or publication.

## Practical method

1. Read the input once as raw bytes. Hash those bytes and persist them before semantic processing.
2. Decode using fatal UTF-8 validation. Store the decoded text byte-for-byte as the complete reading copy; do not normalize Markdown or line endings.
3. Pass complete source text to each required semantic boundary. Add source identity and candidate pointers separately so transport framing is not confused with source content.
4. Resolve model-proposed exact quotes deterministically against the reading copy. Convert match positions to UTF-8 byte positions, check any adjacent context, and record a verified range or an explicit validation finding.
5. Before a semantic call, compare the provided complete text, hash, and byte length with the stored captured source. If it does not fit, reduce the candidate batch; if one decision plus its required complete source cannot fit, fail the document rather than truncate.

## Worked example

This runnable Node.js example demonstrates the ambiguity and resolution path. Production payload keys and persistence grouping remain open under D-005.

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

function decodeStrictUtf8(bytes) {
  // ignoreBOM:true includes the BOM code point so decoded UTF-8 round-trips.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function allOccurrences(text, quote) {
  if (quote.length === 0) return [];
  const found = [];
  for (let from = 0; ; ) {
    const start = text.indexOf(quote, from);
    if (start < 0) return found;
    found.push(start);
    from = start + 1;
  }
}

function resolveUnique(text, originalBytes, quote, context = {}) {
  if (quote.length === 0) return { status: "invalid" };
  const occurrences = allOccurrences(text, quote);
  if (occurrences.length === 0) return { status: "missing" };
  const matches = occurrences.filter((start) =>
    text.slice(0, start).endsWith(context.left ?? "") &&
    text.slice(start + quote.length).startsWith(context.right ?? ""),
  );
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) return { status: "ambiguous", count: matches.length };

  const start = matches[0]; // UTF-16 index used only to locate text in memory.
  const startByte = Buffer.byteLength(text.slice(0, start), "utf8");
  const endByte = startByte + Buffer.byteLength(quote, "utf8");
  const actual = originalBytes.subarray(startByte, endByte).toString("utf8");
  if (actual !== quote) return { status: "invalid" };
  return { status: "verified", startByte, endByte, quote: actual };
}

const original = Buffer.from(
  "\uFEFF# Relato\r\n<!-- contexto -->\r\nLa drágona Ala vio a Ala.\r\n",
  "utf8",
);
const sha256 = createHash("sha256").update(original).digest("hex");
const readingCopy = decodeStrictUtf8(original);
assert.equal(Buffer.from(readingCopy, "utf8").compare(original), 0);
assert.equal(sha256.length, 64);
assert.equal(resolveUnique(readingCopy, original, "").status, "invalid");
assert.equal(resolveUnique(readingCopy, original, "Missing").status, "missing");

// The quote appears twice, so a quote-only proposal remains ambiguous.
assert.deepEqual(resolveUnique(readingCopy, original, "Ala"), {
  status: "ambiguous",
  count: 2,
});

// Adjacent context selects the first mention and yields verified byte bounds.
const evidence = resolveUnique(readingCopy, original, "Ala", {
  left: "La drágona ",
  right: " vio a Ala.",
});
assert.deepEqual(evidence, {
  status: "verified",
  startByte: 44,
  endByte: 47,
  quote: "Ala",
});
assert.equal(original.subarray(evidence.startByte, evidence.endByte).toString(), "Ala");
const changedCopy = readingCopy.replace("drágona", "dragona");
assert.equal(resolveUnique(changedCopy, original, "Ala", {
  left: "La dragona ",
  right: " vio a Ala.",
}).status, "invalid");

// Malformed UTF-8 fails instead of producing a lossy citation copy.
assert.throws(() => decodeStrictUtf8(Buffer.from([0xc3, 0x28])), TypeError);
```

The example's Unicode character before the quote means its UTF-16 text index differs from the UTF-8 byte offset. The resolver converts that index to bytes and verifies the quote against the original byte slice; it returns missing, ambiguous, and invalid outcomes without selecting an arbitrary occurrence. `TextDecoder` must preserve a leading BOM for byte-identical reading-copy round trips; Node documents `ignoreBOM: true` as including the BOM in decoded output and `fatal: true` as throwing on malformed input ([Node.js TextDecoder](https://nodejs.org/api/util.html#class-utiltextdecoder)). The example also uses Node's documented [`Buffer.byteLength`](https://nodejs.org/api/buffer.html#static-method-bufferbytelengthstring-encoding) and [`createHash`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) APIs.

## Failure modes and verification

- **Invalid UTF-8:** reject capture and preserve a diagnosable ingestion failure; do not lossy-decode.
- **Transformed reading copy:** if line endings, BOM, comments, whitespace, or Markdown framing changed, identity byte mapping no longer holds. Restore the exact decoded source; any transformed-source policy requires an approved specification change.
- **Repeated quotation:** require enough surrounding source context to distinguish occurrences; otherwise keep the evidence unresolved.
- **Incorrect boundary:** independently slice the original bytes at `[start_byte, end_byte)` and compare the decoded bytes with the exact quote.
- **Truncated semantic source:** inspect the actual outbound source text, hash, and byte length against storage at every admission and support boundary.

The current source contract and evidence requirements are [SRC-001](../../specification.md#src-001-complete-ordered-source-corpus), [SRC-003](../../specification.md#src-003-complete-context-for-semantic-decisions), [CAP-002](../../specification.md#cap-002-faithful-assertions-and-evidence), and [D-005](../../specification.md#d-005-source-discovery-and-evidence-contract).

## Application to the specification

Apply this guide to complete-source capture, citations, retained passages, and source-support checks. The exact source-local payload, candidate keys, span payload schema, and row grouping remain unresolved under D-005. Preserve proposals before resolving evidence and keep validation findings separate. The specification's `normalized_text` storage field holds the exact decoded reading copy under D-005; its name does not authorize text transformations. Citation coordinates remain original UTF-8 bytes, not JavaScript string offsets.
