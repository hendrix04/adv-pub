# Requirements: lore blocks and entity association

Status: planning complete; implementation and live verification remain unstarted.

## Authority and outcome

Use the [scope ledger](scope-ledger.md#authority) for source precedence and preservation constraints. The [question catalog](../../../Resources/Jev%20question%20catalog.md) controls exact question text, criteria, types, and sequence. The user's later instruction removes the clone check. This feature ends with inspectable source-local entities and their context; it does not create canonical entities, claims, or articles.

**Operator story:** As the lore-pipeline operator, I want each complete source split into faithful blocks and associated with supported entities, so I can inspect what text each entity receives before later knowledge work.

**Developer story:** As a pipeline developer, I want every decision, action, and source location retained, so I can reproduce failures, compare meaning with the source, and resume compatible work safely.

**Reviewer story:** As an independent reviewer, I want the full source and raw model artifacts, so I can identify omissions, mistaken associations, and unauthorized semantic changes.

## R01 — Governing contracts and preservation

Source: [catalog order](../../../Resources/Jev%20question%20catalog.md#the-question-order), [ledger conflicts](scope-ledger.md#conflicts-and-smallest-reconciliations).

1. WHEN this feature processes a document THEN the system SHALL apply the catalog's Q01–Q13 contracts and resolve conflicts in the ledger's authority order.
2. WHEN a new execution contract supersedes an older contract THEN the system SHALL retain historical artifacts and read-only inspection without converting historical answers into new catalog answers.
3. WHEN implementing this feature THEN the system SHALL preserve the seven locked entity definitions, existing commands, source bytes, discovery output, retry ownership, and concurrency constraints.
4. IF an implementation requires unrelated behavior, ontology changes, or canonical persistence THEN the system SHALL leave that work outside this feature.

## R02 — Source integrity and evidence ranges

Source: [guide source checks](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design), [existing source boundary](../../../src/domains/document/discovery/source.ts#L10).

1. WHEN a source is captured THEN the system SHALL retain its original bytes, source identity, byte length, and SHA-256 and reject invalid UTF-8 or failed byte round trips.
2. WHEN any semantic request is dispatched THEN the system SHALL send the unchanged complete document in `state.complete_source` and verify actual outbound text, hash, and length against the retained source.
3. WHEN blocks, labels, notes, links, entries, or mentions are saved THEN the system SHALL retain zero-based, start-inclusive, end-exclusive original UTF-8 byte ranges that reconstruct their exact source text.
4. IF complete required context cannot fit even one question THEN the system SHALL fail that stage with retained diagnostics rather than truncate, summarize, or replace the source.

## R03 — Deterministic Markdown reading

Source: [block elements](../../../Resources/lore-to-blocks.md#blocks), [non-block elements](../../../Resources/lore-to-blocks.md#what-isnt-a-block).

1. WHEN reading Markdown THEN the system SHALL recognize top-level paragraphs, whole nested lists, GFM tables, blockquotes, headings, standalone links/images, HTML notes, thematic breaks, front matter, and code blocks.
2. WHEN adjacent lines form one Markdown paragraph or items form one list THEN the system SHALL preserve that element whole regardless of length, except for a supported map-key split.
3. WHEN tag lines are folded into a paragraph THEN the system SHALL separate their original spans as labels while retaining the remaining paragraph unchanged.
4. WHEN front matter or code is encountered THEN the system SHALL retain its source record without treating it as a lore block; WHEN an HTML comment or image is encountered THEN the system SHALL retain it with its section.
5. WHEN a separate attribution follows a quote THEN the system SHALL join it to that quote's block with source positions and speaker framing preserved.

## R04 — Structural question selection and application

Source: [Q01–Q04](../../../Resources/Jev%20question%20catalog.md#a-make-blocks--q01q04), [candidate selection](../../../Resources/lore-to-blocks.md#jevs-structure-questions).

1. WHEN a one-line paragraph of at most 12 words is wholly emphasized THEN the system SHALL ask Q01 with the line, following text, and section limits; supported yes makes a label.
2. WHEN a paragraph directly precedes a list THEN the system SHALL ask Q02 with both elements and section limits; supported yes joins the introduction to that list's block.
3. WHEN a numbered list does not count from 1 consecutively or shares its section with a picture or note THEN the system SHALL ask Q03 with the list, nearby text, and written map notes or `null`.
4. WHEN a standalone URL needs placement THEN the system SHALL ask Q04 with both neighboring blocks, explicit `null` for a missing neighbor, and section limits, using all five catalog choices.
5. WHEN building blocks THEN the system SHALL use source structure and Q01–Q04 alone without discovered names, aliases, classifications, or entity decisions.

## R05 — Sections, links, and structural uncertainty

Source: [block sections](../../../Resources/lore-to-blocks.md#what-isnt-a-block), [Q04](../../../Resources/Jev%20question%20catalog.md#q04--link-placement), [fallbacks](../../../Resources/lore-to-blocks.md#jevs-structure-questions).

1. WHEN labels occur consecutively THEN the system SHALL combine their label components into one labelled section; WHEN text precedes a label THEN it SHALL retain an unlabelled section; WHEN a thematic break occurs THEN it SHALL end the section.
2. WHEN Q04 supports `before`, `after`, or `both` THEN the system SHALL attach the exact link component to the indicated existing neighbor or neighbors without merging those neighbors into one block.
3. WHEN Q04 supports `neither` THEN the system SHALL retain the standalone link as section context with its source range; WHEN a requested neighbor is missing THEN it SHALL preserve an unresolved placement finding without fabricating a neighbor.
4. IF Q01–Q03 are unresolved or fail repeatability THEN the system SHALL retain the plain structure: title candidate as text, introduction separate, and ordinary list whole.
5. IF Q04 is unresolved or fails repeatability THEN the system SHALL retain its raw decision and use the proposal's provisional next-block placement only within the same section; if no next block exists, it SHALL retain the link as section context.
6. WHEN a label, note, image, or pending link has no lore block THEN the system SHALL still retain its section and source components rather than discard them.

## R06 — Map keys and missing place proposals

Source: [map structure](../../../Resources/lore-to-blocks.md#map-keys), [map places](../../../Resources/blocks-to-entity.md#sections), [guide qualification boundary](../../../Resources/Jev%20decision%20request%20guide.md#make-blocks).

1. WHEN Q03 supports a map key THEN the system SHALL retain one whole block per entry, the original written number, and its map-key/section relationship.
2. WHEN an entry has no available map image THEN the system SHALL retain it unattached; WHEN its section later supplies one unambiguous image THEN it SHALL associate by number without rerunning text decisions.
3. WHEN an entry describes a possible place THEN the system SHALL retain a place proposal even if discovery found no matching name, with its whole entry as context.
4. WHEN naming a place proposal THEN the system SHALL prefer its source bold name, then a supported subject name, then a section-and-number display label; it SHALL distinguish generated display labels from source names.
5. IF a source-backed name is missing from discovery THEN the system SHALL route it through discovery and qualification; IF an entry is unnamed THEN Q06/Q07 SHALL judge its source-backed descriptor and entry evidence without inventing a proper name or accepting a Location automatically.

## R07 — Discovery and acronym coverage

Source: [catalog code scan](../../../Resources/Jev%20question%20catalog.md#b-associate-aliases--q05), [Sol discovery](../../../Resources/Jev%20decision%20request%20guide.md#find-names-with-sol).

1. WHEN discovering candidates THEN the system SHALL use the existing full-source Sol discovery contract, preserving names as written and keeping aliases and acronyms as separate proposals across all seven types.
2. WHEN scanning for acronym clues THEN the system SHALL preserve words with at least two capital letters and no lowercase letters, including dotted forms, and keep their original spelling and byte locations.
3. WHEN checking a possible expansion THEN the system SHALL retain written expansion clues and initials matches using all words and then omitting exactly `a, an, the, of, and, in, for, to`, preserving every matching source-backed full name and which rule matched.
4. IF no full name matches THEN the system SHALL retain the acronym as unresolved; IF discovery missed a name THEN it SHALL retain a discovery finding and require corrected compatible discovery before qualification, without manually inserting a reviewer-selected name into Sol output.

## R08 — Document-local alias decisions

Source: [Q05](../../../Resources/Jev%20question%20catalog.md#q05--alias-identity), [guide grouping](../../../Resources/Jev%20decision%20request%20guide.md#group-aliases).

1. WHEN checking aliases THEN the system SHALL ask general Q05 for ordinary source-backed pairs and acronym Q05 instead for acronym/expansion pairs, using exact catalog criteria and retaining clues and source evidence.
2. WHEN a group is formed THEN the system SHALL require supported `same_entity` evidence for every pair of its members; initials, string overlap, and transitive chains alone SHALL NOT establish identity.
3. IF a name or pair has conflicting uses, insufficient evidence, or an unclear action THEN the system SHALL retain the pair and keep uncertain names separate.
4. WHEN checking aliases THEN the system SHALL use the full source and source-backed candidate records without requiring association mention/block records or entity classification first.

## R09 — Qualification followed by type

Source: [Q06–Q07](../../../Resources/Jev%20question%20catalog.md#c-verify-entities--q06q07).

1. WHEN a candidate or supported alias group is ready THEN the system SHALL ask Q06 with every supported name and the full approved definitions in `state.entity_rules`.
2. WHEN Q06 supports `yes` under the pinned action policy THEN the system SHALL ask Q07 in a later request using exactly the seven entity types with their full definitions as criteria.
3. IF Q06 supports `no` or remains unresolved THEN the system SHALL retain the candidate and outcome and SHALL NOT treat it as a qualified entity or run ordinary Q07 association inputs for it.
4. WHEN qualification and typing succeed THEN the system SHALL retain a stable source-local entity ID, supported names, aliases, type, evidence, and both decision references; it SHALL distinguish this local record from a canonical identity.
5. WHEN considering a candidate THEN the system SHALL require specificity and ontology fit without imposing importance, description length, or article eligibility.

## R10 — Mention ownership and faithful context

Source: [catalog association inputs](../../../Resources/Jev%20question%20catalog.md#d-blocks-to-entity--q08q13), [mention sample](../../../Resources/blocks-to-entity.md#the-code).

1. WHEN association starts THEN the system SHALL find accepted local entities' names and aliases case-insensitively with Unicode-aware word boundaries, longer strings first, deterministic ties, and no duplicate overlapping textual match.
2. WHEN one surface can identify several local entities THEN the system SHALL retain every candidate entity interpretation of that mention until Q08/source review settles the link; string matching alone SHALL NOT choose an identity.
3. WHEN retaining a mention THEN the system SHALL save its exact surface, byte range, entity interpretation, block/label/table position, and supporting candidate lineage.
4. WHEN retaining a table mention THEN the system SHALL retain the whole row, column header, cell position, and table span; WHEN retaining a quote mention THEN it SHALL retain the quote and speaker together.
5. WHEN preparing association checks THEN the system SHALL make every block/entity pair available, including pairs with only a clear pronoun or no literal name hit, without a literal-hit filter that could lose pronoun subjects.

## R11 — Block, section, and document links

Source: [Q08–Q11](../../../Resources/Jev%20question%20catalog.md#q08--block-link), [whole-context rules](../../../Resources/blocks-to-entity.md#who-gets-which-blocks).

1. WHEN evaluating a possible entity/block pair THEN the system SHALL ask Q08 once with the entity, exact whole block, section label, and nearby blocks; supported yes associates that block.
2. WHEN evaluating a section or document subject THEN the system SHALL ask Q10 or Q11 independently per entity; supported yes gives that entity every block in the section or document, including tables and copied/example material.
3. WHEN several entities are discussed THEN the system SHALL permit all supported entities to receive the same block, section, or document instead of selecting one winner.
4. WHEN an entity receives context from several routes THEN the system SHALL union its blocks in source order, retain every route's provenance, and deduplicate identical source components without cutting any block smaller.
5. WHEN assembling context THEN the system SHALL impose no arbitrary number-of-blocks or token cap; size failure affects dispatch rather than silently reducing retained context.

## R12 — Found sections and continued subjects

Source: [found sections](../../../Resources/blocks-to-entity.md#sections), [Q09](../../../Resources/Jev%20question%20catalog.md#q09--continued-subject).

1. WHEN a block has a supported subject THEN the system SHALL ask entity-specific Q09 for the following block using both whole blocks and the same labelled-section limits.
2. WHEN Q09 supports continued discussion THEN the system SHALL extend that entity's found section through consecutive supported continuations; it SHALL stop at a negative/unresolved answer or a section boundary.
3. WHEN different entities have different continuation answers THEN the system SHALL retain separate runs without propagating one entity's answer to another.
4. IF a subject or continuation grouping fails applicable structure agreement or repeatability THEN the system SHALL drop only that proposed expansion and retain already supported direct block links and all source material.

## R13 — Example meanings and copied text notes

Source: [Q12](../../../Resources/Jev%20question%20catalog.md#q12--example-or-assertion), [Q13](../../../Resources/Jev%20question%20catalog.md#q13--copied-text-note).

1. WHEN an entity mention is assessed THEN the system SHALL ask Q12 with its exact passage and nearby text, retaining `example`, `assertion`, `both`, or `unclear` with speaker, doubts, denial, and time when supplied.
2. WHEN Q12 returns any answer THEN the system SHALL keep the passage and supported association; an example-only action SHALL NOT be recorded as an event that occurred.
3. WHEN source-origin notes are enabled THEN the system SHALL ask Q13 once per block without an entity input and retain all five catalog outcomes as annotations only.
4. WHEN Q13 identifies copied material or its introduction THEN the system SHALL retain that text for entity and later claim checks without exclusion or a campaign-adoption gate.
5. WHEN source notes are absent or origin is unclear THEN the system SHALL keep the block; the wiki-source note remains ordinary source material.

## R14 — Shared requests and typed answers

Source: [catalog batching](../../../Resources/Jev%20question%20catalog.md#several-questions-in-one-request), [guide validation](../../../Resources/Jev%20decision%20request%20guide.md#5-read-answers-and-choose-what-to-do).

1. WHEN constructing a single-target question THEN the system SHALL use the catalog's exact instructions, guidance where specified, criteria, and listed `state.target` inputs; WHEN batching THEN it SHALL substitute only target field paths with unambiguous full `state.targets` paths.
2. WHEN several questions share a request THEN the system SHALL include only questions whose inputs are already known and valid; dependent answers SHALL feed later saved stages and later requests.
3. WHEN validating an answer THEN the system SHALL check served model/provider, exact expected IDs, declared type, allowed options, finite number ranges, and Choice probability totals within documented wire-rounding tolerance.
4. WHEN saving a Noul THEN the system SHALL retain its yes probability without inventing a confidence field; WHEN saving a Choice THEN it SHALL retain its choice, full probability map, and confidence without treating confidence as independent corroboration.
5. IF any answer or envelope is invalid THEN the system SHALL retain the full response and findings, fail the batch, and apply no decisions from that invalid batch.

## R15 — Batching, retries, and failure boundaries

Source: [guide full-source limits](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design), [existing child workflow](../../../src/workflows/jev-decision-batch.ts#L9).

1. WHEN scheduling semantic work THEN the system SHALL retain sequential documents and dependent stages with at most four active Jev requests in the same deployment.
2. WHEN a batch exceeds the checked route limit THEN the system SHALL shrink only the number of independent questions while preserving each complete source and required target context.
3. WHEN a retryable provider/transport failure occurs THEN Hatchet SHALL own the existing retry schedule; IF a format or semantic defect occurs THEN the system SHALL retain the defect without treating it as permission to change provider, model, source, or tier.
4. WHEN a durable task is evicted or resumed through `AbortError` THEN the system SHALL propagate that interruption and avoid publishing a false domain failure.
5. IF a required stage fails THEN the system SHALL retain partial evidence and stop the sequence before the next document, distinguishing stage status from completion of the full product pipeline.

## R16 — Retention, provenance, and compatible reuse

Source: [guide reuse](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design), [batch retention](../../../src/domains/document/decisions/operation.ts#L32).

1. WHEN a call is attempted THEN the system SHALL retain its exact outbound request and raw response or failure before decoding/validation, without retaining credentials.
2. WHEN saving a decision THEN the system SHALL retain the raw answer separately from the applied action, policy version, question/template version, full target, source/candidate/rule hashes, requested/served route, and upstream decision lineage.
3. WHEN unchanged work is resumed THEN the system SHALL revalidate saved raw responses and source/configuration lineage and reuse compatible answers without new semantic calls, retaining a no-network reuse receipt.
4. IF source, candidates, target, rules, catalog template, policy, model configuration, or dependency results changed THEN the system SHALL invalidate affected downstream execution and create distinguishable new artifacts while preserving prior evidence.
5. WHEN inspection or verification is requested THEN the system SHALL read saved artifacts without model requests and present rejected, unresolved, failed, provisional, and supported outcomes.

## R17 — Decision policies and validation evidence

Source: [proposal checks](../../../Resources/lore-to-blocks.md#jevs-structure-questions), [context checks](../../../Resources/blocks-to-entity.md#checking-it-without-labels), [guide review](../../../Resources/Jev%20decision%20request%20guide.md#6-keep-the-full-source-and-check-the-design).

1. WHEN calibrating THEN the system SHALL pin per-template action rules using full-source reviewed examples and separate tuning documents from final evaluation documents; 0.5 and existing 0.90 defaults SHALL NOT be reported as proven universal cutoffs.
2. WHEN checking structural actions or subject/continuation expansions THEN the system SHALL obtain one additional real Jev answer to the identical question/state under pinned settings and record label/action agreement; ordinary saved-result reuse SHALL NOT count as a repeat call.
3. WHEN source labels or bold map-entry names supply structural clues THEN the system SHALL record agreement or disagreement as diagnostics, without treating agreement rates as measured accuracy on unmarked text.
4. WHEN independent semantic review runs THEN the reviewer SHALL read the full source and cite omissions, unsupported links, wrong meanings, and unresolved cases; review findings SHALL NOT be imported as product answers or used to patch model output.
5. WHEN testing this feature THEN the system SHALL omit clone calls and clone-agreement gates as explicitly instructed by the user.

## R18 — Live completion and preservation audit

Source: [catalog live status](../../../Resources/Jev%20question%20catalog.md#several-questions-in-one-request), [AGENTS completion rules](../../../AGENTS.md#absolutely-mandatory).

1. WHEN claiming a capability complete THEN the system SHALL retain actual live Hatchet and OpenRouter/Jev results, complete-source wire checks, semantic source review, failure/retry/reuse evidence, and the exact reproduction commands.
2. WHEN assessing corpus coverage THEN the system SHALL process documents 01–09 in order for each authorized capability and report every input/output and unresolved case rather than force the proposal's old counts.
3. WHEN auditing completion THEN an independent review SHALL compare both required changes and preservation constraints, including historical readers, commands, ontology, source bytes, and deferred boundaries.
4. IF external services, uncalibrated policies, semantic errors, or required evidence prevent completion THEN the report SHALL distinguish PASS, FAIL, and BLOCKED with cited evidence instead of treating unit tests or successful workflow status as product success.

## Question coverage and boundaries

| Catalog questions | Requirements | Intended result |
| --- | --- | --- |
| Q01–Q04 | R03–R06, R14–R17 | Faithful layout and structural findings |
| Q05 | R07–R08, R14–R17 | Supported local alias groups and unresolved pairs |
| Q06–Q07 | R09, R14–R17 | Qualified and typed source-local entities |
| Q08–Q11 | R10–R12, R14–R17 | Whole-block context and supported expansions |
| Q12–Q13 | R13–R17 | Retained meaning and origin notes |
| Q14–Q20 | Out of scope | Later claim, relationship, date, identity, and article work |

The proposal's historical counts and token percentiles are comparison data only. Catalog-preserved examples and copied material can legitimately change context totals. No production caller needs hand-authored expected answers; reviewers derive diagnostic expectations from sources during development.
