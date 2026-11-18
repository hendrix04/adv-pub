import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDecisionWire, validateDecisionAnswers } from "../../domains/document/decisions/validation.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";

const directory = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-01-combined-entity-test");
const rows: any[] = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
const cases: any[] = JSON.parse(await readFile(join(directory, "cases.json"), "utf8"));
const template = JSON.parse(await readFile(join(directory, "frozen-template.json"), "utf8"));
assert.equal(rows.length, 60);
assert.equal(new Set(rows.map((r) => r.id)).size, cases.length);
const attempts: any[] = [];
for (const row of rows) {
  const expectedCase = cases.find((c) => c.id === row.id);
  assert(expectedCase);
  assert.deepEqual(row.target, expectedCase.target);
  for (const name of await readdir(join(directory, "calls", row.id))) {
    if (!name.startsWith("attempt-")) continue;
    const path = join(directory, "calls", row.id, name);
    const wire = JSON.parse(await readFile(join(path, "outbound-request.json"), "utf8"));
    const expectedWire = structuredClone(template);
    expectedWire.state.target = expectedCase.target;
    assert(isDeepStrictEqual(wire, expectedWire));
    const raw: any = parseDecisionWire(await readFile(join(path, "response-body.txt"), "utf8"));
    assert.deepEqual(validateDecisionAnswers(raw, template.questions, .02, .02).findings, []);
    if (Number(name.split("-")[1]) === row.attempt) {
      assert.deepEqual(row.probabilities, raw.answers.entity.probabilities);
      assert.equal(row.choice, raw.answers.entity.choice);
      assert.equal(row.confidence, raw.answers.entity.confidence);
    }
    const timing = JSON.parse(await readFile(join(path, "transport-end.json"), "utf8"));
    attempts.push({ ...timing, cost: raw.usage?.cost ?? null });
  }
}
const kinds = Object.keys(template.questions.entity.criteria);
const groups = [...new Set(rows.map((r) => r.case_id))].map((id) => {
  const repeats = rows.filter((r) => r.case_id === id);
  assert.equal(repeats.length, 3);
  const first = repeats[0]!;
  return { id, label: first.label, names: first.target.candidate.names, expected: first.expected, reason: first.reference_reason,
    choices: repeats.map((r) => r.choice), stable_choice: new Set(repeats.map((r) => r.choice)).size === 1,
    probability_range: [Math.min(...repeats.map((r) => r.probabilities[r.choice])), Math.max(...repeats.map((r) => r.probabilities[r.choice]))],
    confidence_range: [Math.min(...repeats.map((r) => r.confidence)), Math.max(...repeats.map((r) => r.confidence))],
    matching: first.expected === null ? null : repeats.filter((r) => first.expected.includes(r.choice)).length,
    repeats };
});
const labelled = rows.filter((r) => r.expected !== null);
const wrong = labelled.filter((r) => !r.expected.includes(r.choice));
const sweeps = [.50, .60, .70, .75, .80, .85, .90, .95].map((cut) => {
  const automatic = rows.filter((r) => r.confidence >= cut && !["mixed_referents", "insufficient_evidence"].includes(r.choice));
  return { confidence_cutoff: cut, automatic_type: automatic.filter((r) => r.choice !== "not_an_entity").length,
    automatic_rejection: automatic.filter((r) => r.choice === "not_an_entity").length,
    clarify: rows.length - automatic.length,
    wrong_automatic_labelled: automatic.filter((r) => r.expected !== null && !r.expected.includes(r.choice)).length,
    unscored_automatic: automatic.filter((r) => r.expected === null).length };
});
const summary = { cases: groups.length, fresh_answers: rows.length, attempts: attempts.length,
  labelled_cases: groups.filter((g) => g.expected !== null).length,
  labelled_answers: labelled.length, matching_labelled_answers: labelled.length - wrong.length,
  stable_cases: groups.filter((g) => g.stable_choice).length,
  mixed_controls: groups.filter((g) => g.expected?.includes("mixed_referents")).length,
  mixed_controls_detected: groups.filter((g) => g.expected?.includes("mixed_referents") && g.matching === 3).length,
  metadata_controls_detected: groups.filter((g) => g.label.startsWith("Table header") && g.matching === 3).length,
  insufficient_evidence_winners: rows.filter((r) => r.choice === "insufficient_evidence").length,
  confirmed_cost_usd: attempts.reduce((s, a) => s + (a.cost ?? 0), 0),
  unconfirmed_charges: attempts.filter((a) => a.cost === null).length,
  http_span_seconds: (Math.max(...attempts.map((a) => Date.parse(a.body_received_at_utc))) - Math.min(...attempts.map((a) => Date.parse(a.network_started_at_utc)))) / 1000,
  wrong_labelled_cases: groups.filter((g) => g.matching === 0).map((g) => g.label), sweeps, groups };
