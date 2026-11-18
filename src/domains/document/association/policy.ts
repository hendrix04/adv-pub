import type { QuestionPolicy } from "../decisions/policy.js";

const noul = { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true } as const;
const choice = { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false } as const;

export function exploratoryAssociationPolicy(): QuestionPolicy {
  return {
    contract_version: "decision-policy-v2",
    definitions_version: "document-questions-v2",
    version: "association-exploratory-v1",
    mode: "exploratory",
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [],
    rules: {
      blockSubject: { ...noul },
      subjectContinuation: { ...noul },
      sectionSubject: { ...noul },
      documentSubject: { ...noul },
      passageMeaning: { ...choice },
      textOrigin: { ...choice },
    },
  };
}
