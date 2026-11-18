# Complete-source campaign discovery prompt v16

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

Use a locked relationship only when both the source meaning and the ontology's endpoint types fit. A named table grouping or collective body can be an Organization when the source presents it as a group with collective identity; a named Pantheon/table as an institutional collective should be proposed as Organization before using `member_of`. Do not assert `member_of` with a Concept, Creature, place, doctrine, species/category, or generic target; leave the locked predicate empty and retain the source wording as a proposed relation. “Respects” does not imply “serves,” and a source column “Patron Of” does not automatically mean `serves` under the locked vocabulary. Preserve “Patron Of” as `proposed_predicate` unless its subject/object types and meaning genuinely match a locked predicate.

Capture every explicit date and period in its original wording. Normalize only when this document supports an unambiguous value; otherwise leave `normalized_value` empty. Distinguish statement time from described time. Link an assertion to the date/period that its evidence actually describes, not merely a nearby date or another event's period. The grammatical subject of a relative clause, date, or time phrase controls what it describes; never transfer that fact to a nearby named referent. Do not add a location, timeframe, or circumstance absent from the evidence. Retain relative periods such as “for years” only when those exact words occur; do not change “have spent years” into “for years” or convert it to an absolute date.

Dates and periods are not Locations. Keep “prehistory,” “eons ago,” and similar time phrases in `explicit_dates`; do not create an entity candidate for them unless the source explicitly presents a named era/concept as a distinct referent.

An assertion's `polarity` represents whether the stated property/relation holds. Keep the property label affirmative and use `polarity` for negation: for “the Dogma does not prohibit veneration,” use subject Dogma, `predicate_or_attribute` “prohibit veneration,” and negative polarity. Do not put “does not” in the predicate, and do not transform the sentence into “veneration is prohibited.” If the source also states a separate affirmative fact, use a distinct assertion. Attach a date key only to the event/fact that date evidence describes; do not attach an unrelated date to a classification assertion merely because both appear in one paragraph.

When a modifier or relative clause names a person/group that escapes, creates, or participates in an event, attach the action/date only to that grammatical subject. Do not infer the offspring's escape from an ancestor's relative clause, or use the ancestor as a proxy for its collective descendants. If the clause subject and the named category differ, keep separate assertions and link only the supported referent.

When one paragraph names multiple events or beings, bind each attribute, action, and time phrase to the source's actual grammatical subject. Do not use a later sentence's narrower group label as a substitute for an earlier broader group label. If the source's subject or referent is ambiguous, preserve that ambiguity in qualification and avoid a definite candidate link.

## Referential identity and relation direction checks

Keep an entity separate from another referent that merely names, impersonates, serves, descends from, or is compared with it. A different being “posing as” a named person is a distinct Creature proposal; the mask/name is not an alias for the being. A source-specific place phrase such as a named or capitalized dimension/space is a Location proposal when the text uses it as where a being lives or an event occurs. A named happening remains an Event candidate even when its occurrence is counterfactual or hypothetical; preserve that modality in its assertion.

Preserve grammatical relation direction. For example, “X is the spawn of Y” states Y as progenitor/source and X as spawn; it does not say X created Y. Likewise, a creature that “preyed upon humanity” supplies the action, but do not invent a location. If an object is a generic collective such as “humanity” and no compatible candidate/type exists under the locked relationship vocabulary, leave `predicate` empty, leave the object key empty, and retain the source wording in `proposed_predicate` or an assertion. Never select `hostile_to` merely because a source describes attack or predation when its type constraints do not fit.

Resolve repeated descriptions and pronouns to the entity the source actually names. Do not assign an attribute to a later named place or person when the source's phrase (“the city”, “she”, “they”) refers to an earlier grammatical antecedent. Do not transfer a place's actions or history to a nearby distinct place with a similar role, and do not treat adjacent mention as evidence of identity. If more than one antecedent is plausible, keep the assertion unlinked or explicitly uncertain.

An assertion cannot simultaneously make a definite positive subject/object claim and say in its own qualification that the source does not support that subject/object. If the evidence identifies one referent but the candidate link is uncertain, remove the definite candidate key/name or mark the assertion uncertain and explain the ambiguity. Never append a disclaimer that contradicts the claim while retaining its unsupported positive link.

