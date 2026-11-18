import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { definitionsData, definitionsVersion, type QuestionKind } from "../../domains/document/decisions/questions.js";
import { loadClassificationCriteria } from "../../domains/document/decisions/semantic-input.js";

export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
export type LabQuestion = {
  id: string;
  type: "choice" | "noul" | "score";
  instructions: unknown;
  criteria: Record<string, unknown> | unknown[];
  target: Record<string, unknown>;
  macro?: string;
};
export type Macro = { id: string; title: string; stage: string; status: string; version: string; question: LabQuestion; extraState: Record<string, unknown> };
export type Experiment = { id: string; title: string; description: string; source: string; questions: LabQuestion[]; extraState: Record<string, unknown> };

const sampleSource = [
  "# The Lantern Guild",
  "The Lantern Guild (LG) worships Apollo, also called Lathander. Apolloite and Lathanderan name the followers, not the deity.",
  "The guild grew out of a late DR1400's movement to unite the city's temples.",
  "Its map shows these places:",
  "1. Temple of Dawn",
  "2. Guild Hall",
  "For the map: https://example.org/guild-map",
  "Alice led the guild until 1490 DR. Bob replaced Alice as leader in 1491 DR.",
  "The guild does not serve the High Council.",
  'Archivist Mira said in 1492 DR, "Some sailors believe Apollo protected them during the storm of 1490 DR."',
  "For example, an Apolloite might carry a lantern; this does not establish that every follower carries one.",
  'Copied from the city chronicle: "The Guild Hall stood beside the eastern gate."',
].join("\n\n");

const targets: Record<string, unknown> = {
  line: "# The Lantern Guild",
  following_text: sampleSource.split("\n\n")[1],
  section_limits: "The Lantern Guild section",
  paragraph: "Its map shows these places:",
  next_list: "1. Temple of Dawn\n2. Guild Hall",
  list: "1. Temple of Dawn\n2. Guild Hall",
  nearby_text: "Its map shows these places:",
  map_notes: "The numbers identify places on the guild map.",
  link: "https://example.org/guild-map",
  previous_block: "1. Temple of Dawn\n2. Guild Hall",
  next_block: "Alice led the guild until 1490 DR.",
  name_a: "Apollo",
  name_b: "Lathander",
  name_clues: {},
  candidate: { names: ["late DR1400's movement"] },
  entity: { name: "The Lantern Guild", type: "Organization" },
  block: "The Lantern Guild (LG) worships Apollo, also called Lathander.",
  parent_item: null,
  table_labels: null,
  quote_speaker: null,
  previous_context: null,
  previous_blocks: [],
  previous_block_context: null,
  section: "# The Lantern Guild\n\n" + sampleSource.split("\n\n")[1],
  passage: "For example, an Apolloite might carry a lantern; this does not establish that every follower carries one.",
  nearby_blocks: ['Copied from the city chronicle: "The Guild Hall stood beside the eastern gate."'],
  claim: "The Lantern Guild does not serve the High Council.",
  entities: ["The Lantern Guild", "High Council"],
  evidence: ["The guild does not serve the High Council."],
  subject: { name: "The Lantern Guild", type: "Organization" },
  object: { name: "High Council", type: "Organization" },
  relationship: { predicate: "serves", polarity: "positive" },
  trait: { key: "leader", value: "Bob", period: "1491 DR" },
  date_text: "1490 DR",
  claim_or_event: "The storm",
  speaker: "Archivist Mira",
  new_candidate: { name: "LG", type: "Organization" },
  saved_entity: { name: "The Lantern Guild", type: "Organization" },
  new_claim: "Bob replaced Alice as leader in 1491 DR.",
  earlier_claim: "Alice leads the Lantern Guild.",
  supported_claims: ["The Lantern Guild worships Apollo."],
};

function defaultTarget(fields: string[], nullable: readonly string[] = []) {
  return Object.fromEntries(fields.map((field) => [field, targets[field] ?? (nullable.includes(field) ? null : "")]));
}

function stage(number: number) {
  return number <= 4 ? "Structure" : number === 5 ? "Aliases" : number <= 7 ? "Entities" : number <= 13 ? "Association" : "Later checks";
}

