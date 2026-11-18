import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type TraceStart = {
  event: "attempt-start";
  at_utc: string;
  attempt: number;
  operation_id: string;
  model?: unknown;
  service_tier?: unknown;
  provider_only?: unknown;
  transport: "synthetic_pre_network_failure" | "live_network";
};

export function retryProbeTracePath(operationId: string): string {
  return resolve(`data/operations/retry-probe-${operationId}.jsonl`);
}

function attemptCount(tracePath: string): number {
  if (!existsSync(tracePath)) return 0;
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => {
      try {
        return (JSON.parse(line) as { event?: unknown }).event === "attempt-start";
      } catch {
        return false;
      }
    }).length;
}

function record(tracePath: string, value: unknown): void {
  appendFileSync(tracePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function createRetryProbeFetcher(
  operationId: string,
  nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis),
  tracePath = retryProbeTracePath(operationId),
): typeof fetch {
  mkdirSync(dirname(tracePath), { recursive: true });

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (!new URL(request.url).pathname.endsWith("/chat/completions")) return nativeFetch(input, init);

    const attempt = attemptCount(tracePath) + 1;
    const body = (await request.clone().json()) as Record<string, unknown>;
    const provider = body.provider as { only?: unknown } | undefined;
    const beforeNetwork = attempt < 3;
    const start: TraceStart = {
      event: "attempt-start",
      at_utc: new Date().toISOString(),
      attempt,
      operation_id: operationId,
      model: body.model,
      service_tier: body.service_tier,
      provider_only: provider?.only,
      transport: beforeNetwork ? "synthetic_pre_network_failure" : "live_network",
    };
    record(tracePath, start);
    if (beforeNetwork) {
      record(tracePath, {
        event: "attempt-failure",
        at_utc: new Date().toISOString(),
        attempt,
        operation_id: operationId,
        transport: "synthetic_pre_network_failure",
      });
      throw new TypeError("fetch failed");
    }

    const response = await nativeFetch(input, init);
    record(tracePath, {
      event: "attempt-response",
      at_utc: new Date().toISOString(),
      attempt,
      operation_id: operationId,
      status: response.status,
    });
    return response;
  };
}
