# Complete-source campaign discovery prompt v2

Read the complete supplied document and propose all supported campaign-specific referents and associated discovery material. The source is authoritative campaign input: capture what it says whether a passage is fictional, quoted, imported, mistaken, uncertain, or inconsistent. Do not fact-check or reconcile source statements.

## Locked entity types

Use exactly these types:

- **Creature:** an individual being, including a player character or deity. Creature Type/Subtype describe supported identity, not temporary appearance, occupation, age, player role, or divine status.
- **Location:** a place at any scale.
- **Organization:** a group with a collective identity.
- **Item:** a significant discrete object. Apply the broad capture boundary: do not add an importance threshold beyond the source making it a specific campaign referent.
- **Event:** a happening in time. Propose one when named by the source, or when it gives multiple participants and a stated date or period; leave borderline cases visible as proposals and explain briefly.
- **Quest:** an objective the party pursues.
- **Concept:** another nameable idea, era, religion, law, tradition, or phenomenon.

Do not create an eighth type. Generic game content does not need an entity only because it is mentioned; a source-specific campaign referent can qualify even when its kind is ordinary.

## Complete capture and source fidelity

Inspect every heading, table, list, quotation, dialogue, narrative, parenthetical, and imported excerpt. Return all supported names, source-used aliases, distinct mentions, assertions, relationships, explicit dates/periods, attributions, and useful passages. Keep meaningful qualifications, exceptions, uncertainty, negative statements, alternatives, and apparent contradictions separately visible; do not compress them into one prevailing summary. A response field may refer to a source-local candidate/date key only when that target is the referent the source statement actually describes.

For categories and enumerated names, capture both the members and the category/classification the source assigns to them. Capture individually described but unnamed beings as specific Creature proposals with a short descriptive source-grounded name and notes that they are unnamed; never invent a proper name or replace an individual referent with a broad category. Capture uncertainty about kind or identity as uncertainty, not an external default.

An alias must be a name, spelling, epithet, title, or label the source uses to denote that same referent. Do not infer an alias from a follower/demonym/adherent word, creature kind, role, relationship, acronym assembled from a full name, or similar spelling alone. Keep followers and affiliated groups as source assertions or separate candidates when the source presents them as referents. Do not merge entities merely because their names, titles, or spellings resemble one another. Preserve ambiguity rather than silently linking a spelling variant to a familiar candidate.

Capture only what the source states. Never use external setting lore, game rules, web search, or another document to add, correct, classify, gender, date, attribute, or identify a candidate. Do not infer personal pronouns from a shared plural description. When a source explicitly frames imported content or gives a quoted speaker/group, retain exactly that degree of attribution; do not invent bibliographic details.

## Assertions, relations, and dates

Capture source-expressed attributes and relationships with subject/object, polarity, qualification, attribution, explicit date where applicable, and exact evidence. Do not turn co-occurrence into a relationship. Do not strengthen, weaken, or reverse the source's direction or meaning. Choose a locked predicate only if both its meaning and its subject/object type constraints fit the source statement. For a supported relation without a compatible locked predicate, leave `predicate` empty and describe the source relation in `proposed_predicate`; keep negative relations negative in assertions rather than inventing a positive edge.

Use exactly this predicate vocabulary: `located_in`, `headquartered_in`, `member_of`, `leads`, `serves`, `sponsors`, `allied_with`, `hostile_to`, `family_of`, `worships`, `possesses`, `created`, `participated_in`, `occurred_at`, `concerns`, `quest_giver_for`, `resulted_in`, `associated_with`. Inverse labels are not extracted predicates. For an `occurred_at` proposal, the subject must be an Event and the object a Location; follow the same locked type constraints for every predicate. If eventhood or a relationship is borderline, retain the source assertion/useful passage and label the proposal uncertain or qualified instead of asserting an unsupported canonical-looking edge.

Capture every explicit date and period in its original wording. Normalize only when this document supports an unambiguous value; otherwise leave `normalized_value` empty. Distinguish statement time from described time. Link an assertion to the date/period that its evidence actually describes, not merely a nearby date or another event's period. Retain relative periods such as “for years” when stated; do not convert them to an absolute date.

## Exact evidence

Every entity mention, assertion, relationship, date, and useful passage must include a quote copied exactly from the supplied source, including case, punctuation, spacing, and original line-break hyphenation. Do not normalize split words, capitalization, apostrophes, or spelling in evidence. Choose short exact quotes and add exact adjacent `before`/`after` context, including punctuation and spaces, to disambiguate repeated text. If exact wording or context cannot be copied confidently, do not invent a substitute: retain the proposal with its exact available text so validation can flag it.

Retain useful full passages for meaningful context or information not represented by candidate assertions. Include source-supported attribution and descriptive classification in the proposal or passage; do not use a long `before`/`after` anchor as a substitute for capturing the category assertion itself.

These are unaccepted proposals only. Do not make acceptance, canonical identity, truth, or rejection decisions. Return one complete-source response in the provided JSON Schema. Candidate, assertion, relationship, date, passage, and evidence keys are unique only within this response and exist solely for inspection.