For each noun phrase describing a specific unnamed individual, propose that individual separately from any named identity, species, class, or collective category. Preserve the exact grounds for its uncertainty. Recheck all named happenings, places, dimensions, impersonators, and individually described unnamed beings during the final source sweep.

For the final passage sweep, ensure the candidate view preserves both the source's complete identity/naming rule and its practical consequence, and any instruction about how a future character/group acquires a relationship or patron. If those details are not represented by assertions, retain their complete exact source passages; do not let coverage of adjacent paragraphs stand in for them.

Named event nouns such as a “Fall,” “purge,” “emergence,” or other source-named happening are Event proposals even when described in a date phrase or counterfactual sentence. Keep the occurrence, cause, participants, and location separate and preserve whether it happened, was hypothetical, or remains uncertain. A specific singular unnamed being that participates in an event or generation relationship needs its own Creature proposal even when a category/species concept is also present.

Places remain Locations when the source uses them as the place where someone lives, is held, or travels, even if they also have religious/mythic associations (“the Hells”, “Interdimensional space”). Do not type a plural group of holdouts, adherents, or followers as an individual Creature. Use Organization only if collective identity is stated; otherwise retain a Concept/grouping proposal or an unlinked assertion as appropriate.

Do not attach a generic statement about “a God” to one named deity unless the source names that deity as its subject. When the assertion text or its qualification admits that the source does not single out a candidate, remove that definite candidate key/name. A sentence fragment that leaves the actor in a trading, serving, or other relation unstated must remain unlinked; do not turn an adjacent entity or the object of a disguise into a participant.

For this source sweep, explicitly verify all 17 named deity rows in the Official Pantheon table: each source-named deity is an entity candidate, its table attributes are present, and every nonempty reference points to the candidate with the exact same name. Do not reference a missing later-numbered key. Preserve a whole table passage in addition to, not instead of, member candidates and supported row assertions.

## Exact evidence

Every entity mention, assertion, relationship, date, and useful passage must include a quote copied exactly from the supplied source, including case, punctuation, spacing, and original line-break hyphenation. Do not normalize split words, capitalization, apostrophes, or spelling in evidence. Choose short exact quotes and add exact adjacent `before`/`after` context, including punctuation and spaces, to disambiguate repeated text. If exact wording or context cannot be copied confidently, do not invent a substitute: retain the proposal with its exact available text so validation can flag it.

Copy evidence literally: do not replace a pronoun with its antecedent, insert a subject, repair spelling, collapse a hyphenated line break, skip a table-row newline, or alter punctuation in the anchor. A quote such as “She was” is not evidence for source wording “Pherria Jynks was.” Keep the source's actual text even when the paraphrased claim is accurate.

Retain useful full passages for meaningful context or information not represented by candidate assertions. Include source-supported attribution and descriptive classification in the proposal or passage; do not use a long `before`/`after` anchor as a substitute for capturing the category assertion itself. Before returning, compare every quote and its anchors against the supplied bytes. Do not repair a quote from memory or normalize it.

These are unaccepted proposals only. Do not make acceptance, canonical identity, truth, or rejection decisions. Return one complete-source response in the provided JSON Schema. Candidate, assertion, relationship, date, passage, and evidence keys are unique only within this response and exist solely for inspection.

Before returning, reconcile every nonempty `subject_candidate_key`, `object_candidate_key`, and `explicit_date_key` against the exact key defined in its corresponding candidate/date proposal. The key and cited target name/type must describe the same source referent, not simply a nearby row, same-position item, or similar string. If you cannot establish that match, leave the key empty and keep the source name/text and uncertainty visible. Do not invent a candidate key or re-use one for a different member. Count the actual candidates and verify the highest keys exist; key numbering must not imply candidates missing from the `entities` array.

Copy quoted smart/curly punctuation exactly as it appears in the supplied source. Do not substitute straight quotes for curly quotes, or vice versa, even when spelling evidence otherwise matches. Evidence quotes and before/after anchors must be copied from the exact source characters adjacent to the quote. If adjacency is uncertain, leave the anchor empty; do not paraphrase it. For repeated text, choose a longer exact contiguous quote that distinguishes the correct occurrence. Do not invent context after unique table rows or omit original spaces/newlines.

If the source paragraph's own qualification says a named candidate is not the referent of “the city”, “the church”, or another descriptive phrase, do not retain a definite positive key/name for that candidate. Prefer the nearest explicit grammatical antecedent in the same paragraph; do not jump to a later place mentioned in a separate or counterfactual sentence. Preserve ambiguity when the source conflicts.

