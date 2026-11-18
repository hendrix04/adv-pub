import { sha256, type AliasDecision, type Candidate } from "../decisions/contracts.js";
import type { Action } from "../decisions/policy.js";

export function buildReferentGroups(candidates: Candidate[], decisions: AliasDecision[]): { groups: Candidate[]; unappliedLinkIds: string[] } {
  const key = (left: string, right: string) => [left, right].sort().join("/");
  const supported = new Map(
    decisions.filter((decision) => decision.outcome === "provisional_link").map((decision) => [key(decision.left_id, decision.right_id), decision.pair_id]),
  );
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const eligible = groups.filter((members) => members.every((member) => supported.has(key(member.candidate_id, candidate.candidate_id))));
    // A link to multiple separate groups can signal inconsistent identity evidence; keep it unresolved.
    if (eligible.length === 1) eligible[0]!.push(candidate);
    else groups.push([candidate]);
  }
  const applied = new Set<string>();
  const referents = groups.map((members) => {
    for (let left = 0; left < members.length; left += 1)
      for (const right of members.slice(left + 1)) {
        applied.add(supported.get(key(members[left]!.candidate_id, right.candidate_id))!);
      }
    const representative = [...members].sort((left, right) => right.name.length - left.name.length || left.index - right.index)[0]!;
    return {
      ...representative,
      index: members[0]!.index,
      candidate_id: `referent-${sha256(members.map((member) => member.candidate_id).join("/")).slice(0, 24)}`,
      members,
      findings: members.flatMap((member) => member.findings),
    };
  });
  return { groups: referents, unappliedLinkIds: [...supported.values()].filter((id) => !applied.has(id)) };
}

export type CatalogAliasDecision = {
  question_id: string;
  target: Record<string, unknown>;
  action: Action;
};

function catalogMemberIds(decision: CatalogAliasDecision): [string, string] | undefined {
  const clues = decision.target.name_clues;
  if (!clues || typeof clues !== "object" || Array.isArray(clues)) return undefined;
  const ids = (clues as { candidate_ids?: unknown }).candidate_ids;
  return Array.isArray(ids) && ids.length === 2 && ids.every((id) => typeof id === "string") ? [ids[0] as string, ids[1] as string] : undefined;
}

/** Only source-backed, policy-supported aliasIdentity pairs can join a new catalog group. */
export function buildCatalogReferentGroups(candidates: Candidate[], decisions: CatalogAliasDecision[], policyMode: "exploratory" | "supported" = "supported") {
  const byId = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const key = (left: string, right: string) => [left, right].sort().join("/");
  const supported = new Map<string, string>();
  const supportedEndpoints = new Map<string, [string, string]>();
  const findings: string[] = [];
  for (const decision of decisions) {
    const ids = catalogMemberIds(decision);
    if (!ids || !byId.has(ids[0]) || !byId.has(ids[1]) || ids[0] === ids[1]) {
      findings.push(`${decision.question_id}: invalid source candidate pair evidence`);
      continue;
    }
    const [left, right] = ids.map((id) => byId.get(id)!);
    const eligibleAction = decision.action.status === "supported" || (policyMode === "exploratory" && decision.action.status === "provisional");
    if (eligibleAction && decision.action.label === "same_entity") {
      if (!left.occurrences.length || !right.occurrences.length) {
        findings.push(`${decision.question_id}: supported alias lacks exact source occurrences; group withheld`);
        continue;
      }
      supported.set(key(left.candidate_id, right.candidate_id), decision.question_id);
      supportedEndpoints.set(decision.question_id, [left.candidate_id, right.candidate_id]);
    }
  }

  const members: Candidate[][] = [];
  for (const candidate of candidates) {
    const matches = members.filter((group) => group.every((member) => supported.has(key(member.candidate_id, candidate.candidate_id))));
    if (matches.length === 1) matches[0]!.push(candidate);
    else {
      if (matches.length > 1) findings.push(`${candidate.candidate_id}: supported links conflict across incomplete alias groups`);
      members.push([candidate]);
    }
  }

  const applied = new Set<string>();
  const groups = members.map((group) => {
    for (let left = 0; left < group.length; left += 1) {
      for (const right of group.slice(left + 1)) applied.add(supported.get(key(group[left]!.candidate_id, right.candidate_id))!);
    }
    const representative = [...group].sort((left, right) => right.name.length - left.name.length || left.index - right.index)[0]!;
    const candidateId = group.length === 1 ? representative.candidate_id : `referent-${sha256(group.map((member) => member.candidate_id).join("/")).slice(0, 24)}`;
    return {
      ...representative,
      index: group[0]!.index,
      candidate_id: candidateId,
      members: group,
      findings: group.flatMap((member) => member.findings),
    };
  });
  const unappliedLinkIds = [...supported.values()].filter((id) => !applied.has(id));
  const groupByMember = new Map(groups.flatMap((group) => (group.members ?? [group]).map((member) => [member.candidate_id, group.candidate_id] as const)));
  const conflictedGroupIds = [...new Set(unappliedLinkIds.flatMap((id) => (supportedEndpoints.get(id) ?? []).map((memberId) => groupByMember.get(memberId)!)))];
  for (const groupId of conflictedGroupIds) findings.push(`${groupId}: supported alias link is unapplied; identity remains unresolved`);
  return { groups, unappliedLinkIds, conflictedGroupIds, findings };
}
