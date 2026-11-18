# Live verification and semantic review

## Purpose and when to use it

Use this guide when deciding whether a workflow change is complete, reviewing a live document result, or preparing fresh unattended acceptance. Unit and integration tests establish deterministic rules and persistence behavior; only live service execution plus a complete-source review establishes product behavior. The [durable workflow guide](durable-workflows-and-recovery.md) covers retry and restore boundaries; [public interfaces and inspection](public-interfaces-and-inspection.md) covers the inspection surface.

## Inputs, outputs, and invariants

- Inputs include the full original source corpus, source hashes and citation maps, pinned model/provider/route/tier/schema/prompt settings, current lore state, Hatchet run state, and published indexes/articles.
- A review output records reproducible run/configuration identifiers, actual service and model-call evidence, complete-source comparison findings, and a clear pass/fail verdict.
- Before every semantic call, compare the actual SDK source text, hash, and length with the complete stored source. Required complete sources cannot be replaced by snippets or truncated to fit.
- Development semantic review checks meaning across the entire document: missed referents, unsupported proposals, wrong types, aliases, conflated or duplicated identities, assertions, relationships, dates, attribution, evidence, passages, and current-stage output quality.
- Integrated review also checks accepted/rejected/unresolved decisions, canonical identities, citations, indexes, eligibility, article facts, readable prose, and finished-statement support.
- Fresh unattended acceptance starts with a fresh database and one ordered kickoff, makes new model and Jev calls, and permits no intervention or replay of reviewed outputs.
- Compare stable source and lore meaning, not generated IDs, timestamps, workflow IDs, or cost telemetry. Supported paraphrase is acceptable; material semantic differences fail.

## Practical method

1. For each deterministic rule, write the test first, run it, and observe a meaningful failure before implementation. Then implement the rule and rerun it. Cover parsing, source-byte coordinates, validation, domain decisions, transactions, retry-safe writes, and workflow stop/continue behavior.
2. Connect to live PostgreSQL, Hatchet, and the configured OpenRouter endpoint. Preflight configuration and endpoint parameter support before paid calls; inspect actual outbound schemas/settings and check served model/provider/tier after responses. Keep the shared Luna budget accounting outside lore-reset state.
3. Run the same `process-document` behavior used by unattended processing. Capture the Hatchet run, source/config provenance, original response, persisted proposals, validation findings, decisions, and committed lore/publication output.
4. Independently compare the complete source with the live result. Trace every material accepted assertion and published factual statement to source evidence; enumerate missed material and unsupported output instead of checking a sample only.
5. Exercise interruption after durable child wait and after a lore write. Retry unchanged inputs and prove the sequence resumes safely, does not duplicate records, and stops after an exhausted child.
6. When a code/configuration change can affect previously reviewed sources, restore neither an old acceptance result nor hand-edited lore: rebuild development state and replay the ordered sources through the current source, then review cumulative output.
7. For final acceptance, create a fresh database, trigger the ordered corpus once, make fresh calls, wait without intervention, then compare its durable result to the reviewed reference for every required semantic category.
8. Audit required behavior and preservation constraints separately: report missing requirements, unapproved interface removals, semantic changes, provider/dependency substitutions, and any non-reproducible evidence.

## Worked example

Consider this complete fictional source:

```text
Mira keeps the Bell Archive in Frostmere. She says the silver key was lost in 123 DR.
At dusk, the archive bell rang three times.
```

Suppose a candidate result contains the Archive, Frostmere, Mira, and the silver key assertion, but omits the bell-ringing assertion and does not retain that Mira attributed the loss. An independent reviewer should report: (1) omitted assertion or useful passage, traced to `At dusk, the archive bell rang three times.`; (2) attribution loss, traced to `She says`; and (3) the lost-in-123-DR assertion needs evidence spanning its complete statement. Retaining the bell passage does not require admitting a standalone Event; entity admission still follows the locked definitions. The reviewer compares the whole source with stored proposals, validation findings, accepted claims, and any published sentence and returns **needs correction** for these defects. This is a worked example only, not a live run result.

For an actual single-document run, record a compact evidence set:

```text
source: path + SHA-256 + original byte length
configuration: model + route/tier policy + schema/prompt versions
live run: Hatchet run ID + terminal status
model input: supplied source hash/length equals stored complete source
durable result: candidates + validation + decisions + accepted lore + publication
semantic audit: supported findings + omissions checked + verdict
```

If a source passage says that a leader *proposed* an alliance, the reviewer checks that the persisted claim and article preserve proposal status and speaker attribution. A published statement that the alliance occurred is a material failure even if all tasks report success.

## Failure modes and verification

- **Only tests pass:** Run the live workflow with real configured services and inspect actual durable outputs.
- **Only telemetry passes:** A successful Hatchet run does not prove source fidelity, complete extraction, citation correctness, or article support.
- **Sample-only review:** Walk the complete source and account for all required categories, including information omitted from candidates and articles.
- **Truncated semantic input:** Capture SDK request content or an equivalent auditable representation and verify exact text/hash/length at each semantic boundary.
- **Retry changes meaning or duplicates data:** Compare the pinned configuration and source identity; inspect records before/after an interruption and retry.
- **Acceptance reuses development outputs:** Verify fresh database identity, a single kickoff, and new Luna/Jev calls after kickoff.
- **Evidence cannot be reproduced:** Include exact commands/queries, source/config hashes, and run identifiers without relying on fixture statistics or screenshots alone.

Completion requires live evidence against [VER-001 through VER-004](../../specification.md#ver-001-development-review-against-complete-sources) and a preservation audit. Writing these guides does not itself verify or complete the application.

## Application to the specification

This guide applies [SRC-003](../../specification.md#src-003-complete-context-for-semantic-decisions), [OPS-001](../../specification.md#ops-001-one-behavior-in-development-and-unattended-processing), [OPS-002](../../specification.md#ops-002-user-controlled-pinned-ai-configuration), [OPS-003](../../specification.md#ops-003-inspectable-discovery-and-decisions), and [VER-001 through VER-004](../../specification.md#ver-001-development-review-against-complete-sources). It preserves the specification's checkpoint, fresh acceptance, semantic-review, and live-service requirements.
