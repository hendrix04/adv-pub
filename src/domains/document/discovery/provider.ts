import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HTTPClient, OpenRouter, type Fetcher } from "@openrouter/sdk";
import { chargeBound } from "./budget.js";

const supportedDiscoveryModels = new Set(["openai/gpt-6-luna", "openai/gpt-6.1-sol"]);
const configuredModel = process.env.ADV_PUB_DISCOVERY_MODEL ?? "openai/gpt-6.1-sol";
if (!supportedDiscoveryModels.has(configuredModel)) {
  throw new Error("ADV_PUB_DISCOVERY_MODEL is restricted to the explicitly supported discovery test models");
}
export const modelId = configuredModel;
export const maxCompletionTokens = 60_000;
export const requestTimeoutMs = 600_000;
export const retryPolicy = [
  { attempt: 1, serviceTier: "flex", providerOnly: ["openai/flex"] },
  { attempt: 2, serviceTier: "flex", providerOnly: ["openai/flex"] },
  { attempt: 3, serviceTier: "default", providerOnly: ["openai"] },
] as const;

export type ModelEndpoint = {
  provider_name: string;
  tag: string;
  status: number;
  max_prompt_tokens?: number | null;
  max_completion_tokens?: number | null;
  supported_parameters: string[];
  pricing: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
    input_cache_write?: string;
    overrides?: Array<{
      min_prompt_tokens: number;
      prompt: string;
      completion: string;
      input_cache_read?: string;
      input_cache_write?: string;
    }>;
  };
};

export type Route = {
  attempt: 1 | 2 | 3;
  serviceTier: "flex" | "default";
  providerOnly: readonly string[];
  endpoint: ModelEndpoint;
};

function validEndpoint(endpoint: ModelEndpoint | undefined): endpoint is ModelEndpoint {
  return Boolean(
    endpoint &&
      endpoint.provider_name.toLowerCase() === "openai" &&
      ["reasoning", "reasoning_effort", "response_format", "structured_outputs"].every((name) => endpoint.supported_parameters.includes(name)),
  );
}

export function findVerifiedRoutesFromMetadata(endpoints: ModelEndpoint[], promptAndSchemaBytes: number): [ModelEndpoint, ModelEndpoint] {
  const flex = endpoints.find((endpoint) => endpoint.tag === "openai/flex");
  const standard = endpoints.find((endpoint) => endpoint.tag === "openai");
  if (!validEndpoint(flex) || !validEndpoint(standard)) {
    throw new Error(`${modelId} OpenAI Flex and standard endpoints must both be present and support requested parameters`);
  }
  for (const endpoint of [flex, standard]) {
    if (endpoint.max_prompt_tokens != null && promptAndSchemaBytes > endpoint.max_prompt_tokens) {
      throw new Error(`Complete source and prompt exceed the ${endpoint.tag} input limit`);
    }
    if (endpoint.max_completion_tokens != null && endpoint.max_completion_tokens < maxCompletionTokens) {
      throw new Error(`The ${endpoint.tag} endpoint cannot honor the bounded completion allowance`);
    }
  }
  return [flex, standard];
}

export async function findVerifiedRoutes(promptAndSchemaBytes: number): Promise<[ModelEndpoint, ModelEndpoint]> {
  const response = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter endpoint metadata request failed with HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { endpoints?: ModelEndpoint[] } };
  return findVerifiedRoutesFromMetadata(body.data?.endpoints ?? [], promptAndSchemaBytes);
}

export function routeForRetry(retryCount: number, endpoints: [ModelEndpoint, ModelEndpoint]): Route {
  if (retryCount < 0 || retryCount > 2 || !Number.isInteger(retryCount)) {
    throw new Error(`Hatchet retry count ${retryCount} is outside the three-attempt policy`);
  }
  const policy = retryPolicy[retryCount]!;
  return {
    ...policy,
    attempt: policy.attempt as 1 | 2 | 3,
    endpoint: endpoints[retryCount === 2 ? 1 : 0],
  };
}

