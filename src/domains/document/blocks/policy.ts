import { definitionsVersion } from "../decisions/questions.js";
import type { QuestionPolicy } from "../decisions/policy.js";

export function exploratoryStructurePolicy(): QuestionPolicy {
  const rule = { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: true };
  return {
    contract_version: "decision-policy-v2",
    definitions_version: definitionsVersion,
    version: "blocks-exploratory-v1",
    mode: "exploratory",
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [],
    rules: { title: rule, listIntroduction: rule, mapLabels: rule, linkPlacement: rule },
  };
}
