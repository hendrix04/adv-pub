# System One decision models: practical comparison and evidence boundaries

Research checked 2026-10-04. This is research material for the Jev request guide, not authorization to change providers, ontology, or admission policy. All recommendations below are research inferences unless identified as an API fact. No model inference was performed.

## What does System One mean, and what is portable between models?

### Takeaway

Operationally, this family takes a supplied state and bounded questions and returns values over supplied options, without composing explanatory text. The useful portable abstraction is a decision contract; probability calibration, context capacity, and correctness do not transfer with a JSON schema.

### Cited Findings

- TypeSafe presents Jev as typed probabilistic decisions over unstructured state, with parallel output rather than autoregressive string generation. The launch post explicitly distinguishes schema validity from its workflow evaluations, which use reference probabilities from larger models rather than independent ground-truth labels. These are vendor descriptions and evaluation choices, not lore acceptance evidence. [TypeSafe launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
- Strands Decider replaces a language-model output head with a pointer head comparing each supplied option to an answer position; one softmax supplies three primitives: Noul returns P(true), Choice returns argmax and a distribution, and Score returns the probability-weighted level index. Options are supplied at runtime. Its choice confidence is `(N*p_max-1)/(N-1)`; score confidence uses normalized standard deviation. Option order can affect results. [Strands architecture](https://github.com/strands-labs/strands-decider/blob/main/docs/architecture.md).
- Kev is Jared Palmer's independent Jev-like family; its repository claims TypeSafe Python SDK compatibility. Current Kev 1.0 includes 0.8B, 4B, 9B and 27B checkpoints. The API offers Noul, exclusive Choice and ordered Score. Sibling questions are isolated. Kev distinguishes server token capacity from measured context accuracy: the smaller checkpoints have 8,192 validated tokens; 27B has 65,536 on its stated contract benchmark criterion. These are author measurements. [Kev repository](https://github.com/jaredpalmer/kev).
- Kev's API code computes Choice confidence using the same normalized-max formula, but Score confidence uses normalized expected absolute distance from the mode, unlike Strands' normalized standard deviation. Score returns an expected index; fractional values do not indicate a generated intermediate category. [Kev API code](https://github.com/jaredpalmer/kev/blob/main/kev/api.py).
- Strands serves a similar-shaped `/v1/systemone`, but its documentation explicitly says compatibility with Jev's API itself is not verified. [Strands inference documentation](https://github.com/strands-labs/strands-decider/blob/main/docs/inference.md).
- The published Strands reference remains v19, an adapter on Qwen3.5-2B-Base plus a decision head. Its HF revision was independently read through `hf models info StrandsAgents/strands-decider-2B-hobson-v19 --format json | python -c 'import json,sys; x=json.load(sys.stdin); print(json.dumps({k:x.get(k) for k in ["id","sha"]}))'`: `bb282d786bc251fd4e3068de3ada9ddbb38127cd`. [Model card](https://huggingface.co/StrandsAgents/strands-decider-2B-hobson-v19).

### Inferences

- Use System One as a practical interface category, not proof that every model with this label has one architecture, one accuracy level, or human-like cognition.
- Explain the model's job as selecting among caller-defined alternatives. An incorrect alternative remains schema-valid.
- A many-to-many block/entity association requires independent pair questions or another explicitly multilabel contract. An exclusive Choice over entities would incorrectly prohibit a block belonging with several entities.
- Put required facts in shared state or the target question. Do not put indispensable instructions in question IDs, comments, or another question's instructions.
- Dependent judgments need separate requests or explicit independent hypotheses. A later question in the same batch does not consume an earlier answer. Program code resolves results, constructs the next state, and then asks the next stage.
- Request compatibility is insufficient for substitution. Preserve the task meaning and remeasure outputs, confidence formulas, token behavior, and target-domain error rates before considering a provider change.

### Gaps

- This research does not establish Jev's proprietary internal architecture. Open replicas explain mechanisms they implement; their architecture is not evidence of Jev's internals.
- No independent lore-domain comparison of these models was run. All vendor/author metrics above stay contextual, not acceptance results.

## How should questions, state, and model uncertainty be designed?

### Takeaway

Use concrete referents, one bounded judgment per question, full definitions of alternatives, and explicit source authority. Treat answer probabilities as predictions that need target-domain checks; abstention is an application action or a well-defined semantic option, not an automatic model guarantee.

### Cited Findings

- Calibration means estimates reflect empirical correctness likelihood; modern neural networks can be miscalibrated. Guo et al. found temperature scaling effective on many tested classification datasets, not a universal correctness guarantee. [ICML 2017 paper, v2 dated 2017-08-03](https://arxiv.org/abs/1706.04599v2).
- Kev-9B v2, released 2026-09-30, lists revision `b5d8c18e`. Its card explicitly warns that temperature calibration does not transfer to every workload, asks users to measure labelled target data, and distinguishes trained task families from genuinely new sources. It reports day-precision date arithmetic as a weakness and offers a deterministic date-fact preprocessor. Option order can change answers, and states longer than training length can be accepted without proven accuracy. [Kev-9B v2 card](https://huggingface.co/jaredpalmer/kev-9b).
- Strands v19's author reports 0.952 accuracy for the confidence >=0.9 band on four short unseen classification tasks, covering 23% of that sample. Its results warn that those bands do not generalize to long documents or adequacy judgments; Noul retains within-bin calibration weakness. Calibration can alter a Score mean but not a Choice argmax. [Strands results](https://github.com/strands-labs/strands-decider/blob/main/evaluation/results.md).
- Strands normally cuts the state to fit its checkpoint window while retaining the question's options. `--strict-window` instead refuses oversized inputs. It shares state encoding, and each question cannot see another's text; `--max-batch` controls inference question batches. [Strands inference documentation](https://github.com/strands-labs/strands-decider/blob/main/docs/inference.md).
- Kev normally rejects oversized states with HTTP 422; `KEV_TRUNCATE_STATES=1` opts into cutting and reports truncation. Its server batching is an implementation budget, not a promise of unchanged semantic accuracy under arbitrarily long input. [Kev repository](https://github.com/jaredpalmer/kev).

### Inferences

- For UCR, use the full document and ask directly whether the occurrences of UCR and Unified Church of the Realms identify the same organization here. Matching initials is a hypothesis clue; it cannot supply identity proof or stand in for source context.
- Separate lexical relationship from referent identity when useful: a spelling can resemble an acronym even when its occurrence names another referent. A direct acronym-focused identity question need not imply the document spells out the expansion.
- Give `same_referent`, `different_referents`, and `insufficient_evidence` concrete, mutually distinguishable definitions. `different_referents` requires source support for distinct identity; missing support for sameness is insufficient evidence.
- `insufficient_evidence` describes what the source permits. Low numerical confidence describes the prediction distribution. Keep them separately visible, since the model can confidently conclude the source is inconclusive or weakly select a substantive answer.
- Choice confidence derived from p_max is not independent evidence. Requiring both it and p_max may be a useful policy, but those are two thresholds on one distribution, not two corroborating judgments.
- Entity existence, ontology membership, ontology type, alias identity, passage relevance, and claim support have different targets. Separate them in the explanation and question catalog, even if some current questions combine them.
- A block about an entity can contain a rumor, quotation, negation, hypothetical example, or attributed belief. Association does not endorse an unqualified claim. Ask claim support against its exact qualifiers separately.
- Arithmetic, UTF-8 spans, exact source matching, source precedence, graph consistency, and persistence permissions belong to deterministic code. Ask a model for semantic readings of date phrases if needed, then calculate and apply temporal rules explicitly.
- Fail closed on unexpected question counts/types, missing IDs, nonfinite probabilities, malformed provider envelopes, or lost context. Preserve the exact request and raw response for diagnosis; never reinterpret transport failure as a domain rejection.

### Gaps

- No corpus-specific admission thresholds follow from public confidence examples. Thresholds need reviewed lore cases and consequences of false links, missed links, and wrong admissions.
- The memory registry's older Strands `temporal_numeric` 0.267 figure was not found in current public documentation during this pass; omit that number from the user-facing guide. The independently verified current date-arithmetic limitations suffice.

## What comparative baseline and evaluation evidence are useful?

### Takeaway

NLI clarifies source/claim decisions and exclusive versus independent labels, but has its own output and truncation semantics. Evaluate correctness against reviewed labels and meaningful coverage; repetition and agreement alone measure stability.

### Cited Findings

- Hugging Face's zero-shot NLI pipeline pairs each source premise with a label hypothesis, then uses entailment logits. With `multi_label=False` it normalizes candidate-label scores to sum to one; with `True` each label independently normalizes entailment versus contradiction. The pipeline can truncate oversized sequences. Its returned label scores are not a Jev confidence field. [Official Transformers pipeline documentation](https://huggingface.co/docs/transformers/main_classes/pipelines#transformers.ZeroShotClassificationPipeline).
- A primary early evidence audit reviews only the first nine days of published typed-decision-model research, describes the evidence as provisional, and reports no established independent accuracy advantage from typed readout itself. It distinguishes confidence-based deferral from guaranteed correctness. [Tang and Zheng, arXiv v1, submitted 2026-09-26](https://arxiv.org/abs/2609.32160v1).
- A separate primary preprint tests option-name/rubric binding with Jev and two open models. Under polarity conflicts it reports ranking inversion while schema validity remains intact. Its hosted arm was observed at one time; quantitative transfer to current models, lore questions, and every architecture is untested. It discusses neutral identifiers but does not establish them as a universal remedy; the paper explicitly leaves mitigations unevaluated. [Sun and Xu, arXiv v1, dated 2026-09-22, discussion and limitations](https://arxiv.org/html/2609.26758v1).

### Inferences

- NLI is a useful conceptual baseline for “Does the document support this exact claim?” For support validation retain three outcomes: supported, contradicted, insufficient evidence. The standard multilabel zero-shot convenience calculation discards neutral from its normalization, so it is not automatically that three-way evidentiary contract.
- Favor clear labels whose normal meanings agree with descriptions. Evaluate alternate labels, option orders and harmless paraphrases on held-out cases; do not remap `yes` to mean `no`. The preprint warrants sensitivity testing, not blindly changing the project's current labels to opaque strings.
- Use independent human-reviewed gold that preserves source evidence and ambiguity. Partition by document/source family to prevent the same context and templated examples from leaking between prompt tuning, threshold calibration, and final evaluation.
- Track false alias links and missed links separately; group consistency and candidate-pair recall; entity admission/type errors; block-association precision/recall; exact claim qualifier support; coverage at each confidence threshold; per-family calibration; transport and context-loss failures; and review volume. High average accuracy can conceal high-confidence false merges or absent acronym coverage.
- Calibration evaluation should include proper distribution scores such as Brier or log loss, reliability plots, sample counts and intervals, plus error versus automated-coverage curves. ECE alone depends on binning and can hide a poorly performing decision family.
- Repeat the same request to assess stability; change ordering/paraphrases to assess sensitivity; compare models to assess disagreement. None substitutes for source-bound gold correctness. Two replicas may share training, base models, or systematic mistakes.
- Re-evaluate after model version, prompt, category descriptions, context packaging, calibration, or routing policy changes. An improved public benchmark does not prove project completion.
- Include acronym cases, ambiguous abbreviations, same-name distinct entities, plural generic kinds, quoted imported material, tables with required headers, pronouns, corrections, succession, rumors, negation, hypothetical examples, and unknown world dates in reviewed coverage. These are suggested test strata, not new ontology or policy rules.

### Gaps

- No reviewed independent Jev/Strands/Kev lore labels, calibration curves, or live acceptance were produced by this research. These notes inform request design; they do not certify a pipeline or recommend a provider replacement.