export function conservativeChargeBound(endpoint: ModelEndpoint, inputBytes: number): number {
  const threshold = endpoint.pricing.overrides?.[0]?.min_prompt_tokens ?? Number.POSITIVE_INFINITY;
  const override = endpoint.pricing.overrides?.find((item) => inputBytes + 512 >= item.min_prompt_tokens);
  return chargeBound({
    inputBytes,
    outputTokenLimit: maxCompletionTokens,
    promptPricePerToken: Number(endpoint.pricing.prompt),
    inputCacheWritePricePerToken: Number(endpoint.pricing.input_cache_write ?? endpoint.pricing.prompt),
    completionPricePerToken: Number(endpoint.pricing.completion),
    promptThreshold: threshold,
    overThresholdPromptPricePerToken: override ? Number(override.prompt) : undefined,
    overThresholdInputCacheWritePricePerToken: override?.input_cache_write ? Number(override.input_cache_write) : undefined,
    overThresholdCompletionPricePerToken: override ? Number(override.completion) : undefined,
  });
}

function readEnvValue(envText: string, key: string): string | undefined {
  const line = envText.split(/\r?\n/).find((entry) => entry.trimStart().startsWith(`${key}=`));
  if (!line) return undefined;
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
}

export async function loadApiKey(): Promise<string> {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  const envPath = resolve(process.cwd(), ".env");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch {
    // The absent file is reported by the same credential-free error below.
  }
  const key = readEnvValue(contents, "OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY is required (value not displayed)");
  return key;
}

export function createOpenRouterClient(apiKey: string, fetcher?: Fetcher): OpenRouter {
  return new OpenRouter({
    apiKey,
    retryConfig: { strategy: "none" },
    timeoutMs: requestTimeoutMs,
    httpClient: fetcher ? new HTTPClient({ fetcher }) : undefined,
  });
}

export function endpointPriceRecord(endpoint: ModelEndpoint): Record<string, unknown> {
  return {
    provider: endpoint.provider_name,
    tag: endpoint.tag,
    status: endpoint.status,
    pricing: endpoint.pricing,
    max_prompt_tokens: endpoint.max_prompt_tokens,
    max_completion_tokens: endpoint.max_completion_tokens,
    supported_parameters: endpoint.supported_parameters,
  };
}

export function classifyTransportFailure(error: unknown): { retryable: boolean; safeMessage: string; status?: number } {
  const value = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const response = typeof value.response === "object" && value.response !== null ? (value.response as Record<string, unknown>) : {};
  const statusValue = value.status ?? value.statusCode ?? response.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const message = String(value.message ?? error ?? "Unknown OpenRouter request failure");
  const lower = message.toLowerCase();
  const errorName = String(value.name ?? "");
  const retryableSdkTransport = errorName === "RequestTimeoutError" || errorName === "ConnectionError";
  const explicitAbort = errorName === "RequestAbortedError";
  const causes: unknown[] = [];
  let cause = value.cause;
  for (let depth = 0; depth < 4 && cause !== undefined; depth += 1) {
    causes.push(cause);
    cause = typeof cause === "object" && cause !== null ? (cause as Record<string, unknown>).cause : undefined;
  }
  const causeText = causes
    .map((item) => (item instanceof Error ? `${item.name} ${item.message}` : String(item)))
    .join(" ")
    .toLowerCase();
  const networkTransient = [lower, causeText].some((text) =>
    ["econnreset", "econnrefused", "etimedout", "eai_again", "ehostunreach", "epipe", "fetch failed", "network error"].some((part) => text.includes(part)),
  );
  const transientStatus = status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  const retryable = !explicitAbort && (retryableSdkTransport || networkTransient || transientStatus);
  return {
    retryable,
    status,
    safeMessage: message.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"),
  };
}
