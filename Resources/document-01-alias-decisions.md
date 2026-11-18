# Document 01 alias decisions and next-stage discussion

Updated: 2026-10-09. Durable record of the user's campaign rulings, live experiments, and grouping discussion. Findings are separated from proposals. This is not a policy freeze or AP-28 completion record.

## User adjudications

| Referent | Names / boundary |
| --- | --- |
| Apollo deity | Apollo = Lathander = Dawnfather. |
| Followers | Apolloite = Lathanderan. Keep them separate from the deity. |
| Spelling variants | Accept Lloth/Lolth and Gruumush/Gruumsh. |
| Pantheon | User accepted Pantheon/Divine Lords and Pantheon/'Official' Pantheon. The full-heading and Gods of the Realms links are additional source-review interpretations, supported by source lines 8, 42 and 44. |
| Church / precursor movement | Unified Church and late DR1400's movement are different types and different entities. This supersedes the earlier tentative continuity interpretation. The user has not assigned a particular ontology type to the movement. |
| Marvel passage | Exclude its entity pairs from the current document 01 investigation. Original complete source remains intact in the requests. |

Source examples: “Apolloite (aka Lathanderan) sailors”; “Thor (aka Talos)”; “Apollo (nee Lathander)”; “the Pantheon would be the only entities who are referred to as the Gods of the Realms”. [Original document](Lore/01-unified-church-of-the-realms.md#L2).

## Experiments retained on disk

| Experiment | Coverage | Main finding | Confirmed cost |
| --- | --- | --- | --- |
| Single-pair wording tuning | Eight calls on Apollo/Lathanderan; stopped before the authorized maximum of 50 | Winning wording produced Different at 92%, 96%, 94%, then 93% with reversed option order. Single-case tuning only. | $0.001830570 |
| Frozen Choice prompt | 1,540 pairs among 56 campaign names, one question/request | At 75%, accepted 24 of 29 source-reviewed positive links. No wrong accepted link identified in those 24. Followers and Pantheon still have missing links. | $0.351748320 |
| Native Noul diagnostic | 41 discussed pairs, one question/request | Yes means same referent. No separate confidence field was returned. All 41 responses passed the existing validation contract. | $0.009300312 |

Full request state includes original complete source, structured deity table, glossary, seven approved definitions, table-reading rules and examples. Noul conversion retained the winning instruction string; true maps to the old same_entity criterion and false to different_entities. Expected labels and user rulings were not inserted as answer hints into requests.

[Single-pair report](../.kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/apollo-lathanderan-experiment/report.md#L1). [Full Choice evaluation](../.kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-01-alias-evaluation/report.md#L1). [All 41 Noul pairs, exact question, context and routing counts](../.kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-01-noul-discussed-pairs/report.md#L1).

The 29-positive inventory combines a 21-positive predeclared reference set with eight post-run source-review additions. It is a bounded reviewed inventory, not a population accuracy estimate. Realms/Forgotten Realms is a reviewer setting-name interpretation; excluding it changes the Choice 75% result to 23/28.

## Actual Noul semantics and confidence

Actual tested proposition: Are the two expressions names of the same referent? Thus P(yes) is P(same entity). No is computed as 1-P(yes). Jev returned only type=noul and noul, with no confidence property. Separately computed confidence-style strength is abs(2*P(yes)-1), as described by [TypeSafe](https://docs.typesafe.ai/confidence). It is not an independent assessment of correctness.

Negative-oriented alias or proposed-decision verifier questions have been discussed but have NOT been run. A fresh negatively worded question need not produce the exact complement of these observed positive-worded results.

## Threshold routing recommendation — experimental

| P(yes: same) | Proposed action |
| --- | --- |
| At least 75% | Accept alias link. |
| At most 15% | Keep separate. |
| Between 15% and 75% | Stronger-LLM clarification. |

Inclusive diagnostic comparisons. On the 41 selected pairs: 22 automatic links, six automatic separations, 13 clarification pairs, zero wrong automatic decisions under the recorded reference judgments. A 75% yes / 25% no profile makes one wrong automatic separation: full Pantheon heading/Gods of the Realms at Yes 19%, No 81%. These boundaries are not validated production policy and have NOT been installed.

Also consider escalating contradictory identity groups. Extra escalation volume from this proposed group check was NOT included in the 13-pair count. The cascade guide suggests narrow error checks, an any-flag gate and selective stronger-model escalation; its example 70% P(wrong) cutoff is not our alias threshold. [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade).

## Proposed overlap merging

Build an undirected graph with an edge for each accepted same-entity pair. Merge overlapping accepted alias sets by finding connected components. This allows A=B and B=C to establish a candidate group without requiring the model to independently accept every pair. Preserve direct disagreements as provenance/review flags.

This is a PROPOSAL, not an implemented change. The current [grouper](../src/domains/document/aliases/groups.ts#L81) requires accepted links between every pair of group members and emits disjoint groups. Its final groups therefore have no shared membership, even when accepted cross-group links remain unapplied. The governing [requirements](../.kiro/specs/lore-block-entity-association/requirements.md#L88) explicitly prohibit transitive chains alone establishing supported identity; implementation of connected-component grouping would require an explicit design/requirements revision.

### Church: connected at the 75% Noul boundary

One component contains UnifiedChurch, Unified Church, Church, Unified Church of the Realms and UCR. For example Church/Unified Church is Yes 87%, and Unified Church/UCR is Yes 77%. These connect Church to UCR despite their direct Yes 65% answer.

### Pantheon: connected at the 75% Noul boundary

One component contains Pantheon, The 'Official' Pantheon of the Unified Church of the Realms, 'Official' Pantheon, Divine Lords and Gods of the Realms. A connecting chain uses full heading/Pantheon 85%, Pantheon/Divine Lords 79%, Divine Lords/Gods of the Realms 80%; Pantheon/'Official' Pantheon is 86%. Retain the contradictory full heading/Gods of the Realms No 81% as a review signal.

### Apollo: three components until follower alias is resolved

| Component at Yes >=75% | Evidence |
| --- | --- |
| Apollo, Lathander, Dawnfather | Apollo/Lathander 88%; Apollo/Dawnfather 86%; Lathander/Dawnfather 89%. |
| Apolloite | No accepted follower alias edge. |
| Lathanderan | No accepted follower alias edge. |

Apolloite/Lathanderan is Yes 51%, No 49%, computed confidence 2%. All six deity/follower comparisons are No 85–92%, keeping followers separate from the deity. Overlap merging fixes the deity group but cannot invent the missing follower edge. That edge can be resolved by the user's adjudication and explicit source aka, or routed for automated clarification. Expected final result: one deity group and one follower group.

## Q06 / Q07 boundary and possible simplification

Current Q06 asks whether the candidate identifies one specific entity that fits the full approved rules; answers yes/no/unclear. Current Q07 selects one of exactly seven approved types. Supported Q06 yes currently gates Q07. [Questions](../src/domains/document/decisions/questions.ts#L117). [Stage requirements](../.kiro/specs/lore-block-entity-association/requirements.md#L94).

The user is considering replacing mandatory qualification-first with a type decision, followed by confidence-based pointed clarification. Seven forced type choices alone do not encode not-an-entity or mixed-referent outcomes. A combined classification decision can instead retain the seven ontology types and add decision outcomes for not_an_entity, mixed_referents and insufficient_evidence. These outcomes are not new ontology types. This would change the question contract/stage flow, requiring a spec revision before implementation. Another option is a provisional type followed by a negative-oriented, type-specific validity check; the verifier's true means a problem or wrong proposal. At that discussion point no Q06/Q07 experiment had been run. The subsequent combined diagnostic is recorded below; production Q06/Q07 remains unchanged.

## Reproduction

- `npx tsx src/dev/jev-playground/report-noul-pairs.ts` verifies all 41 captured wires and raw responses, computes confidence-style strength and reproduces routing sweeps without network calls.
- `npx tsx src/dev/jev-playground/summarize-alias-evaluation.ts` reproduces the full Choice evaluation and existing-grouper replays without network calls.
- For overlap components: take the saved scored-results.json; for each row with yes >=0.75 add an undirected name_a/name_b edge; collect reachable names. Restrict to each named family for the component examples above.

## Outstanding decisions

1. Whether overlap components should be candidate groups with review flags or directly accepted groups; how explicit contradictory edges affect acceptance.
2. Whether to resolve Apolloite/Lathanderan using the recorded user adjudication or test a clarification step.
3. Whether to combine Q06/Q07 or retain a type-specific verifier; question outcomes and routing need a concrete experimental contract.
4. Calibration of qualification/type/clarification boundaries on their own outcomes. Alias thresholds are not automatically qualification/type thresholds.

Production question definitions, thresholds, source corpus and ontology remain unchanged by this record. Keep saved experimental responses separate from future incompatible runs.

## Combined qualification/type test — 2026-10-09

User authorized the ten-option diagnostic. Twenty document 01 cases, three fresh calls each, used full locked definitions/capture rules plus Not an entity, Mixed referents, and Insufficient evidence. Controls and acceptable outcomes were frozen before calls. Movement and festival were unscored, and Pantheon allowed Concept or Organization.

All 60 responses validated, with stable winning labels across three repeats for all 20 cases. Stability did not imply correctness: 42/54 labelled answers matched the 18 predeclared reference cases. Nine clear named-entity cases typed consistently; two metadata controls rejected correctly. Mixed referents detected two of four controls, missing deity/followers and Church/movement. The latter returned Organization probabilities 72%, 78%, 82%, with confidence 69%, 76%, 80%. Followers returned Not an entity 27–28%, confidence 19–20%; Realms returned Concept 54–64%, confidence 49–60%. Insufficient evidence never won.

Hypothetical routing always clarifies Mixed referents and Insufficient evidence. At 75% returned confidence, 31 answers auto-type, six auto-reject, 23 clarify; two labelled automatic errors occur, both Church/movement, plus two unscored festival answers auto-type. At 85%, 27 auto-type, six auto-reject, 27 clarify and zero labelled automatic errors occur in this selected test. These are 60 repeated answers from 20 source cases, not a population error rate. No Item or Quest examples were tested.

Confirmed cost $0.017838072; runtime about 24 seconds; no failed calls. The extra outcomes are useful, but a confidence threshold alone does not reliably detect mixed groups. No cascade follow-up was run and no production stage was replaced.

Full results, actual question/criteria and all ten option scores for every repeat: [.kiro combined test report](../.kiro/execution/AP-28/live/fresh/calibration/practical-thresholds/document-01-combined-entity-test/report.md). Reproduce without live calls: `npx tsx src/dev/jev-playground/report-combined-entity-test.ts`.
