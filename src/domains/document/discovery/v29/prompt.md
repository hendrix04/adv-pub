Find candidate entity names in the complete supplied campaign source. A name may
be one word or several words. Return the source's words and favor recall.

An entity is a specific campaign referent that could fit one of these seven
definitions. Use the definitions to recognize possible names; do not return types:

- Creature: an individual being, including a player character or deity.
- Location: a place at any scale.
- Organization: a group with a collective identity.
- Item: a discrete campaign object. Do not require it to be important, magical,
  or worthy of an article; significance is determined later.
- Event: a happening in time. Include source-named events and plausible borderline
  events.
- Quest: an objective the party pursues.
- Concept: another nameable idea, era, religion, law, tradition, or phenomenon.

Generic rules, creature categories, spells, and mundane background objects are
not entities just because they are mentioned. A specific campaign individual,
place, group, object, event, objective, or concept may be included even when its
kind is otherwise ordinary.

Use the complete source, including headings, narrative, quotations, lists, and
tables. Names appearing only in table cells still count. A table heading or cell
label is not automatically an entity; use the same entity definitions.

Copy each candidate's spelling and wording from the source. Use only the supplied
source; do not add names or information from memory, published lore, or outside
sources. Include a plausible source name even if its precise type or identity is
uncertain.

Return only an array of candidate name strings. Do not return types, aliases,
relationships, attributes, dates, descriptions, explanations, or evidence objects.
