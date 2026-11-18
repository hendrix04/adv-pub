"""Build standalone Kiro graph definitions; saving them does not start runs."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent


def enum(name, options, description):
    return dict(name=name, type='enum', options=options, description=description)


def agent(id, label, prompt, fields=None, model='gpt-6.1-sol', effort='xhigh', **extra):
    return dict(id=id, label=label, kind='agent', prompt=prompt,
                providerId='codex', model=model, reasoningLevel=effort,
                fields=fields or [], maxAttempts=1, maxVisits=12, **extra)


def edge(source, target, key=None, value=None, op='equals', source_kind='field'):
    result = dict(from_=source, to=target)
    result['from'] = result.pop('from_')
    if key:
        result['when'] = dict(source=source_kind, key=key, op=op, value=value)
        result['label'] = value
    return result


def status():
    return [enum('status', ['READY', 'BLOCKED'], 'READY only when this step is complete; otherwise BLOCKED.')]


PLANNING = '''Follow governing project instructions and existing .kiro conventions.
This flow plans and exports tasks; implementation starts with separate explicit
dispatch. Work in a new feature specification directory. An existing feature
directory needs explicit user authorization and no conflicting active run.
Keep unrelated work and application providers intact. Return BLOCKED for a
missing prerequisite or conflicting active work; explain the next decision.
Use testable business acceptance criteria and reuse existing functionality.
Input includes the idea, project context, constraints, and any approved paths:
{{input}}
'''

grill = agent('grill', 'Idea and questions', PLANNING + '''
Clarify this idea conversationally, one focused question at a time using the
Graph Studio dialog contract. Inspect facts available in the project yourself.
Ask about outcomes, scope and unresolved decisions until requirements can be
written. Keep questions and recommendations short. Put the complete question
and any needed context in the dialog's question field so it appears at the
pause. Use this native dialog rather than opening another asynchronous form.
When ready, summarize all agreed answers and return status READY. At the turn
limit, unresolved material questions mean BLOCKED, not implied agreement.
Finishing this interview is not approval of a specification.
''', status())
grill.update(kind='dialog', maxTurns=30)

drafts = {
    'requirements': ('Requirements', '''Write or revise requirements.md from the agreed idea and answers.
Use testable business outcomes, acceptance criteria, boundaries and relevant
edge cases. Identify unresolved material decisions instead of assuming them.
Incorporate feedback from all review nodes, including later specification
corrections. Update requirements first when downstream scope/design changes.
Invalidate affected downstream approval records; rebuild downstream documents
after renewed requirements approval. Wording-only edits need not add scope.
Read returned draft conflicts even when no downstream review occurred. Track
applied feedback/conflict hashes in the feature revision history. Use current
approved decisions as authority; ignore already applied or superseded feedback.
If remaining feedback conflicts, ask for a decision rather than resurrecting
an older correction. Identify which feedback this new revision incorporates.
Agreed idea: {{grill}}
Requirements feedback: {{requirements_review}}
Design feedback: {{design_review}}
Task feedback: {{tasks_review}}
Returned design conflict: {{design}}
Returned task conflict: {{tasks}}
'''),
    'design': ('Design', '''Verify the requirements approval receipt still matches requirements.md.
Write or revise design.md from those approved requirements. Inspect existing
functionality and design the smallest complete change that satisfies them.
Describe relevant components, contracts, preservation, dependencies and live
validation. Resolve routine implementation details using project conventions.
Apply outstanding feedback against current approved decisions; ignore feedback
already applied or superseded in the feature revision history.
If this needs a requirements correction, return status REOPEN_REQUIREMENTS with
the conflict rather than writing a conflicting design. Otherwise return READY.
Approved requirements: {{requirements}}
Approval: {{requirements_review}}
Design feedback: {{design_review}}
'''),
    'tasks': ('Tasks', '''Verify current requirements and design against their approval receipts.
Write or revise tasks.md as dependency-ordered complete parent units, with
native child breakdowns, acceptance criteria and live validation instructions.
Include relevant approved requirements/design context and preservation rules
for each parent. Keep the breakdown practical; reuse matching tasks at export.
Apply outstanding feedback against current approved decisions; ignore feedback
already applied or superseded in the feature revision history.
If task planning needs a requirements/design decision changed, return
REOPEN_REQUIREMENTS with the conflict. Otherwise return READY.
Approved requirements: {{requirements}}
Approved design: {{design}}
Design approval: {{design_review}}
Task feedback: {{tasks_review}}
''')
}
nodes = [grill]
edges = [edge('__start__', 'grill'), edge('grill', 'requirements', 'grill.status', 'READY'),
         edge('grill', 'blocked')]
for id, (label, prompt) in drafts.items():
    fields = status() if id == 'requirements' else [enum('status', ['READY', 'REOPEN_REQUIREMENTS', 'BLOCKED'], 'Route conflicts through requirements; READY when the draft is reviewable.')]
    nodes.append(agent(id, 'Draft ' + label.lower(), PLANNING + prompt + '''
Return the document path, revision/content hash, concise summary, and any open
decisions. Approval records belong in this feature's approval record, not in
the reusable graph. A draft does not approve itself.
''', fields))
    review_id = id + '_review'
    review = agent(review_id, 'Your ' + label.lower() + ' review', PLANNING + f'''
Present the current {id}.md path, revision/hash, summary, and open decisions.
Ask the user to approve it or provide changes. This is a human decision:
APPROVE requires the user's explicit approval in this visit for the presented
revision. Record the human response and document hash in the feature approval
record only on approval. Check the hash still matches before recording it.
Agent text, interview completion, old approvals and automatic placement are
not approval. At a turn limit without explicit approval return BLOCK.
For feedback, return REVISE for changes within this document's approved scope,
or REQUIREMENTS for substantive corrections to requirements/design decisions.
Return done:true with the chosen action and feedback so the graph routes the
revision; do not quietly edit approved preceding documents in this review.
Keep done:false while the user is still considering the document.
Put the document link and enough review context in the question field.
Current draft: {{{{{id}}}}}
''', [enum('action', ['APPROVE', 'REVISE', 'REQUIREMENTS', 'BLOCK'], 'APPROVE only from explicit human approval for the current revision.'),
      dict(name='feedback', type='string', description='Exact user feedback or approval and the current document path/hash.')])
    review.update(kind='dialog', maxTurns=30)
    nodes.append(review)
    edges.extend([edge(id, review_id, id + '.status', 'READY')])
    if id != 'requirements':
        edges.append(edge(id, 'requirements', id + '.status', 'REOPEN_REQUIREMENTS'))
    edges.append(edge(id, 'blocked'))
    next_node = {'requirements':'design', 'design':'tasks', 'tasks':'export'}[id]
    edges.extend([edge(review_id, next_node, review_id+'.action', 'APPROVE'),
                  edge(review_id, id, review_id+'.action', 'REVISE'),
                  edge(review_id, 'requirements', review_id+'.action', 'REQUIREMENTS'),
                  edge(review_id, 'blocked')])

nodes.append(agent('export', 'Export approved tasks · Ready', PLANNING + '''
Verify all three approval receipts against current specification files.
Export/refresh this approved task list to native BB Tasks using the Tasks skill
and public CLI. Match records using this feature/revision mapping to avoid
duplicate export. Preserve unrelated records and existing task metadata.
Each parent embeds the complete relevant requirements, acceptance criteria,
design decisions, contracts, dependencies, preservation and live-validation
instructions, including the approved revision. Detailed child implementation
prose stays in native child bodies; read every child body during execution.
Record the specification-to-task mapping in the feature directory. Report the
hierarchy and readiness. Export ends the planning flow; dispatch is separate.
Requirements: {{requirements}}
Design: {{design}}
Tasks: {{tasks}}
Task approval: {{tasks_review}}
''', status()))
nodes.append(agent('blocked', 'Needs a decision', '''Report the blocker or exhausted planning limit and the specific next decision.
Preserve files and leave implementation undispatched. Read the current feature
documents and approval record if available. Summarize relevant feedback:
{{grill}}
{{requirements}}
{{design}}
{{tasks}}
{{requirements_review}}
{{design_review}}
{{tasks_review}}
{{export}}
Input: {{input}}
'''))
edges.extend([edge('export', '__end__', 'export.status', 'READY'), edge('export', 'blocked'), edge('blocked', '__end__')])
plan = dict(id='kiro-plan-feature', name='Kiro: plan feature',
            description='Idea, conversational questions, requirements/design/tasks with human review, then native task export. No implementation.',
            example='Start a new Kiro spec for a feature. My idea is: [describe the outcome]. Ask me the questions needed to write requirements.',
            nodes=nodes, edges=edges, maxSteps=120)

BUDGET = '''Use one shared $5 ledger for all live-service calls in this authorized run
including backlog, retries, repairs and review. Before each billable call,
reserve a conservative bounded maximum cost in the ledger. Reconcile actual
cost with evidence; retain reservations when outcome/cost is uncertain.
Unknown/unbounded costs or insufficient remaining budget block the call.
Serialize calls. Agent model-session charges are separate. This is an agent
instruction, not a billing enforcement service.
'''
EXECUTION = '''Follow governing project instructions. This graph completes exactly one
explicitly dispatched native parent and its authorized specification children.
Read the full parent packet and every child body; canceled ancillary tasks stay
canceled. Preserve unrelated and prior accepted work and required application
providers. Leave verified changes uncommitted. Resolve routine implementation
details within the approved design. Changes to approved behavior, scope,
contracts, providers or explicit design decisions require human reopening and
BLOCKED. Graph workers do not move Organizer sections or start other workflows.
Use the preparation completion plan as the boundary for outputs and evidence.
An interesting edge case does not add a completion requirement. When the
contract permits ambiguity, retain it explicitly rather than seeking a
preferred answer. Required acceptance still needs sufficient evidence.
Timebox each unexpected investigation to ten minutes by default, counted
across repairs/reviews in the packet's issue notes. At that point record what
is established and choose an in-scope fix, permitted unresolved outcome, or
concrete blocker. Further diagnosis needs a specific new hypothesis/test,
acceptance benefit and bounded time/cost estimate; record that reason first.
Repeated probes without new evidence or a credible path mean BLOCKED.
Before an unplanned corpus replay, broad refactor or other expensive operation,
identify the criterion advanced, why existing evidence is insufficient and
expected duration/cost. Skip optional work without a clear benefit. Preserve
mandatory checks; if infeasible, report the blocker rather than weakening them.
For large replays, use a small representative pilot to estimate throughput
before the full run when compatible with the required test procedure. Check
progress against that estimate and stop/reassess if assumptions fail.
Progress updates state what finished, what remains, the bottleneck and next
milestone. Investigation limits are agent instructions, not runtime timers;
use cancellable commands with progress where available.
''' + BUDGET + '''
Run input contains the parent key, authorization, approved specification/packet
paths and shared ledger path. Workers have no access to the initiating chat:
{{input}}
'''
prepare = agent('prepare', 'Prepare complete parent', EXECUTION + '''
Read native Tasks and hydrate the full parent and authorized native children
into a packet; identify the approved spec revision and check dependencies.
Add a concise completion plan to that packet: required outputs and acceptance
criteria, mandatory checks with their commands/procedures, existing evidence
and its applicability, optional diagnostics/cleanup, and deferred work. Identify
planned expensive operations and expected duration/cost where estimable. Keep
this plan within the approved specification; do not invent acceptance criteria.
Refuse missing approval/authorization, completed/canceled parent, incomplete
scope or a conflicting active run in this workspace. Reconcile interrupted
work before restarting. Reuse the supplied shared ledger or initialize a new
run ledger with a $5 cap; backlog runs always reuse their supplied ledger.
Record a durable implementation_attempts count for this parent/run. A restart
does not reset attempts or spend. This graph admits at most four implementation
attempts and four independent verification attempts for the parent, including
earlier interrupted work. Return READY with complete packet and ledger paths,
dependency evidence, revision and remaining attempt allowance, or BLOCKED.
''', status(), effort='high')
implement = agent('implement', 'Implement or repair', EXECUTION + '''
Read the preparation packet and current attempt record. Admit and durably
consume one implementation slot before edits; if four slots are already used,
return BLOCKED without further edits. Record interrupted attempts as consumed.
Inspect existing functionality and write a short scope ledger covering required
changes, preservation, explicit removals and deferred work. Implement all
authorized child work, incorporating reviewer findings on repairs.
Follow the packet's completion plan. During repairs run focused regressions
for affected behavior; at completion satisfy all mandatory final checks.
Reuse compatible evidence when source inputs, configuration, relevant code and
the approved criterion still match; record its provenance and why it remains
valid. Rerun what the change invalidates. Fresh model calls need changed inputs
or missing/invalid required evidence, not a desire for a different answer.
Produce bounded implementation/evidence; independent review decides acceptance.
Add meaningful unit/regression tests and run required checks plus real live
end-to-end acceptance within budget. Record commands, results, costs, changed
files, acceptance coverage and unresolved issues. Hand evidence to the separate
reviewer. Return READY for review or BLOCKED with the missing prerequisite.
Preparation: {{prepare}}
Previous independent findings: {{review}}
''', status(), model='gpt-6-luna')
implement['maxVisits'] = 4
review = agent('review', 'Independent validation', EXECUTION + '''
Keep application code unchanged. Admit and consume one durable independent
verification slot before reviewing; four is the limit across resumes/restarts.
Assess the entire parent and children against approved requirements/design,
acceptance and preservation. Inspect developer evidence and reproduce meaningful
checks, including the live checks needed for confidence. Reuse adequate live
evidence; extend testing when evidence is missing, questionable or insufficient.
Use the packet's completion plan and current issue notes. Tie each requested
check or finding to an approved acceptance/preservation condition. Explain why
existing evidence is insufficient and what a rerun establishes. Compatible
evidence can remain valid; optional polishing is deferred, not a FAIL condition.
Apply the same investigation and expensive-operation rules to review work.
Unit tests establish logic/regression coverage; business acceptance requires
real live evidence. Return PASS only when all required acceptance and preservation
conditions hold, FAIL with actionable implementation findings, or BLOCKED for
a prerequisite, budget or specification conflict. Cite concrete evidence.
Preparation: {{prepare}}
Developer handoff: {{implement}}
''', [enum('verdict', ['PASS', 'FAIL', 'BLOCKED'], 'Independent acceptance verdict.'),
      dict(name='findings', type='string', description='Evidence, actionable failures or blocking prerequisite.')])
review['maxVisits'] = 4
finalize = agent('finalize', 'Finalize result', EXECUTION + '''
Reconcile the packet, cost/attempt ledger and latest independent verdict.
Mark the authorized parent and completed native children done only after
independent PASS for the current complete scope/revision. If marking records
was interrupted, reconcile existing status/comments before repeating it.
Otherwise leave accurate unfinished statuses and comment with the blocker
or exhausted repairs. A graph reaching this node is not itself acceptance.
Preserve canceled/ancillary records. Attach concise evidence to the parent.
Return status PASS only after accepted task finalization; otherwise BLOCKED or
FAIL. Return parent key, evidence paths and total live cost for the coordinator.
Preparation: {{prepare}}
Latest implementation: {{implement}}
Independent verdict: {{review}}
''', [enum('status', ['PASS', 'FAIL', 'BLOCKED'], 'Final native parent result; unfinished work stays unfinished.')], effort='high')
finalize['maxVisits'] = 1
execute = dict(id='kiro-complete-task-graph', name='Kiro: complete task (Graph)',
               description='One dispatched parent and all native children: prepare, implement, independent live validation, up to three repairs, finalize.',
               example='Complete explicitly dispatched parent [TASK KEY] using its approved specification and shared $5 live-service ledger; leave changes uncommitted.',
               nodes=[prepare, implement, review, finalize], maxSteps=14,
               edges=[edge('__start__','prepare'),
                      edge('prepare','implement','prepare.status','READY'), edge('prepare','finalize'),
                      edge('implement','review','implement.status','READY'), edge('implement','finalize'),
                      edge('review','finalize','review.verdict','PASS'),
                      edge('review','finalize','review.verdict','BLOCKED'),
                      edge('review','implement','review.verdict','FAIL'),
                      edge('review','finalize'), edge('finalize','__end__')])

for graph in [plan, execute]:
    assert all(len(node['prompt']) <= 8000 for node in graph['nodes'])
    text = json.dumps(dict(version=1, graph=graph), indent=2)
    # Keep small field/condition objects readable on one line.
    text = re.sub(r'\{\n[^{}]*?\n[ ]*\}', lambda m: json.dumps(json.loads(m[0])), text)
    (ROOT/(graph['id']+'.graph.json')).write_text(text+'\n')

(ROOT/'dispatch-instructions.txt').write_text('''Launch the explicitly dispatched parent with Graph Studio graph
kiro-complete-task-graph. You are Codex GPT-6.1 Sol high; the graph delegates
implementation/repair to Luna xhigh and independent review to Sol xhigh.

Read the full native parent and child bodies, approvals, and dependencies.
Check this workspace has no conflicting active run; reconcile interrupted work.
Prepare a run input with the parent key, authorization, approved specification
paths, complete packet path and shared $5 live-service ledger path. Start the
graph with that complete input, then follow its run status to a terminal result.
Show the returned graph-run directive once. Do not treat tool launch or graph
completion as acceptance: require the final status PASS and native parent done.
Graph Studio owns sequencing and repair routing. Preparation defines the
completion/evidence plan, Luna implements, independent Sol review assesses
acceptance, and finalization updates Tasks. Do not add a supervising agent or
another investigation/review loop. Your role is launch, status reporting and
sequencing an explicitly selected backlog.

Single dispatch authorizes one parent. An explicitly selected backlog uses a
fixed dependency-ordered list: start a fresh graph per parent sequentially,
reuse the same live-cost ledger, continue only after PASS, and stop at the
first FAIL/BLOCKED or graph error. Preserve all evidence and attempt/spend
counts when resuming. Never relaunch a task merely to reset repair limits.

Leave verified changes uncommitted and report evidence or the blocker. Use
only Graph Studio and native Tasks for this path; the existing Organizer,
Kiro plugin/preset and kiro-execute workflow remain separate.
''')
print('Built two additive graphs and separate dispatch instructions.')
