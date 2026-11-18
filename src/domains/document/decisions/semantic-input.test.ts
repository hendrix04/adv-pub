import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { loadRetainedSource } from "./semantic-input.js";
import { decodeCapturedSource, sourceComponent } from "../discovery/source.js";
const source = decodeCapturedSource(Buffer.from("\ufeff“x”\r\n🧙 UCR"));
test("original Unicode byte evidence rejects split surrogates and invalid offsets", () => {
  const start = source.text.indexOf("🧙");
  assert.equal(sourceComponent(source, start, start + 2).text, "🧙");
  assert.equal(sourceComponent(source, 0, source.text.length).end_byte, source.byteLength);
  for (const offset of [-1, 0.5, start + 1, source.text.length + 1]) assert.throws(() => sourceComponent(source, offset, source.text.length));
});
test("source-only loading requires authorized identity and intact manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ap25-source-"));
  await writeFile(join(directory, "source.md"), source.bytes);
  const manifest = {
    source_path: resolve("Resources/Lore/09-a-gazetteer-of-the-realms.md"),
    sha256: source.sha256,
    byte_length: source.byteLength,
  };
  await writeFile(join(directory, "source-manifest.json"), JSON.stringify(manifest));
  assert.equal((await loadRetainedSource(directory)).captured.sha256, source.sha256);
  await writeFile(join(directory, "source-manifest.json"), JSON.stringify({ ...manifest, byte_length: 1 }));
  await assert.rejects(loadRetainedSource(directory));
});

test("compatible retained sources from another checkout require the exact authorized document bytes", async () => {
  const sourcePath = resolve("Resources/Lore/01-unified-church-of-the-realms.md");
  const bytes = await readFile(sourcePath);
  const captured = decodeCapturedSource(bytes);
  const directory = await mkdtemp(join(tmpdir(), "ap27-compatible-source-"));
  await writeFile(join(directory, "source.md"), bytes);
  const manifest = {
    source_path: `/previous/checkout/Resources/Lore/${basename(sourcePath)}`,
    sha256: captured.sha256,
    byte_length: captured.byteLength,
  };
  await writeFile(join(directory, "source-manifest.json"), JSON.stringify(manifest));
  assert.equal((await loadRetainedSource(directory)).original.source_path, manifest.source_path);

  await writeFile(join(directory, "source-manifest.json"), JSON.stringify({ ...manifest, sha256: "0".repeat(64) }));
  await assert.rejects(loadRetainedSource(directory), /current authorized document/);
  await writeFile(join(directory, "source-manifest.json"), JSON.stringify({ ...manifest, source_path: "/previous/checkout/Resources/Lore/other.md" }));
  await assert.rejects(loadRetainedSource(directory), /nine-document allowlist/);
});

test("all nine retained documents load without altering candidate IDs or strings", async () => {
  const { readdir } = await import("node:fs/promises");
  const { loadDiscoveryCandidates, sourceCandidates } = await import("./semantic-input.js");
  const { sha256 } = await import("./contracts.js");
  const files = (await readdir("Resources/Lore")).filter((name) => /^0[1-9]-/.test(name)).sort();
  assert.equal(files.length, 9);
  for (const name of files) {
    const directory = await mkdtemp(join(tmpdir(), "ap25-retained-"));
    const bytes = await readFile(join("Resources/Lore", name));
    const captured = decodeCapturedSource(bytes);
    const proposal = JSON.stringify({ entities: ["UCR", "UCR", "🧙"] }); // explicit unit fixture, not discovery evidence
    await writeFile(join(directory, "source.md"), bytes);
    await writeFile(
      join(directory, "source-manifest.json"),
      JSON.stringify({
        source_path: resolve("Resources/Lore", name),
        sha256: captured.sha256,
        byte_length: bytes.length,
      }),
    );
    await writeFile(join(directory, "decoded-proposals.json"), proposal);
    const result = await loadDiscoveryCandidates(directory);
    assert.deepEqual(result.candidates, sourceCandidates(["UCR", "UCR", "🧙"], captured, sha256(`${directory}\n${sha256(proposal)}`)));
    await writeFile(join(directory, "source.md"), Buffer.concat([bytes, Buffer.from("altered")]));
    await assert.rejects(loadDiscoveryCandidates(directory), /manifest/);
  }
});