export async function loadCatalog() {
  const text = await readFile(join(projectRoot, "Resources/Jev question catalog.md"), "utf8");
  const rules = await loadClassificationCriteria();
  const headings = [...text.matchAll(/^### (Q\d{2}) — (.+)$/gm)];
  const currentKinds = Object.keys(definitionsData) as QuestionKind[];
  const macros: Macro[] = headings.map((heading, index) => {
    const id = heading[1];
    const number = Number(id.slice(1));
    const body = text.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? text.length);
    const kind = currentKinds[number - 1];
    const definition = kind ? definitionsData[kind] : undefined;
    const inputLine = body.match(/^\*\*Inputs:\*\* (.+)$/m)?.[1] ?? "";
    const fields = definition ? [...definition.required] : [...inputLine.matchAll(/\x60([^\x60]+)\x60/g)].map((entry) => entry[1]);
    const instructions = definition ? definition.instructions + (definition.guidance ? "\n\n" + definition.guidance : "") : body.match(/^\*\*Question:\*\* (.+?)\s*$/m)?.[1];
    if (!instructions) throw new Error("Catalog question missing: " + id);
    const criteriaLine = body.match(/\*\*Criteria:\*\* (.+)$/m)?.[1] ?? "";
    const criteria: Record<string, unknown> = definition
      ? { ...definition.criteria }
      : Object.fromEntries([...criteriaLine.matchAll(/\x60([^\x60]+)\x60: (.*?)(?= \x60[^\x60]+\x60: |$)/g)].map((entry) => [entry[1], entry[2]]));
    if (number === 7) for (const key of Object.keys(criteria)) criteria[key] = rules.criteria[key];
    if (number === 20) {
      const sections = text.match(/^\| \x60Organization\x60 \| (.+?) \|$/m)?.[1];
      if (!sections) throw new Error("Organization article sections missing from catalog");
      Object.assign(criteria, Object.fromEntries(sections.split(", ").map((section) => [section, null])), { Other: "The passage does not clearly fit one allowed section." });
    }
    if (!Object.keys(criteria).length) throw new Error("Catalog criteria missing: " + id);
    return {
      id,
      title: heading[2],
      stage: stage(number),
      status: definition ? "Available source-local stage" : "Planned pipeline stage",
      version: definition?.version ?? "catalog-2026-10-04",
      question: {
        id: id.toLowerCase(),
        type: definition?.type ?? "choice",
        instructions,
        criteria,
        target: {
          ...defaultTarget(fields, definition?.nullable),
          ...(number === 12 ? { block: targets.passage } : {}),
          ...(number === 13 ? { block: sampleSource.split("\n\n").at(-1), nearby_blocks: [] } : {}),
          ...(number === 16 ? { evidence: [targets.new_claim] } : {}),
          ...(number === 17 ? { passage: sampleSource.split("\n\n").at(-3) } : {}),
        },
        macro: id,
      },
      extraState:
        number === 6 || number === 7
          ? { entity_rules: rules.governingRules }
          : number === 15
            ? { relationship_rule: "serves: the subject serves the object. A denial does not support a positive relationship." }
            : [14, 18, 19].includes(number)
              ? { prior_sources: ["# Earlier guild record\n\nAlice leads the Lantern Guild."], document_order: [1, 2] }
              : {},
    };
  });
  if (macros.length !== 20) throw new Error("Expected all 20 catalog questions");
  const alias = macros.find((macro) => macro.id === "Q05")!;
  macros.splice(5, 0, {
    ...structuredClone(alias),
    id: "Q05-acronym",
    title: "Acronym identity",
    question: {
      ...structuredClone(alias.question),
      id: "q05_acronym",
      macro: "Q05-acronym",
      instructions: definitionsData.aliasIdentity.acronymInstructions + "\n\n" + definitionsData.aliasIdentity.guidance,
      target: { name_a: "The Lantern Guild", name_b: "LG", name_clues: {} },
    },
  });
  const documents = (await readdir(join(projectRoot, "Resources/Lore")))
    .filter((name) => /^\d{2}-.+\.md$/.test(name))
    .sort()
    .map((name) => ({
      id: name,
      title: name
        .replace(/^\d{2}-/, "")
        .replace(/\.md$/, "")
        .replaceAll("-", " ")
        .replaceAll("_", " "),
    }));
  const churchSource = await readFile(join(projectRoot, "Resources/Lore/01-unified-church-of-the-realms.md"), "utf8");
  const question = (macroId: string, target: Record<string, unknown>, id?: string): LabQuestion => {
    const item = structuredClone(macros.find((macro) => macro.id === macroId)!.question);
    return { ...item, target: { ...item.target, ...target }, id: id ?? item.id };
  };
  const aliasQuestion = (name_a: string, name_b: string, id = "alias") => question("Q05", { name_a, name_b, name_clues: {} }, id);
  const cases: Experiment[] = [
    {
      id: "followers",
      title: "Deity vs followers",
      description: "Apolloite / Lathander: compare names that are related but identify different referents.",
      source: churchSource,
      extraState: {},
      questions: [aliasQuestion("Apolloite", "Lathander")],
    },
    {
      id: "apollo-matrix",
      title: "Apollo alias matrix",
      description: "Compare deity aliases, follower aliases, and cross-links in one batch.",
      source: churchSource,
      extraState: {},
      questions: [
        aliasQuestion("Apollo", "Lathander", "deity_alias"),
        aliasQuestion("Dawnfather", "Lathander", "deity_title"),
        aliasQuestion("Apolloite", "Lathanderan", "follower_alias"),
        aliasQuestion("Apolloite", "Lathander", "cross_link_1"),
        aliasQuestion("Lathanderan", "Apollo", "cross_link_2"),
        aliasQuestion("Lathanderan", "Lathander", "cross_link_3"),
      ],
    },
    {
      id: "spelling",
      title: "Spelling variants",
      description: "Lloth / Lolth and Gruumush / Gruumsh with the unmodified catalog question.",
      source: churchSource,
      extraState: {},
      questions: [aliasQuestion("Lloth", "Lolth", "lloth"), aliasQuestion("Gruumush", "Gruumsh", "gruumsh")],
    },
    {
      id: "spelling-guidance",
      title: "Spelling · revised wording",
      description: "The same pairs with explicit spelling-mistake guidance. Compare against the original wording.",
      source: churchSource,
      extraState: {},
      questions: [aliasQuestion("Lloth", "Lolth", "lloth"), aliasQuestion("Gruumush", "Gruumsh", "gruumsh")].map((item) => ({
        ...item,
        instructions:
          String(item.instructions) +
          "\n\nConsider whether one name is a spelling mistake or variant of the other. Check the referent and context; similar spelling alone is not proof.",
      })),
    },
    {
      id: "movement",
      title: "Movement · qualification + type",
      description: "Ask qualification and type separately without suppressing the second answer.",
      source: churchSource,
      extraState: { entity_rules: rules.governingRules },
      questions: [
        question("Q06", { candidate: { names: ["late DR1400's movement"] } }, "movement_qualifies"),
        question("Q07", { candidate: { names: ["late DR1400's movement"] } }, "movement_type"),
      ],
    },
    {
      id: "thor",
      title: "Thor · qualification",
      description: "The explicitly named deity, using the existing capture rules.",
      source: churchSource,
      extraState: { entity_rules: rules.governingRules },
      questions: [question("Q06", { candidate: { names: ["Thor"] } }), aliasQuestion("Thor", "Talos", "thor_alias")],
    },
    {
      id: "ucr",
      title: "UCR acronym",
      description: "Full church name / UCR with acronym-specific wording.",
      source: churchSource,
      extraState: {},
      questions: [question("Q05-acronym", { name_a: "Unified Church of the Realms", name_b: "UCR", name_clues: {} })],
    },
    {
      id: "pantheon",
      title: "Pantheon headings",
      description: "See the exact unfamiliar I7/I8 pairs and their full source context.",
      source: churchSource,
      extraState: {},
      questions: [aliasQuestion("Pantheon", "The 'Official' Pantheon of the Unified Church of the Realms", "i7"), aliasQuestion("Pantheon", "'Official' Pantheon", "i8")],
    },
    {
      id: "custom",
      title: "Start from scratch",
      description: "Any content, any question. Choice, yes/no, and score are supported.",
      source: "",
      extraState: {},
      questions: [
        {
          id: "question_1",
          type: "choice",
          instructions: "Which answer best describes the content in complete_source?",
          criteria: { yes: "Yes.", no: "No.", unclear: "The content does not settle this." },
          target: {},
        },
      ],
    },
  ];
  return { macros, cases, documents, sampleSource, definitionsVersion };
}
