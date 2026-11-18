# Jev official API and bounded request composition

Research date: 2026-10-04 (America/New_York). Inspected installed OpenRouter SDK 1.4.21 and retained iteration-043 request/response. No paid model calls; no application edits. Official technical sources below are primary. Do not use similarly named third party Jev domains found by search. Public source pages have 200-word paraphrase budgets and 25-word quotation limits. Allocate final guide claims among the separate sources; no public prose quotations are necessary. Local source examples and our independently composed examples do not copy vendor example wording.

## What is a Jev question, and where does its actual wording belong?

### Takeaway

`instructions` contains the actual question. Structured object instructions are expressly supported; the current app uses a valid format. Direct question wording and named references would improve readability, but we have no experiment showing they would change the UCR answer.

### Cited Findings

- Official API accepts `state` as string/object/array, `questions` as a named map, and `instructions` as string/object/array. It shows object instructions with a `question` and supporting comparison record. Question map keys are bookkeeping and are not used in inference. [TypeSafe API](https://docs.typesafe.ai/api)
- Structured instructions and structured Choice descriptions, Score levels, and Noul criteria are documented features. Use labelled fields for supporting data and explicit question text; an object is useful when guidance has distinct parts. Its accepted-field table includes null, while the API prose and installed OpenRouter types require nonnull instructions: avoid null in examples. [Advanced structure](https://docs.typesafe.ai/primitives/advanced)
- State separates evaluated content/facts from the questions. Vendor recommends an object for most requests to retain descriptive names and relationships, and a string when the case is one simple text. This is evidence against a blanket recommendation to flatten JSON into prose. [State](https://docs.typesafe.ai/concepts/state)
- Every question sees the same state, and each is evaluated independently. Other questions' answers are not hidden context. Use dot/index paths surrounded by backticks to point to exact state fields. Subsequent requests are needed when the earlier answer determines new state data or options. Otherwise batch and combine in code. [Primitives](https://docs.typesafe.ai/primitives)
- Option names and descriptions are both model inputs, while the question ID is not. Instructions and criteria may be structured; the vendor recommends beginning with strings for simple cases. Include `other` or none-of-the-above when possible inputs exceed the offered options. [Choice](https://docs.typesafe.ai/primitives/choice)

### Inferences

- Proposed direct UCR instruction: `In complete_source, do "UCR" and "Unified Church of the Realms" name the same referent?` A structured equivalent is `{question: "...", left_name: "...", right_name: "...", focus: "Use all occurrences and document framing; matching initials are a clue, not identity proof."}`.
- A question's visible JSON ID such as `is_acronym` is not enough. Explicitly state the names and relationship in `instructions`.
- Keep complete_source and the existing evidence pointers in a labelled state object. Avoid speculative claim that changing object/string structure fixes a known failure.

### Gaps

- No comparative live calls were authorized or made. We cannot attribute UCR's low probability to batching, object instructions, question phrasing, acronym difficulty, or long context.
- No official guarantee that arbitrary rules placed in state have higher priority than source content; adversarial-source caveats apply.

## Which typed primitive should be used, and how should answers be read?

### Takeaway

Use Choice for exclusive alternatives, Noul for individual yes/no propositions, and Score for an ordered descriptive rubric. These return bounded judgments rather than explanations or fresh text.

### Cited Findings

- Choice criteria map labels to descriptions, supports up to 255 options, and returns the highest-probability label plus each option's probability. Options form one distribution that sums to 1. [Choice](https://docs.typesafe.ai/primitives/choice)
- Noul instructions can be a statement or yes/no question. Optional criteria have `true` and `false` descriptions. Returned `noul` is the probability of yes; no separate confidence is returned. Around 0.5 means uncertainty, not medium degree. Ask one condition per question, align high probability with yes, and combine conditions in code. [Noul](https://docs.typesafe.ai/primitives/noul)
- Score uses an ordered criteria array with 2–10 descriptive levels and zero-based indexes. Returned score is `sum(i * p_i)`, not a probability or exact magnitude. Read probabilities/legend/confidence too: score 1.0 could mean all weight on level 1 or half on levels 0 and 2. Each level needs a standalone description; numeric labels or references to adjacent levels are insufficient. [Score](https://docs.typesafe.ai/primitives/score)
- Jev returns no generative explanation, rationale, chain of thought, or newly generated free text. Choice/Noul/Score are the replacement for narrow prompt-and-parse judgments, not a drop-in chat interface. [OpenRouter Jev hub](https://openrouter.ai/docs/guides/community/jev)
- TypeSafe's citation cookbook first locates and verifies exact quotes in code, then asks a three-option semantic support question (`supports`, `contradicts`, `says_nothing`) over claim and surrounding source. Verbatim grounding alone does not prove semantic support. [Citation cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
- Entity-alignment cookbook uses a link rubric plus separate Noul checks of matching properties, retaining the individual readings beside the aggregate. It is an example of diagnostic companion questions, not a claim that unrelated domain rubrics should become lore ontology rules. [Entity alignment cookbook](https://docs.typesafe.ai/cookbooks/entity_alignment)

### Inferences

- Multiple applicable entity/block links are many independent propositions: one Noul or one supported/unsupported/unclear Choice per supplied pair. A single Choice over entities would force exclusivity and lose valid shared associations.
- Same/different/unresolved is a useful exclusive alias question when explicit insufficient evidence must survive. A Noul acronym question can be a diagnostic companion; it should not silently override a conflicting identity result or dictate a merge.
- Needed explanation can be approximated by separately typed checks (e.g., expansion stated, contextual coreference supported, multiple incompatible referents). They remain model judgments, not evidence quotations, and are not automatically statistically independent.
- Evidence IDs can be supplied as Choice options, or one evidence-support judgment asked per candidate passage. Code must validate bytes and provenance; Jev cannot emit arbitrary citation spans as generated prose.

### Gaps

- Vendor's citation/beer recipes have illustrative thresholds; none establishes accurate lore thresholds or canonical admission.
- Score is not suitable for categorical ontology labels, which have no natural numeric order.

## How do probabilities, confidence, calibration and batching work?

### Takeaway

Choice confidence is a deterministic transform of the winning probability and number of options. It is not an independent verification signal. Calibrate routing using reviewed domain cases, and distinguish same-request fan-out from stages that actually depend on prior results.

### Cited Findings

- Formula: `choice_confidence = (p_max - 1/n) / (1 - 1/n)`. Only maximum probability and option count matter. Noul has no confidence; an optional derived certainty is `abs(2*p - 1)`. Score confidence uses expected distance from the modal level relative to a uniform distribution. These summarize distributions; thresholds depend on domain and consequences. [Confidence](https://docs.typesafe.ai/confidence)
- Vendor recommends atomic judgments, deterministic composition, and comparing confidence against accuracy on domain data before routing uncertain cases. State can include domain rules; clarify boundaries through criteria and relevant examples. [How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- Questions sharing fixed context can be asked together even when some are only relevant after a routing answer. Code discards irrelevant answers. Additional questions still cost input; fan-out does not provide answer-to-answer reasoning inside a call. [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
- Official model page documents two budgets for Jev 1.13: state plus all questions at most 64k tokens; state plus the longest question at most 32k. It lists `jev-1.13.0`, stable/preview aliases, per-input billing, dynamic rates (100k tokens/s and 80 requests/s as inspected). Aliases move; response reports serving version. Pin version if thresholds depend on it. [TypeSafe models](https://docs.typesafe.ai/models)
- OpenRouter model page presents 32k context and model `typesafe/jev-1.13`, released Sep 18, 2026; input price $0.042/M, output free as inspected. The richer two-budget TypeSafe description should not be discarded; the app currently preflights actual endpoint metadata and conservatively bounds the request. [OpenRouter model page](https://openrouter.ai/typesafe/jev-1.13)
- Vendor jaggedness page, reviewed Oct 2, identifies literal interpretation, arithmetic/counting/time comparison weakness, indirection, distraction from large state, adversarial content, instruction/criteria conflicts, option-order effects, and unsupported generation. Recommendations: exact questions, direct field references, calculation in code, aligned criteria, and option-order evaluations. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

### Inferences

- UCR response: with three options and top probability .41, `(0.41 - 1/3)/(1 - 1/3) = .115`, matching reported confidence .12 after rounding. Earlier descriptions implying confidence and option probability were independent signals are incorrect.
- A confidence cutoff .90 for three-option alias Choice corresponds to p_max ≥ .933333 before output rounding. Thus an additional .90 probability cutoff is weaker and redundant when the same option wins. Retain current behavior until separately authorized; simply document it accurately now.
- Adding/removing alternatives changes the confidence transform. Thresholds are not portable unchanged across option counts, prompt revisions, new providers or models.
- Semantically independent question evaluation is not statistical independence of model errors; never multiply companion probabilities as if independent without evidence.
- Complete-source specification conflicts with generic vendor retrieval/filter advice if filtering deletes required context. Keep the complete source, highlight named occurrence/block context, limit unrelated metadata, batch by question count and fail rather than silently truncate. Narrow acceptance proofs cannot authorize changing complete-source semantics.

### Gaps

- We did not establish exact serialized-to-model token counts for the hosted service. `JSON` UTF-8 byte counts and SDK validation do not equal the vendor tokenizer's input usage; actual `usage.input_tokens` is retained after each request.
- Official OpenRouter tutorial describes 32k broadly; TypeSafe distinguishes 64k packed total from 32k per state-question. Use both budgets when supported, and endpoint metadata restrictions; do not promise the extra packed budget on an unverified route.
- Calibration is vendor-described training/behavior. It is not proof that a .90 prediction on this lore corpus is correct 90% of the time.

## What exact endpoint and SDK fields should the guide show?

### Takeaway

OpenRouter offers Decisions HTTP and a compatibility System One endpoint. This app calls the Decisions path through installed OpenRouter SDK 1.4.21. The SDK uses camelCase configuration fields; wire JSON uses snake_case where mapped.

### Cited Findings

- `POST https://openrouter.ai/api/alpha/decisions` works with OpenRouter HTTP or SDK. `POST https://openrouter.ai/api/v1/systemone` supports the TypeSafe SDK with OpenRouter as base URL. Both authenticate with OpenRouter bearer key; direct TypeSafe endpoint is `https://api.typesafe.ai/v1/systemone` and uses a TypeSafe key. [OpenRouter Jev hub](https://openrouter.ai/docs/guides/community/jev); [TypeSafe API](https://docs.typesafe.ai/api)
- Decisions request fields include model, state, questions, optional provider preferences, `session_id`, trace, and user. Returned answers include model/usage and OpenRouter id/provider. No `messages`, `response_format`, temperature or rationale field is in the installed DecisionsRequest schema. [Decisions endpoint](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request); [installed DecisionsRequest](../../node_modules/@openrouter/sdk/esm/models/decisionsrequest.d.ts#L17)
- Installed serializer transforms `sessionId` to `session_id`; provider serializer transforms `allowFallbacks` to `allow_fallbacks`. Nested instructions objects are retained. [Installed serializer](../../node_modules/@openrouter/sdk/esm/models/decisionsrequest.js#L31); [provider serializer](../../node_modules/@openrouter/sdk/esm/models/providerpreferences.js#L62)
- Installed SDK Choice/Score answer schemas mark confidence/probabilities optional, while TypeSafe docs show them as provided. The app appropriately validates stronger required domain fields and answer coverage rather than treating SDK decode as semantic success. [Choice SDK fields](../../node_modules/@openrouter/sdk/esm/models/decisionschoiceanswer.d.ts#L4); [app validation](../../src/domains/document/decisions/validation.ts#L4)
- App sends `client.alpha.decisions.create({decisionsRequest: request})`, captures actual serialized outbound body plus raw response before decoding, and validates complete source before dispatch. [Provider implementation](../../src/domains/document/decisions/provider.ts#L21)
- OpenRouter response caching supported-endpoint table lists chat/completions, responses, messages, embeddings. Decisions/systemone are absent. Prompt-caching guide does not establish TypeSafe Jev-specific support. Do not advertise endpoint cache headers as supported for this app. [Response caching](https://openrouter.ai/docs/guides/features/response-caching); [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- Existing app reuses a validated saved batch, writes a reuse record with `network_request_sent: false`, and distinguishes fresh results. [Local reuse](../../src/domains/document/decisions/operation.ts#L24)

### Inferences

- Guide should show both JSON over HTTP with `provider: {only: ["typesafe"], allow_fallbacks: false}` and SDK object with `provider: {only: ["typesafe"], allowFallbacks: false}`. Avoid passing wire casing to the SDK configuration.
- Cache identity should include source content hash, complete question instructions/criteria, question version, model serving version, and governing definitions. This is application design guidance, not a claim that the current cache implements every listed check.
- Validate response as data: expected/missing/extra IDs, type, known options, bounded finite probabilities, probability sum tolerance, returned provider/model, and exact source/candidate references. Keep HTTP-success error envelopes visible and retry only documented transient failures.

### Gaps

- No live inference confirms newly written question examples. They are schema-consistent proposed examples.
- No claim that all provider preference knobs affect every Jev endpoint; only pinning fields already present in this app should appear in minimal examples.

## What does the actual UCR run establish?

### Takeaway

The saved request contains explicit acronym guidance and a structural initials clue, and the raw response answers the specified alias question. It is not missing a Jev invocation; it is a low-certainty response preserved as unresolved.

### Cited Findings

- Alias instructions name acronyms/short names/epithets/spelling variants, require full source context, and explain matching initials are only a clue. Pair questions contain both names and use an indirect task reference to `alias_instructions`. [Alias builder](../../src/domains/document/aliases/semantic-input.ts#L5)
- Request sends 16 questions, and `pair-0022-0056` includes `left_name: Unified Church of the Realms`, `right_name: UCR`, and initials clue. [Exact outbound JSON](../../data/runs/01-unified-church-of-the-realms/iterations/iteration-043/classifications/887be63b-d9bc-42a2-88bd-6d23756e6d19/aliases/batches/batch-107/attempt-1-15832227-7236-4b0a-97ef-8ce63f8ea801/outbound-request.json#L1)
- Raw answer chooses `different_referents`, with probabilities different .41 / same .32 / unclear .27 and confidence .12. Provider TypeSafe, serving model `typesafe/jev-1.13-20260917`, usage input 9211/output 883, cost .000386862 USD; these are per batch totals, not cost of just the UCR question. [Raw response](../../data/runs/01-unified-church-of-the-realms/iterations/iteration-043/classifications/887be63b-d9bc-42a2-88bd-6d23756e6d19/aliases/batches/batch-107/attempt-1-15832227-7236-4b0a-97ef-8ce63f8ea801/response-body.txt#L1)
- Code checks answer confidence and probability at configured cutoff, plus source occurrences, before provisional link or distinct routing; low-certainty cases become unresolved. Note configuration field `minimum_same_probability` is currently applied to probability of whichever option wins, so it is a naming mismatch as well. [Validation](../../src/domains/document/decisions/validation.ts#L29)

### Inferences

- A direct wording example should be presented as a readability improvement needing evaluation, not a diagnosed fix. Preserve saved answer and low confidence as evidence.
- Inspector should show question, names, source references, all options, selected answer, full probabilities, derived confidence, application action, policy/version and whether reused.

### Gaps

- No causal explanation for model response is supplied. The response has no rationale/evidence-specific answer fields.

## What transfers to Kev and other System One implementations?

### Takeaway

The bounded-question design transfers; hosted limits, calibration, throughput and exact schemas do not automatically transfer. Kev is an independently authored local Jev-like family, not an official TypeSafe Jev release or verified replacement for the project's provider.

### Cited Findings

- Kev author repository implements compatible `POST /v1/systemone`, Choice/Noul/Score, structured state/instructions and the same Choice confidence formula. Its Score accepts 1–255 levels rather than Jev's documented 2–10. Server default rejects overlong 65,536-token state; explicit `KEV_TRUNCATE_STATES=1` enables prefix-only processing and flags truncation. Current hybrid models isolate each question row and reuse state-prefix computation. These are author implementation claims, not independent validation. [Kev source repository](https://github.com/jaredpalmer/kev)
- TypeSafe's own adapter provides a System One API shape over generative LLM APIs; it is distinct from native Jev serving. [Official adapter repository](https://github.com/typesafe-ai/system-one-adapter-python)

### Inferences

- Same schema and confidence formula do not imply matched semantics or matched calibrated distributions. Revalidate with the same reviewed task corpus and retain provider-specific metadata before any replacement decision.
- Shared design rules: bounded answer space; concrete literal criteria; direct state pointers; code for arithmetic/bytes/routing; atomic questions; explicit uncertainty; domain evaluation; deterministic provenance checks.

### Gaps

- Other researcher covers ecosystem/model comparisons. No research note here recommends installation, provider substitution, or live Kev serving.
- Repository model/benchmark figures are owner-reported; avoid reproducing exact accuracy comparisons as independently demonstrated facts.

Example companion file: [schema-examples.json](schema-examples.json) contains an independently composed complete SYNTHETIC source, one question of each primitive, HTTP JSON with snake_case and SDK wrapper/camelCase illustration, and explicitly invented response-shape examples. Never present its numbers as real Jev output or its synthetic text as actual campaign evidence. The Score measures subject focus and is not an entity association admission rule. It is an optional explanatory example; the actual core association question should use the project's defined categorical/propositional semantics.

Source budget flags for writer: APIs, State, Advanced, Primitives, Choice, Noul, Score, Confidence, TypeSafe Models, Jev jaggedness, Build with System One, Fan-out, Entity alignment, Citation check, OpenRouter Hub, OpenRouter Tutorial, OpenRouter Model, Decisions reference, Response caching, Prompt caching, Kev README each fetched with 200-word derivative limit. No public prose has been quoted verbatim in these notes. Use <=25 quoted words per original webpage, total across final deliverables; original example prose should not be copied. Local repo and SDK evidence can anchor implementation explanations separately. Memory quick search oriented complete-source requirement only; citations MEMORY.md:237-244 and 909-914 if parent uses memory directly. This note's actual conclusions were freshly checked against the live repo/docs.
