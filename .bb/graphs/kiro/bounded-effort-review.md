# Independent bounded-effort review

Verdict: **PASS** for the authorized prompt/configuration change. No material
findings. Live worker compliance and application acceptance were not exercised.

Review date: 2026-10-07. The review used the baselines captured immediately before
this change, rather than the earlier Graph Studio setup baselines. Review actions
were read-only except for this report; no graph/workflow/application execution,
task dispatch or mutation, billable call, commit, or Organizer RPC was performed.

## Scope and instruction assessment

The scope ledger defines the required additions and preservation constraints,
including the already-disabled Organizer and deferred runtime timers:
[scope-ledger.md, lines 3–17](scope-ledger.md#L3).

| Requirement | Assessment and evidence |
| --- | --- |
| Four steps without a separate supervisor | The node list remains prepare, implement, review, finalize. The launcher is explicitly limited to launch, status reporting, and sequencing a selected backlog. [build-graphs.py, lines 296–306](build-graphs.py#L296); [dispatch-instructions.txt, lines 12–22](dispatch-instructions.txt#L12). |
| Completion plan | Preparation records required outputs, approved criteria, mandatory commands/procedures, reusable evidence and applicability, optional diagnostics, deferred work, and planned expensive operations. It cannot invent acceptance criteria. [build-graphs.py, lines 220–227](build-graphs.py#L220). |
| Ten-minute default per unexpected issue | The shared worker instructions timebox each unexpected investigation, count effort across repairs/reviews in packet issue notes, and require a fix, permitted unresolved outcome, or concrete blocker at the limit. Further diagnosis requires a new specific hypothesis/test, acceptance benefit, and bounded time/cost estimate recorded first. Repeated probes without new evidence or a credible path block. [build-graphs.py, lines 199–204](build-graphs.py#L199). |
| Honest enforcement boundary | Worker prompts and README explicitly identify these as agent instructions, not runtime timers. The scope ledger defers timers/watchdogs. No timeout control was introduced in the normalized graph comparison. [build-graphs.py, lines 212–214](build-graphs.py#L212); [README.md, lines 54–69](README.md#L54); [scope-ledger.md, lines 16–17](scope-ledger.md#L16). |
| Justified expensive work | Unplanned expensive operations need a criterion, explanation of insufficient existing evidence, and duration/cost estimate. Optional work without benefit is skipped; infeasible mandatory checks block. Representative pilots are conditional on compatibility with the required procedure. [build-graphs.py, lines 205–211](build-graphs.py#L205). |
| Compatible evidence and proportional verification | Repairs run focused regressions, completion satisfies all mandatory final checks, and reuse requires matching source inputs, configuration, relevant code, and approved criterion plus provenance. Invalidated evidence is rerun. Review ties findings/checks to approved conditions and explains reruns. [build-graphs.py, lines 245–275](build-graphs.py#L245). |
| Progress milestones | Shared instructions require completed work, remaining work, bottleneck, and next milestone, with large-operation progress checked against the pilot estimate. [build-graphs.py, lines 209–214](build-graphs.py#L209). |
| Neutral bounded effort | Added rules state operational choices and their acceptance purpose without hostile language. Unresolved ambiguity is allowed only when the governing contract permits it; sufficient required evidence remains necessary. [build-graphs.py, lines 195–214](build-graphs.py#L195). |

## Preservation assessment

Mandatory live acceptance and independent review remain explicit: the developer
produces real live end-to-end evidence; the reviewer reproduces meaningful
checks and extends testing when evidence is inadequate; PASS requires every
required acceptance and preservation condition. Finalization marks the complete
authorized scope done only after independent PASS. See
[build-graphs.py, lines 252–294](build-graphs.py#L252).

The original parent/full-child scope, locked specification reopening, required
providers, and uncommitted result remain in the common instructions. The shared
$5 ledger retains conservative reservations, reconciliation, uncertain-call
reservations, serialization, and a block on unknown costs or insufficient funds.
See [build-graphs.py, lines 179–194](build-graphs.py#L179).

The original durable attempt admission remains: at most four implementation and
four independent verification attempts including interrupted work, consumed
before edits/review, with no reset on restart. The graph visit limit remains four
for both implementation and review. See
[build-graphs.py, lines 232–262](build-graphs.py#L232).
The launcher preserves attempt/spend counts and only advances a selected backlog
after PASS: [dispatch-instructions.txt, lines 18–26](dispatch-instructions.txt#L18).

## Reproduced checks

Command: `node .bb/graphs/kiro/check-graphs.mjs`

Result: `PASS: 47 routing/dialog scenarios, schemas and model selections; no worker runs.`
This imports the installed Graph Studio schema, checks source/live equality, and
uses the real pure routing/dialog functions, including repair exhaustion and
missing-result fallback. It does not spawn workers. See
[check-graphs.mjs, lines 19–28](check-graphs.mjs#L19),
[check-graphs.mjs, lines 64–110](check-graphs.mjs#L64).

The following read-only comparison was run against the actual installed schema.
It reproduced source/live equality and confirmed that only worker prompts and
the Graph dispatch preset instructions changed. All normalized topology, guards,
fields, node models, and graph/preset metadata were equal to the immediate
baselines. The original Kiro preset was fully equal to its immediate baseline.

```sh
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const cli=args=>JSON.parse(execFileSync('bb',args,{encoding:'utf8'}));
const listed=cli(['plugin','list','--json']);
const plugins=Array.isArray(listed)?listed:listed.plugins;
const root=plugins.find(p=>p.id==='graph-studio').rootDir;
const api=await import(pathToFileURL(path.join(root,'lib/graph.ts')));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const evidence=process.env.KIRO_REVIEW_DIR; // directory containing the original local review exports
const before=api.graphSchema.parse(read(path.join(evidence,'kiro-effort-graph-before.json')).graph);
const source=api.graphSchema.parse(read('.bb/graphs/kiro/kiro-complete-task-graph.graph.json').graph);
const live=api.graphSchema.parse(cli(['graph-studio','export','kiro-complete-task-graph']).graph);
assert.deepEqual(source,live);
const omitPrompts=g=>({...g,nodes:g.nodes.map(({prompt,...rest})=>rest)});
assert.deepEqual(omitPrompts(before),omitPrompts(live));
const beforePreset=read(path.join(evidence,'kiro-effort-preset-before.json')).preset;
const livePreset=cli(['tasks','preset','show',beforePreset.id,'--json']).preset;
const {instructions:bi,...bm}=beforePreset;
const {instructions:li,...lm}=livePreset;
assert.deepEqual(bm,lm);
assert.equal(li,fs.readFileSync('.bb/graphs/kiro/dispatch-instructions.txt','utf8'));
const oldBefore=read(path.join(evidence,'kiro-effort-old-preset-before.json')).preset;
assert.deepEqual(cli(['tasks','preset','show',oldBefore.id,'--json']).preset,oldBefore);
const pluginBefore=read(path.join(evidence,'kiro-effort-plugin-before.json'));
const oldPlugins=Array.isArray(pluginBefore)?pluginBefore:pluginBefore.plugins;
for (const id of ['graph-studio','kiro-workflow','thread-organizer']) {
  const b=oldPlugins.find(p=>p.id===id),a=plugins.find(p=>p.id===id);
  for (const k of ['id','rootDir','enabled','status','version','source']) assert.equal(a[k],b[k]);
}
console.log('PASS: normalized graph/preset and plugin preservation');
JS
```

Observed tuples were prepare/Sol/high, implement/Luna/xhigh, review/Sol/xhigh,
finalize/Sol/high, all Codex. `maxSteps` remained 14, every `maxAttempts` remained
1, implementation/review `maxVisits` remained 4, and finalization `maxVisits`
remained 1. The Graph launcher remained Codex Sol high. Graph Studio and the
original Kiro plugin remained enabled/running; Organizer remained disabled.
No Organizer RPC was queried.

The preserved-file digest comparison matched **24/24** entries, including the
original plugin sources/dist/prompts/workflow, project execution workflow,
planning graph, and AGENTS.md. Reproduction:

```sh
python3 - <<'PY'
import json,hashlib
import os, pathlib
v=json.loads((pathlib.Path(os.environ['KIRO_REVIEW_DIR'])/'kiro-effort-preservation.json').read_text())
bad=[f for f,h in v.items() if hashlib.sha256(open(f,'rb').read()).hexdigest()!=h]
assert not bad,bad
print('PASS:',len(v),'preserved file hashes')
PY
```

Generator/source consistency was checked without writing generated outputs:

```sh
python3 - <<'PY'
import ast,json,pathlib
p=pathlib.Path('.bb/graphs/kiro/build-graphs.py')
a=ast.parse(p.read_text()); ns={'__file__':str(p)}
cut=next(i for i,n in enumerate(a.body) if isinstance(n,ast.For) and n.lineno==308)
exec(compile(ast.Module(body=a.body[:cut],type_ignores=[]),str(p),'exec'),ns)
for name in ['plan','execute']:
    g=ns[name]
    assert g==json.load(open(p.parent/(g['id']+'.graph.json')))['graph']
d=next(n for n in a.body if isinstance(n,ast.Expr) and n.lineno==315)
assert ast.literal_eval(d.value.args[0])==(p.parent/'dispatch-instructions.txt').read_text()
print('PASS: both generated graphs and dispatch instructions match source')
PY
```

The review establishes configuration and instruction preservation only. It does
not establish workers' actual timing/accounting behavior, live application
acceptance, or future execution outcomes. Existing running work was not operated
on by this review.
