# Durable workflows and recovery

## Purpose and when to use it

Use this guide when defining the Hatchet workflow boundary, handling a worker interruption, retrying a document, or restoring a development checkpoint. The reusable `process-document` workflow owns one document's work. The `run-documents-sequentially` durable task owns only ordered child kickoff and waiting. Keep domain behavior in the [document, entity, and article ports](public-interfaces-and-inspection.md).

For Hatchet setup and operations, follow the project [Hatchet CLI guide](../skills/hatchet-cli/HATCHET.md) and its linked reference. This guide describes the product boundary, not CLI procedures.

## Inputs, outputs, and invariants

- A document input identifies its source, order, and pinned run configuration. Its inspectable result reports success or a diagnosable failure and durable lore/publication outcome.
- A sequence input contains an ordered list of those document inputs. Its result identifies the completed prefix and the failing document, if any.
- The sequence starts one child and waits for that result before starting the next. A child failure stops the sequence.
- Documents and dependent stages execute sequentially. Discovery retains one active request; authorized source-local Jev decisions fan out through Hatchet with a shared limit of four active requests and durable result collection.
- The durable sequence performs no database or provider I/O. It makes deterministic choices from its input and awaited child results.
- Document processing remains safe under at-least-once execution: source-local records and publication do not duplicate, and completion is reported only after the required writes commit.
- Hatchet's durable event log records Hatchet execution checkpoints. A lore PostgreSQL restore does not rewind Hatchet state.
- The pinned attempt policy has one retry owner: Hatchet. For Luna, attempts use Flex, Flex, then standard, with two retries delayed at least 30 seconds; a shared handler selects the tier from Hatchet's retry count. Do not add an SDK or application retry loop.

Hatchet durable tasks checkpoint waits and child spawns; replay can resume from those checkpoints. The task body must be deterministic between checkpoints, with external side effects placed in child tasks. See the official [durable tasks](https://docs.hatchet.run/v1/durable-tasks), [child spawning](https://docs.hatchet.run/v1/child-spawning), [idempotency](https://docs.hatchet.run/v1/idempotency), and [retry policy](https://docs.hatchet.run/v1/retry-policies) documentation.

## Practical method

1. Keep `process-document` as the single implementation of document behavior; direct development and sequential execution call the same registration.
2. Implement the sequence as a small loop over its input: spawn one child, await the result, record the returned outcome, and stop on failure. Do not move source loading, database work, model calls, or publication into this controller.
3. Give the child stable source/configuration identity and make its database writes idempotent. Hatchet's task idempotency can suppress duplicate triggers, but it does not replace lore-level uniqueness or safe writes.
4. On interruption, inspect the Hatchet run and lore state independently. Retry only with unchanged source and pinned configuration; use durable checkpoints for Hatchet progress and the lore persistence contract for duplicate prevention.
5. To redo later development work, stop affected workflows, restore the lore checkpoint at a valid completed-document boundary, then start a new run. Capture diagnostics before replacing a failed database when needed. The restore does not rewind Hatchet history.
6. If a change can affect an earlier source, rebuild the development lore database and replay the ordered source set through the current source. Final unattended acceptance always starts fresh and makes new model calls.

## Worked example

This control-flow sketch is illustrative pseudocode, not a Hatchet SDK signature. It makes the ownership boundary explicit:

```text
async durable runDocuments(inputs):
    results = []
    for input in inputs.inOrder:
        result = await spawnAndWait(processDocument, input)
        results.append(result)
        if result.status != "succeeded":
            return { status: "stopped", results }
    return { status: "succeeded", results }
```

For inputs A, B, C, if B fails, the result contains A's success and B's failure; C is never started. Retrying B with the same source hash and pinned configuration must not create duplicate candidates, accepted claims, or publication. A deliberate new model iteration is a new controlled run after the appropriate checkpoint or fresh-build boundary.

## Failure modes and verification

- **Sequence embeds processing:** If the controller reads lore tables or calls OpenRouter, move that work to the document child/domain ports.
- **Retry multiplication:** Inspect Hatchet retry settings, SDK client retry defaults, and shared call handling together. Confirm exactly one owner schedules the Flex/Flex/standard attempts.
- **False success:** Force a failure after a durable write and confirm the child does not report success until required lore and publication writes commit.
- **Duplicate state:** Interrupt after a write, retry unchanged input, and inspect source-local uniqueness, candidates, decisions, claims, and article versions.
- **Restore confusion:** Verify affected runs are stopped before restoring lore; start a new run and inspect its Hatchet identity. Never describe a database restore as rewinding Hatchet.
- **Premature continuation:** Fail one child and confirm the next ordered input is not started.

Deterministic tests establish control-flow and idempotency rules. Completion also needs live Hatchet and PostgreSQL evidence under [live verification and semantic review](live-verification-and-semantic-review.md).

## Application to the specification

This guide applies [OPS-001](../../specification.md#ops-001-one-behavior-in-development-and-unattended-processing), [OPS-002](../../specification.md#ops-002-user-controlled-pinned-ai-configuration), [TECH-003](../../specification.md#tech-003-workflow-decisions-and-publication), and [TECH-005](../../specification.md#tech-005-development-sequence-and-acceptance-handoff). Retry classification and stage limits remain open under [D-004](../../specification.md#open-questions-for-development); source-local persistence details are in [D-005](../../specification.md#d-005-source-discovery-and-evidence-contract); transaction and completion boundaries remain under [D-008](../../specification.md#open-questions-for-development).
