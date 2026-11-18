import { z } from "zod";
import type { BuiltLayout, Component, LayoutBlock, LayoutSection } from "../blocks/types.js";

export const entityTypes = ["Creature", "Location", "Organization", "Item", "Event", "Quest", "Concept"] as const;

export const localEntitySchema = z
  .object({
    contract_version: z.literal("source-local-entity-v1"),
    local_entity_id: z.string().min(1),
    document_id: z.string().min(1),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    source_candidate_ids: z.array(z.string()),
    supported_names: z.array(z.string().min(1)),
    aliases: z.array(z.string()),
    type: z.enum(entityTypes),
    source_descriptor: z.string().nullable(),
    qualification_decision_id: z.string().min(1),
    type_decision_id: z.string().min(1),
    evidence: z.array(z.unknown()),
    place_proposal_ids: z.array(z.string()),
    canonical_status: z.literal("source_local_only"),
  })
  .passthrough();

export const localEntitiesFileSchema = z
  .object({
    contract_version: z.literal("source-local-entities-v1"),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    entities: z.array(localEntitySchema),
  })
  .strict();

export type LocalEntity = z.infer<typeof localEntitySchema>;
export type AssociationLayout = BuiltLayout;
export type AssociationBlock = LayoutBlock;
export type AssociationSection = LayoutSection;

export type MentionInterpretation = {
  local_entity_id: string;
  matched_name: string;
  source_candidate_ids: string[];
};

export type MentionRecord = {
  contract_version: "source-entity-mention-v1";
  mention_id: string;
  source_span: Component;
  interpretations: MentionInterpretation[];
  source_candidate_ids: string[];
  block_id: string | null;
  section_id: string | null;
  label_id: string | null;
  table_context: null | {
    table_span: Component;
    whole_row: Component;
    cell: Component;
    header: Component | null;
    row_index: number;
    cell_index: number;
  };
  quote_context: null | {
    block_components: Component[];
    speaker: string | null;
  };
};

export type DecisionRecord = {
  contract_version: "decision-questions-v2";
  question_id: string;
  target_id: string;
  target: Record<string, unknown>;
  question_kind: string;
  raw_answer: { type: "noul"; noul: number } | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
  action: {
    status: "provisional" | "supported" | "rejected" | "unresolved";
    label: string | null;
    policy_version: string;
    policy_sha256: string;
    findings: string[];
  };
  raw_response_reference: string;
  source_sha256: string;
  upstream_hashes: Record<string, string>;
  repeat_response_reference?: string | null;
};

export type FoundSection = {
  contract_version: "entity-found-section-v1";
  found_section_id: string;
  local_entity_id: string;
  section_id: string;
  block_ids: string[];
  seed_question_id: string;
  continuation_question_ids: string[];
  start_byte: number;
  end_byte: number;
};

export type AssociationLink = {
  contract_version: "source-entity-link-v1";
  link_id: string;
  local_entity_id: string;
  scope: "block" | "section" | "found_section" | "document";
  target_id: string;
  status: "supported" | "provisional" | "rejected" | "unresolved";
  question_ids: string[];
  block_ids: string[];
};

export type EntityContext = {
  contract_version: "source-entity-context-v1";
  local_entity_id: string;
  block_ids: string[];
  blocks: Array<{ block: AssociationBlock; text: string; section: AssociationSection }>;
  source_components: Array<Component & { block_ids: string[] }>;
  link_ids: string[];
  mention_ids: string[];
  meaning_note_ids: string[];
  origin_note_ids: string[];
};

export type AssociationInputManifest = {
  source_path: string;
  structure_directory: string;
  classification_directory: string;
  output_directory: string;
};
