import assert from "node:assert/strict";

// Independent emitted-entity and candidate lineage checks; no product validators.
export function assertSourceSpans(value: unknown, source: Buffer, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSourceSpans(entry, source, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (Number.isInteger(record.start_byte) && Number.isInteger(record.end_byte) && typeof record.text === "string") {
    const start = record.start_byte as number;
    const end = record.end_byte as number;
    assert.ok(start >= 0 && end >= start && end <= source.byteLength, `${label} source span is outside the source`);
    assert.equal(source.subarray(start, end).toString("utf8"), record.text, `${label} source span differs`);
  }
  for (const [key, entry] of Object.entries(record)) assertSourceSpans(entry, source, `${label}.${key}`);
}

export function assertSame(left: unknown, right: unknown, label: string) {
  assert.deepEqual(left, right, `${label} lineage differs`);
}

export function assertLocalEntityCoverage(entityQualificationDecisions: any[], entityTypeDecisions: any[], localEntities: any[]) {
  const entityTypeById = new Map(entityTypeDecisions.map((decision) => [decision.question_id, decision]));
  const expected = entityQualificationDecisions
    .filter((decision) => decision.action.status === "supported" && decision.action.label === "yes")
    .filter((decision) => entityTypeById.get(`entityType-${decision.question_id}`)?.action.status === "supported")
    .map((decision) => decision.question_id)
    .sort();
  assert.deepEqual(
    localEntities.map((entity) => entity.qualification_decision_id).sort(),
    expected,
    "Local entity set must cover every supported entityQualification yes with supported entityType evidence exactly once",
  );
  assert.equal(new Set(localEntities.map((entity) => entity.qualification_decision_id)).size, localEntities.length);
}

export function assertMapProposalResults(inputProposals: any[], packageData: any, entityQualificationDecisions: any[], entityTypeDecisions: any[], localEntities: any[]) {
  const entityQualificationById = new Map(entityQualificationDecisions.map((decision) => [decision.question_id, decision]));
  const entityTypeById = new Map(entityTypeDecisions.map((decision) => [decision.question_id, decision]));
  const resultProposals: any[] = packageData.place_proposals;
  assert.deepEqual(
    resultProposals.map((proposal) => proposal.id),
    inputProposals.map((proposal) => proposal.id),
  );
  for (const [index, proposal] of inputProposals.entries()) {
    const resultProposal = resultProposals[index];
    const entityQualificationActions = proposal.qualification_question_ids.map((id: string) => entityQualificationById.get(id)).filter(Boolean);
    const entityTypeActions = entityQualificationActions.map((decision: any) => entityTypeById.get(`entityType-${decision.question_id}`)).filter(Boolean);
    const locationEntities = localEntities.filter((entity) => entity.type === "Location" && entity.place_proposal_ids.includes(proposal.id));
    const status = proposal.missing_source_names.length
      ? "discovery_correction_required"
      : locationEntities.length
        ? "qualified_location_proposal"
        : entityQualificationActions.some((decision: any) => decision.action.status === "unresolved") ||
            entityTypeActions.some((decision: any) => decision.action.status === "unresolved")
          ? "unresolved"
          : entityQualificationActions.some((decision: any) => decision.action.status === "provisional")
            ? "provisional"
            : "no_supported_location";
    assert.deepEqual(resultProposal, {
      ...proposal,
      qualification_outcomes: entityQualificationActions.map((decision: any) => ({
        question_id: decision.question_id,
        action: decision.action,
      })),
      typing_outcomes: entityTypeActions.map((decision: any) => ({
        question_id: decision.question_id,
        choice: decision.action.label,
        action: decision.action,
      })),
      local_entity_ids: locationEntities.map((entity) => entity.local_entity_id),
      status,
    });
    assert.equal(resultProposal.supported_subject_names.length, 0);
  }
}

export function assertQualificationCandidateLineage(input: {
  groups: any[];
  qualificationInputs: Record<string, any>;
  mapProposals: any[];
  sourceCandidates: any[];
  source: Buffer;
}) {
  const unnamedIds = input.mapProposals.flatMap((proposal) => (proposal.unnamed_descriptor_question_id ? [proposal.unnamed_descriptor_question_id] : []));
  const expectedIds = [
    ...input.groups.filter((group) => (group.members ?? [group]).every((member: any) => member.occurrences.length > 0)).map((group) => `group-${group.candidate_id}`),
    ...unnamedIds,
  ].sort();
  assert.deepEqual(Object.keys(input.qualificationInputs).sort(), expectedIds);
  const sourceById = new Map(input.sourceCandidates.map((candidate) => [candidate.candidate_id, candidate]));
  for (const group of input.groups.filter((entry) => (entry.members ?? [entry]).every((member: any) => member.occurrences.length > 0))) {
    const id = `group-${group.candidate_id}`;
    const members = group.members ?? [group];
    const candidate = {
      kind: "source_candidate_group",
      candidate_id: group.candidate_id,
      names: members.map((member: any) => member.name),
      aliases: members.slice(1).map((member: any) => member.name),
      members: members.map((member: any) => ({
        candidate_id: member.candidate_id,
        name: member.name,
        source_evidence: member.occurrences,
      })),
      source_evidence: members.flatMap((member: any) => member.occurrences),
      findings: group.findings,
    };
    assertSame(input.qualificationInputs[id].candidate, candidate, `entityQualification candidate ${id}`);
    assert.equal(input.qualificationInputs[id].kind, "source_group");
    assertSame(
      input.qualificationInputs[id].source_candidate_ids,
      members.map((member: any) => member.candidate_id),
      `entityQualification source candidate IDs ${id}`,
    );
    for (const member of members) assertSame(sourceById.get(member.candidate_id), member, `aliasIdentity source candidate ${member.candidate_id}`);
    const placeIds = input.mapProposals.filter((proposal) => proposal.qualification_question_ids.includes(id)).map((proposal) => proposal.id);
    assertSame(input.qualificationInputs[id].place_proposal_ids, placeIds, `entityQualification map proposal IDs ${id}`);
    assertSourceSpans(input.qualificationInputs[id].candidate, input.source, `entityQualification candidate ${id}`);
  }
  for (const proposal of input.mapProposals)
    if (proposal.unnamed_descriptor_question_id) {
      const id = proposal.unnamed_descriptor_question_id;
      const candidate = {
        kind: "unnamed_map_place_descriptor",
        candidate_id: id,
        source_descriptor: proposal.entry_components.map((part: any) => part.text).join(""),
        source_evidence: proposal.entry_components,
        map_key_id: proposal.map_key_id,
        entry_number: proposal.number,
      };
      assertSame(input.qualificationInputs[id].candidate, candidate, `Unnamed entityQualification candidate ${id}`);
      assert.equal(input.qualificationInputs[id].kind, "map_place_descriptor");
      assertSame(input.qualificationInputs[id].source_candidate_ids, [], `Unnamed entityQualification source candidate IDs ${id}`);
      assertSame(input.qualificationInputs[id].place_proposal_ids, [proposal.id], `Unnamed entityQualification map proposal IDs ${id}`);
      assertSourceSpans(candidate, input.source, `Unnamed entityQualification candidate ${id}`);
    }
  return expectedIds;
}
