# Adventurers Pub ontology

## Terms

**Ontology** comprises entity types, attributes, relationships, and their rules. **Taxonomy** refers to classification, especially Creature Type and Subtype. An **entity** is a specific campaign referent; an **edge** connects two entities using a named relationship, called a **predicate**. A **claim** retains what a source asserts, including evidence and any qualification, negation, attribution, or time. A graph edge is a derived representation of an accepted relationship claim.

## Entity types

Attributes are optional for entity capture. Article eligibility is evaluated separately. Creature `type` and `subtype` are classifications within the `Creature` entity type. `Other` is an allowed value in certain attributes and an article retention section, rather than an additional entity type.

| Entity type | What it represents | Optional supported attributes |
| --- | --- | --- |
| `Creature` | Individual beings, including player characters and deities. | `type`: broad creature category, such as Humanoid or Dragon. `subtype`: most specific supported kind within it, such as Elf or Green dragon. `vital_status`: Alive, Dead, Undead, Missing, Imprisoned, Transformed, Unknown. Occupations and other repeatable details are claims. PC/NPC and divinity are separate from Type/Subtype. |
| `Location` | Places at any scale. | `location_type` and `settlement_size`: free text. |
| `Organization` | Groups with a collective identity. | `org_type`: Government, Guild, Religious, Military, Noble House, Criminal, Other. `scope`: Local, Regional, Continental, Planar. |
| `Item` | Specific campaign objects, including ordinary objects; a campaign-specific mention establishes importance without a separate significance threshold. | `item_type`: Artifact, Document, Relic, Gear, Other. |
| `Event` | A happening in time. Create an Event when named by the source, or when multiple participants and a stated date or period exist; review borderline cases. | `event_type` and short `outcome`: free text. |
| `Quest` | Objectives the party pursues. | `status`: Rumoured, Active, Completed, Failed, Abandoned. |
| `Concept` | Other nameable ideas, eras, religions, laws, traditions, or phenomena. | `concept_type`: free text. |

Campaign-specific mentions establish importance without a separate significance threshold. Generic game content does not automatically become a standalone entity. A named goblin can be a `Creature`; a generic mention of goblins does not create an individual. A specific ordinary object can qualify as an `Item`. Material that does not fit an entity type remains captured in claims, passages, and source context.

## Creature taxonomy and characteristics

| Level | Meaning | Illustrative value |
| --- | --- | --- |
| Entity type | The kind of campaign referent. | `Creature` |
| Creature `type` | A broad creature category. | Dragon |
| Creature `subtype` | The most specific source-supported kind within that category. | Green dragon |

Creature Type and Subtype have no exhaustive closed vocabulary. Classification describes identity. Temporary appearance, occupation, age, PC/NPC role, and divine status do not establish Type/Subtype. An elf-like appearance alone does not establish Elf identity. A broader grouping such as Chromatic can remain a supported claim when Green dragon is the specific subtype.

Creature characteristics are captured when supported. They are optional and do not add entity or article eligibility requirements.

| Area | Source information to capture when present |
| --- | --- |
| Names and identity | Names, epithets, Type, specific Subtype, broader kind, ancestry, origin, age, life stage, appearance, forms, life state. |
| Roles and relationships | Occupations, classes, titles, duties, explicit PC role, homes, travels, affiliations, faith, family, patrons, possessions. |
| Characteristics and narrative | Size, languages, senses, movement, abilities, weaknesses, equipment, goals, temperament, choices, deeds, and change over time. |
| Humanoids and dragons | Ancestry or species and culture; dragon lineage, broader grouping, age category, breath, alternate forms. |
| Celestials, fiends, and elementals | Rank, allegiance, plane; elemental affinity and manifestation. |
| Undead, constructs, and giants | Former identity, origin, form; maker, material, purpose, autonomy; giant kind and social role. |
| Divine individuals | Rank or status, portfolio, symbol, worshipers, manifestations. |

Repeatable aliases, titles, classes, occupations, homes, affiliations, kinship, patrons, and possessions retain provenance and timing as aliases, claims, or relationships. Characteristics such as age, size, languages, senses, movement, abilities, and weaknesses use optional typed claims. Appearance, motives, personality, history, and transformations remain cited assertions or passages. Infoboxes summarize supported information; each trait does not require a separate database column.

## Relationship edges

An edge reads as **subject → predicate → object**. Each predicate admits only the subject and object types listed below. `Any` means any of the seven entity types. Inverse labels support traversal and display; they are not additional predicates to extract. Qualifiers retain the source's more specific meaning.

