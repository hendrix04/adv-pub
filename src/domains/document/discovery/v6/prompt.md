# Complete-source campaign discovery prompt v6

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

For each paragraph, list, and table row, check separately for (1) named or unnamed referents, (2) source-stated attributes and behaviors, (3) group/category membership, (4) named happenings or other event candidates, (5) every date/period and the exact clause it dates, (6) attribution/import framing, and (7) useful context not captured elsewhere. Complete this sweep before composing the final JSON. Do not stop after finding the main narrative or after reaching a familiar lore explanation.

For categories and enumerated names, capture both the members and the category/classification the source assigns to them, including explicit membership/serving relationships where supported. Capture individually described but unnamed beings as specific Creature proposals with a short descriptive source-grounded name and notes that they are unnamed; never invent a proper name or replace an individual referent with a broad category. Capture uncertainty about kind or identity as uncertainty, not an external default. Capture source-described types and behaviors for every named class, including minority or additional classes, and every concrete example in a list of worshippers, followers, or affiliated beings.

For every multi-row table, count all named referents before returning and check that each row's specific named referent has one corresponding entity candidate and its row attributes/associations remain represented. Do not stop after capturing only the first rows, rows used in assertions, or a passage containing the table. A named race or species is a category; do not label that collective as an individual Creature. Use Concept for a nameable kind/category, Organization only when a group with collective identity is stated, and preserve ambiguity if the source does not establish which kind applies. Do not duplicate the category as if it were an individual member.

An alias must be a name, spelling, epithet, title, or label the source uses to denote that same referent. Do not infer an alias from a follower/demonym/adherent word, creature kind, role, relationship, acronym assembled from a full name, or similar spelling alone. Keep followers and affiliated groups as source assertions or separate candidates when the source presents them as referents. Do not merge entities merely because their names, titles, or spellings resemble one another. Preserve ambiguity rather than silently linking a spelling variant to a familiar candidate.

Do not use a broad group label as an alias for a narrower subset when the document also uses that broad label for other beings or groups. Keep labels distinct when scope differs, even if the passage elsewhere says one subset is “the only” referent entitled to a special title.

Use an alias only when the source directly identifies the labels as names for the same referent (for example, explicit “aka,” “also called,” or “X (née Y)” wording). A parenthetical list of multiple names, examples, works, or portrayals without a direct identity statement is not enough to make every item an alias. Preserve such material as attributed/qualified source assertions or passages. When the text explicitly uses “aka” or “née,” capture that identity statement and do not also make a disconnected candidate for the former/alternate name unless another passage clearly presents a distinct referent.

Capture only what the source states. Never use external setting lore, game rules, web search, or another document to add, correct, classify, gender, date, attribute, or identify a candidate. Do not infer personal pronouns from a shared plural description. When a source explicitly frames imported content or gives a quoted speaker/group, retain exactly that degree of attribution; do not invent bibliographic details.

## Assertions, relations, and dates

Capture source-expressed attributes and relationships with subject/object, polarity, qualification, attribution, explicit date where applicable, and exact evidence. Do not turn co-occurrence into a relationship. Do not strengthen, weaken, or reverse the source's direction or meaning. Choose a locked predicate only if both its meaning and its subject/object type constraints fit the source statement. For a supported relation without a compatible locked predicate, leave `predicate` empty and describe the source relation in `proposed_predicate`; keep negative relations negative in assertions rather than inventing a positive edge.

Use exactly this predicate vocabulary: `located_in`, `headquartered_in`, `member_of`, `leads`, `serves`, `sponsors`, `allied_with`, `hostile_to`, `family_of`, `worships`, `possesses`, `created`, `participated_in`, `occurred_at`, `concerns`, `quest_giver_for`, `resulted_in`, `associated_with`. Inverse labels are not extracted predicates. For an `occurred_at` proposal, the subject must be an Event and the object a Location; follow the same locked type constraints for every predicate. If eventhood or a relationship is borderline, retain the source assertion/useful passage and label the proposal uncertain or qualified instead of asserting an unsupported canonical-looking edge.

Capture every explicit date and period in its original wording. Normalize only when this document supports an unambiguous value; otherwise leave `normalized_value` empty. Distinguish statement time from described time. Link an assertion to the date/period that its evidence actually describes, not merely a nearby date or another event's period. The grammatical subject of a relative clause, date, or time phrase controls what it describes; never transfer that fact to a nearby named referent. Do not add a location, timeframe, or circumstance absent from the evidence. Retain relative periods such as “for years” only when those exact words occur; do not change “have spent years” into “for years” or convert it to an absolute date.

Dates and periods are not Locations. Keep “prehistory,” “eons ago,” and similar time phrases in `explicit_dates`; do not create an entity candidate for them unless the source explicitly presents a named era/concept as a distinct referent.

