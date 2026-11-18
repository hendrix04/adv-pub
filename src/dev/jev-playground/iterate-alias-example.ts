import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { callJev } from "../../domains/document/decisions/provider.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";
import { validateWireRequest, sourceForRequest } from "./request.js";

// One tuning case; variants are explicit JSON, so every change is inspectable.
const directory = resolve(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? ".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/apollo-lathanderan-experiment");
const baseline = JSON.parse(await readFile(join(directory, "baseline.json"), "utf8"));
const variants = JSON.parse(await readFile(join(directory, "variants.json"), "utf8"));
process.env.BB_LIVE_COST_LEDGER ??= resolve(".kiro/execution/AP-28/live-cost-ledger.json");
const maximum = 50;
const threshold = 0.90;
function candidate(variant: any) {
  const wire = structuredClone(baseline);
  Object.assign(wire.questions.alias, variant.question ?? {});
  Object.assign(wire.state, variant.state ?? {});
  for (const key of ["complete_source", "table1", "target", "source_sha256", "source_byte_length"]) {
    assert(isDeepStrictEqual(wire.state[key], baseline.state[key]), `Variant changed ${key}`);
  }
  assert.equal(wire.model, "typesafe/jev-1.13");
  assert.deepEqual(wire.provider, { allow_fallbacks: false, only: ["typesafe"] });
  assert.deepEqual(Object.keys(wire.questions.alias.criteria).sort(), ["different_entities", "same_entity", "unclear"]);
  return validateWireRequest(wire);
}
for (const variant of variants) candidate(variant);
if (process.argv.includes("--dry-run")) {
  assert.equal(baseline.state.target.name_a, "Apollo");
  assert.equal(baseline.state.target.name_b, "Lathanderan");
  assert.equal(baseline.state.table1.rows.length, 17);
  assert.equal(Buffer.byteLength(baseline.state.complete_source), baseline.state.source_byte_length);
  console.log(`Validated ${variants.length} variants; fixed source/table/target; maximum ${maximum} calls.`);
  process.exit(0);
}
const previous = (await readdir(directory)).filter((name) => /^attempt-\d{3}$/.test(name)).sort();
const rows: any[] = [];
for (const name of previous) rows.push(JSON.parse(await readFile(join(directory, name, "result.json"), "utf8")));
let satisfied = rows.some((row) => row.satisfied === true);
let best = rows.filter((row) => row.probabilities).sort((a, b) => b.probabilities.different_entities - a.probabilities.different_entities)[0];
async function run(variant: any, phase: string, reverse = false) {
  if (rows.length >= maximum) return undefined;
  const prepared = candidate(variant);
  if (reverse) {
    const criteria = (prepared.wire.questions as any).alias.criteria;
    (prepared.wire.questions as any).alias.criteria = Object.fromEntries(Object.entries(criteria).reverse());
  }
  const checked = validateWireRequest(prepared.wire);
  const attempt = rows.length + 1;
  const path = join(directory, `attempt-${String(attempt).padStart(3, "0")}`);
  await writeJsonAtomic(join(path, "request.json"), checked.wire);
  const started = Date.now();
  let row: any = { attempt, variant: variant.id, phase, reversed_options: reverse };
  try {
    const raw: any = await callJev(checked.request, path, false, sourceForRequest(checked.request));
    const answer = raw.answers?.alias;
    assert.equal(answer?.type, "choice");
    assert.deepEqual(Object.keys(answer.probabilities).sort(), ["different_entities", "same_entity", "unclear"]);
    const values = Object.values(answer.probabilities) as number[];
    assert(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
    assert(Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 0.02);
    assert.equal(answer.probabilities[answer.choice], Math.max(...values));
    row = { ...row, choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence,
      cost_usd: raw.usage?.cost ?? null, input_tokens: raw.usage?.input_tokens, model: raw.model };
  } catch (error) {
    row.error = String(error instanceof Error ? error.message : error);
  }
  row.duration_ms = Date.now() - started;
  rows.push(row);
  await writeJsonAtomic(join(path, "result.json"), row);
  await writeJsonAtomic(join(directory, "results.json"), rows);
  if (row.probabilities && (!best || row.probabilities.different_entities > best.probabilities.different_entities)) {
    best = row;
    await writeJsonAtomic(join(directory, "best-request.json"), checked.wire);
  }
  console.log(JSON.stringify(row));
  if (row.error && /401|402|403|credential|API_KEY|soft cap|confirmed charges/i.test(row.error)) throw new Error(row.error);
  return row;
}
function good(row: any) { return row?.choice === "different_entities" && row.probabilities.different_entities >= threshold; }
for (const variant of variants) {
  if (satisfied || rows.length >= maximum) break;
  if (rows.some((row) => row.variant === variant.id && row.phase === "screen")) continue;
  const first = await run(variant, "screen");
  if (!good(first)) continue;
  if (!good(await run(variant, "repeat-1"))) continue;
  if (!good(await run(variant, "repeat-2"))) continue;
  const final = await run(variant, "option-order-check", true);
  if (!good(final)) continue;
  final.satisfied = true;
  await writeJsonAtomic(join(directory, `attempt-${String(final.attempt).padStart(3, "0")}`, "result.json"), final);
  await writeJsonAtomic(join(directory, "winning-request.json"), candidate(variant).wire);
  satisfied = true;
}
await writeJsonAtomic(join(directory, "results.json"), rows);
await writeJsonAtomic(join(directory, "summary.json"), { attempts: rows.length, maximum, satisfied, best,
  confirmed_cost_usd: rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
  unresolved_attempts: rows.filter((row) => row.cost_usd == null).length,
  note: "Single example tuning only; expected answer was not inserted into the request." });
console.log(`Finished: ${rows.length}/${maximum}; satisfied=${satisfied}; best different_entities=${best?.probabilities?.different_entities}`);
