import { withTestExecution } from "./execution-retention.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { withEmbeddedWorker } from "./embedded-runtime.js";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { createJevDecisionBatchWorkflow } from "../workflows/jev-decision-batch.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";
import { prepareDecisionStage, collectDecisionStage } from "../domains/document/decisions/stage.js";
import { loadRetainedSource } from "../domains/document/decisions/semantic-input.js";
import * as questions from "../domains/document/decisions/questions.js";
import { loadClassificationCriteria } from "../domains/document/decisions/semantic-input.js";
import { preflightJev } from "../domains/document/decisions/provider.js";
import { jevExecutionPolicy } from "../domains/document/decisions/execution-policy.js";
import { sha256 } from "../domains/document/decisions/contracts.js";
import { writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { catalogTransportTargets } from "./catalog-transport-targets.js";
import { auditRetainedStage } from "./retained-decision-audit.js";

async function main() {
  if (!process.env.BB_LIVE_COST_LEDGER) throw new Error("Shared live ledger required");
  const root = resolve(process.argv[2] ?? `.bb/ap25-evidence/live-${randomUUID()}`);
  return withTestExecution(root, async () => {
    await mkdir(root, { recursive: true });
    const preflight = await preflightJev();
    await writeJsonAtomic(join(root, "endpoint-preflight.json"), preflight);
    await withEmbeddedWorker(
      {
        name: "adv-pub-catalog-contract-review",
        worker: { slots: jevExecutionPolicy.maxConcurrentRequests },
        postgres: { kind: "persistent", path: join(root, "hatchet-runtime") },
      },
      (hatchet) => {
        const child = createJevDecisionBatchWorkflow(hatchet);
        return { workflows: [child], value: child };
      },
      async ({ value: child, throwIfWorkerFailed }) => {
        const names = authorizedDiscoverySources().map((path) => basename(path, ".md"));
        const reports = [];
        const focused = process.argv[3] === "--focused";
        const selected = focused ? [names[2]!, names[2]!] : process.argv[3] ? names.filter((name) => name === process.argv[3]) : names;
        let focusedCase = 0;
        assert.ok(selected.length);
        for (const name of selected) {
          throwIfWorkerFailed();
          const sourcePath = resolve("Resources/Lore", `${name}.md`);
          const bytes = await readFile(sourcePath);
          const source = decodeCapturedSource(bytes);
          const caseName = focused ? (focusedCase++ === 0 ? "single-title" : "mixed") : name;
          const retained = join(root, caseName);
          await mkdir(retained, { recursive: true });
          await writeJsonAtomic(join(retained, "source-manifest.json"), {
            source_path: sourcePath,
            sha256: source.sha256,
            byte_length: source.byteLength,
          });
          const { writeFile } = await import("node:fs/promises");
          await writeFile(join(retained, "source.md"), bytes);
          // Source-backed transport probe; this does not construct or accept a capability layout.
          assert.equal((await loadRetainedSource(retained)).captured.sha256, source.sha256);
          const { targets: originalTargets, evidence } = catalogTransportTargets(source, name);
          await writeJsonAtomic(join(retained, "transport-target-evidence.json"), {
            scope: "local transport fixtures; no capability layout",
            evidence,
          });
          const targets = focused
            ? caseName === "single-title"
              ? [originalTargets[0]!]
              : [
                  ...originalTargets,
                  questions.entityQualification({
                    id: "qualification",
                    target: {
                      candidate: {
                        names: ["The Raven Queen"],
                        members: [{ name: "The Matron of Ravens", evidence: evidence.nearby.text }],
                      },
                    },
                    entityRules: await loadClassificationCriteria(),
                  }),
                ]
            : originalTargets;
          const policy = {
            version: "transport-review-exploratory-v1",
            mode: "exploratory" as const,
            contract_version: "decision-policy-v2" as const,
            definitions_version: questions.definitionsVersion,
            probability_sum_tolerance: 0.02,
            confidence_tolerance: 0.02,
            calibration_evidence_hashes: [],
            rules: {
              title: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true },
              textOrigin: { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false },
              entityQualification: {
                yes_threshold: 0.5,
                no_threshold: 0.5,
                choice_threshold: 0.5,
                require_repeat: true,
              },
            },
          };
          const prepared = await prepareDecisionStage({
            directory: join(retained, "stage"),
            operationId: randomUUID(),
            stageId: "catalog-contract-review",
            discoveryDirectory: retained,
            source,
            questions: targets,
            policy,
            inputLimit: preflight.inputLimit,
            targetMode: (focused ? caseName === "single-title" : name.startsWith("01")) ? "single" : "batch",
          });
          for (const batch of prepared.manifest.batches) {
            throwIfWorkerFailed();
            const input = {
              stage: { version: 1 as const, directory: prepared.directory },
              batchId: batch.batch_id,
              verificationProbe: !focused && name.startsWith("01") && batch.batch_id === "batch-000",
            };
            const ordinary = await child.run(input);
            assert.equal(ordinary.reused, false);
            const repeat = await child.run({ ...input, freshRepeatId: "review-repeat" });
            assert.equal(repeat.reused, false);
            const reused = await child.run(input);
            assert.equal(reused.reused, true);
          }
          const result = await collectDecisionStage(prepared.directory, "review-repeat");
          assert.equal(result.status, "complete");
          const audit = await auditRetainedStage(prepared.directory, true);
          reports.push({
            source: name,
            case: caseName,
            stage: prepared.directory,
            result,
            audit: audit.report,
            source_sha256: sha256(bytes),
          });
          await writeJsonAtomic(join(root, "report.json"), {
            root,
            reports,
            status: "partial",
            scope: "shared-contract transport review only; no capability calibration or semantic completion",
          });
          process.stdout.write(`${name}: live, repeat, reuse and independent wire audit passed\n`);
        }
        await writeJsonAtomic(join(root, "report.json"), {
          root,
          reports,
          status: "complete",
          scope: "shared-contract transport review only; no capability calibration or semantic completion",
        });
      },
    );
  });
}
main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