| Predicate | Allowed subject types | Allowed object types | Inverse / symmetry | Defined qualifier or meaning |
| --- | --- | --- | --- | --- |
| `located_in` | Creature, Location, Item, Organization | Location | `contains` | — |
| `headquartered_in` | Organization | Location | `headquarters_of` | — |
| `member_of` | Creature, Organization, Location | Organization | `has_member` | `rank` |
| `leads` | Creature | Organization, Event | `led_by` | — |
| `serves` | Creature, Organization | Creature, Organization | `served_by` | `relation` |
| `sponsors` | Creature, Organization | Organization | `sponsored_by` | — |
| `allied_with` | Organization, Creature | Organization, Creature | Symmetric | — |
| `hostile_to` | Organization, Creature | Organization, Creature | Symmetric | — |
| `family_of` | Creature | Creature | Symmetric | `relation` |
| `worships` | Creature, Organization | Creature, Concept | `worshipped_by` | — |
| `possesses` | Creature, Organization, Location | Item | `held_by` | — |
| `created` | Creature, Organization | Item, Concept, Location | `created_by` | — |
| `participated_in` | Creature, Organization | Event | `had_participant` | `role` |
| `occurred_at` | Event | Location | `site_of` | — |
| `concerns` | Quest | Creature, Location, Item, Organization, Concept | `subject_of` | — |
| `quest_giver_for` | Creature, Organization | Quest | `given_by` | — |
| `resulted_in` | Event, Quest | Event, Quest | `resulted_from` | Causal |
| `associated_with` | Any | Any | Symmetric | Supported association when no more specific predicate applies. |

For example, an Event's location uses `Event → occurred_at → Location`; Event is not an allowed subject of `located_in`. Participation uses `Creature or Organization → participated_in → Event`.

Co-occurrence in the same source material does not establish an edge. Every canonical relationship needs a supporting source assertion, compatible endpoint types, correct direction, and retained qualifiers and temporal meaning. A source-supported relationship without a defined predicate remains a `proposed_predicate` review item and supporting material outside the canonical graph. A negative assertion remains a claim or prose without creating a fabricated positive edge.

## Claims, evidence, identity, and time

- **Faithful claims:** Preserve the subject, attribute or relationship, value or object, qualification, negation, attribution, and time. Accepted claims retain source identity, verified exact spans and quote, extraction model and prompt version, and the acceptance decision. Source-expressed uncertainty is part of the assertion.
- **Supported optional values:** Populate optional attributes only from source support or explicit campaign inputs for player role and divine status. Unstated remains blank; explicit Unknown remains distinct. Generic species knowledge and external setting lore cannot fill missing individual traits.
- **Stable identities:** Canonical entities have permanent ULIDs, entity type, supported canonical names, aliases, and a canon version. Source-backed merges retain redirects without reusing IDs, self-links, or cycles. Shared names or titles alone do not establish identity.
- **Retained detail:** Useful passages and assertions remain available even without a dedicated field, clear article section, or supported graph predicate.
- **Explicit dates:** Capture dates and periods only when stated, retaining wording and citations. Preserve unambiguous Calendar of Harptos normalization, signed years, and the source form `YYYY.MM.DD`. Approximate and relative wording remains when no exact value is established. Statement dates and described periods are distinct; temporal `before`, `after`, and offsets do not add graph predicates or a constraint solver.
- **Accumulated knowledge:** Current knowledge includes supported history and uncertainty, without an in-world cutoff. Later source material in the supplied processing order can revise the same fact, while earlier evidence remains retained. Omission alone does not erase prior information; incompatible assertions within a single source remain inspectable without an invented ordering rule.
- **Rebuildable projections:** Profiles, edges, indexes, infoboxes, summaries, and articles derive from retained knowledge and evidence. Rebuilding them preserves the underlying record.

## Wiki representation

Every canonical entity appears in its type index and applicable subtype index. It links to an article when that article exists; otherwise it remains visible as an index stub. Extraction eligibility and article eligibility are separate.

### Article eligibility

An entity receives an article when **all** eligibility fields for its type are supported and populated, **or** its quality rating reaches 1. A supported occupation claim satisfies Creature occupation without requiring a scalar occupation column. Extra optional fields and capture leads do not expand this test.

| Entity type | Eligibility fields |
| --- | --- |
| `Creature` | `type`, `subtype`, `vital_status`, `occupation` |
| `Location` | `location_type`, `settlement_size` |
| `Organization` | `org_type`, `scope` |
| `Item` | `item_type` |
| `Event` | `event_type`, `outcome` |
| `Quest` | `status` |
| `Concept` | `concept_type` |

Quality rating counts sections clearing the 100-word source-backed bar: none = 0, one = 1, two = 2, three or more = 3. Overview counts; Notable Events does not. Generated verbosity cannot increase quality.

### Ordered article sections

Each type also permits `Other` for material whose section is uncertain. A section earns a heading at 100 words of source-backed material; shorter material folds into Overview for display while remaining stored and cited.

| Entity type | Ordered sections |
| --- | --- |
| `Creature` | Overview, History, Appearance, Relationships, Notable Events, Possessions |
| `Location` | Overview, Geography, Notable Features, Inhabitants, History, Notable Events |
| `Organization` | Overview, Goals, Structure, Holdings, History, Notable Events |
| `Item` | Overview, Description, Properties, History, Whereabouts |
| `Event` | Overview, Background, Account, Participants, Aftermath |
| `Quest` | Overview, Objectives, Progress, Outcome |
| `Concept` | Overview, Description, History, Significance |

`Notable Events` is built from supported Event cross-references during publication, reusing each Event's source-backed lead sentence. It receives no extracted passage and contributes nothing to quality rating. Article statements and infobox facts require exact source support, and finished prose receives a source-support check before publication.
