import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { callJev } from "../../domains/document/decisions/provider.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";
import { validateWireRequest, sourceForRequest } from "./request.js";
import { validateDecisionAnswers } from "../../domains/document/decisions/validation.js";

const root = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds");
const noul = process.argv.includes("--noul");
const targets = process.argv.includes("--targets");
const directory = resolve(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? join(root, "document-01-alias-evaluation"));
const template = JSON.parse(await readFile(noul || targets ? join(directory, "template.json") : join(root, "apollo-lathanderan-experiment/winning-request.json"), "utf8"));
const pairs: any[] = JSON.parse(await readFile(join(directory, targets ? "cases.json" : "pairs.json"), "utf8"));
assert.equal(Object.keys(template.questions).length, 1);
const questionId = Object.keys(template.questions)[0]!;
process.env.BB_LIVE_COST_LEDGER ??= resolve(".kiro/execution/AP-28/live-cost-ledger.json");
function prepare(pair: any) {
  const wire = structuredClone(template);
  if (targets) wire.state.target = pair.target;
  else {
    wire.state.target.name_a = pair.name_a;
    wire.state.target.name_b = pair.name_b;
    assert.deepEqual(Object.keys(wire.state.target).sort(), ["name_a", "name_b", "name_clues"]);
    assert.deepEqual(wire.state.target.name_clues, {});
  }
  return validateWireRequest(wire);
}
if (process.argv.includes("--dry-run")) {
  for (const pair of pairs) prepare(pair);
  console.log(`Validated ${pairs.length} fixed-template, one-question requests; labels stay outside state.`);
  process.exit(0);
}
let cursor = 0;
let completed = 0;
let stopped: string | undefined;
const started = Date.now();
const rows: any[] = [];
const complete = (row: any) => noul ? typeof row?.noul === "number" : Boolean(row?.probabilities);
await writeJsonAtomic(join(directory, "frozen-template.json"), template);
async function worker() {
  while (cursor < pairs.length && !stopped) {
    const pair = pairs[cursor++];
    const pairDirectory = join(directory, "calls", pair.id);
    let row: any;
    try {
      row = JSON.parse(await readFile(join(pairDirectory, "result.json"), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!complete(row)) {
      const prepared = prepare(pair);
      const previous = row?.attempt ?? 0;
      if (previous >= 2) { rows.push(row); continue; }
      const path = join(pairDirectory, `attempt-${previous + 1}`);
      await writeJsonAtomic(join(path, "request.json"), prepared.wire);
      const at = Date.now();
      row = { ...pair, attempt: previous + 1 };
      try {
        const raw: any = await callJev(prepared.request, path, false, sourceForRequest(prepared.request));
        const answer = raw.answers?.[questionId];
        const checked = validateDecisionAnswers(raw, prepared.request.questions, 0.02, 0.02);
        assert.deepEqual(checked.findings, []);
        assert.equal(answer?.type, noul ? "noul" : "choice");
        row = { ...row, ...answer, cost_usd: raw.usage?.cost ?? null, model: raw.model };
      } catch (error) {
        row.error = String(error instanceof Error ? error.message : error);
        if (/401|402|403|credential|API_KEY|soft cap|confirmed charges/i.test(row.error)) stopped = row.error;
      }
      row.duration_ms = Date.now() - at;
      await writeJsonAtomic(join(path, "result.json"), row);
      await writeJsonAtomic(join(pairDirectory, "result.json"), row);
    }
    rows.push(row);
    completed++;
    if (completed % (noul || targets ? 10 : 100) === 0) console.log(`${completed}/${pairs.length}; valid=${rows.filter(complete).length}; elapsed=${Math.round((Date.now() - started) / 1000)}s`);
  }
}
await Promise.all(Array.from({ length: 10 }, worker));
rows.sort((a, b) => a.id.localeCompare(b.id));
await writeJsonAtomic(join(directory, "results.json"), rows);
console.log(JSON.stringify({ completed: rows.length, valid: rows.filter(complete).length, stopped, elapsed_ms: Date.now() - started }));
