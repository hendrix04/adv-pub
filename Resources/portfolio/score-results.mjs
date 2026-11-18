// Offline recount of the published run excerpts. Run with Node from any directory.
import { readFileSync } from "node:fs";

function load(name) {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
}

const documents = load("classification-runs.json");
const total = (getValue) => documents.reduce((sum, doc) => sum + getValue(doc), 0);
console.log("Six-document classification trial");
console.table({
  "Discovered names": total(doc => doc.discovery_names),
  "Q05 alias questions": total(doc => doc.questions.Q05),
  "Groups withheld for identity conflicts": total(doc => doc.conflicted_groups),
  "Q06 qualification questions": total(doc => doc.questions.Q06),
  "Q07 type questions": total(doc => doc.questions.Q07),
  "Local records emitted": total(doc => doc.emitted),
});

const reviewed = load("reviewed-pairs.json");
const positives = reviewed.filter(row => row.expected === "same_entity");
const negatives = reviewed.filter(row => row.expected === "different_entities");
const expanded = reviewed.filter(row => row.expected === "same_entity" || row.post_run_alias);
const accepted = (rows, field) => rows.filter(row => row[field] >= 0.75).length;
console.log("Alias links accepted at 75%");
console.table(["prior_same", "frozen_same"].map(field => ({
  configuration: field,
  [`recovered of ${positives.length} predeclared links`]: accepted(positives, field),
  [`false links among ${negatives.length} distinct pairs`]: accepted(negatives, field),
  [`recovered of ${expanded.length} after expanded review`]: accepted(expanded, field),
})));

const pairs = load("context-trials.json");
const labeled = pairs.filter(pair => pair.expected !== null);
console.log(`Direct pair decisions on ${labeled.length} scored cases (${pairs.length} queried per condition)`);
console.table(Object.keys(pairs[0].runs).map(run => {
  let correct = 0;
  let wrong = 0;
  let unresolved = 0;
  for (const pair of labeled) {
    const probability = pair.runs[run];
    if (probability > 0.15 && probability < 0.75) unresolved++;
    else if ((probability >= 0.75) === pair.expected) correct++;
    else wrong++;
  }
  return { run, correct, wrong, unresolved };
}));
