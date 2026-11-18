import { withTestExecution } from "./execution-retention.js";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { withEmbeddedBlocks } from "./blocks-runtime.js";
import { exploratoryStructurePolicy } from "../domains/document/blocks/policy.js";
import { calibrateStructurePolicy } from "../domains/document/blocks/calibration.js";
import { readJson, writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { artifactExists, loadReview, operationObservations, auditOperation } from "./blocks-verification-evidence.js";
import { evaluateReviewedDecisions, type SemanticDecisionReport } from "./blocks-semantic-review.js";

type Options = { output: string; review: string; audit?: string };

function parseArgs(args: string[]): Options {
  const options: Options = {
    output: ".kiro/execution/AP-26/blocks-verification",
    review: ".kiro/execution/AP-26/source-review.json",
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag !== "--output" && flag !== "--review" && flag !== "--audit") throw new Error(`Unknown option ${flag}`);
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--output") options.output = value;
    else if (flag === "--review") options.review = value;
    else options.audit = value;
  }
  options.output = resolve(options.output);
  options.review = resolve(options.review);
  if (options.audit) options.audit = resolve(options.audit);
  if (options.audit && args.some((flag) => flag === "--output" || flag === "--review")) throw new Error("--audit cannot be combined with live-run options");
  return options;
}

