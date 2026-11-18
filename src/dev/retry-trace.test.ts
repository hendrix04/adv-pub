import assert from "node:assert/strict";
import test from "node:test";
import { verifyRetryTrace } from "./retry-trace.js";

test("retry verification requires two spaced Flex failures and one live standard response", () => {
  const trace = [
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:00:00.000Z",
      attempt: 1,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "flex",
      provider_only: ["openai/flex"],
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-failure",
      at_utc: "2026-10-03T00:00:00.100Z",
      attempt: 1,
      operation_id: "op-1",
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:00:30.100Z",
      attempt: 2,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "flex",
      provider_only: ["openai/flex"],
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-failure",
      at_utc: "2026-10-03T00:00:30.200Z",
      attempt: 2,
      operation_id: "op-1",
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:01:00.200Z",
      attempt: 3,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "default",
      provider_only: ["openai"],
      transport: "live_network",
    },
    { event: "attempt-response", at_utc: "2026-10-03T00:03:00.000Z", attempt: 3, operation_id: "op-1", status: 200 },
  ];
  const result = verifyRetryTrace(trace);
  assert.deepEqual(result.failure_to_next_attempt_intervals_ms, [30_000, 30_000]);
  assert.equal(result.standard_response_status, 200);
});

test("retry verification rejects fast retries and absent live standard response", () => {
  const trace = [
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:00:00.000Z",
      attempt: 1,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "flex",
      provider_only: ["openai/flex"],
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-failure",
      at_utc: "2026-10-03T00:00:00.100Z",
      attempt: 1,
      operation_id: "op-1",
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:00:30.099Z",
      attempt: 2,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "flex",
      provider_only: ["openai/flex"],
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-failure",
      at_utc: "2026-10-03T00:00:30.199Z",
      attempt: 2,
      operation_id: "op-1",
      transport: "synthetic_pre_network_failure",
    },
    {
      event: "attempt-start",
      at_utc: "2026-10-03T00:01:00.199Z",
      attempt: 3,
      operation_id: "op-1",
      model: "openai/gpt-6-luna",
      service_tier: "default",
      provider_only: ["openai"],
      transport: "live_network",
    },
  ];
  assert.throws(() => verifyRetryTrace(trace), /30 seconds/);
});
