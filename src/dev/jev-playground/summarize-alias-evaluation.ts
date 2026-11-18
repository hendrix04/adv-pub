import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyDecisionPolicy, type DecisionAnswer, type QuestionPolicy } from "../../domains/document/decisions/policy.js";
import { buildCatalogReferentGroups } from "../../domains/document/aliases/groups.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";
import type { Candidate } from "../../domains/document/decisions/contracts.js";
import { parseDecisionWire, validateDecisionAnswers } from "../../domains/document/decisions/validation.js";

const root = resolve(".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds");
const directory = join(root, "document-01-alias-evaluation");
const oldRoot = resolve(".kiro/execution/AP-28/live/fresh/discovery-inputs/01/classifications/2f4d605b-3b0f-4cfa-a6cf-fc36c1551686/aliases/catalog-v1");
const rows: any[] = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
const planned: any[] = JSON.parse(await readFile(join(directory, "pairs.json"), "utf8"));
const template = JSON.parse(await readFile(join(directory, "frozen-template.json"), "utf8"));
const policy: QuestionPolicy = JSON.parse(await readFile(join(root, "trial-policy-v4.json"), "utf8"));
const original = JSON.parse(await readFile(join(oldRoot, "alias-groups.json"), "utf8"));
const names = new Set(planned.flatMap((pair) => [pair.name_a, pair.name_b]));
const candidates: Candidate[] = original.groups.flatMap((group: Candidate) => group.members ?? [group]).filter((member: Candidate) => names.has(member.name)).sort((a: Candidate, b: Candidate) => a.index - b.index);
assert.equal(candidates.length, 56);
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
const attempts: any[] = [];
const validationFindings: any[] = [];
for (const pair of planned) {
  const path = join(directory, "calls", pair.id);
  for (const name of await readdir(path)) {
    if (!name.startsWith("attempt-")) continue;
    const attempt = join(path, name);
    const wire = JSON.parse(await readFile(join(attempt, "outbound-request.json"), "utf8"));
    const expected = structuredClone(template);
    expected.state.target.name_a = pair.name_a;
    expected.state.target.name_b = pair.name_b;
    assert(isDeepStrictEqual(wire, expected), `${pair.id}: actual wire changed more than target names`);
    const result = JSON.parse(await readFile(join(attempt, "result.json"), "utf8"));
    let raw: any;
    try { raw = parseDecisionWire(await readFile(join(attempt, "response-body.txt"), "utf8")); } catch { /* absent transport response */ }
    let timing: any;
    try { timing = JSON.parse(await readFile(join(attempt, "transport-end.json"), "utf8")); } catch { /* network failure */ }
    if (result.probabilities) {
      assert.deepEqual(result.probabilities, raw.answers.alias.probabilities);
      assert.equal(result.choice, raw.answers.alias.choice);
      const checked = validateDecisionAnswers(raw, template.questions, policy.probability_sum_tolerance, policy.confidence_tolerance);
      if (checked.findings.length) validationFindings.push({ pair: pair.id, attempt: name, findings: checked.findings });
    }
    attempts.push({ pair: pair.id, cost: raw?.usage?.cost ?? null, duration_ms: result.duration_ms,
      http_status: timing?.http_status ?? null, start: timing?.network_started_at_utc, end: timing?.body_received_at_utc });
  }
}
const valid = rows.filter((row) => row.probabilities);
const references = valid.filter((row) => row.expected);
const positive = references.filter((row) => row.expected === "same_entity");
const negative = references.filter((row) => row.expected === "different_entities");
const expandedReview = JSON.parse(await readFile(join(directory, "expanded-source-review.json"), "utf8"));
const expandedIds = new Set(expandedReview.expected_positive_pairs.map((row: any) => row.id));
const expandedPositive = valid.filter((row) => expandedIds.has(row.id));
function answer(row: any, old = false): DecisionAnswer {
  return old ? row.old_answer : { type: "choice", choice: row.choice, probabilities: row.probabilities, confidence: row.confidence };
}
function action(row: any, threshold: number, old = false) {
  const simulated = structuredClone(policy);
  simulated.rules.aliasIdentity!.choice_threshold = threshold;
  return applyDecisionPolicy(answer(row, old), "aliasIdentity", simulated);
}
function group(threshold: number, old: boolean) {
  return buildCatalogReferentGroups(candidates, valid.map((row) => ({ question_id: row.id,
    target: { name_clues: { candidate_ids: [byName.get(row.name_a)!.candidate_id, byName.get(row.name_b)!.candidate_id] } },
    action: action(row, threshold, old) })));
}
const thresholds = [.92, .75, .60].map((threshold) => {
  const current = group(threshold, false);
  const historical = group(threshold, true);
  return { threshold,
    expanded_correct_positive_links: expandedPositive.filter((row) => action(row, threshold).label === "same_entity").length,
    old_expanded_correct_positive_links: expandedPositive.filter((row) => action(row, threshold, true).label === "same_entity").length,
    correct_positive_links: positive.filter((row) => action(row, threshold).label === "same_entity").length,
    old_correct_positive_links: positive.filter((row) => action(row, threshold, true).label === "same_entity").length,
    wrong_reference_links: negative.filter((row) => action(row, threshold).label === "same_entity").length,
    old_wrong_reference_links: negative.filter((row) => action(row, threshold, true).label === "same_entity").length,
    accepted_links: valid.filter((row) => action(row, threshold).label === "same_entity").length,
    unresolved: valid.filter((row) => action(row, threshold).status === "unresolved").length,
    grouping: current, old_grouping: historical };
});
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2; };
const timed = attempts.filter((a) => a.start && a.end);
const summary = { planned_pairs: planned.length, valid_pairs: valid.length, attempts: attempts.length,
  validation_findings: validationFindings,
  expanded_source_review_positive_pairs: expandedPositive.length,
  expanded_source_review_missed_at_75: expandedPositive.filter((row) => action(row, .75).label !== "same_entity"),
  reference_positive_pairs: positive.length, reference_negative_pairs: negative.length,
  raw_reference_correct: references.filter((row) => row.choice === row.expected).length,
  old_raw_reference_correct: references.filter((row) => row.old_answer.choice === row.expected).length,
  reference_errors: references.filter((row) => row.choice !== row.expected), thresholds,
  confirmed_cost_usd: attempts.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0),
  unconfirmed_attempts: attempts.filter((a) => a.cost == null).length,
  median_request_ms: median(attempts.map((a) => a.duration_ms)),
  median_http_ms: median(timed.map((a) => Date.parse(a.end) - Date.parse(a.start))),
  transport_span_seconds: (Math.max(...timed.map((a) => Date.parse(a.end))) - Math.min(...timed.map((a) => Date.parse(a.start)))) / 1000,
  failed_attempts: attempts.filter((a) => a.http_status !== 200).length,
  models: [...new Set(valid.map((row) => row.model))] };
