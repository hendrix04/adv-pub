import { createReadStream } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { manifestSchema } from "../domains/document/decisions/contracts.js";
import type { QuestionManifest } from "../domains/document/decisions/contracts.js";
import { readValidatedBatch, withValidatedBatchSnapshot } from "../domains/document/decisions/operation.js";

if (process.argv.length !== 3) throw new Error("Usage: npm run inspect:association -- <association-directory>");
const directory = resolve(process.argv[2]!);
const operation = (await readJson(join(directory, "operation.json"))) as {
  repeat_id: string;
  source_sha256: string;
  source_byte_length: number;
};

async function write(chunk: string | Buffer) {
  if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
}

async function writeRawFile(path: string) {
  for await (const chunk of createReadStream(path)) await write(chunk as Buffer);
}

async function writeJsonValue(value: unknown) {
  await write(JSON.stringify(value));
}

async function writeOptionalRawProperty(key: string, path: string, separator: () => Promise<void>) {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await separator();
  await write(`${JSON.stringify(key)}:`);
  await writeRawFile(path);
}

async function writeBestEffortRawProperty(key: string, path: string, separator: () => Promise<void>) {
  try {
    await access(path);
  } catch {
    await separator();
    await write(`${JSON.stringify(key)}:null`);
    return;
  }
  await separator();
  await write(`${JSON.stringify(key)}:`);
  await writeRawFile(path);
}

async function writeJsonTextFile(path: string) {
  await write('"');
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    await write(JSON.stringify(chunk).slice(1, -1));
  }
  await write('"');
}

async function writeStages() {
  const stagesDirectory = join(directory, "stages");
  const entries = (await readdir(stagesDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  await write("[");
  let stageIndex = 0;
  for (const entry of entries) {
    if (stageIndex++) await write(",");
    const stageDirectory = join(stagesDirectory, entry.name);
    const manifestPath = join(stageDirectory, "manifest.json");
    let manifest: QuestionManifest;
    try {
      manifest = manifestSchema.parse(await readJson(manifestPath)) as QuestionManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await write("{");
      let propertyIndex = 0;
      const separator = async () => {
        if (propertyIndex++) await write(",");
      };
      await separator();
      await write(`"directory":${JSON.stringify(stageDirectory)}`);
      await separator();
      await write('"status":"empty_or_planning_failed"');
      for (const name of ["empty-stage.json", "planning-failure.json", "failure.json", "result.json", "decisions.json"]) {
        const path = join(stageDirectory, name);
        try {
          await access(path);
          await separator();
          await write(`${JSON.stringify(name)}:`);
          await writeRawFile(path);
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== "ENOENT") {
            await separator();
            await write(`${JSON.stringify(`${name}_error`)}:${JSON.stringify(String(readError))}`);
          }
        }
      }
      await write("}");
      continue;
    }

    await write("{");
    let propertyIndex = 0;
    const separator = async () => {
      if (propertyIndex++) await write(",");
    };
    await separator();
    await write(`"directory":${JSON.stringify(stageDirectory)}`);
    await separator();
    await write('"manifest":');
    await writeRawFile(manifestPath);
    await separator();
    await write('"batches":[');
    await withValidatedBatchSnapshot(stageDirectory, manifest, async (snapshot) => {
      let batchIndex = 0;
      for (const batch of snapshot.manifest.batches) {
        if (batchIndex++) await write(",");
        const primary = await readValidatedBatch(stageDirectory, snapshot.manifest, batch.batch_id, undefined, snapshot);
        const repeat = await readValidatedBatch(stageDirectory, snapshot.manifest, batch.batch_id, operation.repeat_id, snapshot);
        await writeJsonValue({
          batch_id: batch.batch_id,
          question_ids: batch.candidate_ids,
          primary: primary ? { response_path: primary.responsePath, decisions: primary.decisions } : null,
          fresh_repeat: repeat ? { response_path: repeat.responsePath, decisions: repeat.decisions } : null,
        });
      }
    });
    await write("]");
    await writeOptionalRawProperty("result", join(stageDirectory, "result.json"), separator);
    await writeBestEffortRawProperty("decisions", join(stageDirectory, "decisions.json"), separator);
    await write("}");
  }
  await write("]");
}

await write("{");
let rootPropertyIndex = 0;
const rootSeparator = async () => {
  if (rootPropertyIndex++) await write(",");
};
await rootSeparator();
await write(`"directory":${JSON.stringify(directory)}`);
await rootSeparator();
await write('"operation":');
await writeJsonValue(operation);
await rootSeparator();
await write('"result":');
await writeRawFile(join(directory, "result.json"));
await rootSeparator();
await write(`"source":${JSON.stringify({ byte_length: operation.source_byte_length, sha256: operation.source_sha256 })}`);
for (const [key, file] of [
  ["block_subject_target_ledger", "block-subject-target-ledger.json"],
  ["mentions", "mentions.json"],
  ["found_sections", "found-sections.json"],
  ["links", "links.json"],
  ["meaning_notes", "meaning-notes.json"],
  ["origin_notes", "origin-notes.json"],
  ["contexts", "context.json"],
  ["map_place_proposals", "map-place-proposals.json"],
] as const) {
  await writeOptionalRawProperty(key, join(directory, file), rootSeparator);
}
await rootSeparator();
await write('"context_view":');
await writeJsonTextFile(join(directory, "context-view.md"));
await rootSeparator();
await write('"stages":');
await writeStages();
await rootSeparator();
await write('"inspection_performed_network_requests":false');
await write("}\n");
