import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateDecisionAnswers, parseDecisionWire } from "../../domains/document/decisions/validation.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";

const directory = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-01-noul-discussed-pairs");
const template = JSON.parse(await readFile(join(directory, "frozen-template.json"), "utf8"));
const rows: any[] = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
const planned: any[] = JSON.parse(await readFile(join(directory, "pairs.json"), "utf8"));
assert.equal(rows.length, planned.length);
assert.equal(rows.length, 41);
const attempts: any[] = [];
for (const row of rows) {
  const path = join(directory, "calls", row.id);
  for (const name of await readdir(path)) {
    if (!name.startsWith("attempt-")) continue;
    const attempt = join(path, name);
    const wire = JSON.parse(await readFile(join(attempt, "outbound-request.json"), "utf8"));
    const expected = structuredClone(template);
    expected.state.target.name_a = row.name_a;
    expected.state.target.name_b = row.name_b;
    assert(isDeepStrictEqual(wire, expected));
    const raw: any = parseDecisionWire(await readFile(join(attempt, "response-body.txt"), "utf8"));
    const validation = validateDecisionAnswers(raw, template.questions, .02, .02);
    assert.deepEqual(validation.findings, []);
    assert.equal(raw.answers.alias.type, "noul");
    if (Number(name.split("-")[1]) === row.attempt) assert.equal(raw.answers.alias.noul, row.noul);
    const timing = JSON.parse(await readFile(join(attempt, "transport-end.json"), "utf8"));
    attempts.push({ ...timing, cost_usd: raw.usage?.cost ?? null, returned_confidence: raw.answers.alias.confidence ?? null });
  }
  row.yes = row.noul;
  row.no = 1 - row.noul;
  row.returned_confidence = row.confidence ?? null;
  row.computed_confidence = Math.abs(2 * row.noul - 1);
}
function sweep(yes: number, no: number) {
  assert(no < yes);
  const yesRows = rows.filter((r) => r.yes >= yes - 1e-9);
  const noRows = rows.filter((r) => r.yes <= no + 1e-9);
  const review = rows.filter((r) => !yesRows.includes(r) && !noRows.includes(r));
  const errors = [...yesRows.filter((r) => r.expected !== "same_entity"), ...noRows.filter((r) => r.expected !== "different_entities")];
  return { yes_threshold: yes, no_threshold: no, automatic_yes: yesRows.length, automatic_no: noRows.length,
    review: review.length, wrong_automatic_decisions: errors.length, error_pair_ids: errors.map((r) => r.id), review_pair_ids: review.map((r) => r.id) };
}
const profiles = [.60, .65, .70, .75, .80, .85, .90, .95].map((yes) => sweep(yes, 1 - yes));
profiles.push(sweep(.75, .15));
const summary = { pairs: rows.length, expected_same: rows.filter((r) => r.expected === "same_entity").length,
  expected_different: rows.filter((r) => r.expected === "different_entities").length,
  http_attempts: attempts.length, returned_confidence_fields: attempts.filter((a) => a.returned_confidence !== null).length,
  confirmed_cost_usd: attempts.reduce((s, a) => s + (a.cost_usd ?? 0), 0), unconfirmed: attempts.filter((a) => a.cost_usd === null).length,
  transport_span_seconds: (Math.max(...attempts.map((a) => Date.parse(a.body_received_at_utc))) - Math.min(...attempts.map((a) => Date.parse(a.network_started_at_utc)))) / 1000,
  profiles, computed_confidence_formula: "abs(2 * P(yes) - 1)",
  boundary_convention: "Inclusive comparisons, epsilon 1e-9 for floating representation. These are diagnostic sweeps; production policy remains unchanged.",
  sources: ["https://docs.typesafe.ai/cookbooks/sde_cascade", "https://docs.typesafe.ai/primitives/noul", "https://docs.typesafe.ai/confidence"] };
