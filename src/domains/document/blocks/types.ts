import type { CapturedSource } from "../discovery/source.js";

export type Component = ReturnType<typeof import("../discovery/source.js")["sourceComponent"]> & {
  role: string;
};

export type ItemKind = "label" | "paragraph" | "quote" | "list" | "table" | "link" | "note" | "image" | "break" | "meta";
export type BlockKind = "paragraph" | "quote" | "list" | "entry" | "table";

export type ListEntry = {
  component: Component;
  number: string | null;
  bold_names: string[];
};

export type TableEvidence = {
  rows: Array<{
    index: number;
    kind: "header" | "body";
    cells: Component[];
  }>;
};

export type ParsedItem = {
  id: string;
  kind: ItemKind;
  ast_type: string;
  component: Component;
  title_candidate: boolean;
  ordered_numbers: string[] | null;
  list_entries: ListEntry[];
  image_references?: Component[];
  table: TableEvidence | null;
};

export type ParsedDocument = {
  contract_version: "markdown-layout-v1";
  source_sha256: string;
  source_byte_length: number;
  items: ParsedItem[];
};

export type LayoutBlock = {
  id: string;
  kind: BlockKind;
  section_id: string;
  item_ids: string[];
  components: Component[];
  map_entry_number: string | null;
  table: TableEvidence | null;
  attribution: string | null;
};

export type LayoutSection = {
  id: string;
  kind: "labelled" | "unlabelled";
  label_components: Component[];
  block_ids: string[];
  notes: Component[];
  images: Component[];
  context: Component[];
  start_byte: number;
  end_byte: number;
};

export type MapKey = {
  id: string;
  section_id: string;
  image: Component | null;
  entries: Array<{ number: string; block_id: string }>;
  findings: string[];
};

export type PlaceProposal = {
  id: string;
  map_key_id: string;
  block_id: string;
  number: string;
  source_names: string[];
  display_label: string;
  naming_basis: "bold" | "section_number";
  qualification_status: "not_run_out_of_scope";
};

export type StructureAction = {
  status: "provisional" | "supported" | "rejected" | "unresolved";
  label: string | null;
  findings: string[];
};

export type StructureActions = Record<string, StructureAction>;

export type BuiltLayout = {
  contract_version: "lore-block-layout-v1";
  capability_status: "complete" | "partial";
  full_product_status: "not_run";
  source_sha256: string;
  source_byte_length: number;
  items: ParsedItem[];
  sections: LayoutSection[];
  blocks: LayoutBlock[];
  map_keys: MapKey[];
  place_proposals: PlaceProposal[];
  decisions: Array<{
    question_id: string;
    action: StructureAction;
    raw_answer: unknown;
    repeat_response_reference: string | null;
  }>;
  findings: string[];
};

export function itemText(source: CapturedSource, item: ParsedItem): string {
  return source.bytes.subarray(item.component.start_byte, item.component.end_byte).toString("utf8");
}
