import { join } from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "./artifacts.js";
import type { EvidenceFinding } from "./response.js";
import type { ModelEndpoint, Route } from "./provider.js";
import { modelId } from "./provider.js";
import { decodeProposalContent, renderCandidateView, validateProposals } from "./response.js";
import type { CapturedSource } from "./source.js";

export type FindingBundle = {
  status: "valid" | "findings" | "invalid_json";
  schema: Array<{ path: string; message: string }>;
  evidence: EvidenceFinding[];
  source_keys: Array<{ key: string; message: string }>;
  served_settings: Array<{
    setting: string;
    requested: unknown;
    served: unknown;
    status: "verified" | "mismatch" | "unreported";
  }>;
};

function responseContent(result: Record<string, unknown>): unknown {
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  return message?.content;
}

function responseFailureMessage(result: Record<string, unknown>, finding: string): string {
  const error = result.error as Record<string, unknown> | undefined;
  if (error && typeof error === "object") {
    const metadata = error.metadata as Record<string, unknown> | undefined;
    const errorType = typeof metadata?.error_type === "string" ? metadata.error_type : "provider error";
    const code = typeof error.code === "number" ? ` (${error.code})` : "";
    return `OpenRouter error envelope ${errorType}${code}; no assistant completion text was available.`;
  }
  return finding;
}

export function failureCandidateView(result: Record<string, unknown>, finding: string): string {
  const error = result.error as Record<string, unknown> | undefined;
  if (error && typeof error === "object") {
    const metadata = error.metadata as Record<string, unknown> | undefined;
    const errorType = typeof metadata?.error_type === "string" ? metadata.error_type : "provider error";
    const code = typeof error.code === "number" ? ` (${error.code})` : "";
    return `# Entity candidate proposals\n\nOpenRouter returned provider error ${errorType}${code}; no assistant completion text was available. The original error envelope and response body are retained for inspection.\n`;
  }
  if (typeof responseContent(result) === "string") {
    return `# Entity candidate proposals\n\nAssistant completion text could not be decoded as proposal JSON (${finding}). The malformed text and untouched SDK response are retained.\n`;
  }
  return "# Entity candidate proposals\n\nNo assistant completion text was available. The untouched SDK response is retained for inspection.\n";
}

export function servedChecks(result: Record<string, unknown>, route: Route): FindingBundle["served_settings"] {
  const metadata = result.openrouterMetadata as Record<string, unknown> | undefined;
  const endpoints = metadata?.endpoints as { available?: Array<Record<string, unknown>> } | undefined;
  const selected = endpoints?.available?.filter((endpoint) => endpoint.selected === true) ?? [];
  const provider = selected.length === 1 ? String(selected[0]?.provider ?? "") : undefined;
  const servedTier = typeof result.serviceTier === "string" ? result.serviceTier : undefined;
  const servedModel = typeof result.model === "string" ? result.model : undefined;
  const firstChoice = Array.isArray(result.choices) ? (result.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const hasCompletion = typeof message?.content === "string";
  return [
    {
      setting: "model",
      requested: modelId,
      served: servedModel ?? null,
      status: !servedModel ? "unreported" : servedModel === modelId ? "verified" : "mismatch",
    },
    {
      setting: "provider",
      requested: route.providerOnly[0],
      served: provider ?? null,
      status: !provider ? "unreported" : provider.toLowerCase() === "openai" ? "verified" : "mismatch",
    },
    {
      setting: "service_tier",
      requested: route.serviceTier,
      served: servedTier ?? null,
      status: !servedTier ? "unreported" : servedTier === route.serviceTier ? "verified" : "mismatch",
    },
    { setting: "reasoning_effort", requested: "high", served: null, status: "unreported" },
    {
      setting: "structured_output",
      requested: "strict JSON Schema",
      served: hasCompletion ? "assistant completion received" : null,
      status: hasCompletion ? "verified" : "unreported",
    },
  ];
}

function proposalCounts(payload: unknown): Record<string, number> {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => Array.isArray(value[key]))
      .map((key) => [key, Array.isArray(value[key]) ? (value[key] as unknown[]).length : 0]),
  );
}

export async function saveFindings(
  directory: string,
  raw: Record<string, unknown>,
  schema: unknown,
  source: CapturedSource,
  route: Route,
): Promise<{ findings: FindingBundle; counts: Record<string, number> }> {
  const content = responseContent(raw);
  const decoded = decodeProposalContent(content);
  const routeFindings = servedChecks(raw, route);
  if (decoded.decoded !== undefined) {
    await writeJsonAtomic(join(directory, "decoded-proposals.json"), decoded.decoded);
  } else if (typeof content === "string") {
    await writeTextAtomic(join(directory, "malformed-output.txt"), content);
  }
  const validation =
    decoded.decoded === undefined
      ? {
          schema: [
            {
              path: "/",
              message: responseFailureMessage(raw, decoded.finding ?? "Response did not contain JSON proposals."),
            },
          ],
          evidence: [],
          sourceKeys: [],
        }
      : validateProposals(decoded.decoded, schema, source.text);
  const findings: FindingBundle = {
    status:
      decoded.decoded === undefined
        ? "invalid_json"
        : validation.schema.length ||
            validation.evidence.some((item) => item.status !== "verified") ||
            validation.sourceKeys.length ||
            routeFindings.some((item) => item.status === "mismatch")
          ? "findings"
          : "valid",
    schema: validation.schema,
    evidence: validation.evidence,
    source_keys: validation.sourceKeys,
    served_settings: routeFindings,
  };
  await writeJsonAtomic(join(directory, "validation-findings.json"), findings);
  await writeTextAtomic(
    join(directory, "candidate-view.md"),
    decoded.decoded === undefined
      ? failureCandidateView(raw, decoded.finding ?? "Response did not contain JSON proposals.")
      : renderCandidateView(decoded.decoded, {
          schema: findings.schema,
          evidence: findings.evidence,
          sourceKeys: findings.source_keys,
        }),
  );
  return { findings, counts: proposalCounts(decoded.decoded) };
}