async function walkFiles(path: string): Promise<string[]> {
  if (!(await artifactExists(path))) return [];
  const output: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(child)));
    else output.push(child);
  }
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.audit) {
    const { auditSavedBlocksRun } = await import("./verify-blocks-audit.js");
    const result = await auditSavedBlocksRun(options.audit);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.verdict !== "PASS") process.exitCode = 1;
    return;
  }
  if (await artifactExists(options.output)) throw new Error(`Evidence output already exists; choose a new --output: ${options.output}`);
  const ledgerPath = resolve(process.env.BB_LIVE_COST_LEDGER ?? "");
  const expectedLedgerPath = resolve(".kiro/execution/AP-26/live-cost-ledger.json");
  if (ledgerPath !== expectedLedgerPath) throw new Error(`Set BB_LIVE_COST_LEDGER to the packet ledger ${expectedLedgerPath}`);
  const ledgerBefore = JSON.parse(await readFile(ledgerPath, "utf8")) as {
    capUsd: number;
    spentUsd: number;
    calls: unknown[];
  };
  if (ledgerBefore.capUsd > 5 || ledgerBefore.spentUsd > 5) throw new Error("Shared live-cost ledger is invalid or over the $5 cap");
  const sources = authorizedDiscoverySources();
  if (sources.length !== 9) throw new Error(`Expected nine ordered authorized sources, found ${sources.length}`);
  const outputRoot = options.output;
  return withTestExecution(outputRoot, async () => {
    await mkdir(outputRoot, { recursive: true });
    const review = await loadReview(options.review);
    await writeJsonAtomic(join(outputRoot, "source-review.json"), review.artifact);
    await writeJsonAtomic(join(outputRoot, "live-cost-ledger-before.json"), ledgerBefore);
    const reproduction = `BB_LIVE_COST_LEDGER=${expectedLedgerPath} npm run verify:blocks -- --output ${outputRoot} --review ${options.review}`;
    await writeJsonAtomic(join(outputRoot, "run-manifest.json"), {
      contract_version: "blocks-live-verification-run-v1",
      started_at_utc: new Date().toISOString(),
      reproduction_command: reproduction,
      packet: ".kiro/execution/AP-26/packet.json",
      source_review: options.review,
      ordered_sources: sources,
      tuning_sources: sources.slice(0, 6),
      holdout_sources: sources.slice(6),
      live_cost_ledger: expectedLedgerPath,
      ledger_at_start: ledgerBefore,
      sequence: [
        "tune 01-06 using exploratory title-linkPlacement",
        "freeze source-reviewed per-template policy",
        "evaluate 01-09 in order under frozen policy; seed only exact request-compatible tuning response/repeat evidence",
      ],
    });
    try {
      const tuningPolicy = exploratoryStructurePolicy();
      const tuningDirectories = new Map<string, string>();
      const tuningRunResults: Array<Record<string, unknown>> = [];
      let frozenPolicy: ReturnType<typeof calibrateStructurePolicy> | undefined;
      const finalReports: Array<Record<string, unknown> & SemanticDecisionReport> = [];
      let retryReport: Record<string, unknown> = {};
      let preflight: Record<string, unknown> = {};
      await withEmbeddedBlocks(async ({ run, preflight: endpoint }) => {
        preflight = endpoint;
        await writeJsonAtomic(join(outputRoot, "endpoint-preflight.json"), endpoint);
        for (const [index, sourcePath] of sources.slice(0, 6).entries()) {
          const name = basename(sourcePath, ".md");
          const directory = join(outputRoot, "tuning", name);
          tuningDirectories.set(sourcePath, directory);
          const runResult = await run({
            capability: "blocks",
            sourcePath,
            directory,
            operationId: randomUUID(),
            mode: "new",
            policy: tuningPolicy,
            repeatId: "structure-repeat-v1",
            provisionalPlanning: true,
            verificationProbe: index === 0,
          });
          tuningRunResults.push({
            source_path: sourcePath,
            directory,
            run_id: runResult.runId,
            result: runResult.result,
          });
          process.stdout.write(`${JSON.stringify({ phase: "tuning", sourcePath, runId: runResult.runId, directory, result: runResult.result })}\n`);
        }
        const tuningEvidence = await Promise.all(
          sources.slice(0, 6).map(async (sourcePath) => {
            const directory = tuningDirectories.get(sourcePath)!;
            const operation = (await readJson(join(directory, "operation.json"))) as { repeat_id: string };
            return operationObservations(directory, operation.repeat_id);
          }),
        );
        const observations = tuningEvidence.flatMap((entry) => entry.observations);
        const calibration = calibrateStructurePolicy({
          reviewedCases: review.cases.map(({ question_id, question_kind, expected }) => ({
            question_id,
            question_kind,
            expected,
          })),
          observations,
          evidenceHashes: review.cases.map((entry) => entry.evidence_sha256),
        });
        frozenPolicy = calibration;
        await writeJsonAtomic(join(outputRoot, "calibration.json"), {
          contract_version: "blocks-calibration-review-v1",
          source_review: options.review,
          tuning_sources: sources.slice(0, 6),
          tuning_request_count: tuningEvidence.reduce((sum, entry) => sum + entry.requestCount, 0),
          tuning_repeat_count: tuningEvidence.reduce((sum, entry) => sum + entry.repeatCount, 0),
          observations: observations.map((entry) => ({ ...entry, primary: entry.primary, repeat: entry.repeat })),
          families: calibration.families,
          policy: calibration.policy,
          note: "Thresholds are safe on these source-reviewed examples only; missing outcomes and small-corpus limits remain explicit.",
        });
        await writeJsonAtomic(join(outputRoot, "frozen-policy.json"), calibration.policy);

        for (const [index, sourcePath] of sources.entries()) {
          const name = basename(sourcePath, ".md");
          const directory = join(outputRoot, "final", name);
          const reuseEvidenceDirectory = index < 6 ? tuningDirectories.get(sourcePath) : undefined;
          const runResult = await run({
            capability: "blocks",
            sourcePath,
            directory,
            operationId: randomUUID(),
            mode: "new",
            policy: calibration.policy,
            repeatId: "structure-repeat-v1",
            provisionalPlanning: false,
            ...(reuseEvidenceDirectory ? { reuseEvidenceDirectory } : {}),
          });
          const audited = await auditOperation(sourcePath, directory, "structure-repeat-v1");
          finalReports.push({ run_id: runResult.runId, operation_directory: directory, ...audited });
          process.stdout.write(`${JSON.stringify({ phase: "final", sourcePath, runId: runResult.runId, directory, result: runResult.result })}\n`);
        }
        retryReport = {
          tuning_source: sources[0],
          probe_stage: "linkPlacement",
          probe_method:
            "one explicit synthetic pre-network transport failure on the first primary request; the existing Hatchet child retry then performs the real Jev request; fresh repeat is a separate ordinary call",
        };
      });
      assert.ok(frozenPolicy);
      const semanticReview = evaluateReviewedDecisions(review.cases, finalReports);
      const semantic = semanticReview.outcomes;
      const wrong = semanticReview.failures;
      const allFiles = await walkFiles(outputRoot);
      const liveAttempts = allFiles.filter((path) => path.endsWith("/transport-start.json"));
      const syntheticFailures = await Promise.all(liveAttempts.map(async (path) => JSON.parse(await readFile(path, "utf8")) as { transport?: string }));
      const ledgerAfter = JSON.parse(await readFile(expectedLedgerPath, "utf8")) as Record<string, any>;
      const ledgerCalls = (ledgerAfter.calls as Array<Record<string, any>>).filter((entry) => String(entry.attemptDirectory ?? "").startsWith(outputRoot));
      const report = {
        contract_version: "blocks-live-verification-report-v1",
        status: wrong.length ? "semantic_fail" : "ready_for_independent_review",
        completed_at_utc: new Date().toISOString(),
        independent_review_required: true,
        commands: {
          typecheck: "npm run typecheck",
          unit_tests: "npm test",
          build: "npm run build",
          live: reproduction,
          inspector: "npm run inspect:blocks -- <operation-directory>",
        },
        approved_source_review: {
          verdict: "PASS",
          reviewer: review.artifact.reviewer,
          cases: review.cases.length,
          evidence_hashes: review.cases.map((entry) => entry.evidence_sha256),
        },
        endpoint_preflight: preflight,
        tuning: tuningRunResults,
        calibration_policy: frozenPolicy.policy,
        calibration_families: frozenPolicy.families,
        final_corpus: finalReports,
        source_semantic_review: {
          reviewed_cases: semantic,
          false_or_missing_supported_actions: wrong,
          unresolved_visible: semantic.filter((entry) => entry.result === "unresolved_visible"),
        },
        failure_retry_reuse_evidence: {
          retry_probe: retryReport,
          synthetic_pre_network_failures: syntheticFailures.filter((entry) => entry.transport === "synthetic_pre_network_failure").length,
          recorded_attempt_starts: liveAttempts.length,
          ledger_reservations_in_this_run: ledgerCalls,
          compatible_tuning_evidence_reuse: finalReports.map((entry) => ({
            source_path: entry.source_path,
            stage_reuse: entry.stages,
          })),
        },
        live_cost_ledger: { path: expectedLedgerPath, before: ledgerBefore, after: ledgerAfter },
        final_note: "Capability success is distinct from complete product delivery. aliasIdentity-textOrigin, qualification, typing, canon, and wiki behavior were not run.",
      };
      await writeJsonAtomic(join(outputRoot, "verification-report.json"), report);
      await writeJsonAtomic(join(outputRoot, "live-cost-ledger-after.json"), ledgerAfter);
      await writeJsonAtomic(join(outputRoot, "calibration-plan-summary.json"), {
        contract_version: "blocks-calibration-plan-summary-v1",
        tuning_sources: sources.slice(0, 6),
        holdout_sources: sources.slice(6),
        tuned_question_ids: review.cases.map((entry) => entry.question_id),
        target_count_by_family: Object.fromEntries(
          ["title", "listIntroduction", "mapLabels", "linkPlacement"].map((kind) => [kind, review.cases.filter((entry) => entry.question_kind === kind).length]),
        ),
        source_hashes: Object.fromEntries(review.cases.map((entry) => [entry.source_path, entry.source_sha256])),
        holdout_coverage: finalReports.slice(6).map((entry) => ({
          source_path: entry.source_path,
          question_counts: entry.question_counts,
          empty_stages: Object.entries(entry.stages as Record<string, { status: string }>)
            .filter(([, stage]) => stage.status === "empty")
            .map(([name]) => name),
        })),
      });
      process.stdout.write(
        `${JSON.stringify({ status: report.status, report: join(outputRoot, "verification-report.json"), ledger_spent_usd: ledgerAfter.spentUsd, sources: finalReports.length })}\n`,
      );
      if (wrong.length) process.exitCode = 1;
    } catch (error) {
      const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as Record<string, unknown>;
      await writeJsonAtomic(join(outputRoot, "live-cost-ledger-after.json"), ledger);
      await writeJsonAtomic(join(outputRoot, "blocker.json"), {
        contract_version: "blocks-verification-blocker-v1",
        at_utc: new Date().toISOString(),
        reason: error instanceof Error ? error.message : String(error),
        ledger_path: ledgerPath,
        ledger,
        tuning_artifacts_retained: await artifactExists(join(outputRoot, "tuning")),
        final_artifacts_retained: await artifactExists(join(outputRoot, "final")),
      });
      throw error;
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