await writeJsonAtomic(join(directory, "summary.json"), summary);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const range = (r: number[]) => r[0] === r[1] ? pct(r[0]!) : `${pct(r[0]!)}–${pct(r[1]!)}`;
const display = (x: string) => ({ not_an_entity: "Not an entity", mixed_referents: "Mixed referents", insufficient_evidence: "Insufficient evidence" })[x] ?? x;
const table = (head: string[], body: string[][]) => ["| " + head.join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |", ...body.map((cells) => "| " + cells.map((s) => s.replaceAll("|", "\\|")).join(" | ") + " |")].join("\n");
let report = `# Combined qualification/type question — document 01 diagnostic\n\n` +
  `20 cases, three fresh calls each, ten options. The seven entity definitions and capture/source-authority rules were loaded through the existing loader. Added decision outcomes: Not an entity, Mixed referents, Insufficient evidence. Expected labels were frozen before calls and excluded from requests. No production Q06/Q07 changes or stronger-LLM calls.\n\n` +
  `## Results\n\nAll 60 responses passed the existing response-validation contract; every captured outbound matched the frozen template plus its candidate. All 20 cases chose the same label in all three repeats; stable answers include wrong answers. ${summary.matching_labelled_answers}/${summary.labelled_answers} answers match the predeclared acceptable outcomes across ${summary.labelled_cases} labelled cases. The movement and festival were deliberately unscored; Pantheon allows Concept or Organization. These are diagnostic reference judgments, not population accuracy.\n\n` +
  table(["Candidate / control", "Choice, all three calls", "Chosen probability", "Returned confidence", "Expected / review"], groups.map((g) => [g.label, g.choices.map(display).filter((v, i, a) => a.indexOf(v) === i).join(" / "), range(g.probability_range), range(g.confidence_range), g.expected?.map(display).join(" or ") ?? "Unscored — source interpretation needed"])) +
  `\n\n## Added outcomes\n\nBoth table headers correctly selected Not an entity in all six calls. Mixed referents won for Church/doctrine and Waterdeep/cathedral, but lost for deity/followers and Church/movement: two of four mixed controls detected. Insufficient evidence never won in any call, including low-confidence cases. The followers selected Not an entity at only 27–28%; this would require clarification, not confident rejection.\n\n` +
  `## Confidence routing experiment\n\nHypothetical rule: automatically type or reject only when returned confidence meets the cutoff; always clarify Mixed referents and Insufficient evidence, and clarify any lower-confidence answer. Each repeat is counted independently (60 answers), not as 60 independent source cases. Production is unchanged.\n\n` +
  table(["Confidence cutoff", "Auto type", "Auto reject", "Clarify", "Wrong automatic labelled answers", "Unscored automatic answers"], sweeps.map((s) => [pct(s.confidence_cutoff), String(s.automatic_type), String(s.automatic_rejection), String(s.clarify), String(s.wrong_automatic_labelled), String(s.unscored_automatic)])) +
  `\n\nAt 75% confidence, Church/movement is incorrectly auto-typed in two of three calls (Organization probability 78% and 82%; confidence 76% and 80%). At 85%, no labelled automatic errors occur in this selected set, but 27/60 answers require clarification. This is a trade-off observation, not a validated cutoff. For ten options, computed confidence is (top probability-0.1)/0.9; the tables use Jev's returned rounded confidence. Probability 75% is therefore approximately confidence 72%, not confidence 75%.\n\n` +
  `## Exact instructions and criteria\n\n${template.questions.entity.instructions}\n\n` +
  table(["Option", "Exact criterion"], Object.entries(template.questions.entity.criteria).map(([k, v]) => [display(k), String(v)])) + "\n\n";
for (const g of groups) {
  report += `## ${g.label}: every returned score\n\nNames: ${g.names.join("; ")}.\n\nReference: ${g.reason}\n\n` +
    table(["Repeat", "Chosen", ...kinds.map(display), "Returned confidence"], g.repeats.map((r) => [String(r.repeat), display(r.choice), ...kinds.map((k) => pct(r.probabilities[k])), pct(r.confidence)])) + "\n\n";
}
report += `## Interpretation and limitations\n\nThe added exits make the question capable of rejecting metadata and detecting some mixed groups; their presence does not guarantee it will choose them. A confidence-only gate can accept a wrong mixed group. Candidate graph contradictions or a narrow negative-oriented mixed-referent check are possible next experiments. Neither is tested here. Realms as Location and followers as Organization are reviewer reference interpretations, not a user-approved exhaustive gold set. The earlier movement returned Organization 53–54% in all repeats, matching Church's type contrary to the user's different-type ruling; low confidence exposes uncertainty but does not resolve it. Festival returned Event 77–80%; its validity under Event capture rules is not scored. No Item or Quest cases were included, and all seven types' performance cannot be inferred.\n\n` +
  `## Cost and reproduce\n\nConfirmed cost $${summary.confirmed_cost_usd.toFixed(9)}; ${summary.unconfirmed_charges} unconfirmed charges; first network dispatch to final HTTP response ${summary.http_span_seconds.toFixed(2)} seconds.\n\n\`npx tsx src/dev/jev-playground/report-combined-entity-test.ts\` checks captured outbound, raw answers, schema and confidence consistency through the existing validator, and regenerates tables and threshold sweeps without network calls. Prepared cases, exact full context, all raw responses, SDK responses and timing remain alongside this report.\n`;
await writeFile(join(directory, "report.md"), report);
console.log(JSON.stringify({ ...summary, groups: undefined }, null, 2));