await writeJsonAtomic(join(directory, "summary.json"), summary);
const pct = (value: number) => `${Math.round(value * 100)}%`;
const display = (label: string) => ({ same_entity: "Same", different_entities: "Different", unclear: "Unclear" })[label] ?? label;
const cell = (value: string) => value.replaceAll("|", "\\|");
const table = (header: string[], body: string[][]) => ["| " + header.join(" | ") + " |", "| " + header.map(() => "---").join(" | ") + " |", ...body.map((cells) => "| " + cells.map(cell).join(" | ") + " |")].join("\n");
const links = valid.filter((row) => row.choice === "same_entity");
const report = `# Document 01: frozen alias prompt evaluation\n\n` +
  `All ${valid.length}/${planned.length} campaign-name pairs returned valid answers. Marvel names were excluded; UCR was included. Full source still contains the original Marvel text. Only the target names changed in the winning single-question request; all actual wire requests and raw answers were checked.\n\n` +
  `## Overall assessment\n\nKeep this context as the stronger working candidate, with a 75% alias threshold. It fixes all six deity/follower distinctions and consolidates the Church and Apollo deity names. It does not consolidate the follower names, and the Pantheon still splits into two conflicted groups that the current pipeline would exclude before Q06. This is a practical improvement with visible remaining losses, not complete pipeline acceptance.\n\n` +
  `After the run, source review expanded the expected-alias list to ${expandedPositive.length} links, adding the full five-name Pantheon set and Realms/Forgotten Realms. At 75%, ${thresholds[1]!.expanded_correct_positive_links}/${expandedPositive.length} (${Math.round(thresholds[1]!.expanded_correct_positive_links / expandedPositive.length * 100)}%) of these links are accepted, versus ${thresholds[1]!.old_expanded_correct_positive_links}/${expandedPositive.length} from old v4 at the same threshold. All ${thresholds[1]!.accepted_links} accepted links fit this reviewed list; no wrong accepted link was identified at 75%. These are my source-review judgments, incorporating your adjudication; the post-run expansion is separate from the predeclared benchmark. See source-review.md for rationale and limits.\n\n` +
  table(["Threshold", "Reviewed aliases recovered: new / old", "Accepted links", "Conflicted groups"], thresholds.map((t) => [pct(t.threshold), `${t.expanded_correct_positive_links}/${expandedPositive.length} / ${t.old_expanded_correct_positive_links}/${expandedPositive.length}`, `${t.accepted_links}`, `${t.grouping.conflictedGroupIds.length}`])) +
  `\n\n### Five alias links not accepted at 75%\n\n` +
  table(["Name A", "Name B", "Answer", "Same score", "Chosen score"], summary.expanded_source_review_missed_at_75.map((r) => [r.name_a, r.name_b, display(r.choice), pct(r.probabilities.same_entity), pct(r.probabilities[r.choice])])) +
  `## Decision metrics\n\nReference cases: ${positive.length} expected aliases and ${negative.length} deliberate distinct-referent checks, frozen before calls. These are bounded reviewer/user judgments, not a corpus accuracy estimate. Raw choices match ${summary.raw_reference_correct}/${references.length} reference labels, versus ${summary.old_raw_reference_correct}/${references.length} in old v4.\n\n` +
  table(["Threshold", "Expected links recovered (new / old)", "Wrong reference links (new / old)", "All accepted same links", "Unresolved pairs", "Unapplied links / conflicted groups"], thresholds.map((t) => [pct(t.threshold), `${t.correct_positive_links}/${positive.length} / ${t.old_correct_positive_links}/${positive.length}`, `${t.wrong_reference_links} / ${t.old_wrong_reference_links}`, `${t.accepted_links}`, `${t.unresolved}`, `${t.grouping.unappliedLinkIds.length} / ${t.grouping.conflictedGroupIds.length}`])) +
  `\n\n## Every pair predicted to be an alias\n\nThis includes low-score predictions that a threshold would withhold. Unlabelled cases require source inspection; they are not silently counted correct.\n\n` +
  table(["Name A", "Name B", "Old same score", "New same score", "Frozen expectation", "At 75%", "At 92%"], links.map((r) => [r.name_a, r.name_b, pct(r.old_answer.probabilities.same_entity), pct(r.probabilities.same_entity), r.expected ? display(r.expected) : "Not prelabelled", action(r, .75).label === "same_entity" ? "Link" : "Withhold", action(r, .92).label === "same_entity" ? "Link" : "Withhold"])) +
  `\n\n## All frozen reference results\n\n` +
  table(["Name A", "Name B", "Expected", "Old choice / score", "New choice / score", "At 75%"], references.map((r) => [r.name_a, r.name_b, display(r.expected), `${display(r.old_answer.choice)} ${pct(r.old_answer.probabilities[r.old_answer.choice])}`, `${display(r.choice)} ${pct(r.probabilities[r.choice])}`, display(action(r, .75).label ?? "Withhold")])) +
  `\n\n## Operations\n\n${attempts.length} HTTP attempts; ${summary.failed_attempts} failed attempts; ${summary.unconfirmed_attempts} charges unconfirmed. Confirmed cost: $${summary.confirmed_cost_usd.toFixed(9)}. Median HTTP elapsed: ${summary.median_http_ms} ms. Median whole call including artifact/budget work: ${summary.median_request_ms} ms. First HTTP dispatch to final response: ${summary.transport_span_seconds.toFixed(1)} seconds. Ten concurrent request loops; no Hatchet jobs or pipeline rerun.\n\n` +
  `## Reproduce\n\n\`npx tsx src/dev/jev-playground/summarize-alias-evaluation.ts\` recounts saved responses, checks every wire request against the frozen template, applies the existing decision-policy function, and replays the existing catalog grouper at each threshold. It makes no network calls.\n\n` +
  `## Limits\n\nOne fresh answer per pair, with failed requests retried only if needed. Not a repeat-stability study. The old run used a different context and batched questions: differences cannot be attributed to one sentence. Alias grouping is replayed against saved source-backed candidates; qualification, type and association are not run. Production thresholds remain unchanged. Scores are model weights, not measured accuracy.\n`;
await writeFile(join(directory, "report.md"), report);
console.log(JSON.stringify({ ...summary, thresholds: thresholds.map(({ grouping, old_grouping, ...rest }) => ({ ...rest, unapplied: grouping.unappliedLinkIds.length, conflicted: grouping.conflictedGroupIds.length })) }, null, 2));
