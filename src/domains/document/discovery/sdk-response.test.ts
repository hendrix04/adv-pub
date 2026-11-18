import assert from "node:assert/strict";
import test from "node:test";
import { rejectedSdkResponse, shouldRetryRejectedProviderError } from "./sdk-response.js";
import { routeForRetry, type ModelEndpoint } from "./provider.js";

test("SDK validation errors retain the exact HTTP body and parsed usage", () => {
  const body = '{"id":"generation-1","usage":{"cost":0.012},"choices":[]}';
  const captured = rejectedSdkResponse(
    Object.assign(new Error("Response validation failed"), {
      name: "ResponseValidationError",
      statusCode: 200,
      body,
      rawValue: { id: "generation-1", usage: { cost: 0.012 }, choices: [] },
    }),
  );

  assert.equal(captured?.bodyText, body);
  assert.deepEqual(captured?.response, JSON.parse(body));
  assert.equal(captured?.actualCostUsd, 0.012);
});

test("a 200 envelope carrying provider_unavailable is classified for Hatchet retry", () => {
  const captured = rejectedSdkResponse(
    Object.assign(new Error("Response validation failed"), {
      name: "ResponseValidationError",
      statusCode: 200,
      body: '{"error":{"message":"Flex unavailable","code":502,"metadata":{"error_type":"provider_unavailable"}}}',
    }),
  );

  assert.equal(captured?.retryableProviderError, true);
  assert.equal(captured?.response?.error && typeof captured.response.error, "object");
  assert.equal(shouldRetryRejectedProviderError(captured, 0), true);
  assert.equal(shouldRetryRejectedProviderError(captured, 1), true);
  assert.equal(shouldRetryRejectedProviderError(captured, 2), false);

  const flex: ModelEndpoint = {
    provider_name: "OpenAI",
    tag: "openai/flex",
    status: 0,
    supported_parameters: [],
    pricing: { prompt: "0", completion: "0" },
  };
  const standard = { ...flex, tag: "openai" };
  const endpoints: [ModelEndpoint, ModelEndpoint] = [flex, standard];
  assert.equal(routeForRetry(0, endpoints).endpoint.tag, "openai/flex");
  assert.equal(routeForRetry(1, endpoints).endpoint.tag, "openai/flex");
  assert.equal(routeForRetry(2, endpoints).endpoint.tag, "openai");
});

test("unrecognized errors and invalid response bodies do not become decoded envelopes", () => {
  assert.equal(rejectedSdkResponse(new Error("network failed")), undefined);
  const captured = rejectedSdkResponse(
    Object.assign(new Error("Response validation failed"), {
      name: "ResponseValidationError",
      body: "not JSON",
    }),
  );
  assert.equal(captured?.bodyText, "not JSON");
  assert.equal(captured?.response, undefined);
  assert.equal(captured?.actualCostUsd, undefined);
});