await writeJsonAtomic(join(directory, "scored-results.json"), rows);
await writeJsonAtomic(join(directory, "summary.json"), summary);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (x: string) => x === "The 'Official' Pantheon of the Unified Church of the Realms" ? "Full Pantheon heading" : x;
const table = (head: string[], body: string[][]) => ["| " + head.join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |", ...body.map((cells) => "| " + cells.join(" | ") + " |")].join("\n");
let report = `# Document 01 — discussed alias pairs as native yes/no questions\n\n` +
  `41 fresh Noul calls; one per pair, identical winning state/context. Only target names and the question format changed. Full Pantheon heading means **The 'Official' Pantheon of the Unified Church of the Realms**. Church/movement is evaluated as different entities per the user's ruling; no expected answers were inserted into requests.\n\n` +
  `## Exact question\n\n\`\`\`json\n${JSON.stringify(template.questions, null, 2)}\n\`\`\`\n\n` +
  `## Returned versus computed fields\n\nAll ${attempts.length} raw answers returned type=noul and the yes probability. None returned confidence. No = 1 - Yes. The table's computed confidence uses abs(2 * Yes - 1), per [TypeSafe confidence documentation](https://docs.typesafe.ai/confidence); it is not an additional model estimate. [Noul documentation](https://docs.typesafe.ai/primitives/noul) describes the absence of a separate confidence field.\n\n`;
for (const group of [...new Set(rows.map((r) => r.group))]) {
  report += `## ${group}\n\n` + table(["Name A", "Name B", "Yes: same", "No: different", "Returned confidence", "Computed confidence", "Expected"], rows.filter((r) => r.group === group).map((r) => [short(r.name_a), short(r.name_b), pct(r.yes), pct(r.no), r.returned_confidence === null ? "Not returned" : pct(r.returned_confidence), pct(r.computed_confidence), r.expected === "same_entity" ? "Same" : "Different"])) + "\n\n";
}
report += `## Threshold sweep\n\nYes if P(yes) >= Yes cutoff; No if P(yes) <= No cutoff; otherwise clarify. Cutoffs are inclusive. This is diagnostic routing, not a production policy change.\n\n` +
  table(["Yes cutoff", "No cutoff", "Auto yes", "Auto no", "Clarify", "Wrong automatic decisions"], profiles.map((p) => [pct(p.yes_threshold), pct(p.no_threshold), String(p.automatic_yes), String(p.automatic_no), String(p.review), String(p.wrong_automatic_decisions)])) +
  `\n\n## Reading the sweep\n\nAt 75% yes / 25% no: 22 correct aliases auto-link, 6 expected aliases require clarification, and one source-reviewed alias is wrongly rejected (full Pantheon heading/Gods of the Realms: Yes 19%, No 81%). The five Church/movement pairs all require clarification; all six deity/follower cross-pairs auto-reject correctly. Apolloite/Lathanderan is 51% yes / 49% no, computed confidence 2%.\n\n` +
  `A candidate asymmetric 75% yes / 15% no profile produces 22 auto yes, 6 auto no and 13 clarification pairs, with zero wrong automatic decisions on this selected set. This is not a validated production boundary. The earlier three-option choice probabilities cannot simply be renormalized to predict Noul outputs; these are fresh calls.\n\n` +
  `## Cascade guidance\n\nThe [SDE cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade) uses narrow per-field verifier checks and escalates when any error signal crosses its boundary; it does not average away a red flag. Its example 70% P(wrong) cutoff is not an alias-acceptance threshold. For this task, an inference from that pattern is to escalate uncertain pairs and groups with contradictory identity links; uncertainty alone can miss confident wrong answers. No companion verifier heads or strong-LLM calls were made here.\n\n` +
  `## Operations and reproduction\n\nConfirmed cost $${summary.confirmed_cost_usd.toFixed(9)}; ${summary.unconfirmed} unconfirmed charges; HTTP span ${summary.transport_span_seconds.toFixed(2)} seconds. One answer per pair, not a repeat-stability or population accuracy study.\n\nRun \`npx tsx src/dev/jev-playground/report-noul-pairs.ts\` to check all actual wire requests, raw responses and the existing validation contract, and regenerate this table and thresholds without network calls. Run the runner with \`--noul --dry-run\` to validate the prepared requests. All responses, full request context, and original choice comparisons are retained on disk.\n`;
await writeFile(join(directory, "report.md"), report);
console.log(JSON.stringify(summary, null, 2));
