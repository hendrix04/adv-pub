import { definitionsVersion } from "../decisions/questions.js";
import { questionPolicySchema, type QuestionPolicy } from "../decisions/policy.js";
import { sha256 } from "../decisions/integrity.js";

const questionKinds = ["aliasIdentity", "entityQualification", "entityType"] as const;

export function classificationRepeatId(stageId: string, policy: QuestionPolicy, kind: (typeof questionKinds)[number]) {
  return policy.rules[kind]?.require_repeat ? `${stageId}-repeat-${sha256(JSON.stringify(policy)).slice(0, 16)}` : undefined;
}

export function exploratoryClassificationPolicy(): QuestionPolicy {
  const rule = { yes_threshold: 0.5, no_threshold: 0.5, choice_threshold: 0.5, require_repeat: false };
  return questionPolicySchema.parse({
    contract_version: "decision-policy-v2",
    definitions_version: definitionsVersion,
    version: "catalog-classification-exploratory-v1",
    mode: "exploratory",
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: [],
    rules: Object.fromEntries(questionKinds.map((kind) => [kind, rule])),
  });
}

export function supportedClassificationPolicy(input: {
  version: string;
  choiceThresholds: Record<(typeof questionKinds)[number], number>;
  evidenceHashes: string[];
}): QuestionPolicy {
  if (!input.evidenceHashes.length || input.evidenceHashes.some((hash) => !/^[0-9a-f]{64}$/i.test(hash))) {
    throw new Error("Supported aliasIdentity–entityType policy requires SHA-256 source-review evidence");
  }
  const rules = Object.fromEntries(
    questionKinds.map((kind) => [
      kind,
      {
        yes_threshold: 0.5,
        no_threshold: 0.5,
        choice_threshold: input.choiceThresholds[kind],
        require_repeat: false,
      },
    ]),
  );
  return questionPolicySchema.parse({
    contract_version: "decision-policy-v2",
    definitions_version: definitionsVersion,
    version: input.version,
    mode: "supported",
    probability_sum_tolerance: 0.02,
    confidence_tolerance: 0.02,
    calibration_evidence_hashes: input.evidenceHashes,
    rules,
  });
}

export function assertSupportedClassificationPolicy(policy: QuestionPolicy): void {
  questionPolicySchema.parse(policy);
  if (policy.mode !== "supported" || questionKinds.some((kind) => !policy.rules[kind]) || !policy.calibration_evidence_hashes.length) {
    throw new Error("Classification live execution requires a reviewed supported aliasIdentity–entityType policy");
  }
}
