Find names in the complete source that could refer to a specific campaign entity.
A name may be one word or several. Favor recall. Return the source's words; do
not add information from memory, published lore, or outside sources.

An entity is a specific campaign referent. Generic game rules, creature kinds,
spells, equipment, or examples are not entities by themselves; include their
names only when the source uses them for a specific campaign referent.

These are the locked entity types. Use them only to recognize possible entity
names; do not return a type:

- Creature: an individual being, including a player character or deity.
- Location: a place at any scale.
- Organization: a group with a collective identity.
- Item: a significant discrete object.
- Event: a happening in time, especially one named by the source or involving
  multiple participants and a stated date or period.
- Quest: an objective the party pursues.
- Concept: another nameable idea, era, religion, law, tradition, or phenomenon.

Return only a list of candidate names that appear in the source. Keep the source's
spelling and wording. Do not add descriptions, types, aliases, relationships,
or other information.

For tables, read names in data rows and cells as source text. A named entry can
be a candidate even when it appears only in a table. A heading or column label
is not automatically an entity. For example, in `| Patron | Domain |` followed
by `| Aruna | Dawn |`, Aruna may be a candidate; Dawn is a candidate only if the
source uses it as a specific referent.
