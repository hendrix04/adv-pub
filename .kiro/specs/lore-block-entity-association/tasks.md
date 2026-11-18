# Implementation tasks: lore blocks and entity association

Status: planning complete. Tasks 3.1–3.5 are accepted after independent AP-27 PASS; all other checkbox states are unchanged. See [acceptance evidence](../../execution/AP-27/independent-review-wfr-2d24e365/review.md).

Read [requirements](requirements.md), [design](design.md), and [scope/preservation ledger](scope-ledger.md) together. The catalog has priority over older documents. The user removed clone checks. Each numbered implementation task is intended as roughly 2–4 hours of focused work; live review duration depends on service responses and findings. Split a task further if implementation exceeds that scope.

Dependencies below are task IDs. Checkboxes mean the task's stated evidence is complete, not merely that code was written. Capability live reviews do not authorize the next implementation phase; use the task selection authorized for implementation. This document itself authorizes no execution or paid calls.

## 1. Shared source and decision contracts

- [ ] 1.1 Add the exact catalog templates and target contracts
  - Files: new `src/domains/document/decisions/catalog.ts`; extend `decisions/contracts.ts` and `decisions/semantic-input.ts`.
  - Define Q01–Q13, exact question text/criteria/guidance, acronym Q05 variant, required single-target fields, and deterministic batch path substitution. Keep historical schema variants readable.
  - Add a focused contract check against the Markdown catalog so wording/option drift fails. Confirm `both`/`neither` in Q04; `yes/no/unclear` Q06; seven-only Q07; all Q12/Q13 options.
  - Done: exact templates and required inputs pass; no implementation changes the catalog or ontology; no Q14–Q20 execution scaffolding.
  - Depends on: none. _Requirements: R01, R04, R08, R09, R13, R14._

- [ ] 1.2 Generalize retained source loading and byte evidence
  - Files: `decisions/semantic-input.ts`, `discovery/source.ts` or adjacent source-evidence utility, `dev/discovery-source-policy.ts`, `document/index.ts`.
  - Replace the document-01-only candidate-loader guard with the nine-source allowlist and manifest checks; keep a source-only load operation that needs no candidate file for structure.
  - Add shared parser-offset/regex-offset conversion to verified original byte spans; preserve UTF-8, CRLF, BOM, smart quotes, and non-BMP characters. Keep source capture and outbound equality checks.
  - Done: valid retained inputs for all nine documents load; altered manifests/source and invalid boundaries fail; original candidate IDs/strings and discovery output are preserved.
  - Depends on: 1.1. _Requirements: R01, R02, R04, R07, R10, R16._

- [ ] 1.3 Extend response validation and saved actions for Noul and catalog Choices
  - Files: `decisions/contracts.ts`, `decisions/validation.ts`, `decisions/operation.ts`, relevant existing decision tests.
  - Validate each question against its own declared template and exact answer ID set. Add Noul without confidence; retain Choice map/confidence and explicit finite-value, option, sum, and route checks.
  - Save raw answer separately from provisional/supported/rejected/unresolved action and policy provenance. Fail the entire invalid batch without applying partial answers.
  - Done: mixed Noul/Choice and historical fixtures pass; missing/extra IDs, wrong kinds, invalid numbers, wrong options/routes, and malformed envelopes fail with retained evidence.
  - Depends on: 1.1, 1.2. _Requirements: R09, R14, R16, R17._

- [ ] 1.4 Extend shared batching, stage references, and replay lineage
  - Files: `decisions/batching.ts`, `decisions/provider.ts`, `decisions/operation.ts`, `workflows/jev-decision-batch.ts`; update all owned callers together.
  - Add one versioned stage reference to the shared child input, extend manifests with template/policy/upstream hashes, and keep saved historical readers. Do not add a translation shim or second client.
  - Keep full-source checks at dispatch, conservative batch shrinking, raw wire retention, two Hatchet retries, 30-second delay, and one shared four-request queue. Distinguish explicit fresh repeats from retries and compatible reuse.
  - Done: changed lineage invalidates downstream reuse; unchanged answers revalidate and produce no-network receipts; a single oversized target fails without truncation; interrupted waits preserve `AbortError` control flow.
  - Depends on: 1.3. _Requirements: R01, R02, R14, R15, R16, R17._

