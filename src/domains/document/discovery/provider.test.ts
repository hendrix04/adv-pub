import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectionError, RequestAbortedError, RequestTimeoutError } from "@openrouter/sdk/models/errors/httpclienterrors.js";
import { conservativeChargeBound, findVerifiedRoutesFromMetadata, maxCompletionTokens, modelId, routeForRetry, type ModelEndpoint } from "./provider.js";
import { classifyTransportFailure } from "./provider.js";

const endpoint: ModelEndpoint = {
  provider_name: "OpenAI",
  tag: "openai/flex",
  status: 0,
  supported_parameters: [],
  pricing: {
    prompt: "0.00000005",
    completion: "0.00000025",
    input_cache_write: "0.0000000625",
    overrides: [{ min_prompt_tokens: 272_000, prompt: "0.0000001", completion: "0.000000375" }],
  },
};

test("GPT-6.1 Sol is the ongoing default discovery model", () => {
  assert.equal(modelId, "openai/gpt-6.1-sol");
});

test("OpenRouter per-token endpoint prices produce a conservative dollar reservation", () => {
  assert.ok(Math.abs(conservativeChargeBound(endpoint, 10_000) - (10_512 * 0.0000000625 + maxCompletionTokens * 0.00000025)) < 1e-12);
  endpoint.pricing.overrides![0]!.input_cache_write = "0.000000125";
  assert.ok(Math.abs(conservativeChargeBound(endpoint, 272_000) - (272_512 * 0.000000125 + maxCompletionTokens * 0.000000375)) < 1e-12);
});

test("official OpenRouter timeout and connection errors use Hatchet retry policy", () => {
  assert.equal(classifyTransportFailure(new RequestTimeoutError("Request timed out")).retryable, true);
  assert.equal(classifyTransportFailure(new ConnectionError("Unable to make a request", { cause: new Error("fetch failed") })).retryable, true);
  assert.equal(classifyTransportFailure(new RequestAbortedError("Request aborted")).retryable, false);
});

test("unavailable Flex metadata still allows Hatchet's third attempt to select standard", () => {
  const flex = { ...endpoint, status: -2 };
  const standard: ModelEndpoint = {
    ...endpoint,
    tag: "openai",
    status: 0,
    pricing: { prompt: "0.0000001", completion: "0.0000005" },
  };
  for (const modelEndpoint of [flex, standard]) {
    modelEndpoint.supported_parameters = ["reasoning", "reasoning_effort", "response_format", "structured_outputs"];
  }
  const endpoints = findVerifiedRoutesFromMetadata([flex, standard], 1024);

  assert.equal(routeForRetry(0, endpoints).endpoint.tag, "openai/flex");
  assert.equal(routeForRetry(1, endpoints).endpoint.tag, "openai/flex");
  assert.equal(routeForRetry(2, endpoints).endpoint.tag, "openai");
});