Preserve exact scope in containment claims. “Earth's universe” is the source's stated object; it does not mean Earth itself. Do not add Earth as another object or claim it is contained unless the source says so directly.

A singular unnamed actor in a concrete hypothetical campaign example can be an unnamed Creature proposal when the source describes that individual doing a specific action (for example, an unnamed Cleric in a place petitioning a named being). Preserve the hypothetical qualification; do not claim the event occurred. Generic plural occupations/classes remain generic categories.

Keep a restricted formal name distinct from a broad category when the document gives them different scopes. If “Gods of the Realms” denotes only Pantheon members elsewhere while another assertion says “all the Gods,” do not link both phrases to a broad Gods candidate.

Capture every stated qualitative period (for example, “in times of upheaval” and “in more mundane eras”) in `explicit_dates` with original wording and no invented normalized value. For hypothetical narratives with named participants and time, propose the named happening as an Event with its hypothetical modality.

## Review-driven full-source checks

Review every named place in narrative text, including headings and parenthetical examples; do not rely only on the main story or tables. A place explicitly named as a cathedral, church, city, plane, or other location is a Location candidate when the source treats it as a place, even if it appears only once. Before returning, perform a separate sweep for named locations not already present in the candidate list.

When a source explicitly gives a former name in a parenthetical, preserve it as an alias for the same referent (for example, a form like “Apollo (née Lathander)”). Do not miss the identity relation because the alternate name appears only once. Keep a separate former-name candidate only if the source also presents it as a distinct referent elsewhere.

Do not attach a nearby demon list, quotation, or imported example to a named demon unless the grammar identifies that demon as the subject or referent. Names in a comparison, aside, list, or quotation remain separate unless the text directly establishes identity. Check every mention before adding it to an existing candidate; a familiar nearby name is not an identity link.

Represent negation once. Do not encode “does not X” in the predicate text and again in `negative` polarity. Use the affirmative property/relation label in `predicate_or_attribute` and use `negative` polarity to represent the source's negation; never convert it to an affirmative opposite.

A sentence fragment with an omitted actor stays unlinked. Do not invent “some people,” a group, or a named adjacent entity as the subject of a fragment merely because that makes the sentence complete. Preserve the fragment as an unlinked assertion or useful passage with its exact evidence.

Type a universe or dimension as a Location when it is a spatial container or the place where something exists or lives. Do not classify a spatial universe as a Concept simply because it is cosmological. Preserve the source's exact containment scope: an entity said to be within Earth's universe is not thereby within Earth.

Before returning, read each relationship as a sentence in subject-to-object order and compare it to the source grammar. The candidate in `subject_candidate_key` must be the grammatical subject and the candidate in `object_candidate_key` the grammatical object. Do not reverse an adoption, service, worship, creation, or other directed relation to fit a familiar phrasing. If the source direction or endpoint is uncertain, leave keys empty as needed and preserve the wording in `proposed_predicate` or an assertion.

A useful-passage quote must be one contiguous source span. Do not concatenate distant paragraphs or skip intervening source text to create one quote. Split distinct source spans into separate passages. Preserve original line-break hyphenation (`be-ings`, `en-compasses`, `any-thing`) and punctuation literally; do not quote repaired words or substitute smart quotes.

Use the exact source characters when copying quotes and their anchors. Source lines may visually wrap; do not invent a newline at a display wrap, normalize a hyphenated line break, add or remove a trailing space, or repair punctuation in `before`/`after`. Leave both anchors empty by default. Add one only when you can copy the immediately adjacent source characters exactly and without repeating any part of the quote. If a short quote repeats, use a longer contiguous quote that is unique; otherwise retain the ambiguous finding with empty anchors.

For an alias assertion, cite the source span that directly identifies the two labels as names for the same entity. A phrase such as “aka Lathanderan sailors” describes sailors; it is not evidence that the deity Lathander is another name for Apollo. Do not use an alias relationship asserted in one context as evidence for a distinct referent's identity.

When a plural or demonstrative phrase (“such beings,” “they,” “these”) refers back to more than one type or group, preserve the full antecedent scope. Do not narrow the claim to the nearest named subgroup unless grammar does so. If the antecedent set is ambiguous, leave the entity key empty and keep the source's broader wording.

