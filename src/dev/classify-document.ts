import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { createProcessDocumentWorkflow } from "../workflows/process-document.js";
import { createJevDecisionBatchWorkflow } from "../workflows/jev-decision-batch.js";
import { readJson, writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { classificationManifestSchema, aliasManifestSchema } from "../domains/document/decisions/contracts.js";
import { questionPolicySchema } from "../domains/document/decisions/policy.js";
import type { QuestionPolicy } from "../domains/document/decisions/policy.js";
import { catalogResumeBlocksDirectory } from "../domains/document/classification/catalog-operation.js";
import { jevExecutionPolicy } from "../domains/document/decisions/execution-policy.js";

const args = process.argv.slice(2);
let verificationProbe = args.includes("--verify-retry");
let blocksDirectory: string | undefined;
let policyPath: string | undefined;
const paths: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  if (arg === "--verify-retry") continue;
  if (arg === "--blocks" || arg === "--policy") {
    const next = args[++index];
    if (!next) throw new Error(`Missing value for ${arg}`);
    if (arg === "--blocks") blocksDirectory = next;
    else policyPath = next;
    continue;
  }
  if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
  paths.push(arg);
}
if (paths.length > 1)
  throw new Error("Usage: npm run classify -- [discovery-directory | classification-directory] [--blocks <blocks-operation>] [--policy <policy.json>] [--verify-retry]");
const target = resolve(paths[0] ?? "data/runs/01-unified-church-of-the-realms/iterations/iteration-043");
const resumed = /\/classifications\/([0-9a-f-]{36})$/i.exec(target);
const operationId = resumed?.[1] ?? randomUUID();
const discoveryDirectory = resumed ? resolve(target, "../..") : target;
const classificationDirectory = join(discoveryDirectory, "classifications", operationId);
let legacyResume = false;
let policy: QuestionPolicy | undefined;

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (policyPath) policy = questionPolicySchema.parse(JSON.parse(await readFile(resolve(policyPath), "utf8")));
  if (resumed) {
    const catalogInputs = join(target, "aliases", "catalog-v1", "alias-inputs.json");
    const catalogOperation = join(target, "classification-operation.json");
    if ((await exists(catalogOperation)) || (await exists(catalogInputs))) {
      if (await exists(catalogOperation)) {
        const retainedOperation = (await readJson(catalogOperation)) as { blocks_directory: string | null };
        blocksDirectory = catalogResumeBlocksDirectory(retainedOperation, blocksDirectory);
      }
      if (await exists(catalogInputs)) {
        const retained = (await readJson(catalogInputs)) as { verification_probe?: boolean };
        if (verificationProbe && !retained.verification_probe) throw new Error("Cannot enable a probe when resuming a catalog operation that was not prepared for one");
        verificationProbe = Boolean(retained.verification_probe);
      }
      if (!policy) {
        const retainedPolicy = join(target, "aliases", "catalog-v1", "decision-policy.json");
        if (await exists(retainedPolicy)) policy = questionPolicySchema.parse(JSON.parse(await readFile(retainedPolicy, "utf8")));
        else {
          const retainedManifest = join(target, "aliases", "catalog-v1", "manifest.json");
          if (await exists(retainedManifest)) policy = questionPolicySchema.parse(((await readJson(retainedManifest)) as { policy: unknown }).policy);
        }
      }
    } else {
      legacyResume = true;
      let saved: { config: Record<string, unknown> };
      try {
        saved = classificationManifestSchema.parse(await readJson(join(target, "manifest.json")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        saved = aliasManifestSchema.parse(await readJson(join(target, "aliases/manifest.json")));
      }
      if (verificationProbe && !saved.config.verification_probe) throw new Error("Cannot enable a probe when resuming a non-probe operation");
      verificationProbe = Boolean(saved.config.verification_probe);
    }
  }
  await withEmbeddedWorker(
    { name: "adv-pub-document-classification", worker: { slots: jevExecutionPolicy.maxConcurrentRequests, durableSlots: 1 }, postgres: { kind: "temporary" } },
    (hatchet) => {
      const batch = createJevDecisionBatchWorkflow(hatchet);
      const workflow = createProcessDocumentWorkflow(hatchet, batch);
      return { workflows: [workflow, batch], value: workflow };
    },
    async ({ value: workflow, waitForRun }) => {
      const run = await workflow.runNoWait({
        capability: "classify",
        discoveryDirectory,
        operationId,
        verificationProbe,
        ...(blocksDirectory ? { blocksDirectory: resolve(blocksDirectory) } : {}),
        ...(policy ? { policy } : {}),
        ...(legacyResume ? { legacyResume: true } : {}),
      });
      const runId = await run.runId;
      process.stdout.write(`${JSON.stringify({ runId, classificationDirectory, verificationProbe })}\n`);
      const details = await waitForRun(runId, { timeoutMs: 4 * 60 * 60_000, pollIntervalMs: 500 });
      await writeJsonAtomic(join(classificationDirectory, "hatchet-runs", `${runId}.json`), details ?? { status: "unknown", runId });
      if (!details?.done || details.status !== "COMPLETED") throw new Error(`Hatchet classification ${details?.status ?? "not visible"}; inspect ${classificationDirectory}`);
      process.stdout.write(`${JSON.stringify({ runId, result: details.taskRuns["classify-entities"]?.output }, null, 2)}\n`);
    },
  );
}
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
