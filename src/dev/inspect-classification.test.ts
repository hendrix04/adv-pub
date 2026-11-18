import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { writeBytesAtomic, writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { prepareCatalogAliasStage } from "../domains/document/aliases/operation.js";
import { exploratoryClassificationPolicy } from "../domains/document/classification/policy.js";
import { sha256 } from "../domains/document/decisions/contracts.js";

test("read-only inspection reports aliasIdentity evidence before entityQualification creates the operation record", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap27-aliasIdentity-inspect-"));
  try {
    const discovery = join(root, "iterations", "iteration-001");
    await mkdir(discovery, { recursive: true });
    const source = decodeCapturedSource(Buffer.from("Alpha Order and A. Beta Order and B."));
    await writeBytesAtomic(join(discovery, "source.md"), source.bytes);
    await writeJsonAtomic(join(discovery, "source-manifest.json"), {
      source_path: "Resources/Lore/01-unified-church-of-the-realms.md",
      sha256: source.sha256,
      byte_length: source.byteLength,
    });
    await writeFile(join(discovery, "decoded-proposals.json"), JSON.stringify({ entities: ["Alpha Order", "Beta Order"] }));
    const operationId = "12345678-1234-1234-1234-123456789012";
    const policy = exploratoryClassificationPolicy();
    await prepareCatalogAliasStage({
      capability: "classify",
      discoveryDirectory: discovery,
      operationId,
      policy,
      inputLimit: 32_000,
      endpointPreflight: { checked_at_utc: "fixture", endpoint: { tag: "typesafe" }, inputLimit: 32_000 },
    });

    const classificationDirectory = join(discovery, "classifications", operationId);
    const inspected = spawnSync(process.execPath, ["--import", "tsx", resolve("src/dev/inspect-classification.ts"), classificationDirectory], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(inspected.status, 0, inspected.stderr);
    const output = JSON.parse(inspected.stdout);
    assert.equal(output.aliasIdentity.status, "partial_or_collected");
    assert.equal(output.aliasIdentity.manifest.stage_id, "catalog-aliases-v1");
    assert.equal(output.aliasIdentity.batches.length, 1);
    assert.equal(output.aliasIdentity.batches[0].retained, undefined);
    assert.equal(output.entityQualification.status, "not_prepared");
    assert.equal(output.entityType.status, "not_prepared");
    assert.equal(output.source.sha256, source.sha256);
    assert.equal(sha256(await readFile(join(discovery, "source.md"))), source.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