- [ ] 1.5 Implement action policies and fresh-repeat reporting before capability execution
  - Files: focused policy module under `decisions/` if needed; shared manifests/action handling; independent dev audit/reporting.
  - Implement exploratory versus supported policies, per-template thresholds, exact ties/unclear paths, evidence hashes, and source-review diagnostic reports. Select numerical thresholds during each capability's live review using 01–06, then freeze them before 07–09 evaluation for that question family.
  - Implement explicit fresh Jev repeats with identical state/questions and separate receipts from retry/reuse. Record structure agreement separately from accuracy. No clone calls, settings, or blockers.
  - Done: policy state is wired before a capability can claim supported actions; changed policy invalidates downstream results; test cases verify ties, unresolved answers, repeat disagreements, and provisional-versus-supported output without manually patched model answers.
  - Depends on: 1.4. _Requirements: R05, R08, R09, R11, R12, R14, R16, R17._

## 2. Lore-to-blocks capability

- [ ] 2.1 Implement the specified Markdown reader with original-source components
  - Files: new `src/domains/document/blocks/read.ts` and source/layout types beside it; `package.json` and lockfile for the five specified parser extensions/utilities.
  - Verify and pin compatible mdast/GFM/frontmatter packages. Parse top-level elements, nested whole lists, table cells/rows, quotes, tag peeling, headings, comments, images, breaks, and metadata.
  - Use shared byte conversion and preserve original source components; expose AST table evidence to later association rather than write another table parser.
  - Done: focused source examples verify no paragraph/list/table/quote fragmentation, Unicode offsets, escaped table pipes, and tag paragraphs; no candidate input is required.
  - Depends on: 1.2. _Requirements: R02, R03, R04, R10._

- [ ] 2.2 Plan Q01–Q04 with correct targets and repeat checks
  - Files: new `blocks/operation.ts`; extend `decisions/semantic-input.ts` and catalog target construction.
  - Select the proposal's short emphasized titles, paragraph/list adjacency, numbered-map suspects, and standalone links. Resolve Q01-derived boundaries before supplying dependent section limits for Q02–Q04.
  - Include missing neighbors/map notes as `null`, written map context, full source, and deterministic target IDs. Obtain explicit Jev repeats for actions; clone checks are absent.
  - Done: every actual suspect has one planned primary question and a separately tracked repeat; no unsupported title or list candidate is silently skipped; zero-suspect documents have valid empty stages without calls.
  - Depends on: 1.5, 2.1. _Requirements: R04, R05, R14, R16, R17._

- [ ] 2.3 Build labelled sections, joins, Q04 placements, and map keys
  - Files: new `blocks/build.ts`; extend `blocks/operation.ts`.
  - Assemble original-order whole blocks, consecutive labels, unlabelled/empty sections, comments/images, quote attributions, and supported introductions. Preserve source gaps as components.
  - Support Q04 `before/after/both/neither/unclear`, missing-neighbor findings, section-local fallback, and duplicate link components without paragraph merging.
  - Split supported map keys into whole numbered entries; preserve introductions separately, unattached/ambiguous image references, and one place proposal per entry with source name versus display-label distinction.
  - Done: focused cases cover all Q04 choices, start/end/label-only sections, ordinary nested lists, map entry numbers, and safe image attachment without repeated text decisions.
  - Depends on: 2.2. _Requirements: R03, R05, R06, R16._

- [ ] 2.4 Wire structure into the shared workflow and inspection command
  - Files: `document/index.ts`, `workflows/process-document.ts`; new focused structure launcher/inspector under `src/dev/`; `package.json`.
  - Add the structure capability with source-only input, saved stage output, `blocks`/`inspect:blocks`, explicit source and new/resume arguments, and one-deployment ordered corpus mode.
  - Render items, sections, exact block components, map proposals, primary/repeat decisions, provisional fallbacks, and findings. Use existing atomic artifact and runtime lifecycle patterns.
  - Done: inspectors use no model calls; resume inputs are checked; discovery and existing classification commands still work; capability success is distinct from full-product success.
  - Depends on: 2.3. _Requirements: R01, R04, R06, R15, R16, R18._

