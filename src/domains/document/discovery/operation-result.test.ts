import assert from "node:assert/strict";
import test from "node:test";
import { failureCandidateView, servedChecks } from "./operation-result.js";
import type { Route } from "./provider.js";

const route: Route = {
  attempt: 1,
  serviceTier: "flex",
  providerOnly: ["openai/flex"],
  endpoint: {
    provider_name: "OpenAI",
    tag: "openai/flex",
    status: 0,
    supported_parameters: [],
    pricing: { prompt: "0", completion: "0" },
  },
};

test("an error envelope does not claim that model, route, or structured output were served", () => {
  const checks = servedChecks(
    {
      error: { message: "Flex unavailable", code: 502 },
    },
    route,
  );

  assert.deepEqual(
    checks.map(({ setting, status, served }) => ({ setting, status, served })),
    [
      { setting: "model", status: "unreported", served: null },
      { setting: "provider", status: "unreported", served: null },
      { setting: "service_tier", status: "unreported", served: null },
      { setting: "reasoning_effort", status: "unreported", served: null },
      { setting: "structured_output", status: "unreported", served: null },
    ],
  );
});

test("a provider error envelope is described as missing completion text, not malformed JSON", () => {
  const view = failureCandidateView(
    {
      error: { code: 502, metadata: { error_type: "provider_unavailable" } },
    },
    "The response content is not a text JSON value.",
  );

  assert.match(view, /OpenRouter returned provider error provider_unavailable \(502\)/);
  assert.match(view, /no assistant completion text was available/);
  assert.match(view, /original error envelope and response body are retained/);
  assert.doesNotMatch(view, /could not be decoded as JSON/);
});
