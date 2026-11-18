# Complete-source campaign discovery prompt v1

Read the complete supplied document and propose all supported campaign-specific referents and associated discovery material. The source is authoritative campaign input: capture what it says regardless of whether a passage is fictional, quoted, imported, mistaken, uncertain, or inconsistent. Do not fact-check it.

## Locked entity types

Use exactly these types:

- **Creature:** an individual being, including a player character or deity. Creature Type/Subtype describe supported identity, not temporary appearance, occupation, age, player role, or divine status.
- **Location:** a place at any scale.
- **Organization:** a group with a collective identity.
- **Item:** a significant discrete object. Apply the broad capture boundary: do not require a special importance threshold beyond the source making it a specific campaign referent.
- **Event:** a happening in time. Propose one when the source names it, or when it gives multiple participants and a stated date or period; leave borderline cases visible as proposals and explain briefly.
- **Quest:** an objective the party pursues.
- **Concept:** another nameable idea, era, religion, law, tradition, or phenomenon.

Generic game content does not require a standalone entity merely because it is mentioned. A specific campaign person, place, group, object, happening, objective, or idea can qualify even when its kind is ordinary. Do not add an eighth type or invent a significance filter.

## Capture instructions

Inspect the whole document: headings, tables, lists, quotations, dialogue, and narrative all carry context. Capture potential entity names, source-used aliases, and distinct mentions. Do not merge referents just because names or titles match. Preserve uncertainty about identification in notes.

Capture source-expressed assertions, including attributes and relationships, with subject/object, polarity, qualification, attribution, and explicit dates where present. Keep negative statements negative. Co-occurrence is not a relationship. Use a relationship predicate only from the locked project vocabulary when the source supports its meaning and direction. When a supported relationship has no permitted predicate, leave `predicate` empty and put the source-described relation in `proposed_predicate`; do not invent a predicate. These are proposals only.

The complete permitted predicate vocabulary is `located_in`, `headquartered_in`, `member_of`, `leads`, `serves`, `sponsors`, `allied_with`, `hostile_to`, `family_of`, `worships`, `possesses`, `created`, `participated_in`, `occurred_at`, `concerns`, `quest_giver_for`, `resulted_in`, and `associated_with`. Inverse labels are not extracted predicates.

For individual Creatures, inspect source-stated names and identity, kind/subtype, ancestry, origin, age or life stage, appearance and forms, life state, occupation or role, titles, duties, PC role, home/travel, affiliations, faith, family, patrons, possessions, characteristics, abilities, weaknesses, goals, temperament, choices, deeds, and change over time. Include source-stated divine status, portfolio, symbol, worshipers, or manifestations. Capture only details the source states; never infer defaults or convert temporary appearance into identity. Capture source-stated location, organization, item, event, quest, and concept details as assertions too, without inventing extra entity types or fields.

Capture explicit source dates and periods in their original wording. Normalize only when the document itself supports an unambiguous value; otherwise leave `normalized_value` empty. Distinguish the time of a statement from the time it describes. Keep attribution when the source attributes a statement to a speaker or group.

Retain useful source passages for meaningful context, narrative, or information not represented by a candidate assertion. Every proposed mention, assertion, relationship, date, and passage must carry evidence copied exactly from the supplied source. Add `before` and `after` context that disambiguates repeated quotes when possible. Never invent a quote, anchor, name, alias, date, attribution, relationship, fact, or interpretation to complete the schema. An unresolved quote can still be returned exactly as proposed for later findings.

Do not use external setting lore, rules knowledge, web search, or other documents to add or correct candidates. Do not make acceptance, canonical identity, or truth decisions. Return one complete-source response in the provided JSON Schema. Candidate keys and evidence keys are unique only within this response and are references for inspection, not durable identities.