An assertion's `polarity` represents whether the stated property/relation holds; do not encode the same negation both in a `does_not_*` predicate and negative polarity. For wording such as “the Dogma does not prohibit X,” record the source-level absence of prohibition once, with a source-faithful predicate/attribute and polarity. Do not transform it into “X is prohibited.” Attach a date key only to the event/fact that date evidence describes; do not attach an unrelated date to a classification assertion merely because both appear in one paragraph.

When one paragraph names multiple events or beings, bind each attribute, action, and time phrase to the source's actual grammatical subject. Do not use a later sentence's narrower group label as a substitute for an earlier broader group label. If the source's subject or referent is ambiguous, preserve that ambiguity in qualification and avoid a definite candidate link.

## Referential identity and relation direction checks

Keep an entity separate from another referent that merely names, impersonates, serves, descends from, or is compared with it. A different being “posing as” a named person is a distinct Creature proposal; the mask/name is not an alias for the being. A source-specific place phrase such as a named or capitalized dimension/space is a Location proposal when the text uses it as where a being lives or an event occurs. A named happening remains an Event candidate even when its occurrence is counterfactual or hypothetical; preserve that modality in its assertion.

Preserve grammatical relation direction. For example, “X is the spawn of Y” states Y as progenitor/source and X as spawn; it does not say X created Y. Likewise, a creature that “preyed upon humanity” supplies the action, but do not invent a location. If an object is a generic collective such as “humanity” and no compatible candidate/type exists under the locked relationship vocabulary, leave `predicate` empty, leave the object key empty, and retain the source wording in `proposed_predicate` or an assertion. Never select `hostile_to` merely because a source describes attack or predation when its type constraints do not fit.

Resolve repeated descriptions and pronouns to the entity the source actually names. Do not assign an attribute to a later named place or person when the source's phrase (“the city”, “she”, “they”) refers to an earlier grammatical antecedent. Do not transfer a place's actions or history to a nearby distinct place with a similar role, and do not treat adjacent mention as evidence of identity. If more than one antecedent is plausible, keep the assertion unlinked or explicitly uncertain.

An assertion cannot simultaneously make a definite positive subject/object claim and say in its own qualification that the source does not support that subject/object. If the evidence identifies one referent but the candidate link is uncertain, remove the definite candidate key/name or mark the assertion uncertain and explain the ambiguity. Never append a disclaimer that contradicts the claim while retaining its unsupported positive link.

For each noun phrase describing a specific unnamed individual, propose that individual separately from any named identity, species, class, or collective category. Preserve the exact grounds for its uncertainty. Recheck all named happenings, places, dimensions, impersonators, and individually described unnamed beings during the final source sweep.

For the final passage sweep, ensure the candidate view preserves both the source's complete identity/naming rule and its practical consequence, and any instruction about how a future character/group acquires a relationship or patron. If those details are not represented by assertions, retain their complete exact source passages; do not let coverage of adjacent paragraphs stand in for them.

## Exact evidence

Every entity mention, assertion, relationship, date, and useful passage must include a quote copied exactly from the supplied source, including case, punctuation, spacing, and original line-break hyphenation. Do not normalize split words, capitalization, apostrophes, or spelling in evidence. Choose short exact quotes and add exact adjacent `before`/`after` context, including punctuation and spaces, to disambiguate repeated text. If exact wording or context cannot be copied confidently, do not invent a substitute: retain the proposal with its exact available text so validation can flag it.

Copy evidence literally: do not replace a pronoun with its antecedent, insert a subject, repair spelling, collapse a hyphenated line break, skip a table-row newline, or alter punctuation in the anchor. A quote such as “She was” is not evidence for source wording “Pherria Jynks was.” Keep the source's actual text even when the paraphrased claim is accurate.

Retain useful full passages for meaningful context or information not represented by candidate assertions. Include source-supported attribution and descriptive classification in the proposal or passage; do not use a long `before`/`after` anchor as a substitute for capturing the category assertion itself. Before returning, compare every quote and its anchors against the supplied bytes. Do not repair a quote from memory or normalize it.

These are unaccepted proposals only. Do not make acceptance, canonical identity, truth, or rejection decisions. Return one complete-source response in the provided JSON Schema. Candidate, assertion, relationship, date, passage, and evidence keys are unique only within this response and exist solely for inspection.

Before returning, reconcile every nonempty `subject_candidate_key`, `object_candidate_key`, and `explicit_date_key` against the exact key defined in its corresponding candidate/date proposal. The key and cited target name/type must describe the same source referent, not simply a nearby row, same-position item, or similar string. If you cannot establish that match, leave the key empty and keep the source name/text and uncertainty visible. Do not invent a candidate key or re-use one for a different member. Count the actual candidates and verify the highest keys exist; key numbering must not imply candidates missing from the `entities` array.

Copy quoted smart/curly punctuation exactly as it appears in the supplied source. Do not substitute straight quotes for curly quotes, or vice versa, even when spelling evidence otherwise matches.
