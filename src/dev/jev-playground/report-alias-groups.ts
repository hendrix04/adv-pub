import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDecisionWire, validateDecisionAnswers } from "../../domains/document/decisions/validation.js";
import { writeJsonAtomic } from "../../domains/document/discovery/artifacts.js";

const directory = resolve(process.argv[2] ?? ".kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-02-noul-grouping");
const names: string[] = JSON.parse(await readFile(join(directory, "names.json"), "utf8"));
const rows: any[] = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
const planned: any[] = JSON.parse(await readFile(join(directory, "pairs.json"), "utf8"));
const template = JSON.parse(await readFile(join(directory, "frozen-template.json"), "utf8"));
assert.equal(rows.length, planned.length);
assert.equal(new Set(rows.map((r) => r.id)).size, planned.length);
assert(rows.every((r) => typeof r.noul === "number"));
assert.equal(await readFile(join(directory, "source.md"), "utf8"), template.state.complete_source);
const attempts: any[] = [];
for (const row of rows) {
  const expectedPair = planned.find((p) => p.id === row.id);
  assert.equal(row.name_a, expectedPair.name_a);
  assert.equal(row.name_b, expectedPair.name_b);
  for (const entry of await readdir(join(directory, "calls", row.id))) {
    if (!entry.startsWith("attempt-")) continue;
    const path = join(directory, "calls", row.id, entry);
    const expected = structuredClone(template);
    expected.state.target.name_a = row.name_a;
    expected.state.target.name_b = row.name_b;
    const wire = JSON.parse(await readFile(join(path, "outbound-request.json"), "utf8"));
    assert(isDeepStrictEqual(wire, expected));
    const raw: any = parseDecisionWire(await readFile(join(path, "response-body.txt"), "utf8"));
    const attempt = JSON.parse(await readFile(join(path, "result.json"), "utf8"));
    if (typeof attempt.noul === "number") {
      assert.deepEqual(validateDecisionAnswers(raw, template.questions, .02, .02).findings, []);
      assert.equal(attempt.noul, raw.answers.alias.noul);
    }
    let timing: any = {};
    try { timing = JSON.parse(await readFile(join(path, "transport-end.json"), "utf8")); } catch { /* retained failed transport */ }
    attempts.push({ cost: raw.usage?.cost ?? null, ...timing, valid: typeof attempt.noul === "number" });
  }
  row.yes = row.noul;
  row.no = 1 - row.noul;
  row.computed_confidence = Math.abs(2 * row.noul - 1);
}
function components(vertices: string[], edges: Array<[string, string]>) {
  const adjacency = new Map(vertices.map((name) => [name, new Set<string>()]));
  for (const [a, b] of edges) { adjacency.get(a)!.add(b); adjacency.get(b)!.add(a); }
  const remaining = new Set(vertices);
  const groups: string[][] = [];
  for (const seed of vertices) {
    if (!remaining.has(seed)) continue;
    const pending = [seed];
    const members = new Set<string>();
    while (pending.length) {
      const name = pending.pop()!;
      if (members.has(name)) continue;
      members.add(name);
      pending.push(...adjacency.get(name)!);
    }
    groups.push(vertices.filter((name) => members.has(name)));
    for (const name of members) remaining.delete(name);
  }
  return groups;
}
// Reproduce the intended transitivity: A-B and B-C merge without requiring A-C.
assert.deepEqual(components(["A", "B", "C", "D"], [["A", "B"], ["B", "C"]]), [["A", "B", "C"], ["D"]]);
const links = rows.filter((r) => r.yes >= .75);
const separated = rows.filter((r) => r.yes <= .15);
const uncertain = rows.filter((r) => r.yes > .15 && r.yes < .75);
const groupNames = components(names, links.map((r) => [r.name_a, r.name_b]));
assert.equal(groupNames.flat().length, names.length);
assert.equal(new Set(groupNames.flat()).size, names.length);
const groupByName = new Map(groupNames.flatMap((members, index) => members.map((name) => [name, index] as const)));
assert(links.every((r) => groupByName.get(r.name_a) === groupByName.get(r.name_b)));
const inside = (r: any) => groupByName.get(r.name_a) === groupByName.get(r.name_b);
const contradictions = separated.filter(inside);
const indirect = rows.filter((r) => r.yes < .75 && inside(r));
const unresolvedBetween = uncertain.filter((r) => !inside(r));
const groups = groupNames.map((members, index) => ({ id: `group-${String(index + 1).padStart(2, "0")}`, names: members,
  accepted_links: links.filter((r) => members.includes(r.name_a) && members.includes(r.name_b)),
  indirect_pairs: indirect.filter((r) => members.includes(r.name_a) && members.includes(r.name_b)),
  contradictions: contradictions.filter((r) => members.includes(r.name_a) && members.includes(r.name_b)) }));
