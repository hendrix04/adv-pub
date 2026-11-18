import { withTestExecution } from "./execution-retention.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { questionPolicySchema } from "../domains/document/decisions/policy.js";
import { exploratoryStructurePolicy } from "../domains/document/blocks/policy.js";
import { withEmbeddedBlocks } from "./blocks-runtime.js";

type Options = {
  source?: string;
  output?: string;
  mode?: "new" | "resume";
  corpus: boolean;
  policy?: string;
  repeatId: string;
  provisionalPlanning: boolean;
};

function parseArgs(args: string[]): Options {
  const options: Options = { corpus: false, repeatId: "structure-repeat-v1", provisionalPlanning: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--corpus") {
      options.corpus = true;
      continue;
    }
    if (value === "--provisional-planning") {
      options.provisionalPlanning = true;
      continue;
    }
    if (!["--source", "--output", "--mode", "--policy", "--repeat-id"].includes(value)) throw new Error(`Unknown option ${value}`);
    const next = args[++index];
    if (!next) throw new Error(`Missing value for ${value}`);
    if (value === "--source") options.source = next;
    if (value === "--output") options.output = next;
    if (value === "--policy") options.policy = next;
    if (value === "--repeat-id") options.repeatId = next;
    if (value === "--mode") {
      if (next !== "new" && next !== "resume") throw new Error("--mode must be new or resume");
      options.mode = next;
    }
  }
  if (!options.output || !options.mode)
    throw new Error(
      "Usage: npm run blocks -- --source <lore.md> --output <operation-dir> --mode <new|resume> [--policy <policy.json>] [--repeat-id <id>] [--provisional-planning] | --corpus --output <root-dir> --mode <new|resume>",
    );
  if (options.corpus === Boolean(options.source)) throw new Error("Choose either --corpus or one --source");
  if (!/^[a-zA-Z0-9_-]+$/.test(options.repeatId)) throw new Error("--repeat-id may contain only letters, numbers, underscores, and hyphens");
  return options;
}

async function retainedOperationId(directory: string) {
  const saved = (await readJson(join(directory, "operation.json"))) as { operation_id?: unknown };
  if (typeof saved.operation_id !== "string") throw new Error(`Retained operation ID is missing: ${directory}`);
  return saved.operation_id;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = options.policy ? questionPolicySchema.parse(JSON.parse(await readFile(resolve(options.policy), "utf8"))) : exploratoryStructurePolicy();
  const output = resolve(options.output!);
  const sources = options.corpus ? authorizedDiscoverySources() : [resolve(options.source!)];
  await withTestExecution(output, () =>
    withEmbeddedBlocks(async ({ run }) => {
      for (const sourcePath of sources) {
        const directory = options.corpus ? join(output, basename(sourcePath, ".md")) : output;
        const operationId = options.mode === "resume" ? await retainedOperationId(directory) : randomUUID();
        const result = await run({
          capability: "blocks",
          sourcePath,
          directory,
          operationId,
          mode: options.mode!,
          policy,
          repeatId: options.repeatId,
          provisionalPlanning: options.provisionalPlanning,
        });
        assert.ok(result.result && typeof result.result === "object", "Block workflow did not return a capability result");
        process.stdout.write(`${JSON.stringify({ sourcePath, runId: result.runId, directory, result: result.result })}\n`);
      }
    }),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
