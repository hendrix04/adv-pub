# Independent review of additive Kiro Graph Studio setup

Verdict: **PASS for the additive setup, saved configuration, and pure routing checks.**
No unresolved material findings remain in the reviewed definitions. Live dialog,
worker, recovery, and application acceptance are deferred; this verdict does not
establish their acceptance. The setup boundary explicitly preserves current work
and defers graph execution in [scope-ledger.md](scope-ledger.md#L8).

Reviewed independently on 2026-10-07. The reviewer only read files/configuration,
ran pure installed schema/routing code, and wrote this report. No application
task, graph, workflow, worker, paid service call, task update, or commit was
started by the reviewer. `bb graph-studio runs` returned `No runs.`

## Preservation and saved definitions

The independently reproduced results were:

```text
{"baseline_file_matches": 23, "old_preset_matches": 1,
 "new_preset_matches": true, "organizer_exact_match": true}
PASS: 47 routing/dialog scenarios, schemas and model selections; no worker runs.
```

All 23 files listed in `existing-setup-baseline.json` (local export)
matched their SHA-256 hashes. That baseline includes the existing Kiro plugin,
its bundled/project workflows, and AGENTS.md. The original preset exactly
matched `presets-before.json` (local export).
The new preset exactly matched `preset-created.json` (local export)
and its instructions matched [dispatch-instructions.txt](dispatch-instructions.txt#L1).
Organizer's live `getConfig` result exactly matched
`organizer-before.json` (local export),
including revision and section IDs.

Both saved graphs matched the portable sources after parsing through the actual
installed schema. Export compaction omits defaults such as `kind: agent`, so raw
JSON equality is unsuitable; the check uses normalized equality at
[check-graphs.mjs](check-graphs.mjs#L23).
Both `bb graph-studio show` commands also returned `Check found nothing.`

## Gate and execution review

| Requirement | Reviewed result and evidence |
| --- | --- |
| Human approval of the current revision | Each review is a native dialog. Its prompt requires explicit human approval during that visit, records the response/hash, and checks the hash before recording. See [build-graphs.py](build-graphs.py#L115). |
| Missing approval or turn limit cannot approve | Reviews require `action` and `feedback`; turn-limit instructions return BLOCK without approval. Parser checks reject `done:true` without required approval fields. See [check-graphs.mjs](check-graphs.mjs#L75). |
| Revisions require renewed approval | Substantive downstream corrections route to requirements, invalidate affected downstream receipts, and rebuild documents. Same-document feedback routes to its draft. See [build-graphs.py](build-graphs.py#L57) and [routing](build-graphs.py#L134). |
| Export and execution are separate | Export verifies all three receipts, preserves existing metadata, embeds complete parent context and native child bodies, and ends planning. It does not dispatch. See [export prompt](build-graphs.py#L144). |
| Full authorized parent and children | Preparation reads/hydrates the parent and every authorized child, checks approval/dependencies, refuses conflicting runs, and reconciles interrupted work. See [prepare prompt](build-graphs.py#L200). |
| Existing providers and accepted/unrelated work | Every execution worker receives the shared preservation, authorized scope, provider, no-commit, and human-reopening rules. See [execution contract](build-graphs.py#L187). |
| One implementation plus three repairs | Implementation/review nodes each allow four visits; automatic node retries are disabled. Durable attempts are consumed before edits/review and interrupted slots remain consumed across restarts. See [prepare/implement prompts](build-graphs.py#L207), [review prompt](build-graphs.py#L228), and [exhaustion checks](check-graphs.mjs#L69). |
| Independent live acceptance | Review keeps application code unchanged, examines complete acceptance/preservation, reproduces meaningful checks, requires real live evidence, and returns PASS/FAIL/BLOCKED. See [review prompt](build-graphs.py#L228). |
| Finalization cannot substitute for acceptance | Finalization requires independent PASS for the current complete scope/revision before marking done; blockers and exhausted repair failures stay unfinished. See [finalize prompt](build-graphs.py#L244). |
| One shared $5 budget | Every execution worker receives the same reservation/reconciliation rules, including repairs/retries/review/backlog, retained uncertain reservations, and blocked unknown costs. Model-session charges are separate. See [budget contract](build-graphs.py#L179). |
| Explicit sequential backlog | The coordinator requires a fixed dependency-ordered list, a fresh graph per parent, the same ledger, continuation only after PASS, and stop at FAIL/BLOCKED/error. See [dispatch instructions](dispatch-instructions.txt#L13). |
| Requested model selections | Preparation/finalization use Codex Sol 6.1 high; implementation/repair uses Luna xhigh; independent review uses Sol 6.1 xhigh. The source and installed schema checks agree. See [model checks](check-graphs.mjs#L104). |

These are prompt/routing controls. The durable cross-run counters, receipt
hashes, and service-cost reservations are worker obligations; no custom billing
gateway or platform enforcement is claimed. The guide states that limit at
[README.md](README.md#L49).

## Actual runtime and stale-state review

The installed Graph Studio runtime starts a dialog conversation for its
run/node/visit and reuses it only when resuming that visit. A later review visit
gets a distinct conversation. The implementation is visible in
[runtime.ts](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/runtime.ts#L329)
and [store.ts](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/store.ts#L239).

Its turn limit asks for a summary, not approval. Required fields are parsed
before a result is recorded. Missing/malformed fields throw; the graphs use the
default `onError: stop` and `maxAttempts: 1`, so a malformed response stops the
graph rather than taking a successful route. See
[runtime.ts](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/runtime.ts#L366),
[field parsing](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/graph.ts#L1968),
and [agent failure behavior](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/runtime.ts#L644).
The coordinator explicitly stops at graph errors.

The runtime preserves prior node outputs by node ID. Planning therefore needs
revision-aware handling of previous feedback, not an assumption that looping
clears old outputs. The current prompts track applied feedback/conflict hashes,
use current approved decisions, and ignore applied/superseded feedback. See
[requirements](build-graphs.py#L64),
[design](build-graphs.py#L81),
[tasks](build-graphs.py#L94), and the
[runtime merge reducer](https://github.com/sajov/bb-plugins/blob/896dd60e2ec3260585fac836a5e6819e7558732c/bb-plugin-graph-studio/lib/runtime.ts#L150).

The reviewer identified a material lost-handoff issue in the first revision:
draft design/task conflicts routed to requirements without their returned
results, and draft blockers were absent from the blocker reporter's prompt.
The setup agent repaired those prompts. The reviewer independently reproduced
both conflict handoffs and all three blocker handoffs with installed
`routeFrom` and `renderPrompt`; all five markers reached their destinations.
The saved definitions and regression checks now include the repair at
[build-graphs.py](build-graphs.py#L73),
[blocker handoff](build-graphs.py#L160),
and [five handoff checks](check-graphs.mjs#L51).

## Reproduction and reviewed fingerprints

From `.`, the pure schema/routing/source comparison
and read-only library checks are:

```sh
node .bb/graphs/kiro/check-graphs.mjs
bb graph-studio show kiro-plan-feature
bb graph-studio show kiro-complete-task-graph
bb graph-studio runs
sha256sum .bb/graphs/kiro/build-graphs.py .bb/graphs/kiro/kiro-plan-feature.graph.json .bb/graphs/kiro/kiro-complete-task-graph.graph.json .bb/graphs/kiro/dispatch-instructions.txt
```

The exact independent preservation check was:

```python
import hashlib, json, pathlib, subprocess
root = pathlib.Path('.bb/graphs/kiro')
baseline = json.loads((root/'existing-setup-baseline.json').read_text())
assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() == h
           for p, h in baseline.items())
live = json.loads(subprocess.check_output(['bb', 'tasks', 'preset', 'list', '--json']))['presets']
byid = {p['id']: p for p in live}
before = json.loads((root/'presets-before.json').read_text())['presets']
assert all(byid[p['id']] == p for p in before)
created = json.loads((root/'preset-created.json').read_text())['preset']
assert byid[created['id']] == created
assert created['instructions'] == (root/'dispatch-instructions.txt').read_text()
organizer = json.loads(subprocess.check_output(
    ['bb', 'plugin', 'rpc', 'call', 'thread-organizer', 'getConfig',
     '--input-file', '/dev/stdin', '--json'], input=b'{}'))
assert organizer == json.loads((root/'organizer-before.json').read_text())
```

| Reviewed file | SHA-256 |
| --- | --- |
| build-graphs.py | `0f23b11e4d2ff6abf66a57625e08658b472ebdd6b72d0109c7a8613feb3e4f3b` |
| kiro-plan-feature.graph.json | `61b71571914e5247db7358f616e0d5a5a9a63608c0b2b9952f2f2215a076372e` |
| kiro-complete-task-graph.graph.json | `9fbbe3b852b24478c86a1154e888328863e2d0a2737da5551c55d174a5164547` |
| dispatch-instructions.txt | `b3fce0bcc5ac28b516dc0d3575ff7a64f3a6b6191b79b44af889a232b0fc02f6` |

An authorized isolated live run is still required to establish worker compliance,
dialog UX, durable receipt/counter behavior across interruptions, actual native
task export/finalization, and application end-to-end acceptance. This boundary is
already stated in [README.md](README.md#L88).
