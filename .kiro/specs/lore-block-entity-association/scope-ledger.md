# Lore blocks and entity association: scope ledger

Planning date: October 4, 2026. Status: requirements, design, and tasks only.

## Authority

The user authorized completing all three planning phases without intermediate input and subsequently instructed: **Ignore the clone check.** That instruction removes clone calls and clone-agreement gates throughout this feature. This planning request does not authorize executing implementation tasks or paid acceptance runs.

For this feature, resolve conflicts in this order:

1. [Jev question catalog](../../../Resources/Jev%20question%20catalog.md): exact questions, criteria, types, inputs, and stage order.
2. [Splitting lore into blocks](../../../Resources/lore-to-blocks.md) and [Giving blocks to names](../../../Resources/blocks-to-entity.md): structural and association behavior where compatible with the catalog.
3. [Jev decision request guide](../../../Resources/Jev%20decision%20request%20guide.md): request construction, validation, calibration, and live review where compatible with the above.
4. [Earlier specification](../../../Resources/specification.md): remaining compatible project constraints. Its claim of sole authority does not override the user's current precedence instruction.

The existing locked ontology remains unchanged. References in the new documents identify source sections; explanatory examples and corpus measurements are not additional acceptance requirements.

## Required planning changes

Create this ledger and [requirements](requirements.md), [design](design.md), and [tasks](tasks.md) in one Kiro feature directory. Document conflicting behavior, required changes to current code, requirement-to-task coverage, and live completion criteria. Keep implementation checkboxes open.

## Required implementation scope represented by the plan

- Process the nine complete lore documents, one document at a time, using compatible source-local artifacts.
- Produce Markdown blocks, labelled sections, map-key entries, and Q01–Q04 structural decisions without candidate-name inputs.
- Use source-backed discovery and acronym clues, Q05 aliases, Q06 qualification, and Q07 type decisions before entity association.
- Match names and aliases to original source locations; evaluate Q08–Q11 independently per entity and retain Q12 meanings and optional Q13 notes.
- Assemble whole-block context with no arbitrary context cap; preserve examples, copied material, tables, quotes, and source uncertainty.
- Extend existing document operations, retention, inspection, and Hatchet decision children rather than create a second pipeline.
- Retain repeat, structure-agreement, semantic-review, and independent operational evidence; calibrate actions against reviewed sources.

## Preserved behavior and interfaces

