import { z } from "zod";
import { sourceComponent, type CapturedSource } from "../discovery/source.js";
import type { Candidate } from "../decisions/contracts.js";
import { entityQualification, type EntityRules } from "../decisions/questions.js";

const sourceRangeSchema = z.object({
  start_byte: z.number().int().nonnegative(),
  end_byte: z.number().int().nonnegative(),
  text: z.string(),
});
export const layoutSchema = z.object({
  contract_version: z.literal("lore-block-layout-v1"),
  source_sha256: z.string(),
  source_byte_length: z.number().int().nonnegative(),
  blocks: z.array(z.object({ id: z.string(), section_id: z.string(), components: z.array(sourceRangeSchema) })),
  place_proposals: z.array(
    z.object({
      id: z.string(),
      map_key_id: z.string(),
      block_id: z.string(),
      number: z.string(),
      source_names: z.array(z.string()),
      display_label: z.string(),
      naming_basis: z.enum(["bold", "section_number"]),
      qualification_status: z.string(),
    }),
  ),
});
export type CandidateRecord = {
  candidate: Record<string, unknown>;
  source_candidate_ids: string[];
  place_proposal_ids: string[];
  kind: "source_group" | "map_place_descriptor";
};

function offsetForByte(source: CapturedSource, byte: number) {
  return source.bytes.subarray(0, byte).toString("utf8").length;
}
export function verifyComponent(source: CapturedSource, component: z.infer<typeof sourceRangeSchema>) {
  if (component.end_byte < component.start_byte || source.bytes.subarray(component.start_byte, component.end_byte).toString("utf8") !== component.text) {
    throw new Error(`Map entry component changed at byte ${component.start_byte}`);
  }
}
export function mapNameSpans(source: CapturedSource, block: z.infer<typeof layoutSchema>["blocks"][number], name: string) {
  const found: ReturnType<typeof sourceComponent>[] = [];
  for (const component of block.components) {
    verifyComponent(source, component);
    let local = component.text.indexOf(name);
    while (local >= 0) {
      const start = offsetForByte(source, component.start_byte) + local;
      found.push(sourceComponent(source, start, start + name.length));
      local = component.text.indexOf(name, local + name.length);
    }
  }
  return found;
}

export function planQualificationInputs(
  source: CapturedSource,
  groups: Candidate[],
  layout: z.infer<typeof layoutSchema> | undefined,
  rules: EntityRules,
  unresolvedGroupIds: ReadonlySet<string> = new Set(),
) {
  const groupForName = new Map<string, Set<string>>();
  for (const group of groups)
    for (const member of group.members ?? [group]) {
      if (!member.occurrences.length) continue;
      groupForName.set(member.name, new Set([...(groupForName.get(member.name) ?? []), group.candidate_id]));
    }
  const questions: ReturnType<typeof entityQualification>[] = [];
  const inputs: Record<string, CandidateRecord> = {};
  const groupQuestionIds = new Map<string, string>();
  for (const group of groups) {
    if (unresolvedGroupIds.has(group.candidate_id)) continue;
    const members = group.members ?? [group];
    if (members.some((member) => !member.occurrences.length)) continue;
    const candidateId = `group-${group.candidate_id}`;
    const candidate = {
      kind: "source_candidate_group",
      candidate_id: group.candidate_id,
      names: members.map((member) => member.name),
      aliases: members.slice(1).map((member) => member.name),
      members: members.map((member) => ({
        candidate_id: member.candidate_id,
        name: member.name,
        source_evidence: member.occurrences,
      })),
      source_evidence: members.flatMap((member) => member.occurrences),
      findings: group.findings,
    };
    questions.push(entityQualification({ id: candidateId, target: { candidate }, entityRules: rules }));
    inputs[candidateId] = {
      candidate,
      source_candidate_ids: members.map((member) => member.candidate_id),
      place_proposal_ids: [],
      kind: "source_group",
    };
    groupQuestionIds.set(group.candidate_id, candidateId);
  }

  const mapProposals: Array<Record<string, unknown>> = [];
  if (layout) {
    const blockById = new Map(layout.blocks.map((block) => [block.id, block]));
    for (const proposal of layout.place_proposals) {
      const block = blockById.get(proposal.block_id);
      if (!block) throw new Error(`Map proposal references missing entry block ${proposal.block_id}`);
      const names = proposal.source_names.map((name) => ({ name, source_spans: mapNameSpans(source, block, name) }));
      const groupIds = new Set<string>();
      const missing = names.filter((entry) => !entry.source_spans.length || !groupForName.has(entry.name)).map((entry) => entry.name);
      for (const entry of names) if (entry.source_spans.length) for (const groupId of groupForName.get(entry.name) ?? []) groupIds.add(groupId);
      let descriptorQuestionId: string | null = null;
      if (!names.length) {
        descriptorQuestionId = `place-${proposal.id}`;
        const evidence = block.components.map((component) => ({ ...component }));
        const candidate = {
          kind: "unnamed_map_place_descriptor",
          candidate_id: descriptorQuestionId,
          source_descriptor: evidence.map((component) => component.text).join(""),
          source_evidence: evidence,
          map_key_id: proposal.map_key_id,
          entry_number: proposal.number,
        };
        questions.push(entityQualification({ id: descriptorQuestionId, target: { candidate }, entityRules: rules }));
        inputs[descriptorQuestionId] = {
          candidate,
          source_candidate_ids: [],
          place_proposal_ids: [proposal.id],
          kind: "map_place_descriptor",
        };
      }
      const qualificationIds = descriptorQuestionId
        ? [descriptorQuestionId]
        : [...groupIds].map((groupId) => groupQuestionIds.get(groupId)).filter((id): id is string => Boolean(id));
      for (const questionId of qualificationIds) {
        const record = inputs[questionId];
        if (record && !record.place_proposal_ids.includes(proposal.id)) record.place_proposal_ids.push(proposal.id);
      }
      mapProposals.push({
        id: proposal.id,
        map_key_id: proposal.map_key_id,
        block_id: proposal.block_id,
        number: proposal.number,
        source_names: names,
        supported_subject_names: [],
        display_label: proposal.display_label,
        naming_basis: proposal.naming_basis,
        entry_components: block.components,
        entry_text: block.components.map((component) => component.text).join(""),
        candidate_group_ids: [...groupIds],
        qualification_question_ids: qualificationIds,
        missing_source_names: missing,
        unnamed_descriptor_question_id: descriptorQuestionId,
        status: missing.length
          ? "discovery_correction_required"
          : [...groupIds].some((groupId) => unresolvedGroupIds.has(groupId))
            ? "unresolved"
            : names.length
              ? "qualification_pending"
              : "qualification_pending_unnamed_descriptor",
      });
    }
  }
  return { questions, inputs, mapProposals };
}
