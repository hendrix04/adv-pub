# Public interfaces and inspection

## Purpose and when to use it

Use this guide when shaping the three domain ports, connecting the CLI to workflows, or checking a run and its lore evidence. The document, entity, and article domains own product behavior; the CLI is a thin trigger and inspection surface. The [durable workflow guide](durable-workflows-and-recovery.md) defines sequencing and recovery. Hatchet command operations belong in the project [Hatchet CLI guide](../skills/hatchet-cli/HATCHET.md).

## Inputs, outputs, and invariants

The proposed public ports are:

- **Document:** capture complete sources and citation mapping; discover proposals; retain validation findings; record admission and source-support outcomes.
- **Entity:** resolve canonical identity; retain accepted claims, relationships, and passages; reconcile accumulated knowledge; serve indexes and profile data.
- **Article:** calculate eligibility and section quality; compose supported articles, infoboxes, citations, and links; check finished prose before publication.

Each `index.ts` exports its domain's public operations and types. Workflows, CLI, and wiki call those exports rather than private files or duplicated logic. Workflow registrations are `process-document` and `run-documents-sequentially`; their exact payload contracts remain a design task.

### Retained Publican command contract

Keep every retained command leaf and its positional/option order:

| Command | Positional arguments | Options |
| --- | --- | --- |
| `publican entity list` | — | `--name TEXT`, `--type TYPE`, `--subtype SUBTYPE`, `--limit N`, `--cursor TOKEN` |
| `publican entity show` | `ENTITY_ID` | `--section NAME`, `--limit N`, `--cursor TOKEN` |
| `publican relationship list` | — | `--entity ENTITY_ID`, `--between ENTITY_ID ENTITY_ID`, `--type PREDICATE`, `--limit N`, `--cursor TOKEN` |
| `publican relationship show` | `RELATIONSHIP_ID` | `--section NAME`, `--limit N`, `--cursor TOKEN` |
| `publican document list` | — | `--name TEXT`, `--limit N`, `--cursor TOKEN` |
| `publican document show` | `DOCUMENT_ID` | `--section NAME`, `--reference KEY`, `--text-view original\|normalized`, `--start N`, `--length N`, `--cursor TOKEN` |
| `publican document submit` | `FILE` | — |
| `publican capabilities` | — | — |
| `publican test reset` | — | — |
| `publican test document` | `FILE` | — |
| `publican test extraction` | `LORE_DOCUMENT` | — |

List/show operations are remote inspection; the three `test` leaves are local-only commands. Preserve their names and positional/flag vocabulary. Their implementation must obey the checkpoint, fresh-run, and live-verification requirements; a reset command is not permission to reset both databases or an acceptance fixture. Pagination uses the existing `--limit` and `--cursor` vocabulary. `capabilities` reports actual server capabilities rather than claiming unsupported behavior.

`--section NAME` selects a named section; `--reference KEY` selects an evidence reference. The public vocabulary does not yet define how those values combine, whether they can repeat, or what error is returned for an unknown value. For `document show`, `--start N` and `--length N` bound the requested original or normalized text view, but the unit and windowing semantics remain open. These display windows are separate from citation coordinates, which are zero-based half-open UTF-8 byte ranges into original source bytes.

## Practical method

1. Define each port around product operations already owned by its domain. Reuse a domain operation when another caller needs the same behavior.
2. Make CLI parsing produce typed workflow inputs or domain query inputs; return the Hatchet run identifier promptly for long submissions.
3. Make `document show` distinguish original and normalized source views and let the caller request a bounded text window. Preserve source references and attributable knowledge in inspection output.
4. Keep entity and relationship views paginated and evidence-bearing. A shortlist score or unverified proposal is not canonical lore.
5. Make run inspection connect Hatchet status to document result and durable lore/publication state, reporting partial or failed state explicitly.
6. Keep serialized inputs/results and exact domain signatures in one shared contract after they are resolved; document unresolved shapes under D-009 rather than guessing. Preserve the small workflow handoff: source identity/path, order, and pinned configuration go in; a run identifier returns for later inspection. Do not move full document contents or domain decision logic into the CLI.

## Worked example

Suppose the complete local file `lore.md` contains:

```text
Mira keeps the Bell Archive in Frostmere. She says the silver key was lost in 123 DR.
At dusk, the archive bell rang three times.
```

The command and expected handoff are:

```sh
publican document submit lore.md
# expected: accepted submission and a run identifier (exact response payload is D-009)
```

After that run finishes, use the returned document identifier and cursor to inspect source and continue a list:

```sh
publican document show DOCUMENT_ID --text-view original --start 0 --length 120
publican entity list --name Bell --limit 1
# next page, only if the first response includes a cursor:
publican entity list --name Bell --limit 1 --cursor CURSOR_FROM_PREVIOUS_PAGE
```

The source view should show the requested original text window, and the list response should include at most one item plus a continuation cursor when more results exist. The document identifier mapping, response envelope, cursor encoding, and the unit/behavior of text-window flags are unresolved under [D-009](../../specification.md#open-questions-for-development); this sketch does not establish a concrete payload contract. Entity and relationship inspection must include evidence references, not only names or edge labels.

## Failure modes and verification

- **Private-module coupling:** Search callers for imports beneath another domain's implementation directory; replace them with its public port.
- **Duplicated semantics:** Compare CLI/wiki behavior with domain operations. Filtering or formatting may live at the boundary, but identity, acceptance, reconciliation, and article rules stay in their owning domain.
- **Lost command compatibility:** Compare parser help and invocation tests against every leaf and argument in the table above, including `--between`'s two IDs and original/normalized text selection.
- **Misleading inspection:** Check that proposals, validation findings, decisions, evidence, source views, and publication state remain distinguishable.
- **False capability report:** Query the actual server and verify each advertised operation is available.
- **Unsafe local test behavior:** Verify reset and fixture-style checks cannot be mistaken for live completion or silently erase Hatchet state with lore data.

Test parser compatibility and domain contracts deterministically, then verify submissions and inspections against live services. The complete-source semantic audit is defined in [live verification and semantic review](live-verification-and-semantic-review.md).

## Application to the specification

This guide applies [OPS-003](../../specification.md#ops-003-inspectable-discovery-and-decisions), [TECH-002](../../specification.md#tech-002-one-package-and-three-domain-ports), [TECH-003](../../specification.md#tech-003-workflow-decisions-and-publication), and the unresolved interface contracts in [D-009](../../specification.md#open-questions-for-development). The public command inventory is the retained-publican-command-contract for this specification. Original source citations remain byte-based even while display-window units are unresolved under D-009/D-005.