Do not use a specific candidate key for an ambiguous place/person/group while simultaneously qualifying that the source does not establish that identity. Remove the key and name, or retain an explicitly unresolved source phrase and mark the assertion uncertain. The same rule applies to entity notes.

When the source states that an individual was spawned, created, or descended from “one” unnamed member of a named category, represent that single unnamed individual separately when the text gives it an individual action or description. Link the relationship to the specific unnamed individual proposal, not to the broader category.

Treat each named happening as a candidate even when it is framed as a question or hypothetical example; preserve that modality. During the final scan, check for named festivals, ceremonies, discussions, or other happenings outside the primary narrative and include their exact qualified mention.

## Coverage and consistency reconciliation

Capture both the source's main proposition and each distinct explanation, exception, qualification, or consequence that materially changes its meaning. A quoted or contextual explanation is still source material: preserve its attribution and represent it as an assertion or a separate useful passage even when another assertion covers the surrounding topic. Before returning, walk from the first source byte to the last and confirm each meaning-bearing paragraph, quotation, and table row has its distinct supported information represented; never omit it because it seems repetitive, secondary, fragmentary, or inconvenient to fit the schema.

Do not create a second entity for a referent already represented. When the same source name appears again, add its mention to the existing candidate unless the source itself establishes a distinct referent. A spelling variant or second contextual description alone does not establish a second entity. Do not merge separately named referents solely because they resemble one another.

For assertions, `predicate_or_attribute` names the property/relation without grammatical negation and `polarity` carries whether that property holds. Use the affirmative property label without a “not” prefix; for source wording “X does not prohibit Y,” use the property label `prohibit veneration` and `negative` polarity. Do not write `does not prohibit veneration` as the predicate and also mark the polarity negative. If the same sentence also states an affirmative fact, split it into a separate assertion so each assertion has one polarity.

A grammatical fragment with no recoverable actor remains an unlinked assertion or useful passage. Preserve any source-stated action and object text, but leave the subject key/name empty and mark the assertion uncertain; do not drop the fragment or supply an actor from nearby context.

Reconcile every candidate-key object with its displayed source text: when `subject_candidate_key` is nonempty, `subject_name` must name that candidate or one of its explicit source aliases; when `object_candidate_key` is nonempty, `object_text` must identify that candidate or one of its explicit source aliases. If the text describes a different object, leave the key empty and preserve the source wording. Apply the same exact-key check to relationship subject/object fields.

When a candidate key is present, use the exact candidate name or exact source alias in `subject_name` or `object_text`. Put articles, broader descriptions, and claim details in qualification or attribution while retaining the exact source wording in the evidence. Do not put a category, object, or explanatory clause in the keyed label field.

Do not assign ordinal numbers to a type, subclass, or category unless the source explicitly numbers it. If the source calls something a subclass of messenger and servant demons, preserve those words; do not rename it “first-type.” When the source names a discrete reference resource, page, or discussion thread and assigns it a campaign function, capture the named resource as an Item proposal and preserve its stated authority/function. Do not fetch the resource or add any external lore.

Keep exact-span failures and ambiguous anchors visible in the validation findings. They do not authorize changing a quote, adding adjacent words that are not contiguous, or silently removing the proposal. Use the complete exact passage as a new evidence quote when the short span or its anchors cannot uniquely identify the correct source occurrence.

## Final type and attribution checks

A named being described as a member of a creature class is an individual Creature, not a Concept. The class itself may be a Concept; every individually named member remains a separate Creature proposal. Capture every explicitly named example in a category's membership list and preserve the member/category assertion or relationship. Do not downgrade a named individual to Concept just because the sentence classifies it as a demon, servant, messenger, or other kind.

Use the source's described referent to choose the type, and reconcile that type with the candidate's own notes. If its notes say it is a Location, its entity_type must be Location. A named spatial container is a Location candidate even when it is called a universe, dimension, or multiverse; include its explicit containment/location relationship only at the exact scope stated by the source.

If notes describe a place, the type is Location; if they describe a happening, the type is Event. Apply this check to every candidate before returning, including notes written as uncertainty or a rationale rather than a direct type definition.

Bind every assertion to the grammatical source of the stance. If the source says “the Church insists that the Pantheon be respected,” the Church is the subject of the insisting, while the Pantheon is the object of the respect claim. Do not assign a speaker's or institution's position to a related doctrine merely because the doctrine is discussed nearby. Keep the stance attribution explicit.

