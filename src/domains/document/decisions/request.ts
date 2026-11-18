import type { DecisionsRequest } from "@openrouter/sdk/models";
import { decodeCapturedSource, type CapturedSource } from "../discovery/source.js";
import type { PreparedRequestQuestion } from "./questions.js";
import { sha256, type Manifest } from "./contracts.js";
import { jevExecutionPolicy } from "./execution-policy.js";

export function sharedRuleEvidence(questions: PreparedRequestQuestion[]) {
  const evidence = questions.flatMap((question) => (question.entity_rules ? [question.entity_rules] : []));
  if (evidence.some((rule) => JSON.stringify(rule) !== JSON.stringify(evidence[0]))) throw new Error("Conflicting shared rule evidence");
  return evidence[0] ?? null;
}
export function buildDecisionRequest(input: { source: CapturedSource; questions: PreparedRequestQuestion[]; targetMode: "single" | "batch" }): DecisionsRequest {
  const { source, questions, targetMode } = input;
  if (!questions.length || questions.some((q) => !q.id) || new Set(questions.map((q) => q.id)).size !== questions.length) throw new Error("Empty or duplicate question IDs");
  if (targetMode !== "single" && targetMode !== "batch") throw new Error("Invalid target mode");
  if (targetMode === "single" && questions.length !== 1) throw new Error("Single target requires exactly one question");
  const captured = decodeCapturedSource(source.bytes);
  if (captured.text !== source.text || captured.sha256 !== source.sha256 || captured.byteLength !== source.byteLength) throw new Error("Captured source differs");
  const state: Record<string, unknown> = {
    complete_source: source.text,
    source_sha256: source.sha256,
    source_byte_length: source.byteLength,
  };
  if (targetMode === "single") state.target = questions[0]!.target;
  else state.targets = Object.fromEntries(questions.map((q) => [q.id, q.target]));
  const rules = sharedRuleEvidence(questions);
  if (rules) state.entity_rules = rules.governingRules;
  return {
    model: jevExecutionPolicy.model,
    provider: { only: [jevExecutionPolicy.provider], allowFallbacks: jevExecutionPolicy.allowFallbacks },
    state,
    questions: Object.fromEntries(
      questions.map((q) => [
        q.id,
        {
          ...q.question,
          instructions:
            targetMode === "single"
              ? q.question.instructions
              : q.question.instructions.replace(/target\.(\w+)/g, (_, field: string) => `targets[${JSON.stringify(q.id)}].${field}`),
        },
      ]),
    ),
  };
}

export function planDecisionBatches<T>(items: T[], inputLimit: number, maximumQuestions: number, build: (items: T[]) => DecisionsRequest): Manifest["batches"] {
  const batches: Manifest["batches"] = [];
  for (let offset = 0; offset < items.length; ) {
    let count = Math.min(maximumQuestions, items.length - offset);
    while (count) {
      const request = build(items.slice(offset, offset + count));
      const bound = Buffer.byteLength(JSON.stringify(request)) + 2048;
      if (bound <= inputLimit) {
        batches.push({
          batch_id: `batch-${String(batches.length).padStart(3, "0")}`,
          batch_sha256: sha256(JSON.stringify(request)),
          candidate_ids: Object.keys(request.questions),
          request: request as unknown as Record<string, unknown>,
          input_upper_bound_tokens: bound,
        });
        offset += count;
        break;
      }
      count -= 1;
    }
    if (!count) throw new Error(`Decision ${offset} cannot fit with complete source and required context`);
  }
  return batches;
}
