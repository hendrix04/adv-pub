# Kiro in Graph Studio

Two additive Graph Studio library entries and one separate dispatch preset.
The existing Kiro plugin, Organizer configuration, preset and execution workflow
remain unchanged. Saving/importing graphs and creating a preset starts no work.

## Start a new specification

Create a thread in the intended project and send:

> Start the Graph Studio flow **Kiro: plan feature** for a new spec called
> **[feature name]**. My idea is **[short description]**. Include the relevant
> context from this thread and start the questions.

The initiating agent supplies the complete idea, project context, boundaries,
and file paths as the run input. Graph workers cannot see the initiating chat.
Alternatively, open Graph Studio, select **Kiro: plan feature**, enter that
context in its input, and run it.

The first node is a native Graph Studio dialog: it asks one focused question
at a time and pauses for the answer. Answer in Graph Studio or through the
starting chat's Graph Studio pause message. It uses native dialog questions,
not a second asynchronous grilling form.

Requirements, design and tasks each get a draft and a conversational human
review. Reply with approval or feedback. Approval applies to the presented
document revision; it is recorded with its content hash. A turn limit or an
agent finishing its message does not approve anything. Substantive downstream
specification changes return to requirements, then rebuild affected documents
for renewed review. Within-scope document edits can return to the same draft.

After task approval, the final node exports or refreshes native parents and
subtasks and reports readiness. This ends planning; it does not dispatch code.

## Dispatch approved work

When ready, open the native parent in Tasks and select the separate preset
**Kiro Graph: complete task**. Selecting a preset starts work immediately.
The original **Kiro: complete task** remains available for the existing path.

The new Sol high launcher starts **Kiro: complete task (Graph)** with the
parent key, explicit authorization, complete packet/specification paths and
shared live-cost ledger. Graph preparation validates scope and dependencies;
Luna xhigh implements/repairs; a separate Sol xhigh agent independently validates;
Sol high finalizes task statuses and evidence after PASS. Agents use Codex.
One implementation plus three repairs is the limit. Verified changes remain
uncommitted. Specification conflicts require explicit human reopening.

Graph Studio owns routing; there is no separate supervisor agent. Preparation
adds a concise completion plan to the task packet: outputs, approved acceptance
criteria, mandatory checks, reusable evidence, optional diagnostics and deferred
work. Workers and reviewers follow it without adding completion requirements.

Unexpected investigations have a ten-minute default budget per issue, tracked
across repairs and review. Then choose an in-scope fix, permitted unresolved
outcome or concrete blocker. Further diagnosis needs a specific new hypothesis,
acceptance benefit and bounded time/cost estimate recorded before continuing.
Repeated probes without new evidence or a credible path become blockers.

Unplanned expensive work needs an acceptance purpose, an explanation of missing
evidence and a duration/cost estimate. Optional work without benefit is skipped;
infeasible mandatory checks block completion. Large replays use a representative
pilot where compatible with the required procedure. Repairs run focused checks;
completion satisfies mandatory final checks, reusing evidence whose relevant
inputs, configuration, code and criterion remain compatible. Fresh model calls
serve changed inputs or missing/invalid required evidence.

Updates report completed work, remaining work, the bottleneck and next milestone.
These are worker instructions, not an enforced timer or an active-node watchdog.

For a backlog, explicitly give the launcher a fixed parent list in dependency
order. It starts one fresh parent graph at a time and shares one $5 live-service
ledger across all parents, retries, repairs and review. It continues after PASS
and stops at the first failure or blocker. Model-session costs are separate.
An interrupted attempt remains consumed; restarting does not reset spend or
repair allowances. Cost reservation is an agent instruction, not a billing gateway.

Graph Studio runs in the initiating environment. Complete work only in a
workspace without another conflicting active run. This setup has not started
any run; avoid testing execution alongside your current work in that workspace.

## Source and checks

The graph library stores the installed definitions independently of chat
threads. These JSON exports are portable source copies in this checkout:

- `kiro-plan-feature.graph.json`
- `kiro-complete-task-graph.graph.json`
- `dispatch-instructions.txt`

Prompts are embedded in graph definitions, with no reference to the old plugin
or originating thread storage. To use them on another host, import the two JSON
files there and create the separate preset from `dispatch-instructions.txt`.
Import uses absolute paths on this installation, for example:

```sh
bb graph-studio import /absolute/path/kiro-plan-feature.graph.json
bb graph-studio import /absolute/path/kiro-complete-task-graph.graph.json
```

`build-graphs.py` regenerates the source JSON without saving or running it.
Changes to existing saved graphs require an explicit overwrite operation.

```sh
node .bb/graphs/kiro/check-graphs.mjs
bb graph-studio show kiro-plan-feature
bb graph-studio show kiro-complete-task-graph
```

The checks exercise the installed Graph Studio schema, routing, visit limits,
dialog parsing and selected models without spawning workers. Setup review
does not establish live conversational or application acceptance; that requires
a later isolated run when authorized and no conflicting work is active.