- [ ] 2.5 Verify structure live on the nine complete sources
  - Files: focused `verify:blocks` command and retained development evidence; fix owning modules only when findings warrant it.
  - Run the real shared Hatchet/OpenRouter/Jev path in order: tune Q01–Q04 action policies on 01–06, freeze them, then evaluate 07–09. Retain full questions, actual repeats, coverage gaps, and every source/layout/fallback. Rebuild affected tuning outputs under the final policy before the final corpus verdict.
  - Check title lines in doc 04, doc 02's list introduction, doc 03's map numbering/notes, doc 01's bare URL, and actual parsed edge cases. Recompute counts without forcing 116 blocks or a fixed section total.
  - Done: exact commands, raw requests/responses, source-byte audit, coverage/findings, and semantic verdict are saved; unresolved fallbacks are visible; unit success alone does not check this box.
  - Depends on: 2.4. _Requirements: R02–R06, R15–R18._

## 3. Catalog aliases and qualified local entities

- [x] 3.1 Extend acronym discovery clues and use exact Q05
  - Files: `aliases/semantic-input.ts`, `aliases/operation.ts`, `aliases/groups.ts`, `aliases/aliases.test.ts`; source discovery findings as needed.
  - Scan full source for undotted/dotted capitalized acronym forms; retain original spelling, expansion clues, both initials rules, every matching source-backed expansion, and unresolved acronyms.
  - Retain all-unordered-pairs coverage. Select one catalog wording per pair, with full-name/acronym direction correct, catalog labels, exact guidance, and all-pair grouping.
  - Done: UCR, U.C.R., all-word/function-word initials, several possible expansions, missing names, conflicting uses, and transitive-only groups have inspectable outcomes; no initials-only accepted link or manual Sol-output insertion.
  - Depends on: 1.5, 2.5. _Requirements: R01, R07, R08, R14, R16._

- [x] 3.2 Split qualification and type into saved Q06/Q07 stages
  - Files: `classification/operation.ts`, `decisions/semantic-input.ts`, `workflows/process-document.ts`; relevant focused contract tests.
  - Q06 receives candidate names/groups plus full approved definitions. Save its `yes/no/unclear` and action before preparing seven-only Q07 for supported yes candidates in later requests.
  - Emit reproducible source-local entity IDs, supported names/aliases, type/evidence, and both decision references. Preserve mixed-group findings and rejected/unresolved candidates.
  - Done: no Q07 executes for ordinary no/unresolved Q06; alias agreement is not qualification; no article/importance filter or canonical write; historical combined results remain readable but cannot qualify new runs.
  - Depends on: 3.1. _Requirements: R01, R08, R09, R14, R16._

- [x] 3.3 Integrate map place proposals and discovery correction findings
  - Files: `blocks/operation.ts`, `classification/operation.ts`, existing discovery inspection/provenance code; map proposal evidence under the same operation lineage.
  - Present entry bold names, later supported subjects, and section/number fallback labels separately. Route missing source-backed names through a new compatible discovery iteration and invalidate dependent stages.
  - Let Q06/Q07 evaluate unnamed place descriptors with their exact entry evidence; retain unclear/nonqualifying entries without automatic Location acceptance.
  - Done: all six Winterhaven entries have proposals and traceable outcomes even without a map or Sol name; a generated label is never treated as a verbatim source name or canonical proper name.
  - Depends on: 2.3, 3.2. _Requirements: R02, R06, R07, R09, R16._

- [x] 3.4 Extend entity inspection and independent retained-answer auditing
  - Files: `dev/inspect-classification.ts`, `dev/verify-classification.ts`, `dev/retained-decision-audit.ts`; `README.md` only for changed/new command behavior.
  - Show Q05 pair evidence, acronym clues, Q06 routes, Q07 results, local entity lineage, and unresolved map/candidate outcomes. Preserve positional paths, `--verify-retry`, `--require-reuse`, and archived readers.
  - Audit wire Noul/Choice fields and catalog criteria without importing product validation/grouping to manufacture agreement.
  - Done: both old and catalog artifacts inspect read-only; raw-data audit catches missing/extra/mutated decisions and invalid reuse; commands documented with stage-specific status.
  - Depends on: 3.3. _Requirements: R01, R06–R09, R14, R16, R18._

- [x] 3.5 Verify Q05–Q07 live before supported association
  - Files: retained qualification/alias evidence and independent source-review reports; fix owning modules where findings warrant it.
  - Tune Q05–Q07 action policies on 01–06 using complete-source reviewed outcomes. Freeze policies before evaluating 07–09; retain undecidable cases and any unsupported group/type as findings, not patched answers.
  - Present every local entity, rejected/unresolved candidate, acronym pair, and map-place outcome with exact commands and producing artifacts. Regenerate affected earlier outputs under the frozen policy.
  - Done: actual live wire evidence and semantic review support the saved local-entity inputs that association will consume; historical combined results do not stand in for Q06/Q07 evidence.
  - Depends on: 3.4. _Requirements: R02, R06–R09, R14, R16–R18._

