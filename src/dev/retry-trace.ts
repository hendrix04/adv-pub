export type RetryTraceEvent = {
  event: string;
  at_utc: string;
  attempt: number;
  operation_id?: string;
  model?: string;
  service_tier?: string;
  provider_only?: string[];
  transport?: string;
  status?: number;
};

export function verifyRetryTrace(events: RetryTraceEvent[]): {
  failure_to_next_attempt_intervals_ms: [number, number];
  standard_response_status: number;
} {
  const starts = events.filter((event) => event.event === "attempt-start").sort((a, b) => a.attempt - b.attempt);
  if (starts.length !== 3 || starts.some((event, index) => event.attempt !== index + 1)) {
    throw new Error("Retry trace must contain exactly attempts 1, 2, and 3");
  }
  for (const [index, expectedTier] of ["flex", "flex", "default"].entries()) {
    const start = starts[index]!;
    const expectedProvider = index < 2 ? "openai/flex" : "openai";
    if (start.model !== "openai/gpt-6-luna" || start.service_tier !== expectedTier || start.provider_only?.length !== 1 || start.provider_only[0] !== expectedProvider) {
      throw new Error(`Attempt ${index + 1} did not use its pinned model and route`);
    }
  }
  if (starts[0]!.transport !== "synthetic_pre_network_failure" || starts[1]!.transport !== "synthetic_pre_network_failure" || starts[2]!.transport !== "live_network") {
    throw new Error("The first two attempts must be injected before network access and the third must use live network access");
  }
  const operationIds = new Set(starts.map((event) => event.operation_id));
  if (operationIds.size !== 1 || !starts[0]!.operation_id) throw new Error("All attempts must belong to one identified operation");
  const failures = events.filter((event) => event.event === "attempt-failure").sort((a, b) => a.attempt - b.attempt);
  if (
    failures.length !== 2 ||
    failures.some((event, index) => event.attempt !== index + 1 || event.transport !== "synthetic_pre_network_failure" || event.operation_id !== starts[0]!.operation_id)
  ) {
    throw new Error("Retry trace must identify the two injected no-network failures for this operation");
  }
  const intervals = [1, 2].map((attempt) => Date.parse(starts[attempt]!.at_utc) - Date.parse(failures[attempt - 1]!.at_utc));
  if (intervals.some((interval) => !Number.isFinite(interval) || interval < 30_000)) {
    throw new Error("Hatchet failure-to-next-attempt intervals must each be at least 30 seconds");
  }
  const responses = events.filter((event) => event.event === "attempt-response");
  if (
    responses.length !== 1 ||
    responses[0]!.attempt !== 3 ||
    responses[0]!.operation_id !== starts[0]!.operation_id ||
    !Number.isInteger(responses[0]!.status) ||
    responses[0]!.status! < 200 ||
    responses[0]!.status! >= 300
  ) {
    throw new Error("Attempt 3 must return one successful live OpenRouter HTTP response");
  }
  return {
    failure_to_next_attempt_intervals_ms: [intervals[0]!, intervals[1]!],
    standard_response_status: responses[0]!.status!,
  };
}
