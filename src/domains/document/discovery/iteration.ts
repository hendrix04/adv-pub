import { access, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirectory, readJson, writeBytesAtomic, writeJsonAtomic } from "./artifacts.js";
import type { CapturedSource } from "./source.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type SourceManifest = {
  source_path: string;
  source_name: string;
  byte_length: number;
  sha256: string;
  encoding: "utf-8";
  reading_copy: "source.md";
  original_bytes_preserved: true;
};

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function safeSourceKey(path: string): string {
  const value = basename(path, extname(path)).replace(/[^A-Za-z0-9_-]/g, "-");
  if (!value) throw new Error("Source path has no safe filename");
  return value;
}

function manifestFor(path: string, captured: CapturedSource): SourceManifest {
  return {
    source_path: path,
    source_name: basename(path),
    byte_length: captured.byteLength,
    sha256: captured.sha256,
    encoding: "utf-8",
    reading_copy: "source.md",
    original_bytes_preserved: true,
  };
}

export async function findReusableIteration(
  sourceKey: string,
  sourceHash: string,
  configurationHash: string,
  operationId: string,
  forceNewIteration: boolean,
): Promise<string | undefined> {
  const base = join(rootDirectory, "data/runs", sourceKey, "iterations");
  if (!(await exists(base))) return undefined;
  const candidates = (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^iteration-\d{3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of candidates) {
    const directory = join(base, name);
    if (!(await exists(join(directory, "response.json")))) continue;
    try {
      const manifest = (await readJson(join(directory, "source-manifest.json"))) as SourceManifest;
      const provenance = (await readJson(join(directory, "provenance.json"))) as Record<string, unknown>;
      if (manifest.sha256 !== sourceHash || provenance.configuration_sha256 !== configurationHash) continue;
      if (provenance.operation_id === operationId) return directory;
      if (!forceNewIteration) return directory;
    } catch {
      // Keep partial results inspectable; they are not compatible for reuse.
    }
  }
  return undefined;
}

export async function newIterationDirectory(sourceKey: string): Promise<string> {
  const base = join(rootDirectory, "data/runs", sourceKey, "iterations");
  await ensureDirectory(base);
  const entries = (await readdir(base)).filter((name) => /^iteration-\d{3}$/.test(name));
  const next = entries.reduce((max, name) => Math.max(max, Number(name.slice(-3))), 0) + 1;
  return join(base, `iteration-${String(next).padStart(3, "0")}`);
}

export async function retainSource(directory: string, path: string, captured: CapturedSource): Promise<void> {
  await ensureDirectory(directory);
  const copyPath = join(directory, "source.md");
  if (await exists(copyPath)) {
    const existing = await readFile(copyPath);
    if (!existing.equals(captured.bytes)) throw new Error("Existing iteration contains different source bytes; a new iteration is required");
  } else {
    await writeBytesAtomic(copyPath, captured.bytes);
  }
  await writeJsonAtomic(join(directory, "source-manifest.json"), manifestFor(path, captured));
}

export async function baseProvenance(directory: string): Promise<Record<string, unknown>> {
  return (await exists(join(directory, "provenance.json"))) ? ((await readJson(join(directory, "provenance.json"))) as Record<string, unknown>) : {};
}
