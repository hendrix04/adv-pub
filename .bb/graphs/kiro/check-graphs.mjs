// Exercise installed Graph Studio routing without spawning workers or tasks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const listed = JSON.parse(execFileSync('bb', ['plugin', 'list', '--json'], { encoding: 'utf8' }));
function findPlugin(value) {
  if (Array.isArray(value)) return value.map(findPlugin).find(Boolean);
  if (value && typeof value === 'object') {
    if (value.id === 'graph-studio') return value;
    return Object.values(value).map(findPlugin).find(Boolean);
  }
}
const plugin = findPlugin(listed);
assert(plugin?.rootDir, 'Installed Graph Studio source is required');
const api = await import(pathToFileURL(path.join(plugin.rootDir, 'lib/graph.ts')));
const load = id => api.graphSchema.parse(JSON.parse(fs.readFileSync(path.join(root, id + '.graph.json'), 'utf8')).graph);
const plan = load('kiro-plan-feature');
const work = load('kiro-complete-task-graph');
for (const graph of [plan, work]) {
  assert.deepEqual(api.validateGraph(graph), []);
  assert(graph.nodes.every(n => n.maxAttempts === 1), 'Retries cannot silently duplicate work');
  const live = JSON.parse(execFileSync('bb', ['graph-studio', 'export', graph.id], { encoding: 'utf8' }));
  assert.deepEqual(api.graphSchema.parse(live.graph), graph, 'Saved graph matches the portable definition');
}

let checks = 0;
function route(graph, from, fields, expected, visits = {}) {
  const state = { ...api.emptyRunState(), fields, visits };
  assert.equal(api.routeFrom(graph, from, state).next, expected);
  checks++;
}
route(plan, 'grill', { grill: { status: 'READY' } }, 'requirements');
route(plan, 'grill', { grill: { status: 'BLOCKED' } }, 'blocked');
for (const [stage, next] of [['requirements', 'design'], ['design', 'tasks'], ['tasks', 'export']]) {
  const review = stage + '_review';
  route(plan, review, { [review]: { action: 'APPROVE' } }, next);
  route(plan, review, { [review]: { action: 'REVISE' } }, stage);
  route(plan, review, { [review]: { action: 'REQUIREMENTS' } }, 'requirements');
  route(plan, review, { [review]: { action: 'BLOCK' } }, 'blocked');
  route(plan, review, {}, 'blocked'); // Missing approval never advances.
  route(plan, review, { [review]: { action: 'REVISE' } }, 'blocked', { [stage]: 12 });
}
route(plan, 'design', { design: { status: 'REOPEN_REQUIREMENTS' } }, 'requirements');
route(plan, 'tasks', { tasks: { status: 'REOPEN_REQUIREMENTS' } }, 'requirements');
route(plan, 'export', { export: { status: 'READY' } }, '__end__');
route(plan, 'export', { export: { status: 'BLOCKED' } }, 'blocked');
// Draft conflicts/blockers must reach the next worker even before review.
for (const draft of ['design', 'tasks']) {
  const state = { ...api.emptyRunState(), outputs: { [draft]: 'Conflict: current requirement needs correction.' } };
  const prompt = api.renderPrompt(plan.nodes.find(n => n.id === 'requirements').prompt, state);
  assert(prompt.includes('Conflict: current requirement needs correction.'));
  checks++;
}
for (const draft of ['requirements', 'design', 'tasks']) {
  const state = { ...api.emptyRunState(), outputs: { [draft]: 'Blocked: prerequisite is unavailable.' } };
  const prompt = api.renderPrompt(plan.nodes.find(n => n.id === 'blocked').prompt, state);
  assert(prompt.includes('Blocked: prerequisite is unavailable.'));
  checks++;
}
for (const [stage, next] of [['prepare', 'implement'], ['implement', 'review']]) {
  route(work, stage, { [stage]: { status: 'READY' } }, next);
  route(work, stage, { [stage]: { status: 'BLOCKED' } }, 'finalize');
  route(work, stage, {}, 'finalize');
}
route(work, 'review', { review: { verdict: 'PASS' } }, 'finalize');
route(work, 'review', { review: { verdict: 'BLOCKED' } }, 'finalize');
route(work, 'review', { review: { verdict: 'FAIL' } }, 'implement', { implement: 3 });
route(work, 'review', { review: { verdict: 'FAIL' } }, 'finalize', { implement: 4 });
route(work, 'review', {}, 'finalize');

// Actual dialogue parsing: forced summary is completion, not approval.
const reviewNode = plan.nodes.find(n => n.id === 'requirements_review');
assert.deepEqual(api.parseDialogTurn('```json\n{"done":false,"question":"Approve this revision?"}\n```'),
  { done: false, question: 'Approve this revision?' });
assert.throws(() => api.parseFields(reviewNode.fields, '{"done":true}'));
assert.deepEqual(api.parseFields(reviewNode.fields, '{"done":true,"action":"BLOCK","feedback":"Turn limit; no approval"}'),
  { action: 'BLOCK', feedback: 'Turn limit; no approval' });
checks += 3;

// Traverse the real routing functions through repair and exhaustion scenarios.
for (const verdicts of [['PASS'], ['FAIL', 'PASS'], ['FAIL', 'FAIL', 'FAIL', 'FAIL'], ['BLOCKED']]) {
  const state = { ...api.emptyRunState() };
  let current = '__start__';
  let reviews = 0;
  const visited = [];
  while (current !== '__end__') {
    current = api.routeFrom(work, current, state).next;
    if (current === '__end__') break;
    assert(visited.length < 14);
    visited.push(current);
    state.visits[current] = (state.visits[current] ?? 0) + 1;
    if (current === 'prepare' || current === 'implement') state.fields[current] = { status: 'READY' };
    if (current === 'review') state.fields.review = { verdict: verdicts[reviews++] };
  }
  assert.equal(reviews, verdicts.length);
  assert.equal(visited.filter(n => n === 'implement').length, verdicts.length);
  assert.equal(visited.at(-1), 'finalize');
  checks++;
}
for (const node of plan.nodes) assert.equal(node.reasoningLevel, 'xhigh');
for (const node of work.nodes) {
  assert.equal(node.providerId, 'codex');
  assert.equal(node.model, node.id === 'implement' ? 'gpt-6-luna' : 'gpt-6.1-sol');
  assert.equal(node.reasoningLevel, ['prepare', 'finalize'].includes(node.id) ? 'high' : 'xhigh');
}
console.log(`PASS: ${checks} routing/dialog scenarios, schemas and model selections; no worker runs.`);
