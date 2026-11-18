# Knowledge pipeline guide library

Use these guides to build a system that turns complete source documents into structured knowledge and supported publications. They explain reusable implementation techniques through small examples using Node/TypeScript, PostgreSQL/Drizzle, Hatchet, and OpenRouter/Jev.

The [specification](../../specification.md) governs project requirements, technology selections, locked ontology, configuration, budgets, and publication rules. This library explains implementation techniques; it does not change those requirements or settle an open contract. Read the guide for the capability you need, without treating the table as a development sequence.

## Choose a guide

| Guide | When to read it | Related guides |
| --- | --- | --- |
| [Source capture and evidence](source-capture-and-evidence.md) | Preserve immutable bytes, an exact reading copy, complete semantic context, and unambiguous original-byte citations. | [Model calls](structured-model-calls.md), [Persistence](provenance-and-persistence.md) |
| [Structured model calls](structured-model-calls.md) | Centralize dispatch, pin request settings, retain untouched output before validation, check served settings, and account for spending. | [Source evidence](source-capture-and-evidence.md), [Candidate decisions](candidate-admission-and-support.md) |
| [Candidate admission and support](candidate-admission-and-support.md) | Separate discovery proposals from bounded Jev decisions, retain probabilities and uncertainty, and prevent unsupported relationships. | [Model calls](structured-model-calls.md), [Identity](identity-resolution-and-reconciliation.md) |
| [Provenance and persistence](provenance-and-persistence.md) | Preserve evidence lineage and historical assertions through transactions, retries, and projection rebuilds. | [Source evidence](source-capture-and-evidence.md), [Recovery](durable-workflows-and-recovery.md) |
| [Identity resolution and reconciliation](identity-resolution-and-reconciliation.md) | Retrieve and rerank bounded candidates, decide same/new/unresolved from complete sources, and reconcile revisions without erasing history. | [Candidate decisions](candidate-admission-and-support.md), [Persistence](provenance-and-persistence.md) |
| [Durable workflows and recovery](durable-workflows-and-recovery.md) | Keep orchestration thin, await children durably, assign one retry owner, and restore database checkpoints safely. | [Persistence](provenance-and-persistence.md), [Live verification](live-verification-and-semantic-review.md) |
| [Article projections and citations](article-projections-and-citations.md) | Calculate source-backed eligibility and quality, compose supported prose and infoboxes, and render citations, index stubs, and cross-references. | [Identity](identity-resolution-and-reconciliation.md), [Public inspection](public-interfaces-and-inspection.md) |
| [Public interfaces and inspection](public-interfaces-and-inspection.md) | Design domain ports and inspectable CLI handoffs, pagination, source views, and capability reporting; consult the retained Publican vocabulary. | [Recovery](durable-workflows-and-recovery.md), [Publication](article-projections-and-citations.md) |
| [Packaging and service readiness](packaging-and-service-readiness.md) | Build reproducible Node containers, verify extension compatibility and database isolation, and distinguish startup from usable services. | [Recovery](durable-workflows-and-recovery.md), [Live verification](live-verification-and-semantic-review.md) |
| [Live verification and semantic review](live-verification-and-semantic-review.md) | Combine meaningful tests with real service checks, independent source-to-result review, omitted-material inspection, and interruption exercises. | [Source evidence](source-capture-and-evidence.md), [Publication](article-projections-and-citations.md) |

## Ownership and use

Evidence resolution belongs to the source guide, model dispatch to the model-call guide, semantic questions to the candidate-decision guide, and durable lore storage to the persistence guide. Other guides link to those mechanisms rather than creating another implementation of them.

Each guide states its purpose, inputs and invariants, practical method, worked example, failure checks, and application to the specification. Fictional examples demonstrate mechanisms without adding campaign facts. Code labeled illustrative pseudocode explains a design boundary; it is not an adopted schema, SDK contract, transaction policy, or calibration value. Official API references support concrete examples, but deployment compatibility and live product behavior still require the checks described in the guides.

For tool-operating instructions, retain the existing [Hatchet CLI skill](../skills/hatchet-cli/HATCHET.md) and its linked references. Workflow design lives in [durable workflows and recovery](durable-workflows-and-recovery.md). The [retained Publican command contract](public-interfaces-and-inspection.md#retained-publican-command-contract) records command names, positional arguments, and flags locally; the specification governs their behavior.

Creating or checking this library verifies documentation. It does not establish application completion or live service readiness.