When a singular member of a category performs an action in a relative clause, link the action and any date to that individual, not to the category. For example, in wording shaped like “one of the Elder Gods who escaped,” the escaped being is one unnamed individual; it is not the full Elder Gods category. If the payload includes both the category and the individual proposal, use the individual key for the action/relationship and preserve the category membership separately.

Compare candidates with the same formal name and scope before returning. A category may be represented once even if its full title appears in a table and narrative. Reuse its existing response-local key and add the additional mention; do not create a second candidate for the same formal group. Keep same-looking names separate only when the source establishes distinct referents or scope.

Do not create a Concept candidate for an organization already proposed as that same campaign body. A phrase naming the organization's broader theological subject is not a second Concept unless the source treats it as a distinct idea.

An evidence quote must be a contiguous, exact substring of the source bytes. Do not add a leading or trailing space to a quote unless that space is part of the exact copied substring. When exact text repeats and no exact adjacent anchors distinguish it, leave the ambiguity finding visible rather than altering the quote.

Retain missing and ambiguous evidence findings without repairing the response. They remain visible to the reviewer, and an unresolved source pointer does not prevent inspection of the original proposal.

A named plane or hell used as a place of captivity or residence is a Location, even when it also has religious or cosmological meaning. Keep a nameable doctrine or category as a Concept separately from the place itself.

Do not turn two co-subjects of one clause into a relation with each other. If the source says “X and Y derive from Z,” link both X-to-Z and Y-to-Z only where supported; do not create X-to-Y.

Use a locked relationship only when the exact endpoint types are allowed by its contract, in addition to matching the source meaning and direction. A proposed `serves` relation with a Concept subject or object is invalid; leave the locked predicate empty and preserve the source wording or assertion instead.

A named happening has one candidate key even when the source refers to it by two descriptions. Compare event names, descriptions, dates, participants, and source passage before adding another Event proposal; use a second key only when the source establishes a distinct happening.

Do not attach an attribution to a quote about a different city or event. Follow the exact quotation's speaker and grammatical subject, and keep a neighboring city's history separate when the text has not identified those cities as the same place.

Keep an unsupported spelling variant visible as its own ambiguous proposal when the source uses it as a name and does not establish whether it is the same referent as another spelling. Do not omit a source-used proper name merely because a similar table spelling already has a candidate.

If a candidate's notes say the source does not establish that a similarly spelled name is the same referent, do not attach that variant's mention to the candidate anyway. Keep the source-used variant as a separate, explicitly uncertain proposal unless the source directly links the names.

A date phrase that names an event already in the candidate list is not a second Concept entity. Keep the named happening as one Event candidate and attach the date/period to that event only when the wording supports it. Do not create an entity solely to hold a time phrase.

Do not add a comparison or ranking that the source does not state. Preserve the actual comparison set and direction in the sentence; do not change “X is commensurate with Y” into “X is more powerful than lesser Gods” or another inferred ranking.

Do not add a comparison target absent from the source wording.

Populate `attribution` whenever the source identifies who spoke, wrote, imported, or holds a view. Keep each named source or speaker attached only to the claims the text attributes to them. For example, if a paragraph says “Theologists pronounced…” and later “In the Church's view…,” attribute those distinct claims to Theologists and the Church respectively; do not transfer either stance to a nearby doctrine or institution by inference.

Populate attribution when a quotation or imported excerpt names its speaker or source.

When a passage introduces a policy explanation with wording such as “In the Church's view,” preserve that view's actual supporting claim as an assertion or exact useful passage, including its stated worship qualification and possible consequence. Do not preserve only the paragraph's earlier classification statement.

For claims about counterfactual prevention, the named happening in the phrase “would have prevented the [Event]” is the object of the prevention claim. Do not assign that outcome to a nearby nation, city, or participant. Preserve hypothetical modality and attribution.

A counterfactual prevention claim about a named event has that Event as its object.

If a qualification says an assertion is unlinked, ambiguous, or not established by the source, its candidate keys and definite subject/object names must be empty. Do not convert missing evidence into a negative claim that a relationship or containment does not exist. Use an unlinked uncertain assertion or a useful passage.

A qualification saying a link is unresolved requires the candidate key to be empty.

When one sentence coordinates a negative property with positive properties (for example, “the number is not fixed; beings can die and ascend”), split these into distinct assertions with their own subjects, affirmative property labels, and polarities. Do not assign one polarity to a compound statement that contains both positive and negative facts.

