import { DecisionsRequest$outboundSchema } from "@openrouter/sdk/models";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

/** Independent wire-data checks. This module imports no product decisions, grouping, or validation implementation. */
export async function auditRetainedStage(directory: string, requireReuse: boolean) {
  const manifest = await json(join(directory, "manifest.json"));
  // Audit only the formats produced by the active execution paths.
  if (Object.hasOwn(manifest, "contract_version")) {
    assert.equal(manifest.contract_version, "decision-questions-v2");
  } else if (manifest.decision_kind === "document_alias") {
    assert.equal(manifest.question_version, "document-alias-v2");
    assert.ok(Array.isArray(manifest.alias_pairs));
  } else {
    assert.equal(manifest.decision_kind, "entity_type");
    assert.equal(manifest.question_version, "entity-type-v3-linked");
    assert.ok(Array.isArray(manifest.original_candidates));
    assert.equal(typeof manifest.alias_directory, "string");
    assert.equal(typeof manifest.alias_result_sha256, "string");
  }
  const source = await readFile(join(directory, "source.md"));
  assert.equal(hash(source), manifest.source_sha256);
  assert.equal(hash(JSON.stringify(manifest.config)), manifest.configuration_sha256);
  if (manifest.contract_version === "decision-questions-v2") {
    const paths = manifest.config.upstream_paths as Record<string, string>;
    const hashes = manifest.config.upstream_hashes as Record<string, string>;
    assert.deepEqual(Object.keys(paths).sort(), Object.keys(hashes).sort(), "Upstream path/hash coverage must match");
    for (const [id, path] of Object.entries(paths)) {
      assert.equal(hash(await readFile(path)), hashes[id], `Current upstream artifact hash differs: ${id}`);
    }
  }
  const answers = new Map<string, any>();
  const repeats = new Map<string, Record<string, any>>();
  const events: Array<{ at: number; delta: number }> = [];
  let liveCalls = 0;
  let reuseReceipts = 0;
  let costUsd = 0;
  const retryDelays: number[] = [];
  for (const batch of manifest.batches) {
    const root = join(directory, "batches", batch.batch_id);
    const saved = await json(join(root, "result.json"));
    assert.equal(saved.batch_sha256, batch.batch_sha256);
    assert.equal(saved.configuration_sha256, manifest.configuration_sha256);
    assert.equal(hash(JSON.stringify(batch.request)), batch.batch_sha256);
    const rawText = await readFile(saved.response_path, "utf8");
    assert.equal(hash(rawText), saved.response_sha256);
    const raw = JSON.parse(rawText);
    assert.equal(raw.provider, "TypeSafe");
    assert.match(raw.model, /^typesafe\/jev-1\.13(?:-\d{8})?$/);
    assert.deepEqual(Object.keys(raw.answers).sort(), [...batch.candidate_ids].sort());
    for (const id of batch.candidate_ids) {
      assert.ok(!answers.has(id), `Duplicate question ${id}`);
      const answer = raw.answers[id];
      const choices = Object.keys(batch.request.questions[id].criteria);
      assert.equal(answer.type, batch.request.questions[id].type);
      const retained = saved.decisions.find((decision: any) => (decision.question_id ?? decision.candidate_id ?? decision.pair_id) === id);
      if (answer.type === "noul") {
        assert.deepEqual(Object.keys(answer).sort(), ["noul", "type"]);
        assert.ok(Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1);
      } else {
        assert.ok(choices.includes(answer.choice));
        assert.ok(Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1);
        assert.deepEqual(Object.keys(answer.probabilities).sort(), choices.sort());
        for (const probability of Object.values(answer.probabilities))
          assert.ok(typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1);
        const values = Object.values(answer.probabilities) as number[];
        assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= (manifest.policy?.probability_sum_tolerance ?? 0.02));
        if (manifest.contract_version) {
          const expected = (Math.max(...values) - 1 / values.length) / (1 - 1 / values.length);
          assert.ok(Math.abs(expected - answer.confidence) <= manifest.policy.confidence_tolerance);
        }
      }
      if (manifest.contract_version) {
        assert.deepEqual(retained.raw_answer, answer);
        assert.equal(retained.action.policy_sha256, hash(JSON.stringify(manifest.policy)));
        assert.ok(["provisional", "supported", "rejected", "unresolved"].includes(retained.action.status));
        if (manifest.policy.mode === "exploratory") assert.notEqual(retained.action.status, "supported");
      } else {
        assert.equal(retained.answer, answer.choice);
        assert.equal(retained.confidence, answer.confidence);
        assert.deepEqual(retained.option_probabilities, answer.probabilities);
        assert.equal(retained.question_version, manifest.question_version);
      }
      answers.set(id, answer);
    }
    const ordinaryEntries = await readdir(root);
    const roots = [root];
    if (ordinaryEntries.includes("repeats")) for (const repeat of await readdir(join(root, "repeats"))) roots.push(join(root, "repeats", repeat));
    for (const attemptRoot of roots) {
      const entries = await readdir(attemptRoot);
      if (attemptRoot !== root && entries.includes("result.json")) {
        const repeated = await json(join(attemptRoot, "result.json"));
        const repeatedText = await readFile(repeated.response_path, "utf8");
        assert.equal(hash(repeatedText), repeated.response_sha256);
        const repeatedRaw = JSON.parse(repeatedText);
        assert.equal(repeatedRaw.provider, "TypeSafe");
        assert.match(repeatedRaw.model, /^typesafe\/jev-1\.13(?:-\d{8})?$/);
        assert.deepEqual(Object.keys(repeatedRaw.answers).sort(), [...batch.candidate_ids].sort());
        const savedById = new Map<string, any>(repeated.decisions.map((decision: any) => [decision.question_id, decision]));
        for (const id of batch.candidate_ids) {
          assert.deepEqual(savedById.get(id)?.raw_answer, repeatedRaw.answers[id]);
        }
        repeats.set(repeated.response_path, repeatedRaw.answers);
      }
      const starts: number[] = [];
      for (const attempt of entries.filter((entry) => entry.startsWith("attempt-"))) {
        const attemptDir = join(attemptRoot, attempt);
        const start = await json(join(attemptDir, "transport-start.json"));
        const wire = await json(join(attemptDir, "outbound-request.json"));
        assert.equal(wire.state.complete_source, source.toString("utf8"));
        assert.equal(hash(Buffer.from(wire.state.complete_source)), manifest.source_sha256);
        assert.equal(wire.model, "typesafe/jev-1.13");
        assert.deepEqual(wire.provider.only, ["typesafe"]);
        assert.equal(wire.provider.allow_fallbacks, false);
        assert.deepEqual(Object.keys(wire.questions), batch.candidate_ids);
        assert.deepEqual(wire, DecisionsRequest$outboundSchema.parse(batch.request));
        starts.push(Date.parse(start.at_utc));
        if (start.transport === "live_network") {
          const end = await json(join(attemptDir, "transport-end.json"));
          assert.equal(end.http_status, 200);
          events.push({ at: Date.parse(start.at_utc), delta: 1 }, { at: Date.parse(end.at_utc), delta: -1 });
          costUsd += (await json(join(attemptDir, "response-body.txt"))).usage?.cost ?? 0;
          liveCalls += 1;
        } else assert.equal(start.transport, "synthetic_pre_network_failure");
      }
      starts.sort((left, right) => left - right);
      for (let index = 1; index < starts.length; index += 1) {
        const delay = (starts[index]! - starts[index - 1]!) / 1000;
        assert.ok(delay >= 30, `Hatchet retry too fast: ${delay}s`);
        retryDelays.push(delay);
      }
      if (entries.includes("reuse")) {
        const receipts = await readdir(join(attemptRoot, "reuse"));
        for (const receipt of receipts) assert.equal((await json(join(attemptRoot, "reuse", receipt))).network_request_sent, false);
        reuseReceipts += receipts.length;
      } else if (attemptRoot === root) assert.equal(requireReuse, false, `${batch.batch_id} has no reuse receipt`);
    }
  }
  let active = 0;
  let peak = 0;
  for (const event of events.sort((left, right) => left.at - right.at || left.delta - right.delta)) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  assert.ok(peak <= 4, `Observed request concurrency ${peak}`);
  assert.equal(active, 0);
  // Network attempts, fresh repeats and synthetic failures are counted independently.
  assert.equal((await json(join(directory, "result.json"))).status, "complete");
  return {
    manifest,
    source,
    answers,
    repeats,
    events,
    report: {
      batches: manifest.batches.length,
      live_calls: liveCalls,
      peak_concurrent_requests: peak,
      retry_delays_seconds: retryDelays,
      reuse_receipts: reuseReceipts,
      reported_cost_usd: costUsd,
    },
  };
}
