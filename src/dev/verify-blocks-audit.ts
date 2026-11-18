import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { auditOperation, loadReview } from "./blocks-verification-evidence.js";

type LiveReport = {
  contract_version: string;
  status: string;
  approved_source_review: { verdict: string; cases: number };
  final_corpus: Array<Record<string, unknown>>;
  source_semantic_review: { false_or_missing_supported_actions: unknown[] };
  failure_retry_reuse_evidence: { synthetic_pre_network_failures: number; recorded_attempt_starts: number };
  live_cost_ledger: { before: { spentUsd: number }; after: { spentUsd: number; capUsd: number } };
};

function readJson<T>(path: string): Promise<T> {
  return readFile(path, "utf8").then((text) => JSON.parse(text) as T);
}

export async function auditSavedBlocksRun(runDirectory: string) {
  const root = resolve(runDirectory);
  const manifest = await readJson<{
    contract_version: string;
    ordered_sources: string[];
    tuning_sources: string[];
    holdout_sources: string[];
  }>(join(root, "run-manifest.json"));
  const report = await readJson<LiveReport>(join(root, "verification-report.json"));
  const sources = authorizedDiscoverySources();
  assert.equal(manifest.contract_version, "blocks-live-verification-run-v1");
  assert.deepEqual(manifest.ordered_sources, sources, "saved run source order differs from authorized corpus");
  assert.deepEqual(manifest.tuning_sources, sources.slice(0, 6));
  assert.deepEqual(manifest.holdout_sources, sources.slice(6));
  assert.equal(report.contract_version, "blocks-live-verification-report-v1");
  assert.equal(report.status, "ready_for_independent_review");
  assert.equal(report.source_semantic_review.false_or_missing_supported_actions.length, 0);
  const review = await loadReview(join(root, "source-review.json"));
  assert.equal(report.approved_source_review.verdict, "PASS");
  assert.equal(report.approved_source_review.cases, review.cases.length);
  assert.equal(report.final_corpus.length, sources.length);
  assert.ok(report.failure_retry_reuse_evidence.synthetic_pre_network_failures >= 1);
  assert.ok(report.failure_retry_reuse_evidence.recorded_attempt_starts > 0);
  assert.ok(report.live_cost_ledger.after.spentUsd <= report.live_cost_ledger.after.capUsd);

  for (const sourcePath of sources.slice(0, 6)) {
    const operationDirectory = join(root, "tuning", basename(sourcePath, ".md"));
    await auditOperation(sourcePath, operationDirectory, "structure-repeat-v1");
  }
  const final = [];
  for (const [index, sourcePath] of sources.entries()) {
    const reported = report.final_corpus[index] as {
      source_path: string;
      source_sha256: string;
      operation_directory: string;
      block_count: number;
      section_count: number;
    };
    assert.equal(reported.source_path, sourcePath);
    const operationDirectory = join(root, "final", basename(sourcePath, ".md"));
    assert.equal(resolve(reported.operation_directory), operationDirectory);
    const audited = await auditOperation(sourcePath, operationDirectory, "structure-repeat-v1");
    assert.equal(audited.source_sha256, reported.source_sha256);
    assert.equal(audited.block_count, reported.block_count);
    assert.equal(audited.section_count, reported.section_count);
    final.push({
      source: basename(sourcePath),
      sha256: audited.source_sha256,
      blocks: audited.block_count,
      sections: audited.section_count,
      byte_audit: audited.component_audit,
    });
  }

  return {
    verdict: "PASS" as const,
    run_directory: root,
    read_only: true,
    network_requests: 0,
    sources: final,
    semantic_review_cases: review.cases.length,
    saved_cost_usd: report.live_cost_ledger.after.spentUsd,
    live_cost_cap_usd: report.live_cost_ledger.after.capUsd,
    run_status: report.status,
  };
}