## 4. Blocks-to-entity capability

- [ ] 4.1 Implement source mention matching and faithful table/quote evidence
  - Files: new `association/mentions.ts`; reuse source byte utility and `blocks/read.ts` table/quote evidence.
  - Match supported names/aliases longest-first with case-insensitive Unicode word boundaries and deterministic ties. Deduplicate textual overlaps while preserving every ambiguous entity interpretation.
  - Save exact surfaces, byte spans, original member lineage, block/label IDs, table cell/header/whole-row context, and quote speakers.
  - Done: overlapping aliases, same names for different entities, dotted acronyms, case variations, labels, escaped pipes, and speaker mentions resolve to faithful source records; matches alone create no accepted links.
  - Depends on: 2.1, 3.5. _Requirements: R02, R10, R16._

- [ ] 4.2 Plan and execute Q08/Q11 with broad pair coverage
  - Files: new `association/operation.ts`; shared catalog semantic input and batch operation.
  - Plan Q08 for every qualified local entity/block pair, with complete blocks, section labels and nearby text; plan Q11 once per entity. Include tables, copied passages, examples, and pronoun-only blocks.
  - Retain independent per-entity Noul probabilities/actions and multi-subject links; reuse compatible answers instead of duplicate calls.
  - Done: actual target ledger proves Cartesian pair coverage with no literal-hit filter; one block/document can link to multiple entities; no unsupported context is attached solely by a mention match.
  - Depends on: 4.1. _Requirements: R10, R11, R13, R14, R16._

- [ ] 4.3 Build entity-specific continuations and section links
  - Files: `association/operation.ts`, new `association/context.ts`.
  - After Q08, ask Q09 with known entities and adjacent blocks. Retain entity-specific continuation chains bounded by input sections, stopping at negative/unresolved answers.
  - Ask Q10 for each labelled section/entity and proposed found section/entity; preserve multiple overlapping subjects, whole-section evidence, repeats, and marked-structure diagnostics.
  - Done: Luskan-style pronoun continuations receive inspectable found sections; another entity's chain cannot leak into them; failed grouping leaves supported direct links intact and no found section crosses a labelled boundary.
  - Depends on: 4.2. _Requirements: R11, R12, R14, R16, R17._

- [ ] 4.4 Retain Q12 example/assertion meanings and optional Q13 origin notes
  - Files: `association/operation.ts`, shared catalog contracts, association inspection output.
  - Evaluate Q12 per entity occurrence/passage and supported pronoun-only passage with complete speaker/qualification framing. Save exact `example/assertion/both/unclear` meanings.
  - Enable Q13 by default as one entity-free origin note per block; pin its optional switch. Retain all Q13 choices without source removal or filtering entity/link decisions.
  - Done: Caine's example keeps supported context without asserting the action happened; Marvel material remains available regardless of origin; mixed uses, rumor, denial, and the wiki note retain their meaning.
  - Depends on: 4.3. _Requirements: R01, R11, R13, R14, R16._

- [ ] 4.5 Assemble whole-context unions and expose association inspection
  - Files: `association/context.ts`, `association/operation.ts`, `document/index.ts`; focused launcher/inspector under `dev/`; `package.json`.
  - Union supported direct, section, found-section, and document links in original order, preserving whole blocks, source metadata, all decision provenance, and deduplicated shared components without caps.
  - Add `associate`/`inspect:association` with explicit compatible upstream paths, new/resume mode, and one-deployment ordered corpus mode through `process-document`.
  - Done: contexts retain tables/examples/copied text and multi-subject routes; duplicate shared URLs are not double-counted; empty/rejected/unresolved outputs are inspectable; inspection is read-only and the full pipeline is not marked complete.
  - Depends on: 4.4. _Requirements: R01, R06, R10–R13, R15, R16, R18._

## 5. Calibration and live operational verification

- [ ] 5.1 Verify real retries, concurrency, interruption, and compatible resume
  - Files: existing retry-probe/audit modules; focused independent `verify:association` command; saved live evidence.
  - Use one running Hatchet deployment for overlapping independent batches. Audit actual start/end events for at most four active Jev requests and required retry delays. Keep explicitly synthetic pre-network probes distinguishable from actual successful service calls.
  - Run a controlled interruption/resume and unchanged-input resubmission; inspect raw artifacts and no-network reuse receipts. Verify changed source/question/policy/upstream lineage is rejected and no invalid batch actions survive.
  - Done: independent wire/event audit reports concurrency, failures, retry timing, resume/reuse, and route/source integrity with exact commands; it does not rely on workflow success alone.
  - Depends on: 4.5. _Requirements: R01, R02, R14, R15, R16, R18._