const timed = attempts.filter((a) => a.network_started_at_utc && a.body_received_at_utc);
const summary = { candidates: names.length, pairs: rows.length, attempts: attempts.length, valid_pairs: rows.length,
  accepted_links: links.length, separated_pairs: separated.length, uncertain_pairs: uncertain.length,
  total_groups: groups.length, merged_groups: groups.filter((g) => g.names.length > 1).length,
  singletons: groups.filter((g) => g.names.length === 1).length,
  indirect_pairs: indirect.length, strong_no_inside_groups: contradictions.length,
  uncertain_between_groups: unresolvedBetween.length,
  confirmed_cost_usd: attempts.reduce((s, a) => s + (a.cost ?? 0), 0),
  unconfirmed_attempts: attempts.filter((a) => a.cost === null).length,
  failed_attempts: attempts.filter((a) => !a.valid).length,
  transport_span_seconds: (Math.max(...timed.map((a) => Date.parse(a.body_received_at_utc))) - Math.min(...timed.map((a) => Date.parse(a.network_started_at_utc)))) / 1000,
  yes_threshold: .75, no_threshold: .15 };
await writeJsonAtomic(join(directory, "scored-results.json"), rows);
await writeJsonAtomic(join(directory, "groups.json"), groups);
await writeJsonAtomic(join(directory, "summary.json"), summary);
const pct = (x: number) => `${Math.round(100 * x)}%`;
const table = (head: string[], body: string[][]) => ["| " + head.join(" | ") + " |", "| " + head.map(() => "---").join(" | ") + " |", ...body.map((r) => "| " + r.map((s) => s.replaceAll("|", "\\|")).join(" | ") + " |")].join("\n");
const pairTable = (data: any[]) => table(["Name A", "Name B", "Yes", "No", "Computed confidence"], data.map((r) => [r.name_a, r.name_b, pct(r.yes), pct(r.no), pct(r.computed_confidence)]));
let report = `# Document 02 — fresh Q05 yes/no and overlap grouping\n\n` +
  `${names.length} discovery names; ${rows.length} fresh pair answers. Accept Yes >= 75%, separate Yes <= 15%, otherwise retain for clarification. Merge accepted pair sets by shared names (connected components); keep original answers as evidence. Jev Noul does not return separate confidence; displayed confidence is computed as abs(2p-1).\n\n` +
  `## Summary\n\n${links.length} accepted links; ${separated.length} separation answers; ${uncertain.length} uncertain pairs. ${groups.length} resulting groups: ${summary.merged_groups} merged groups and ${summary.singletons} singleton candidates. ${indirect.length} below-threshold pairs are connected through accepted paths. ${contradictions.length} strong separation answers occur inside merged groups. ${unresolvedBetween.length} uncertain pairs remain between groups. These are grouping candidates, not qualified or typed entities.\n\n` +
  `## All merged groups\n\n` + table(["Group", "Names", "Accepted links", "Indirect pairs", "Strong No contradictions"], groups.filter((g) => g.names.length > 1).map((g) => [g.id, g.names.join("; "), String(g.accepted_links.length), String(g.indirect_pairs.length), String(g.contradictions.length)])) + "\n\n";
for (const group of groups.filter((g) => g.names.length > 1)) {
  report += `### ${group.id}: ${group.names.join(" / ")}\n\nAccepted links:\n\n${pairTable(group.accepted_links)}\n\n`;
  if (group.indirect_pairs.length) report += `Pairs joined through accepted paths despite lower direct scores:\n\n${pairTable(group.indirect_pairs)}\n\n`;
}
report += `## Singleton candidates\n\n${groups.filter((g) => g.names.length === 1).map((g) => "- " + g.names[0]).join("\n")}\n\n` +
  `## Strong separation contradictions inside groups\n\n${contradictions.length ? pairTable(contradictions) : "None at the 15% Yes separation boundary."}\n\n` +
  `## Uncertain pairs between groups\n\n${pairTable([...unresolvedBetween].sort((a, b) => b.yes - a.yes))}\n\n` +
  `## Operations and preservation\n\nConfirmed cost $${summary.confirmed_cost_usd.toFixed(9)}; ${summary.unconfirmed_attempts} unconfirmed charges; ${summary.failed_attempts} failed attempts. HTTP span ${summary.transport_span_seconds.toFixed(2)} seconds. Every actual wire request checked against the document 02 template, every valid answer checked against the existing response contract. All input names appear in exactly one component, and every accepted link joins names in the same component. All original source bytes remain in source.md and the request. Document 02 has no Markdown table; table1 is empty, not document 01's Pantheon.\n\n` +
  `## Reproduce\n\n\`npx tsx src/dev/jev-playground/report-alias-groups.ts\` recounts raw responses and rebuilds groups without network calls. Full pairs, actual requests, responses and costs are retained beside this report. The existing runner makes fresh calls with the supplied diagnostic directory and --noul; it resumes completed pair results and preserves failed attempts. No production grouping implementation, Q06/Q07 classification, or LLM clarification was run.\n`;
await writeFile(join(directory, "report.md"), report);
console.log(JSON.stringify(summary, null, 2));
