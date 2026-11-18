# Candidate admission and support

## Purpose and when to use it

Use this capability to keep broad source discovery distinct from decisions about what may enter canonical knowledge. Luna discovers proposals from a complete source; Jev evaluates bounded batches of those proposals against that complete source. Missing discoveries are corrected in discovery, never treated as Jev rejections. See [source capture and evidence](source-capture-and-evidence.md) for evidence coordinates and [structured model calls](structured-model-calls.md) for the shared dispatch boundary.

## Inputs, outputs, and invariants

Discovery input is one complete current source and its pinned Luna configuration. In one discovery response per iteration, Luna proposes entities across the seven locked types, mentions, aliases, assertions, relationships, explicit dates, attribution, useful passages, and proposed evidence. Preserve that original response and all proposals before deterministic evidence validation.

Jev input is a bounded batch of proposals, the complete current source, candidate pointers and relevant framing, and versioned bounded questions. Its output records the choice/answer, option probabilities, confidence, question version, evidence, and an outcome: accept, confident reject, or unresolved review according to separately calibrated thresholds. Jev's entity choice contains the seven locked types plus `not_an_entity`; it does not invent a new type or discover omitted candidates.

## Practical method

1. Run exactly one complete-source Luna discovery call for each iteration. Retain the untouched model response and every proposal before checking evidence or meaning.
2. Validate evidence pointers deterministically. Resolve exact quote and context against original-byte coordinates. Preserve missing, ambiguous, or invalid spans as findings; do not erase the proposal.
3. Build small Jev batches that fit with the complete current source. Ask bounded questions about entity admission, source assertions, or relationships among discovered candidates. Include pointers and enough framing to identify the candidate without replacing source context with snippets.
4. Route model-proposed entity types through the complete choice set. Keep a `not_an_entity` answer distinct from a missing proposal or invalid evidence.
5. Apply separate calibrated acceptance and rejection thresholds. Between thresholds, persist review and keep the item out of canon automatically; it does not block the workflow.
6. Require verified original-source evidence and an acceptance decision before creating a canonical claim. Capture completeness and graph admission are separate: unsupported predicates remain review material rather than entering the graph.

## Worked example

Use the complete source `The Lantern Guild does not serve the High Council.` It is 50 UTF-8 bytes. Luna's original discovery response proposes the Organization `Lantern Guild`, `High Council`, and a positive `serves` relationship with quote span `[0, 50)`. Preserve that response and proposal before validation.

```text
Jev Choice question 1:
  options: Creature | Location | Organization | Item | Event | Quest |
           Concept | not_an_entity
  instructions: classify this proposed entity using the complete source

Jev Choice question 2:
  options: supports_positive | contradicts_positive | unclear
  instructions: does the complete source support this positive relationship?

Jev Choice question 3:
  options: positive | negative | qualified | no_relationship | unclear
  instructions: what polarity and meaning does the complete source express?

Example persisted decision evidence (synthetic values, not calibration):
  entity answer: Organization
  entity option probabilities: { Organization: 0.97, not_an_entity: 0.01, ... }
  entity confidence: 0.97
  support answer: contradicts_positive
  support option probabilities: { supports_positive: 0.01,
                                  contradicts_positive: 0.98, unclear: 0.01 }
  support confidence: 0.98
  question_version: source-assertion-v1
  candidate_evidence: verified original-byte span [0, 50)
  extracted meaning: the source explicitly says the guild does not serve
  canonical positive edge: none
  negative source claim/passage: retained for supported downstream handling
  routing: apply separately calibrated thresholds; if no threshold contract
           exists, preserve the decision as review and keep it out of canon
```

OpenRouter documents a batched Decisions request with typed `choice` questions and responses containing the selected choice, per-option probabilities, and confidence. This guide uses the shape only to explain the decision boundary; exact request and persistence contracts remain open. [OpenRouter Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) · [Jev on OpenRouter](https://openrouter.ai/docs/guides/community/jev)

## Failure modes and verification

- **Discovery omission:** compare all meaningful source content with the one response. A missing person, claim, or passage is a discovery defect, not a rejection.
- **Focused extra passes:** do not add per-type or per-predicate discovery calls; a new iteration is a new single complete-source discovery call with its own pinned configuration and preserved response.
- **Snippet substituted for source:** verify complete text, hash, and length in actual Jev inputs. Reduce batch size if needed; fail when one candidate cannot fit with the complete source.
- **Type laundering:** preserve Luna's proposed classification and Jev's full locked choice set. Do not constrain Jev to agree with Luna or map uncertain items into an invented type.
- **Threshold collapse:** keep acceptance and rejection thresholds distinct. A middle outcome remains inspectable and outside canon.
- **Wrong polarity, subject, object, or meaning:** assess the full assertion and framing, not just whether names co-occur. Deterministic validation and support review must catch unsupported positive relationships.
- **Predicate guessed from co-occurrence:** “consecrated in Waterdeep” does not establish “headquartered in Waterdeep.” Unnamed worshippers who worship a deity do not make the deity the subject of a self-directed worship relationship. Retain the exact participants, predicate meaning, and source framing.

Inspect [CAP-001](../../specification.md#cap-001-broad-capture-and-generic-content-boundary), [CAP-002](../../specification.md#cap-002-faithful-assertions-and-evidence), [REL-001](../../specification.md#rel-001-closed-relationship-vocabulary-and-source-support), [OPS-003](../../specification.md#ops-003-inspectable-discovery-and-decisions), [TECH-003](../../specification.md#tech-003-workflow-decisions-and-publication), and D-002, D-003, and D-005 in the [open-question register](../../specification.md#open-questions-for-development).

## Application to the specification

Discovery remains one complete-source Luna call per iteration across all seven locked entity types and related discovery material. Jev evaluates retained proposals in bounded batches with complete source context, the seven types plus `not_an_entity`, and retained probabilities, confidence, question version, and evidence. Calibrated accept/reject thresholds remain distinct; a between-threshold answer is review and stays out of canon automatically. Option probabilities and confidence describe Jev's decision over the supplied choices; they do not rate source credibility, decide whether campaign statements are true, or guarantee a correct answer. Keep unresolved question versions, schemas, thresholds, and exact persistence payload explicit. This guide adds no discovery passes, merge-by-name identity rule, or requirement that Jev accept Luna's proposed classification.
