import type { DecisionsRequest } from "@openrouter/sdk/models";
import { isDeepStrictEqual } from "node:util";
import { DecisionsRequest$outboundSchema, decisionsRequestToJSON } from "@openrouter/sdk/models";
import { z } from "zod";
import { decodeCapturedSource } from "../../domains/document/discovery/source.js";
import { assertSemanticSource } from "../../domains/document/decisions/semantic-input.js";
import { buildDecisionRequest } from "../../domains/document/decisions/request.js";
import { jevModel, jevProvider } from "../../domains/document/decisions/execution-policy.js";
import type { PreparedRequestQuestion } from "../../domains/document/decisions/questions.js";

const questionSchema = z.object({
  id: z.string().trim().min(1).max(150),
  type: z.enum(["choice", "noul", "score"]),
  instructions: z.unknown(),
  criteria: z.unknown(),
  target: z.record(z.string(), z.unknown()).default({}),
  macro: z.string().optional(),
});
const experimentSchema = z.object({
  source: z.string(),
  extraState: z.record(z.string(), z.unknown()).default({}),
  questions: z.array(questionSchema).min(1).max(50),
});

function checkQuestions(request: DecisionsRequest) {
  const entries = Object.entries(request.questions);
  if (!entries.length || entries.length > 50) throw new Error("Use between 1 and 50 questions per request.");
  for (const [id, question] of entries) {
    if (!id.trim()) throw new Error("Each question needs an ID.");
    if (typeof question.instructions === "string" && !question.instructions.trim()) throw new Error(id + ": write a question first.");
    if (question.type === "choice" && (Object.keys(question.criteria).length < 2 || Object.keys(question.criteria).length > 255))
      throw new Error(id + ": choice needs 2–255 answer options.");
    if (question.type === "score" && (question.criteria.length < 2 || question.criteria.length > 10)) throw new Error(id + ": score needs 2–10 levels.");
    if (question.type === "noul" && question.criteria && Object.keys(question.criteria).some((key) => key !== "true" && key !== "false"))
      throw new Error(id + ": yes/no criteria must use true and false.");
  }
}

export function validateWireRequest(raw: unknown) {
  const wire = z
    .object({
      model: z.literal(jevModel),
      provider: z.object({ only: z.tuple([z.literal(jevProvider)]), allow_fallbacks: z.literal(false) }).strict(),
      state: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
      questions: z.record(z.string(), z.unknown()),
      session_id: z.string().max(256).optional(),
      trace: z.record(z.string(), z.unknown()).optional(),
      user: z.string().optional(),
    })
    .strict()
    .parse(raw);
  const request = {
    model: wire.model,
    provider: { only: [jevProvider], allowFallbacks: false },
    state: wire.state,
    questions: wire.questions,
    sessionId: wire.session_id,
    trace:
      wire.trace === undefined
        ? undefined
        : {
            generationName: wire.trace.generation_name,
            parentSpanId: wire.trace.parent_span_id,
            spanName: wire.trace.span_name,
            traceId: wire.trace.trace_id,
            traceName: wire.trace.trace_name,
            additionalProperties: wire.trace,
          },
    user: wire.user,
  } as DecisionsRequest;
  DecisionsRequest$outboundSchema.parse(request);
  checkQuestions(request);
  const source = sourceForRequest(request);
  if (source) assertSemanticSource(request, source);
  const serialized = JSON.parse(decisionsRequestToJSON(request)) as Record<string, unknown>;
  if (!isDeepStrictEqual(serialized, wire)) throw new Error("SDK serialization would change this request. Remove unsupported fields or use the supported wire contract.");
  return { request, wire: serialized };
}

export function buildExperiment(raw: unknown) {
  const experiment = experimentSchema.parse(raw);
  if (new Set(experiment.questions.map((q) => q.id)).size !== experiment.questions.length) throw new Error("Question IDs must be unique.");
  const source = decodeCapturedSource(Buffer.from(experiment.source, "utf8"));
  const prepared = experiment.questions.map((q) => ({
    id: q.id,
    target: q.target,
    entity_rules: null,
    question: { type: q.type, instructions: q.instructions, criteria: q.criteria },
  })) as PreparedRequestQuestion[];
  const request = buildDecisionRequest({ source, questions: prepared, targetMode: prepared.length === 1 ? "single" : "batch" });
  request.state = { ...experiment.extraState, ...(request.state as Record<string, unknown>) };
  return validateWireRequest(JSON.parse(decisionsRequestToJSON(request)));
}

export function sourceForRequest(request: DecisionsRequest): Buffer | undefined {
  const state = request.state;
  if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.complete_source !== "string") return undefined;
  if (!Object.hasOwn(state, "source_sha256") && !Object.hasOwn(state, "source_byte_length")) return undefined;
  return Buffer.from(state.complete_source, "utf8");
}

/** Use forms only when reconstructing them preserves the entire validated request. */
export function experimentForWire(raw: unknown) {
  const prepared = validateWireRequest(raw);
  const state = prepared.request.state;
  if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.complete_source !== "string") return undefined;
  const extraState = { ...state };
  for (const key of ["complete_source", "source_sha256", "source_byte_length", "targets", "target"]) delete extraState[key];
  const targets = state.targets as Record<string, unknown> | undefined;
  const questions = Object.entries(prepared.request.questions).map(([id, question]) => ({
    id,
    ...question,
    target: targets?.[id] ?? state.target ?? {},
    instructions: typeof question.instructions === "string" ? question.instructions.split("targets[" + JSON.stringify(id) + "]").join("target") : question.instructions,
  }));
  const experiment = { source: state.complete_source, extraState, questions };
  try {
    return isDeepStrictEqual(buildExperiment(experiment).wire, prepared.wire) ? experiment : undefined;
  } catch {
    return undefined;
  }
}
