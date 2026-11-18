import { reserveWorkflowCall } from "../discovery/budget.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { writeTextAtomic, writeJsonAtomic } from "../discovery/artifacts.js";
import { classifyTransportFailure, createOpenRouterClient, loadApiKey } from "../discovery/provider.js";
import { join } from "node:path";
import { jevModel, jevProvider } from "./contracts.js";
import type { DecisionsRequest } from "@openrouter/sdk/models";
import { assertSemanticSource } from "./semantic-input.js";

export async function preflightJev(): Promise<Record<string, unknown> & { inputLimit: number }> {
  await loadApiKey();
  const response = await fetch(`https://openrouter.ai/api/v1/models/${jevModel}/endpoints`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jev endpoint metadata unavailable: HTTP ${response.status}`);
  const data = ((await response.json()) as { data: { endpoints: Array<Record<string, unknown>> } }).data;
  const endpoint = data.endpoints.find((entry) => entry.tag === jevProvider);
  if (!endpoint || typeof endpoint.context_length !== "number" || Number(endpoint.status) < 0) throw new Error("Pinned TypeSafe Jev endpoint unavailable");
  const limit = Math.min(endpoint.context_length, typeof endpoint.max_prompt_tokens === "number" ? endpoint.max_prompt_tokens : Infinity);
  return { checked_at_utc: new Date().toISOString(), endpoint, inputLimit: limit };
}

export class RetryableDecisionError extends Error {}

/** Capture actual serialized outbound and response bodies before SDK decoding. Never retain authorization headers. */
export async function callJev(request: DecisionsRequest, attemptDirectory: string, probe: boolean, sourceBytes?: Buffer, sourcePath?: string): Promise<unknown> {
  let status: number | undefined;
  let body: string | undefined;
  const client = createOpenRouterClient(await loadApiKey(), async (input, init) => {
    const outgoing = input instanceof Request ? input : new Request(input, init);
    const wire = await outgoing.clone().text();
    // Pipeline callers supply immutable source bytes. Generic diagnostic requests may use any Jev state.
    if (sourceBytes) assertSemanticSource(JSON.parse(wire) as DecisionsRequest, sourceBytes);
    await writeTextAtomic(join(attemptDirectory, "outbound-request.json"), wire);
    await writeJsonAtomic(join(attemptDirectory, "transport-start.json"), {
      at_utc: new Date().toISOString(),
      transport: probe ? "synthetic_pre_network_failure" : "live_network",
    });
    if (probe) throw new TypeError("fetch failed (explicit Jev retry verification before network dispatch)");
    const ledgerPath = process.env.BB_LIVE_COST_LEDGER;
    let finish: Awaited<ReturnType<typeof reserveWorkflowCall>> | undefined;
    if (ledgerPath) {
      finish = await reserveWorkflowCall(ledgerPath, randomUUID(), 0.1, {
        attemptDirectory,
        model: jevModel,
        questionCount: Object.keys(request.questions).length,
        reservationBasis: "$0.10 provisional per outbound Jev request until confirmed response cost",
      });
    }
    let response: Response;
    let networkStartedAt: string | undefined;
    let bodyReceivedAt: string | undefined;
    try {
      if (sourceBytes) assertSemanticSource(JSON.parse(wire) as DecisionsRequest, sourcePath ? await readFile(sourcePath) : sourceBytes);
      networkStartedAt = new Date().toISOString();
      response = await fetch(input, init);
      const rawText = await response.clone().text();
      bodyReceivedAt = new Date().toISOString();
      await writeTextAtomic(join(attemptDirectory, "response-body.txt"), rawText);
      let cost: number | undefined;
      try {
        const rawCost = JSON.parse(rawText).usage?.cost;
        if (typeof rawCost === "number") cost = rawCost;
      } catch {
        /* reservation stays held */
      }
      await finish?.(cost, join(attemptDirectory, "response-body.txt"));
      finish = undefined;
    } finally {
      await finish?.();
    }

    status = response.status;
    body = await response.clone().text();
    await writeTextAtomic(join(attemptDirectory, "response-body.txt"), body);
    await writeJsonAtomic(join(attemptDirectory, "transport-end.json"), {
      at_utc: new Date().toISOString(),
      http_status: status,
      network_started_at_utc: networkStartedAt,
      body_received_at_utc: bodyReceivedAt,
    });
    return response;
  });
  try {
    const decoded = await client.alpha.decisions.create({ decisionsRequest: request });
    await writeJsonAtomic(join(attemptDirectory, "sdk-response.json"), decoded);
    if (!body) throw new Error("Jev raw response was not captured");
    return JSON.parse(body) as unknown;
  } catch (error) {
    const failure = classifyTransportFailure(error);
    let apiError: Record<string, unknown> | undefined;
    try {
      apiError = (JSON.parse(body ?? "{}") as { error?: Record<string, unknown> }).error;
    } catch {
      /* raw body retained */
    }
    const apiCode = typeof apiError?.code === "number" ? apiError.code : status;
    const metadata = apiError?.metadata as Record<string, unknown> | undefined;
    const transient =
      failure.retryable ||
      [408, 429, 500, 502, 503, 504, 524, 529].includes(apiCode ?? 0) ||
      ["provider_unavailable", "provider_overloaded"].includes(String(metadata?.error_type));
    const retryable = ![400, 401, 402, 403, 404, 413].includes(apiCode ?? 0) && transient;
    await writeJsonAtomic(join(attemptDirectory, "failure.json"), {
      at_utc: new Date().toISOString(),
      status: apiCode ?? null,
      retryable,
      message: failure.safeMessage,
      synthetic: probe,
    });
    if (retryable) throw new RetryableDecisionError(failure.safeMessage);
    throw new Error(failure.safeMessage);
  }
}
