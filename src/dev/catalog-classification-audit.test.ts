import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  assertCompleteClassificationResult,
  assertDecisionActions,
  assertLocalEntityCoverage,
  assertMapProposalResults,
  assertQualificationCandidateLineage,
} from "./catalog-classification-audit.js";

const policy = {
  version: "reviewed",
  mode: "supported",
  calibration_evidence_hashes: ["review-hash"],
  rules: {
    entityQualification: { yes_threshold: 0.7, no_threshold: 0.3, choice_threshold: 0.8, require_repeat: false },
  },
};
const answer = {
  type: "choice",
  choice: "yes",
  confidence: 0.85,
  probabilities: { yes: 0.9, no: 0.05, unclear: 0.05 },
};
const action = {
  status: "supported",
  label: "yes",
  policy_version: "reviewed",
  policy_sha256: "" as string,
  findings: [] as string[],
};
const decision = () => ({
  question_id: "group-a",
  question_kind: "entityQualification",
  raw_answer: structuredClone(answer),
  action: structuredClone(action),
});
const entityQualification = () => decision();
const entityType = () => ({ question_id: "entityType-group-a", action: { status: "supported", label: "Location" } });

test("catalog audit binds top-level answers and statuses to raw responses and policy", () => {
  const policyHash = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  const row = decision();
  row.action.policy_sha256 = policyHash;
  const manifest = { policy };
  const stage = { answers: new Map([["group-a", structuredClone(answer)]]), repeats: new Map() };
  assert.doesNotThrow(() => assertDecisionActions([row], stage, manifest));
  const changedAnswer = structuredClone(row);
  changedAnswer.raw_answer.choice = "no";
  assert.throws(() => assertDecisionActions([changedAnswer], stage, manifest), /Retained answer differs from raw response/u);
  const changedAction = structuredClone(row);
  changedAction.action.status = "rejected";
  assert.throws(() => assertDecisionActions([changedAction], stage, manifest), /Retained action differs/u);
});

test("catalog audit requires a unique exact decision ID set", () => {
  const policyHash = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  const rowA = decision();
  rowA.action.policy_sha256 = policyHash;
  const rowB = { ...structuredClone(rowA), question_id: "group-b" };
  const stage = {
    answers: new Map([
      ["group-a", structuredClone(answer)],
      ["group-b", structuredClone(answer)],
    ]),
    repeats: new Map(),
  };
  const manifest = { policy };
  assert.doesNotThrow(() => assertDecisionActions([rowA, rowB], stage, manifest));
  assert.throws(() => assertDecisionActions([rowA], stage, manifest));
  const extra = { ...structuredClone(rowB), question_id: "group-c" };
  assert.throws(() => assertDecisionActions([rowA, extra], stage, manifest), /exactly cover/u);
  assert.throws(() => assertDecisionActions([rowA, structuredClone(rowA)], stage, manifest), /must be unique/u);
});

test("catalog audit detects missing local entities and incomplete or altered map outcomes", () => {
  const qualification = entityQualification();
  const typing = entityType();
  const entity = {
    qualification_decision_id: "group-a",
    type_decision_id: "entityType-group-a",
    type: "Location",
    local_entity_id: "local-a",
    place_proposal_ids: ["place-a"],
  };
  assert.doesNotThrow(() => assertLocalEntityCoverage([qualification], [typing], [entity]));
  assert.throws(() => assertLocalEntityCoverage([qualification], [typing], []), /cover every supported entityQualification yes/u);

  const proposal = {
    id: "place-a",
    qualification_question_ids: ["group-a"],
    missing_source_names: [],
    supported_subject_names: [],
    display_label: "Place A",
  };
  const result = {
    ...proposal,
    qualification_outcomes: [{ question_id: "group-a", action: qualification.action }],
    typing_outcomes: [{ question_id: "entityType-group-a", choice: "Location", action: typing.action }],
    local_entity_ids: ["local-a"],
    status: "qualified_location_proposal",
  };
  assert.doesNotThrow(() => assertMapProposalResults([proposal], { place_proposals: [result] }, [qualification], [typing], [entity]));
  assert.throws(() => assertMapProposalResults([proposal], { place_proposals: [] }, [qualification], [typing], [entity]));
  const changed = structuredClone(result);
  changed.qualification_outcomes[0].action.label = "no";
  assert.throws(() => assertMapProposalResults([proposal], { place_proposals: [changed] }, [qualification], [typing], [entity]));
});

test("catalog audit requires the retained classification root to be complete", () => {
  assert.doesNotThrow(() => assertCompleteClassificationResult({ status: "complete", full_product_status: "not_run" }));
  assert.throws(() => assertCompleteClassificationResult({ status: "failed", full_product_status: "not_run" }), /complete/u);
});

test("independent catalog audit rejects a substituted entityQualification candidate name", () => {
  const source = Buffer.from("Unified Church of the Realms (UCR)");
  const fullName = {
    candidate_id: "source-1",
    index: 0,
    name: "Unified Church of the Realms",
    occurrences: [{ start_byte: 0, end_byte: 28 }],
    findings: [],
  };
  const acronym = {
    candidate_id: "source-2",
    index: 1,
    name: "UCR",
    occurrences: [{ start_byte: 30, end_byte: 33 }],
    findings: [],
  };
  const group = { candidate_id: "alias-group-1", findings: [], members: [fullName, acronym] };
  const candidate = {
    kind: "source_candidate_group",
    candidate_id: group.candidate_id,
    names: [fullName.name, acronym.name],
    aliases: [acronym.name],
    members: [fullName, acronym].map((member) => ({
      candidate_id: member.candidate_id,
      name: member.name,
      source_evidence: member.occurrences,
    })),
    source_evidence: [...fullName.occurrences, ...acronym.occurrences],
    findings: [],
  };
  const qualificationInputs = {
    "group-alias-group-1": {
      candidate,
      source_candidate_ids: [fullName.candidate_id, acronym.candidate_id],
      place_proposal_ids: [],
      kind: "source_group",
    },
  };
  const audit = () =>
    assertQualificationCandidateLineage({
      groups: [group],
      qualificationInputs,
      mapProposals: [],
      sourceCandidates: [fullName, acronym],
      source,
    });
  assert.doesNotThrow(audit);
  qualificationInputs["group-alias-group-1"].candidate.names = ["Forged Council"];
  assert.throws(audit, /entityQualification candidate group-alias-group-1 lineage differs/u);
});
