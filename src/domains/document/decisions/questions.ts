import { z } from "zod";
import { sha256 } from "./integrity.js";
import type { loadClassificationCriteria } from "./semantic-input.js";
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type TargetValue = Exclude<JsonValue, null>;
export type EntityRules = Awaited<ReturnType<typeof loadClassificationCriteria>>;
export type WireQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria: {
        true: string;
        false: string;
      };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    };
export const definitionsVersion = "document-questions-v2" as const;
export const definitionsData = {
  title: {
    version: "title-v1",
    type: "noul",
    instructions: "In `complete_source`, is `target.line` a title for `target.following_text`?",
    criteria: {
      true: "The line labels the text that follows.",
      false: "The line is part of the body text, or does not label the following text.",
    },
    required: ["line", "following_text", "section_limits"],
    nullable: [],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  listIntroduction: {
    version: "listIntroduction-v1",
    type: "noul",
    instructions: "In `complete_source`, does `target.paragraph` introduce `target.next_list`?",
    criteria: {
      true: "The paragraph tells the reader what the next list covers.",
      false: "The paragraph and list stand apart.",
    },
    required: ["paragraph", "next_list", "section_limits"],
    nullable: [],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  mapLabels: {
    version: "mapLabels-v1",
    type: "noul",
    instructions: "In `complete_source`, do the numbers in `target.list` label places on a map?",
    criteria: {
      true: "The numbers identify places on a map.",
      false: "The numbers serve another purpose, such as list order, or the text does not establish map labels.",
    },
    required: ["list", "nearby_text", "map_notes"],
    nullable: ["map_notes"],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  linkPlacement: {
    version: "linkPlacement-v1",
    type: "choice",
    instructions: "In `complete_source`, which neighboring block does `target.link` belong with?",
    criteria: {
      before: "The link belongs with the previous block.",
      after: "It belongs with the next block.",
      both: "It belongs with both.",
      neither: "It stands alone.",
      unclear: "The source does not settle its placement.",
    },
    required: ["link", "previous_block", "next_block", "section_limits"],
    nullable: ["previous_block", "next_block"],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  aliasIdentity: {
    version: "aliasIdentity-v1",
    type: "choice",
    instructions: "In `complete_source`, are `target.name_a` and `target.name_b` aliases for the same entity?",
    criteria: {
      same_entity: "Both names name one entity in this document.",
      different_entities: "The names name different entities.",
      unclear: "The source does not settle the link, or a name has conflicting uses.",
    },
    required: ["name_a", "name_b", "name_clues"],
    nullable: [],
    optional: [],
    guidance:
      "Use the names' meaning in the full source. Shared words or matching initials alone do not prove an alias. The source does not have to spell out the full name if its use of the names makes the link clear.",
    variants: ["standard", "acronym"],
    maximum_questions: 50,
    rule_resolution: null,
    acronymInstructions: "In `complete_source`, is `target.name_b` an acronym for `target.name_a`?",
  },
  entityQualification: {
    version: "entityQualification-v1",
    type: "choice",
    instructions: "In `complete_source`, does `target.candidate` name one specific entity that fits `entity_rules`?",
    criteria: {
      yes: "The candidate names one specific entity that fits an approved definition.",
      no: "It is generic content or does not fit any approved definition.",
      unclear: "The source does not settle its identity or qualification, or the candidate mixes different entities.",
    },
    required: ["candidate"],
    nullable: [],
    optional: [],
    guidance:
      "A mention is enough to consider a qualifying entity. Do not require importance, a long description, or enough material for an article. Preserve examples, beliefs, denials, and quotes as written.",
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: "approved-rules",
  },
  entityType: {
    version: "entityType-v1",
    type: "choice",
    instructions: "In `complete_source`, which type in `entity_rules` fits `target.candidate`?",
    criteria: {
      Creature: "An individual being, including a deity.",
      Location: "A place at any scale.",
      Organization: "A group with a collective identity.",
      Item: "A specific object that meets the capture rules.",
      Event: "A happening that meets the approved Event rules.",
      Quest: "An objective the party pursues.",
      Concept: "A nameable idea, era, religion, law, tradition, or phenomenon.",
    },
    required: ["candidate"],
    nullable: [],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: "seven-full-approved-definitions",
  },
  blockSubject: {
    version: "blockSubject-v1",
    type: "noul",
    instructions: "In `complete_source`, does `target.block` talk about `target.entity`, using its name, an alias, or a clear pronoun?",
    criteria: {
      true: "The block discusses or mentions this entity.",
      false: "It does not discuss or mention this entity. A shared name with a different entity does not count.",
    },
    required: ["entity", "block", "section_label", "nearby_blocks"],
    nullable: ["section_label"],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  subjectContinuation: {
    version: "subjectContinuation-v1",
    type: "noul",
    instructions: "In `complete_source`, does `target.block` keep talking about `target.entity` from `target.previous_block`?",
    criteria: {
      true: "Both blocks discuss this entity, and the later block continues the discussion.",
      false: "The later block changes subject, or the link to this entity is not established.",
    },
    required: ["entity", "previous_block", "block", "section_limits"],
    nullable: ["previous_block"],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  sectionSubject: {
    version: "sectionSubject-v1",
    type: "noul",
    instructions: "In `complete_source`, is `target.entity` a subject of `target.section`?",
    criteria: {
      true: "The section as a whole discusses this entity.",
      false: "The entity is only mentioned in passing, or the section does not discuss it.",
    },
    required: ["entity", "section"],
    nullable: [],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  documentSubject: {
    version: "documentSubject-v1",
    type: "noul",
    instructions: "Is `target.entity` a subject of `complete_source` as a whole?",
    criteria: {
      true: "The document as a whole discusses this entity.",
      false: "The entity is only mentioned in passing, or the document does not discuss it.",
    },
    required: ["entity"],
    nullable: [],
    optional: [],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  passageMeaning: {
    version: "passageMeaning-v1",
    type: "choice",
    instructions: "In `complete_source`, does `target.passage` use `target.entity` in an example, make an assertion about it, or do both?",
    criteria: {
      example: "The passage uses this entity only in a made-up example or a hypothetical case.",
      assertion: "It makes a claim about this entity, including a reported belief, rumor, or denial.",
      both: "It includes both example use and an assertion.",
      unclear: "The source does not settle which use applies.",
    },
    required: ["entity", "passage", "nearby_text"],
    nullable: [],
    optional: ["speaker"],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
  textOrigin: {
    version: "textOrigin-v1",
    type: "choice",
    instructions: "In `complete_source`, is `target.block` copied from another work, an introduction to copied text, or neither?",
    criteria: {
      copied_text: "The block is presented as text taken from another work.",
      introduction: "The block introduces text taken from another work.",
      both: "It contains copied text and its introduction.",
      neither: "The source presents it as neither.",
      unclear: "Its origin is not settled.",
    },
    required: ["block", "nearby_blocks"],
    nullable: [],
    optional: ["source_note"],
    guidance: null,
    variants: ["standard"],
    maximum_questions: 10,
    rule_resolution: null,
  },
} as const;
export type QuestionKind = keyof typeof definitionsData;
export const questionKindSchema = z.enum(Object.keys(definitionsData) as [QuestionKind, ...QuestionKind[]]);
export const definitionsHash = sha256(JSON.stringify(definitionsData));
// Check serializability before recursive schema parsing, including cycles and sparse arrays.
function isJson(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))) return false;
  }
  if (Array.isArray(value) && keys.length !== value.length + 1) return false;
  ancestors.add(value);
  const valid =
    Reflect.ownKeys(value).every((key) => typeof key === "string") &&
    (Array.isArray(value)
      ? Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i) && isJson(value[i], ancestors)).every(Boolean)
      : Object.values(value).every((entry) => isJson(entry, ancestors)));
  ancestors.delete(value);
  return valid;
}
export const jsonSchema = z.custom<JsonValue>((value) => isJson(value), "Expected finite JSON evidence");
const targetValueSchema = z.custom<TargetValue>((value) => value !== null && isJson(value), "Expected non-null finite JSON evidence");
const identity = z.string().min(1);
const rulesSchema = z
  .object({ criteria: z.record(z.string(), z.string().min(1)), governingRules: z.string().min(1), sha256: z.string() })
  .strict()
  .superRefine((rules, ctx) => {
    const names = ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"];
    if (names.some((name) => !Object.hasOwn(rules.criteria, name)) || rules.sha256 !== sha256(JSON.stringify({ criteria: rules.criteria, governingRules: rules.governingRules })))
      ctx.addIssue({ code: "custom", message: "Invalid entity rule evidence" });
  });
type Definition<K extends QuestionKind> = (typeof definitionsData)[K];
type Target<K extends QuestionKind> = {
  [F in Definition<K>["required"][number]]: F extends Definition<K>["nullable"][number] ? JsonValue : TargetValue;
} & { [F in Definition<K>["optional"][number]]?: JsonValue } & Record<string, JsonValue>;
type Input<K extends QuestionKind> = { id: string; target: Target<K> } & (Definition<K>["rule_resolution"] extends null ? {} : { entityRules: EntityRules });
function targetSchema<K extends QuestionKind>(kind: K): z.ZodType<Target<K>> {
  const definition = definitionsData[kind];
  const nullable: readonly string[] = definition.nullable;
  const fields = Object.fromEntries([
    ...definition.required.map((field) => [field, nullable.includes(field) ? jsonSchema : targetValueSchema]),
    ...definition.optional.map((field) => [field, jsonSchema.optional()]),
  ]);
  const schema = z.object(fields).catchall(jsonSchema);
  const refined =
    kind === "textOrigin"
      ? schema.superRefine((target, ctx) => {
          if (Object.hasOwn(target, "entity")) ctx.addIssue({ code: "custom", message: "textOrigin has no entity target" });
        })
      : schema;
  // Object.fromEntries loses literal keys; the mapped type follows the same definition fields.
  return refined as unknown as z.ZodType<Target<K>>;
}
function inputSchema<K extends QuestionKind>(kind: K): z.ZodType<Input<K>> {
  return z
    .object({
      id: identity,
      target: targetSchema(kind),
      ...(definitionsData[kind].rule_resolution ? { entityRules: rulesSchema } : {}),
    })
    .strict() as z.ZodType<Input<K>>;
}
// Every definition key gets its own schema; Object.fromEntries cannot retain that key/type relationship.
const inputSchemas = Object.fromEntries(Object.keys(definitionsData).map((kind) => [kind, inputSchema(kind as QuestionKind)])) as unknown as {
  [K in QuestionKind]: z.ZodType<Input<K>>;
};
const descriptorFields = { question_id: identity, target_id: identity };
function descriptorSchema<K extends QuestionKind>(kind: K) {
  return z
    .object({
      ...descriptorFields,
      question_kind: z.literal(kind),
      definition_variant: z.enum<Definition<K>["variants"]>(definitionsData[kind].variants),
      definition_version: z.string(),
      definition_sha256: z.string(),
      target: targetSchema(kind),
      rules_sha256: z.string().nullable(),
    })
    .strict();
}
export type QuestionDescriptor = {
  [K in QuestionKind]: z.infer<ReturnType<typeof descriptorSchema<K>>>;
}[QuestionKind];
const descriptorSchemas = Object.keys(definitionsData).map((kind) => descriptorSchema(kind as QuestionKind));
export const questionDescriptorSchema = z.discriminatedUnion("question_kind", [descriptorSchemas[0]!, ...descriptorSchemas.slice(1)]) as z.ZodType<QuestionDescriptor>;
export type PreparedRequestQuestion = {
  id: string;
  target: Record<string, JsonValue>;
  question: WireQuestion;
  entity_rules: EntityRules | null;
};
export type PreparedQuestion = PreparedRequestQuestion & {
  descriptor: QuestionDescriptor;
  maximum_questions: 10 | 50;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function prepare(
  kind: QuestionKind,
  input: {
    id: string;
    target: Record<string, JsonValue>;
  },
  question: WireQuestion,
  rules: EntityRules | null = null,
  variant: "standard" | "acronym" = "standard",
): PreparedQuestion {
  const definition = definitionsData[kind];
  return {
    id: input.id,
    target: clone(input.target),
    question: clone(question),
    entity_rules: clone(rules),
    descriptor: {
      question_id: input.id,
      target_id: input.id,
      question_kind: kind,
      definition_variant: variant,
      definition_version: definition.version,
      definition_sha256: sha256(JSON.stringify(definition)),
      target: input.target,
      rules_sha256: rules?.sha256 ?? null,
    } as QuestionDescriptor,
    maximum_questions: definition.maximum_questions,
  };
}
function wording(definition: { instructions: string; guidance: string | null }): string {
  return definition.instructions + (definition.guidance ? `\n\n${definition.guidance}` : "");
}
export function title(input: z.infer<typeof inputSchemas.title>): PreparedQuestion {
  inputSchemas.title.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.title;
  return prepare("title", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function listIntroduction(input: z.infer<typeof inputSchemas.listIntroduction>): PreparedQuestion {
  inputSchemas.listIntroduction.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.listIntroduction;
  return prepare("listIntroduction", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function mapLabels(input: z.infer<typeof inputSchemas.mapLabels>): PreparedQuestion {
  inputSchemas.mapLabels.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.mapLabels;
  return prepare("mapLabels", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function linkPlacement(input: z.infer<typeof inputSchemas.linkPlacement>): PreparedQuestion {
  inputSchemas.linkPlacement.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.linkPlacement;
  return prepare("linkPlacement", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function aliasIdentity(input: z.infer<typeof inputSchemas.aliasIdentity>): PreparedQuestion {
  inputSchemas.aliasIdentity.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.aliasIdentity;
  return prepare("aliasIdentity", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function entityQualification(input: z.infer<typeof inputSchemas.entityQualification>): PreparedQuestion {
  inputSchemas.entityQualification.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.entityQualification;
  return prepare("entityQualification", input, { type: d.type, instructions: wording(d), criteria: d.criteria }, input.entityRules);
}
export function entityType(input: z.infer<typeof inputSchemas.entityType>): PreparedQuestion {
  inputSchemas.entityType.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.entityType;
  return prepare(
    "entityType",
    input,
    {
      type: d.type,
      instructions: wording(d),
      criteria: Object.fromEntries(Object.keys(d.criteria).map((key) => [key, input.entityRules.criteria[key]!])),
    },
    input.entityRules,
  );
}
export function blockSubject(input: z.infer<typeof inputSchemas.blockSubject>): PreparedQuestion {
  inputSchemas.blockSubject.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.blockSubject;
  return prepare("blockSubject", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function subjectContinuation(input: z.infer<typeof inputSchemas.subjectContinuation>): PreparedQuestion {
  inputSchemas.subjectContinuation.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.subjectContinuation;
  return prepare("subjectContinuation", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function sectionSubject(input: z.infer<typeof inputSchemas.sectionSubject>): PreparedQuestion {
  inputSchemas.sectionSubject.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.sectionSubject;
  return prepare("sectionSubject", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function documentSubject(input: z.infer<typeof inputSchemas.documentSubject>): PreparedQuestion {
  inputSchemas.documentSubject.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.documentSubject;
  return prepare("documentSubject", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function passageMeaning(input: z.infer<typeof inputSchemas.passageMeaning>): PreparedQuestion {
  inputSchemas.passageMeaning.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.passageMeaning;
  return prepare("passageMeaning", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function textOrigin(input: z.infer<typeof inputSchemas.textOrigin>): PreparedQuestion {
  inputSchemas.textOrigin.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.textOrigin;
  return prepare("textOrigin", input, { type: d.type, instructions: wording(d), criteria: d.criteria });
}
export function acronymIdentity(input: z.infer<typeof inputSchemas.aliasIdentity>): PreparedQuestion {
  inputSchemas.aliasIdentity.parse(input);
  if (!isJson(input.target)) throw new Error("Expected finite JSON target");
  const d = definitionsData.aliasIdentity;
  return prepare("aliasIdentity", input, { type: d.type, instructions: wording({ ...d, instructions: d.acronymInstructions }), criteria: d.criteria }, null, "acronym");
}
export function restoreQuestion(raw: unknown, retainedRules: EntityRules | null): PreparedQuestion {
  if (!isJson(raw)) throw new Error("Expected finite JSON descriptor");
  questionDescriptorSchema.parse(raw);
  // Parsing is validation only: preserve original target key order.
  const descriptor = clone(raw) as QuestionDescriptor;
  if (descriptor.question_id !== descriptor.target_id) throw new Error("Question/target IDs differ");
  const input = { id: descriptor.question_id, target: descriptor.target, entityRules: retainedRules };
  let prepared: PreparedQuestion;
  switch (descriptor.question_kind) {
    case "title":
      prepared = title({ id: input.id, target: descriptor.target });
      break;
    case "listIntroduction":
      prepared = listIntroduction({ id: input.id, target: descriptor.target });
      break;
    case "mapLabels":
      prepared = mapLabels({ id: input.id, target: descriptor.target });
      break;
    case "linkPlacement":
      prepared = linkPlacement({ id: input.id, target: descriptor.target });
      break;
    case "aliasIdentity":
      prepared = (descriptor.definition_variant === "acronym" ? acronymIdentity : aliasIdentity)({
        id: input.id,
        target: descriptor.target,
      });
      break;
    case "entityQualification":
      prepared = entityQualification({ id: input.id, target: descriptor.target, entityRules: retainedRules! });
      break;
    case "entityType":
      prepared = entityType({ id: input.id, target: descriptor.target, entityRules: retainedRules! });
      break;
    case "blockSubject":
      prepared = blockSubject({ id: input.id, target: descriptor.target });
      break;
    case "subjectContinuation":
      prepared = subjectContinuation({ id: input.id, target: descriptor.target });
      break;
    case "sectionSubject":
      prepared = sectionSubject({ id: input.id, target: descriptor.target });
      break;
    case "documentSubject":
      prepared = documentSubject({ id: input.id, target: descriptor.target });
      break;
    case "passageMeaning":
      prepared = passageMeaning({ id: input.id, target: descriptor.target });
      break;
    case "textOrigin":
      prepared = textOrigin({ id: input.id, target: descriptor.target });
      break;
  }
  if (JSON.stringify(prepared.descriptor) !== JSON.stringify(descriptor)) throw new Error("Question descriptor differs from current definition");
  return prepared;
}
