import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, writeJsonAtomic } from "../domains/document/discovery/artifacts.js";
import { releaseUnsentReservation } from "../domains/document/discovery/budget.js";
import { verifyRetryTrace, type RetryTraceEvent } from "./retry-trace.js";

const [iterationArgument, traceArgument] = process.argv.slice(2);
if (!iterationArgument || !traceArgument) throw new Error("Usage: npm run verify:retry-artifact -- <iteration-dir> <retry-trace.jsonl>");
const directory = resolve(iterationArgument);
const tracePath = resolve(traceArgument);
const trace = (await readFile(tracePath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RetryTraceEvent);
const result = verifyRetryTrace(trace);
const provenance = (await readJson(resolve(directory, "provenance.json"))) as Record<string, unknown>;
const settings = (await readJson(resolve(directory, "settings.json"))) as Record<string, unknown>;
const response = (await readJson(resolve(directory, "response.json"))) as Record<string, unknown>;
assert.equal(provenance.hatchet_attempt, 3, "the retained successful discovery must be Hatchet attempt three");
assert.equal(provenance.requested_service_tier, "default");
assert.equal(provenance.requested_provider, "openai");
assert.equal(settings.attempt, 3);
assert.equal(settings.service_tier, "default");
const operationId = provenance.operation_id;
assert.equal(typeof operationId, "string");
const traceOperationId = trace.find((event) => event.event === "attempt-start")?.operation_id;
assert.equal(traceOperationId, operationId, "retry trace must belong to this retained Hatchet operation");

const released = [] as Array<{ attempt: number; reservation_id: string; maximum_usd: number }>;
const budget = JSON.parse(await readFile(resolve("data/operations/luna-budget.json"), "utf8")) as {
  unresolved: Record<string, number>;
};
for (const attempt of [1, 2]) {
  const reservationId = `${operationId}/attempt-${attempt}`;
  const maximum = budget.unresolved[reservationId];
  assert.equal(typeof maximum, "number", `attempt ${attempt} reservation should still be held before trace reconciliation`);
  await releaseUnsentReservation(reservationId, `retry trace ${tracePath} proves the injected failure occurred before native fetch; no OpenRouter request was sent`);
  released.push({ attempt, reservation_id: reservationId, maximum_usd: maximum });
}

const artifact = {
  result: "verified",
  method: "Two locally injected connection failures were thrown before native fetch; attempt three used native fetch and received a successful live OpenRouter HTTP response.",
  trace_path: tracePath,
  failure_to_next_attempt_intervals_ms: result.failure_to_next_attempt_intervals_ms,
  first_two_transport_failures: "synthetic; no external request was sent",
  standard_attempt_response_status: result.standard_response_status,
  retained_generation_id: response.id ?? provenance.generation_id,
  retained_attempt: 3,
  requested_model: provenance.requested_model,
  requested_route: "OpenAI standard",
  settled_actual_charge_usd: provenance.actual_charge_usd,
  released_provenably_unsent_reservations: released,
};
await writeJsonAtomic(resolve(directory, "retry-verification.json"), artifact);
process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
