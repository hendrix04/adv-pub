import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { questionPolicySchema } from "../domains/document/decisions/policy.js";
import { exploratoryAssociationPolicy } from "../domains/document/association/policy.js";
import { sha256 } from "../domains/document/decisions/integrity.js";
import { withEmbeddedBlocks } from "./blocks-runtime.js";
import { withTestExecution } from "./execution-retention.js";

const corpusEntrySchema = z
  .object({
    document_id: z.string().regex(/^\d{2}$/u),
    source_path: z.string(),
    structure_directory: z.string(),
    classification_directory: z.string(),
  })
  .passthrough();
const corpusSchema = z.object({ documents: z.array(corpusEntrySchema).min(1) }).strict();
type CorpusEntry = z.infer<typeof corpusEntrySchema>;
type Options = {
  source?: string;
  structure?: string;
  classification?: string;
  corpusManifest?: string;
  output: string;
  mode: "new" | "resume";
  corpus: boolean;
  policy?: string;
  repeatId: string;
  includeOriginNotes: boolean;
};

function parseArgs(args: string[]): Options {
  const options: Options = {
    output: "",
    mode: "new",
    corpus: false,
    repeatId: "association-repeat-v1",
    includeOriginNotes: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--corpus") {
      options.corpus = true;
      continue;
    }
    if (arg === "--no-origin-notes") {
      options.includeOriginNotes = false;
      continue;
    }
    if (!["--source", "--structure", "--classification", "--corpus-manifest", "--output", "--mode", "--policy", "--repeat-id"].includes(arg))
      throw new Error(`Unknown option ${arg}`);
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === "--source") options.source = value;
    if (arg === "--structure") options.structure = value;
    if (arg === "--classification") options.classification = value;
    if (arg === "--corpus-manifest") options.corpusManifest = value;
    if (arg === "--output") options.output = value;
    if (arg === "--policy") options.policy = value;
    if (arg === "--repeat-id") options.repeatId = value;
    if (arg === "--mode") {
      if (value !== "new" && value !== "resume") throw new Error("--mode must be new or resume");
      options.mode = value;
    }
  }
  if (!options.output) throw new Error("--output is required");
  if (options.corpus) {
    if (!options.corpusManifest || options.source || options.structure || options.classification) throw new Error("Corpus mode requires only --corpus-manifest with --output");
  } else if (!options.source || !options.structure || !options.classification || options.corpusManifest) {
    throw new Error("Single-document mode requires --source, --structure, --classification, and --output");
  }
  if (!/^[a-zA-Z0-9_-]+$/u.test(options.repeatId)) throw new Error("--repeat-id may contain only letters, numbers, underscores, and hyphens");
  return options;
}

async function readOperationId(directory: string) {
  const operation = (await readJson(join(directory, "operation.json"))) as { operation_id?: unknown };
  if (typeof operation.operation_id !== "string") throw new Error(`Retained association operation ID is missing: ${directory}`);
  return operation.operation_id;
}

async function checkLedger() {
  const value = process.env.BB_LIVE_COST_LEDGER;
  if (!value || resolve(value) !== resolve(".kiro/execution/AP-28/live-cost-ledger.json"))
    throw new Error("Set BB_LIVE_COST_LEDGER to .kiro/execution/AP-28/live-cost-ledger.json before association runs");
  const ledger = (await readJson(resolve(value))) as { capUsd?: number; spentUsd?: number; taskKeys?: string[] };
  if (ledger.capUsd !== 5 || !Array.isArray(ledger.taskKeys) || !ledger.taskKeys.includes("AP-28") || !Number.isFinite(ledger.spentUsd))
    throw new Error("AP-28 live-cost ledger is invalid");
}

async function loadCorpus(path: string): Promise<CorpusEntry[]> {
  const parsed = corpusSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
  const documents = parsed.documents;
  if (new Set(documents.map((entry) => entry.document_id)).size !== documents.length) throw new Error("Corpus manifest has duplicate document IDs");
  if (documents.some((entry, index) => index > 0 && entry.document_id <= documents[index - 1]!.document_id))
    throw new Error("Corpus documents must be in ascending document order");
  return documents;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await checkLedger();
  const policy = options.policy ? questionPolicySchema.parse(JSON.parse(await readFile(resolve(options.policy), "utf8"))) : exploratoryAssociationPolicy();
  const output = resolve(options.output);
  const entries = options.corpus
    ? await loadCorpus(options.corpusManifest!)
    : [
        {
          document_id: basename(options.source!, ".md").slice(0, 2),
          source_path: resolve(options.source!),
          structure_directory: resolve(options.structure!),
          classification_directory: resolve(options.classification!),
        },
      ];
  if (options.corpus && options.mode === "new") {
    await mkdir(output, { recursive: true });
    await writeJsonAtomic(join(output, "run-manifest.json"), {
      contract_version: "association-corpus-run-v1",
      document_ids: entries.map((entry) => entry.document_id),
      mode: options.mode,
      policy_sha256: sha256(JSON.stringify(policy)),
      started_at_utc: new Date().toISOString(),
    });
  }
  const body = () =>
    withEmbeddedBlocks(async ({ run }) => {
      for (const entry of entries) {
        const directory = options.corpus ? join(output, entry.document_id) : output;
        const operationId = options.mode === "resume" ? await readOperationId(directory) : randomUUID();
        const runResult = await run({
          capability: "associate",
          sourcePath: entry.source_path,
          structureDirectory: entry.structure_directory,
          classificationDirectory: entry.classification_directory,
          directory,
          operationId,
          mode: options.mode,
          repeatId: options.repeatId,
          policy,
          includeOriginNotes: options.includeOriginNotes,
        });
        assert.equal(runResult.result.status, "complete", "Association workflow did not return a complete capability result");
        process.stdout.write(
          `${JSON.stringify({ document_id: entry.document_id, source_path: entry.source_path, runId: runResult.runId, directory, result: runResult.result })}\n`,
        );
      }
    });
  if (options.corpus) await withTestExecution(output, body, resolve(".kiro/execution/AP-28"));
  else await body();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