- [ ] 5.2 Complete ordered live association review for 01–09
  - Files: retained machine results and separate independent review reports; fix owning components when evidence identifies defects.
  - Use compatible Q05–Q07 producing artifacts, complete original sources, and saved stage lineage. Tune Q08–Q13 policies on 01–06, freeze them before 07–09 evaluation, and regenerate affected earlier outputs under that final policy. Retain fresh repeat checks and report coverage limits.
  - Review missed names/entities, wrong aliases/types, same-name interpretations, pronouns, tables, multi-subject links, found sections, map-place proposals, example/assertion meanings, copied-text retention, and unresolved cases.
  - Done: each document has exact inspect/reproduce commands, counts, source-cited findings, and source-review verdict. No corpus totals are forced to historical proposal measurements; unsupported actions fail review even if stable/confident.
  - Depends on: 2.5, 3.5, 5.1. _Requirements: R02, R06–R13, R16–R18._

## 6. Preservation and feature handoff

- [ ] 6.1 Audit preservation and report the bounded feature verdict
  - Files: feature review evidence, scoped command documentation; all changes audited against `scope-ledger.md`.
  - Run the existing relevant deterministic tests, `npm run typecheck`, and `npm run build`, then independently inspect required coverage and preservation against both source documents and actual live artifacts.
  - Verify original sources/ontology, old command behavior and readers, discovery output/model policy, retry/spending rules, shared queue, deferred Q14–Q20/canon/wiki boundaries, and absence of clone requirements.
  - Done: report PASS only for the implemented source-local capability with mandatory live/semantic evidence; report FAIL for violations and BLOCKED for missing external evidence. List unresolved decisions and explicit reproduction commands without claiming complete product delivery.
  - Depends on: 5.2. _Requirements: R01, R02, R07, R09, R14–R18._

## Traceability

| Requirement | Implementing and verifying tasks |
| --- | --- |
| R01 | 1.1, 1.2, 1.4, 2.4, 3.1, 3.2, 3.4, 4.4, 4.5, 5.1, 6.1 |
| R02 | 1.2, 1.4, 2.1, 2.5, 3.3, 3.5, 4.1, 5.1, 5.2, 6.1 |
| R03 | 2.1, 2.3, 2.5 |
| R04 | 1.1, 1.2, 2.1, 2.2, 2.4, 2.5 |
| R05 | 1.5, 2.2, 2.3, 2.5 |
| R06 | 2.3, 2.4, 2.5, 3.3, 3.4, 3.5, 4.5, 5.2 |
| R07 | 1.2, 3.1, 3.3, 3.4, 3.5, 5.2, 6.1 |
| R08 | 1.1, 1.5, 3.1, 3.2, 3.4, 3.5, 5.2 |
| R09 | 1.1, 1.3, 1.5, 3.2, 3.3, 3.4, 3.5, 5.2, 6.1 |
| R10 | 1.2, 2.1, 4.1, 4.2, 4.5, 5.2 |
| R11 | 1.5, 4.2, 4.3, 4.4, 4.5, 5.2 |
| R12 | 1.5, 4.3, 4.5, 5.2 |
| R13 | 1.1, 4.2, 4.4, 4.5, 5.2 |
| R14 | 1.1, 1.3, 1.4, 1.5, 2.2, 3.1, 3.2, 3.4, 3.5, 4.2, 4.3, 4.4, 5.1, 6.1 |
| R15 | 1.4, 2.4, 2.5, 4.5, 5.1, 6.1 |
| R16 | 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 6.1 |
| R17 | 1.3, 1.4, 1.5, 2.2, 2.5, 3.5, 4.3, 5.2, 6.1 |
| R18 | 2.4, 2.5, 3.4, 3.5, 4.5, 5.1, 5.2, 6.1 |

Policy handling comes before capability execution; numerical calibration occurs during each capability's live review, with final settings frozen before that question family's final evaluation and dependent supported execution. Each capability remains separately inspectable. Live reviews and the final preservation audit are mandatory completion evidence; their presence in this plan is not a claim that they have run.