| Preserved | Evidence / implementation boundary |
| --- | --- |
| Seven entity types and capture rules | [ENT-001](../../../Resources/specification.md#ent-001-locked-entity-definitions); [ontology reference](../../../Resources/Lore/ontology.md) |
| Full original UTF-8 source and exact outbound equality | [source checks](../../../src/domains/document/discovery/source.ts#L10); retain zero-based half-open byte spans |
| Name-only discovery output | [v31 schema](../../../src/domains/document/discovery/v31/schema.json); keep original candidate strings and raw responses |
| Discovery model and retries | [provider](../../../src/domains/document/discovery/provider.ts#L6); default Sol, high reasoning, existing Flex/Flex/standard policy, shared spending accounting |
| Existing CLI entry points and historical evidence | [scripts](../../../package.json); `ready`, `discover`, `discover:sol-once`, `inspect`, `classify`, `inspect:classification`, `verify:classification`, and retry verification remain available |
| Jev route and retry ownership | [provider](../../../src/domains/document/decisions/provider.ts#L10), [child workflow](../../../src/workflows/jev-decision-batch.ts#L9); pinned Jev/TypeSafe, no provider fallback, two retries, 30-second backoff, SDK retries disabled |
| Shared maximum of four Jev requests | [child workflow](../../../src/workflows/jev-decision-batch.ts#L15); one running deployment owns the limit |
| All-member-pair alias support | [grouping](../../../src/domains/document/aliases/groups.ts#L3); retain distinct and unresolved pairs |
| Durable interruption handling | [child collection](../../../src/workflows/process-document.ts#L96); propagate `AbortError` without a false failed domain result |
| Raw wire retention, validated reuse, and read-only auditing | [batch operation](../../../src/domains/document/decisions/operation.ts#L32), [independent audit](../../../src/dev/retained-decision-audit.ts#L9) |

These are preservation constraints, not assertions that the present code already implements this feature. Existing archive formats remain readable; new execution uses new versioned contracts. No shim translates old model answers into catalog answers.

## Conflicts and smallest reconciliations

| Conflict | Governing evidence | Required reconciliation |
| --- | --- | --- |
| Q04 is yes/no in the block proposal and omits `both` in the guide | [catalog Q04](../../../Resources/Jev%20question%20catalog.md#q04--link-placement), [structure proposal](../../../Resources/lore-to-blocks.md#jevs-structure-questions) | Use Choice with `before`, `after`, `both`, `neither`, `unclear`; support overlapping link components without merging two neighboring blocks. |
| Copied material and its introduction are excluded by context code | [catalog Q13](../../../Resources/Jev%20question%20catalog.md#q13--copied-text-note), [old exclusions](../../../Resources/blocks-to-entity.md#what-gets-nothing) | Keep every passage available; Q13 annotates provenance only. Remove no original source text. |
| Example mentions give no context in the proposal | [catalog Q08](../../../Resources/Jev%20question%20catalog.md#q08--block-link), [Q12](../../../Resources/Jev%20question%20catalog.md#q12--example-or-assertion) | Q08 can associate an example mention; Q12 preserves its meaning without asserting that its action happened. |
| Tables do not give per-name context in the proposal | [catalog association inputs](../../../Resources/Jev%20question%20catalog.md#d-blocks-to-entity--q08q13) | Record row/cell/header mentions; evaluate table/entity pairs through Q08, retain whole tables on supported links and section/document expansion. Mere cell matching is not acceptance. |
| Block proposal bypasses qualification for map places | [map places](../../../Resources/blocks-to-entity.md#sections), [catalog Q06–Q07](../../../Resources/Jev%20question%20catalog.md#c-verify-entities--q06q07) | Preserve one place proposal per entry; route missing source-backed names through discovery and every place through Q06/Q07. Synthetic map labels are display identifiers, not invented proper names. |
| Guide suggests matching before aliases and offers combined type/qualification | [catalog order](../../../Resources/Jev%20question%20catalog.md#the-question-order), [guide order](../../../Resources/Jev%20decision%20request%20guide.md#3-ask-the-questions-in-this-order) | Association mention records belong after Q06/Q07. Q05/Q06 use full source and source-backed candidate evidence without requiring block-link records. |
| Current questions use `same_referent` and combine type with `not_an_entity` | [alias input](../../../src/domains/document/aliases/semantic-input.ts#L33), [current choices](../../../src/domains/document/decisions/contracts.ts#L8) | New runs use exact catalog Q05 labels and separate Q06 then seven-choice Q07; historical results stay readable and cannot be reused as new decisions. |
| Current decision schemas and audit assume Choice only | [contracts](../../../src/domains/document/decisions/contracts.ts#L21), [audit](../../../src/dev/retained-decision-audit.ts#L33) | Extend the shared contract and independent audit for Noul, template-specific options, and action metadata. |
| Candidate loader rejects documents other than 01 | [loader](../../../src/domains/document/decisions/semantic-input.ts#L11) | Validate the supplied retained manifest against the nine-document allowlist instead of the single hardcoded path. |
| Sample parsers and mention matching use character offsets | [block sample](../../../Resources/lore-to-blocks.md#the-code), [mention sample](../../../Resources/blocks-to-entity.md#the-code), [guide byte rule](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design) | Use parser offsets internally; persist verified original UTF-8 byte ranges, including source gaps as explicit components where needed. |
| Block checks use no hand labels; guide asks for source-reviewed expected answers | [block checks](../../../Resources/blocks-to-entity.md#checking-it-without-labels), [guide review](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design) | No hand-maintained runtime label input or patched product answer. Independent development review derives expected answers from the full source as diagnostics; structure/repeat checks remain and do not prove correctness. |
| Block documents require a clone opinion | User instruction in this chat: **Ignore the clone check** | Omit clone requests, configuration, dependencies, and agreement gates. Repeatability uses Jev itself and is recorded separately from source correctness. |
| Probability 0.5 and existing alias 0.90 defaults are uncalibrated | [proposal choices](../../../Resources/blocks-to-entity.md#choices-for-you), [guide answer handling](../../../Resources/Jev%20decision%20request%20guide.md#5-read-answers-and-choose-what-to-do) | Preserve them as named exploratory policies; distinguish provisional layouts from supported entity/link actions. Calibrate per-template production actions through live source review. |

## Explicit removals

No files, commands, historical artifacts, canonical records, or original source passages are removed by this planning change. The future catalog path supersedes conflicting question wording, combined qualification/type execution, and exclusion/example filters listed above. That retirement applies to new execution semantics, not deletion of historical evidence or readers.

## Deferred and out of scope

Q14–Q20, claims and relationships, date normalization, cross-document identity, canon writes and permanent canonical IDs, Drizzle migrations, retrieval indexes, articles, wiki, deployment, direct Discord ingestion, map image interpretation, and changes to ontology are deferred. Source-local IDs used in Q08 do not imply canonical acceptance.

## Evidence-dependent implementation risks

- **Thresholds:** numerical final thresholds require live evidence; their selection procedure and failure behavior are specified in the design. The plan needs no user-supplied labels or arbitrary new thresholds.
- **Parser dependencies:** the block document explicitly specifies mdast with GFM/frontmatter extensions; [current dependencies](../../../package.json#L26) do not include them. Their addition is scoped to block parsing, with package compatibility checked before implementation.
- **Sample counts:** 116 blocks, 516 names, and other proposal counts come from readings used in those documents. Recompute against pinned actual inputs; do not trim candidates, alter source, or exclude copied/example material to reproduce obsolete counts.

## Planning completion checks

- Requirements cover Q01–Q13 and retention, review, error, reuse, boundary, and preservation cases.
- Design assigns each requirement to existing or narrowly added components and defines exact input/output and uncertainty behavior.
- Tasks identify affected files, dependencies, checks, and live evidence; every requirement is covered.
- Original named documents, ontology, lore, package files, and application source remain unchanged.
- Documentation validation is reported separately from future live feature verification.

## Planning audit result

Documentation audit: PASS. The audit checked 18 requirement sections, 23 open implementation tasks, complete requirement coverage, backward-only task dependencies, 91 local file/anchor/line links, and closed code fences. Every document is below 400 lines. SHA-256 comparison against the pre-write snapshot found no changes in 165 existing source, lore, ontology, package, instruction, and governing-document files. No application tests or live feature calls were run for this planning task.

Reproduce requirement/task counts and tracked-file preservation from the repository root:

```bash
python3 - <<'PY'
from pathlib import Path
import re
p = Path('.kiro/specs/lore-block-entity-association')
print('requirements:', len(re.findall(r'^## R\d+ ', (p / 'requirements.md').read_text(), re.M)))
print('tasks:', len(re.findall(r'^- \[ \] \d+\.\d+ ', (p / 'tasks.md').read_text(), re.M)))
PY
git diff --exit-code -- AGENTS.md README.md package.json package-lock.json Resources src
git status --short
```

The planning handoff consists only of the four Markdown files in this feature directory. Remaining checkboxes represent future implementation and its mandatory live evidence.
