import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadReview } from "./blocks-verification-evidence.js";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { sha256 } from "../domains/document/decisions/integrity.js";

test("source review loading preserves independent provenance and exact evidence without network or writes", async () => {
  const sourcePath = authorizedDiscoverySources()[0]!;
  const source = decodeCapturedSource(await readFile(sourcePath));
  const end = source.bytes.indexOf(10);
  const text = source.bytes.subarray(0, end).toString("utf8");
  const artifact = {
    contract_version: "blocks-source-review-v1",
    verdict: "PASS",
    reviewer: "GPT-6.1 Sol xhigh independent reviewer",
    cases: [
      {
        source_path: sourcePath,
        source_sha256: source.sha256,
        question_id: "title-review-test",
        question_kind: "title",
        expected: "yes",
        reason: "Source-backed review diagnostic",
        evidence: { start_byte: 0, end_byte: end, text },
      },
    ],
  };
  const directory = await mkdtemp(join(tmpdir(), "adv-pub-review-evidence-"));
  const path = join(directory, "source-review.json");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Read-only evidence loading must not dispatch network requests");
  };
  try {
    await writeFile(path, JSON.stringify(artifact));
    const before = await readFile(path);
    const loaded = await loadReview(path);
    assert.deepEqual(loaded.artifact, artifact);
    assert.equal(
      loaded.cases[0]?.evidence_sha256,
      sha256(
        JSON.stringify({
          question_id: "title-review-test",
          question_kind: "title",
          expected: "yes",
          source_sha256: source.sha256,
          start_byte: 0,
          end_byte: end,
          evidence_sha256: sha256(source.bytes.subarray(0, end)),
          map_note_sha256: null,
        }),
      ),
    );
    assert.deepEqual(await readFile(path), before);
    await writeFile(path, JSON.stringify({ ...artifact, verdict: "FAIL" }));
    await assert.rejects(loadReview(path), /independent PASS provenance/);
    await writeFile(path, JSON.stringify({ ...artifact, cases: [{ ...artifact.cases[0], source_sha256: "wrong" }] }));
    await assert.rejects(loadReview(path), /Source-review hash differs/);
    await writeFile(
      path,
      JSON.stringify({
        ...artifact,
        cases: [{ ...artifact.cases[0], evidence: { start_byte: 0, end_byte: end, text: "altered" } }],
      }),
    );
    await assert.rejects(loadReview(path), /evidence span differs/);
    await writeFile(path, JSON.stringify({ ...artifact, cases: [artifact.cases[0], artifact.cases[0]] }));
    await assert.rejects(loadReview(path), /Duplicate source-reviewed question IDs/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
