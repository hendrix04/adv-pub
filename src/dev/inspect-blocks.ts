import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { manifestSchema } from "../domains/document/decisions/contracts.js";
import { readValidatedBatch } from "../domains/document/decisions/operation.js";

if (process.argv.length !== 3) throw new Error("Usage: npm run inspect:blocks -- <operation-directory>");
const directory = resolve(process.argv[2]!);
const operation = (await readJson(join(directory, "operation.json"))) as { repeat_id: string };
const stages = [];
for (const stageName of ["title", "listIntroduction", "mapLabels", "linkPlacement"]) {
  const stageDirectory = join(directory, "stages", stageName);
  try {
    await access(stageDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      stages.push({ stage: stageName, status: "not_started" });
      continue;
    }
    throw error;
  }
  let manifest;
  try {
    manifest = manifestSchema.parse(await readJson(join(stageDirectory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const artifacts: Record<string, unknown> = { stage: stageName, status: "empty_or_planning_failed" };
    for (const name of ["empty-stage.json", "planning-failure.json", "failure.json", "result.json", "decisions.json"]) {
      try {
        artifacts[name] = await readJson(join(stageDirectory, name));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT") artifacts[`${name}_error`] = String(readError);
      }
    }
    stages.push(artifacts);
    continue;
  }
  const batches = await Promise.all(
    manifest.batches.map(async (batch) => {
      const primary = await readValidatedBatch(stageDirectory, manifest, batch.batch_id);
      const repeat = await readValidatedBatch(stageDirectory, manifest, batch.batch_id, operation.repeat_id);
      return {
        batch_id: batch.batch_id,
        question_ids: batch.candidate_ids,
        primary: primary ? { response_path: primary.responsePath, decisions: primary.decisions } : null,
        fresh_repeat: repeat ? { response_path: repeat.responsePath, decisions: repeat.decisions } : null,
      };
    }),
  );
  let result: unknown;
  let decisions: unknown;
  try {
    result = await readJson(join(stageDirectory, "result.json"));
  } catch {
    result = null;
  }
  try {
    decisions = await readJson(join(stageDirectory, "decisions.json"));
  } catch {
    decisions = null;
  }
  stages.push({ stage: stageName, manifest, result, decisions, batches });
}
process.stdout.write(
  JSON.stringify(
    {
      directory,
      operation,
      source_manifest: await readJson(join(directory, "source-manifest.json")),
      result: await readJson(join(directory, "result.json")),
      items: await readJson(join(directory, "items.json")),
      layout: await readJson(join(directory, "layout.json")),
      layout_view_markdown: await readFile(join(directory, "layout-view.md"), "utf8"),
      stages,
      inspection_performed_network_requests: false,
    },
    null,
    2,
  ) + "\n",
);
