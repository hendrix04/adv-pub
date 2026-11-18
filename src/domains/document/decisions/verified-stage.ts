import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestSchema, sha256, type Manifest } from "./contracts.js";
import { assertExecutionCompatibility } from "./retained-stage.js";

type VerifiedStage = { digest: string; manifest: Manifest; evidence: Map<string, string> };
const verified = new Map<string, VerifiedStage>();
const loading = new Map<string, Promise<VerifiedStage>>();

function evidencePaths(directory: string, manifest: Manifest): string[] {
  const paths = [join(directory, "source.md")];
  if (manifest.contract_version === "decision-questions-v2") {
    paths.push(join(directory, "question-targets.json"), join(directory, "decision-policy.json"), join(directory, "entity-rules.json"));
    paths.push(...Object.values(manifest.config.upstream_paths));
  } else {
    paths.push(join(directory, "discovery-proposals.json"));
    if (manifest.decision_kind === "entity_type") paths.push(join(directory, "ontology-criteria.json"), join(manifest.alias_directory, "result.json"));
  }
  return [...new Set(paths)];
}

async function evidenceHashes(paths: Iterable<string>): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      [...paths].map(async (path) => {
        try {
          return [path, sha256(await readFile(path))] as const;
        } catch (error) {
          if (path.endsWith("/entity-rules.json") && (error as NodeJS.ErrnoException).code === "ENOENT") return [path, "absent"] as const;
          throw error;
        }
      }),
    ),
  );
}

function sameEvidence(left: Map<string, string>, right: Map<string, string>): boolean {
  return left.size === right.size && [...left].every(([path, hash]) => right.get(path) === hash);
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

/** A worker reuses a checked stage only while every retained input still has the same bytes. */
export async function loadVerifiedStage(directory: string): Promise<Manifest> {
  const bytes = await readFile(join(directory, "manifest.json"));
  const digest = sha256(bytes);
  const cached = verified.get(directory);
  if (cached?.digest === digest && sameEvidence(cached.evidence, await evidenceHashes(cached.evidence.keys()))) return cached.manifest;

  const key = `${directory}:${digest}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = (async () => {
      const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
      const paths = evidencePaths(directory, manifest);
      const evidence = await evidenceHashes(paths);
      await assertExecutionCompatibility(manifest, directory);
      if (sha256(await readFile(join(directory, "manifest.json"))) !== digest) throw new Error("Retained stage manifest changed during validation");
      if (!sameEvidence(evidence, await evidenceHashes(paths))) throw new Error("Retained stage evidence changed during validation");
      freeze(manifest);
      const entry = { digest, manifest, evidence };
      verified.set(directory, entry);
      if (verified.size > 2) verified.delete(verified.keys().next().value!);
      return entry;
    })().finally(() => loading.delete(key));
    loading.set(key, pending);
  }
  const entry = await pending;
  if (!sameEvidence(entry.evidence, await evidenceHashes(entry.evidence.keys()))) throw new Error("Retained stage evidence changed during validation");
  return entry.manifest;
}