Capture every source-named individual in imported or attributed parenthetical lists as its own proposal when the source presents it as a referent. Preserve the list and its framing as imported text; do not convert parenthetical names into aliases unless the source explicitly equates them.

Capture each proper name in an imported parenthetical list as a proposal when the source presents that name as a referent.

Include a named setting/place when the source uses it as the locale for a historical or divine claim, even when it appears only as a generic-looking plural name such as “the Realms.” Use the existing locked Location definition and retain the source's exact scope.

Capture each explicit relative or qualitative period separately, including words such as “soon,” “spent years,” “since that point,” “midnight,” and “at some point.” Preserve the original phrase in `explicit_dates`; do not invent an absolute normalization. A clock-time or relative-period word does not become a new entity unless the source names a distinct time-period referent.

Do not attach an earlier date to a later clause merely because it follows in the paragraph. Associate a date with only the clause/event it explicitly dates; a sentence that says an organization was consecrated in a year and “soon” spread supplies separate time statements unless the source directly dates the spread to that year.

Do not infer a relation between two deities from an adherent name or offering passage. “Apolloite sailors” names the sailors, not Apollo as the actor; sailors offering to Thor does not by itself state a Thor–Apollo relation. Do not convert co-occurrence, shared context, or a demonym into an entity-to-entity edge.

A name of an adherent or follower is not an alias for the deity or organization. Create an alias only when the source explicitly identifies the labels as names for the same referent; a demonym or affiliation word does not meet that test.

If notes say that two labels are not established as identical, neither may be listed as an alias of the other. Reconcile aliases, mentions, and notes before returning; an explicit uncertainty in notes must not be contradicted by a definite alias or candidate link.

Split an assertion when its clauses state both an affirmative property and its negation. For example, “worshiper count was a factor but was not defining” requires a positive factor assertion and a separate negative defining-characteristic assertion. Each assertion has one polarity and one source-faithful property label.

For nested relative clauses, resolve each clause's grammatical subject independently. In wording like “N'Garal are spawn of one Elder God who escaped a purge,” the spawn relation links N'Garal to one specific unnamed Elder God, and the escape links that individual to the purge; neither action belongs to the broader Elder Gods category.

Do not attach a quote about an action to a nearby place unless the source says the action occurred there. “Preyed upon humanity in prehistory” gives no Earth location; do not link its Creature to Earth merely because Earth appears elsewhere in the paragraph.

For a sentence fragment with omitted actors, preserve only the source-stated relation and keep its unknown subject and named target separate. Do not claim that a named impostor or mask was a participant merely because another demon is described as posing as it.

## Final referent and type reconciliation

Before returning, reconcile every entity candidate against all mentions and aliases. Merge repeated candidate rows only when the source establishes they are the same referent; do not create a second candidate for the same referent merely because one appearance is in a table and another is in narrative. Conversely, keep distinct beings separate when the source gives distinct names or identity statements. After reconciliation, update every key reference to the single candidate and check that its name and type match the source.

A source heading, grammatical possessive, nearby mention, or table placement does not by itself establish group membership. A possessive heading may give context without stating that its subject belongs to the named organization. Propose `member_of` only when the source text explicitly states membership and both endpoints meet the locked predicate's type requirements; otherwise retain the exact wording as an assertion or passage.

Do not attach a particular individual to a broad class/category when the wording identifies a specific member or says “one of” that class. For N'Garal, the progenitor is one unnamed Elder God, not the plural Elder Gods category; link the progenitor claim only to the specific unnamed-individual proposal when the sentence supports it. Keep that individual's escape from the purge on the same individual, not on the category.

For every negated proposition, name the affirmative property being negated and encode negation once in `polarity`. For example, “the Dogma does not prohibit veneration” is a negative-polarity assertion about “prohibit veneration”; it is not a positive assertion that veneration is respected or permitted. Do not infer an affirmative implication from a prohibition's absence.

Use a locked relationship predicate only if its source meaning and both endpoint types satisfy the locked contract. A relationship involving an Event cannot use `concerns` unless the relevant endpoint types are allowed by the ontology; retain a source-faithful assertion with empty candidate links and an explanatory `proposed_predicate` when no locked predicate fits. Do not preserve a semantically incompatible edge merely because the schema accepts its vocabulary string.
