import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenRouter } from "@openrouter/sdk";
import { NonRetryableError } from "@hatchet-dev/typescript-sdk/v1/task";
import { z } from "zod";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./artifacts.js";
import { assertOutboundSourceMatches, decodeCapturedSource } from "./source.js";
import {
  chargeFromUsageOrEstimate,
  defaultRunChargeEstimateUsd,
  currentBudget,
  reconcileCharge,
  reconcileEstimatedCharge,
  releaseUnsentReservation,
  reserveCharge,
  reserveWorkflowCall,
} from "./budget.js";
import {
  classifyTransportFailure,
  conservativeChargeBound,
  createOpenRouterClient,
  endpointPriceRecord,
  findVerifiedRoutes,
  loadApiKey,
  maxCompletionTokens,
  modelId,
  requestTimeoutMs,
  routeForRetry,
  retryPolicy,
  type Route,
} from "./provider.js";
import { forecastCorpusBudget, forecastSingleSourceBudget } from "./forecast.js";
import { baseProvenance, findReusableIteration, newIterationDirectory, retainSource, safeSourceKey } from "./iteration.js";
import { saveFindings } from "./operation-result.js";
import { createRetryProbeFetcher } from "../../../dev/retry-probe.js";
import { buildPromptWithTableInventory } from "./tables.js";
import { rejectedSdkResponse, shouldRetryRejectedProviderError } from "./sdk-response.js";

const discoveryVersion = "document-discovery-v31";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const promptPath = join(moduleDirectory, "v31/prompt.md");
const schemaPath = join(moduleDirectory, "v31/schema.json");
const outputLimit = maxCompletionTokens;

export type DiscoveryTaskInput = {
  sourcePath: string;
  operationId: string;
  retryCount: number;
  forceNewIteration?: boolean;
};

export type DiscoveryResult = {
  iterationDirectory: string;
  sourcePath: string;
  sourceSha256: string;
  status: "complete" | "findings" | "reused";
  proposalCounts: Record<string, number>;
  requestId?: string;
};

export class RetryableDiscoveryError extends Error {
  readonly retryable = true;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readPromptAndSchema(sourceText: string): Promise<{
  prompt: string;
  schema: Record<string, unknown>;
  promptHash: string;
  schemaHash: string;
  tableInventory: ReturnType<typeof buildPromptWithTableInventory>["tables"];
}> {
  const [prompt, schemaText] = await Promise.all([readFile(promptPath, "utf8"), readFile(schemaPath, "utf8")]);
  const schema = JSON.parse(schemaText) as Record<string, unknown>;
  z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0], { defaultTarget: "draft-2020-12" });
  const expanded = buildPromptWithTableInventory(prompt, sourceText);
  return {
    prompt: expanded.prompt,
    schema,
    promptHash: sha256(expanded.prompt),
    schemaHash: sha256(schemaText),
    tableInventory: expanded.tables,
  };
}

function configuration(promptHash: string, schemaHash: string): Record<string, unknown> {
  return {
    discovery_version: discoveryVersion,
    model: modelId,
    reasoning: { effort: "high" },
    response_format: { type: "json_schema", strict: true, schema_version: discoveryVersion },
    provider_policy: retryPolicy,
    allow_fallbacks: false,
    require_parameters: true,
    sdk_retry: "disabled",
    timeout_ms: requestTimeoutMs,
    max_completion_tokens: outputLimit,
    prompt_sha256: promptHash,
    schema_sha256: schemaHash,
  };
}

function currentAttemptSettings(route: Route): Record<string, unknown> {
  return {
    attempt: route.attempt,
    service_tier: route.serviceTier,
    provider: { only: [...route.providerOnly], allow_fallbacks: false, require_parameters: true },
    model: modelId,
    reasoning: { effort: "high" },
    response_format: { type: "json_schema", strict: true, schema_version: discoveryVersion },
    max_completion_tokens: outputLimit,
    sdk_retries: "disabled",
  };
}

export async function discoverDocument(input: DiscoveryTaskInput): Promise<DiscoveryResult> {
  const absoluteSourcePath = resolve(input.sourcePath);
  const original = await readFile(absoluteSourcePath);
  const source = { path: absoluteSourcePath, captured: decodeCapturedSource(original) };
  const material = await readPromptAndSchema(source.captured.text);
  const config = configuration(material.promptHash, material.schemaHash);
  const configurationHash = sha256(canonical(config));
  const sourceKey = safeSourceKey(source.path);
  const reusable = await findReusableIteration(sourceKey, source.captured.sha256, configurationHash, input.operationId, Boolean(input.forceNewIteration));
  const directory = reusable ?? (await newIterationDirectory(sourceKey));
  await retainSource(directory, source.path, source.captured);
  await writeJsonAtomic(join(directory, "configuration.json"), config);

  if (reusable) {
    const raw = (await readJson(join(directory, "response.json"))) as Record<string, unknown>;
    const provenance = await baseProvenance(directory);
    const reservationId = typeof provenance.reservation_id === "string" ? provenance.reservation_id : undefined;
    const usage = raw.usage as Record<string, unknown> | undefined;
    const actualCost = typeof usage?.cost === "number" ? usage.cost : undefined;
    if (reservationId) {
      const budget = await currentBudget();
      if (budget.unresolved[reservationId] !== undefined) {
        if (actualCost !== undefined) await reconcileCharge(reservationId, actualCost, modelId);
        else await reconcileEstimatedCharge(reservationId, modelId, "Reused response omitted usage.cost");
      }
    }
    const retryCount = Number(provenance.requested_attempt ?? 1) - 1;
    const endpoints = await findVerifiedRoutes(Buffer.byteLength(material.prompt) + Buffer.byteLength(JSON.stringify(material.schema)) + source.captured.byteLength);
    const route = routeForRetry(Math.max(0, Math.min(2, retryCount)), endpoints);
    const output = await saveFindings(directory, raw, material.schema, source.captured, route);
    await writeJsonAtomic(join(directory, "provenance.json"), {
      ...provenance,
      response_reused: true,
      inspection_operation_id: input.operationId,
      validation_status: output.findings.status,
      proposal_counts: output.counts,
    });
    return {
      iterationDirectory: directory,
      sourcePath: source.path,
      sourceSha256: source.captured.sha256,
      status: "reused",
      proposalCounts: output.counts,
      requestId: typeof raw.id === "string" ? raw.id : undefined,
    };
  }

  const promptBytes = Buffer.byteLength(material.prompt, "utf8");
  const schemaBytes = Buffer.byteLength(JSON.stringify(material.schema), "utf8");
  const endpoints = await findVerifiedRoutes(promptBytes + schemaBytes + source.captured.byteLength);
  const route = routeForRetry(input.retryCount, endpoints);
  if (route.endpoint.status < 0) {
    const message = `${route.endpoint.tag} endpoint is unavailable for Hatchet attempt ${route.attempt} (status ${route.endpoint.status})`;
    await writeJsonAtomic(join(directory, `endpoint-unavailable-attempt-${route.attempt}.json`), {
      checked_at_utc: new Date().toISOString(),
      model: modelId,
      attempt: route.attempt,
      selected_route: {
        service_tier: route.serviceTier,
        provider_only: route.providerOnly,
        endpoint: route.endpoint.tag,
      },
      endpoint_status: route.endpoint.status,
      flex_status: endpoints[0].status,
      standard_status: endpoints[1].status,
      generation_request_sent: false,
      charge_reservation_created: false,
      retry_scheduled: input.retryCount < 2,
      message,
    });
    if (input.retryCount < 2) throw new RetryableDiscoveryError(message);
    throw new NonRetryableError(message);
  }
  const settings = currentAttemptSettings(route);
  const messages = [
    { role: "system" as const, content: material.prompt },
    { role: "user" as const, content: source.captured.text },
  ];
  const chatRequest = {
    model: modelId,
    messages,
    reasoning: { effort: "high" as const },
    serviceTier: route.serviceTier,
    provider: {
      only: [...route.providerOnly],
      allowFallbacks: false,
      requireParameters: true,
    },
    responseFormat: {
      type: "json_schema" as const,
      jsonSchema: {
        name: `campaign_entity_discovery_${discoveryVersion.replace("document-discovery-", "")}`,
        strict: true,
        schema: material.schema,
      },
    },
    maxCompletionTokens: outputLimit,
    stream: false as const,
  };
  if (process.env.ADV_PUB_SINGLE_SOURCE_SOL_FORECAST === "1") {
    if (modelId !== "openai/gpt-6.1-sol" || source.path !== resolve("Resources/Lore/01-unified-church-of-the-realms.md")) {
      throw new Error("The one-off GPT-6.1 Sol forecast is limited to complete document 01");
    }
    await forecastSingleSourceBudget(source.path, material.prompt, chatRequest.responseFormat, endpoints);
  } else {
    await forecastCorpusBudget(dirname(source.path), material.prompt, chatRequest.responseFormat, endpoints);
  }
  const outboundSource = messages[1]!.content;
  const maximumUsd = defaultRunChargeEstimateUsd;
  const reservationId = `${input.operationId}/attempt-${route.attempt}`;
  const reservation = await reserveCharge(reservationId, maximumUsd, modelId);
  const endpointPricing = { flex: endpointPriceRecord(endpoints[0]), standard: endpointPriceRecord(endpoints[1]) };
  const requestBundle = {
    requested_settings: settings,
    system_prompt: material.prompt,
    response_schema: material.schema,
    source_text: outboundSource,
    source: { sha256: source.captured.sha256, byte_length: source.captured.byteLength },
    request: {
      chatRequest,
      xOpenRouterMetadata: "enabled",
    },
    endpoint_pricing: endpointPricing,
    charge_reservation: {
      reservation_id: reservationId,
      estimated_usd: maximumUsd,
      available_before_usd: reservation.availableBefore,
      available_after_usd: reservation.availableAfter,
    },
  };
  await writeJsonAtomic(join(directory, "outbound-request.json"), requestBundle);
  await writeJsonAtomic(join(directory, "settings.json"), {
    ...settings,
    endpoint_prices: endpointPricing,
    configuration_sha256: configurationHash,
  });
  await writeJsonAtomic(join(directory, "provenance.json"), {
    configuration_sha256: configurationHash,
    operation_id: input.operationId,
    model: modelId,
    sdk: "@openrouter/sdk@1.4.21",
    hatchet_attempt: route.attempt,
    requested_attempt: route.attempt,
    prompt_version: discoveryVersion,
    prompt_sha256: material.promptHash,
    schema_version: discoveryVersion,
    schema_sha256: material.schemaHash,
    source_sha256: source.captured.sha256,
    source_byte_length: source.captured.byteLength,
    reservation_id: reservationId,
    reserved_estimated_usd: maximumUsd,
    response_reused: false,
  });
  await writeJsonAtomic(join(directory, "table-inventory.json"), material.tableInventory);

  let response: Record<string, unknown>;
  let raw: unknown;
  let dispatched = false;
  let finishWorkflowCall: Awaited<ReturnType<typeof reserveWorkflowCall>> | undefined;
  const finishWorkflowReservation = async (actualUsd?: number, evidence?: string) => {
    const finish = finishWorkflowCall;
    finishWorkflowCall = undefined;
    await finish?.(actualUsd, evidence);
  };
  try {
    const retainedBytes = await readFile(join(directory, "source.md"));
    assertOutboundSourceMatches(outboundSource, source.captured, retainedBytes);
    const apiKey = await loadApiKey();
    const client: OpenRouter = createOpenRouterClient(apiKey, process.env.ADV_PUB_TEST_RETRY_PROBE === "1" ? createRetryProbeFetcher(input.operationId) : undefined);
    const workflowLedgerPath = process.env.BB_LIVE_COST_LEDGER;
    if (workflowLedgerPath) {
      const inputBytes = promptBytes + schemaBytes + source.captured.byteLength;
      const maximum = conservativeChargeBound(route.endpoint, inputBytes);
      finishWorkflowCall = await reserveWorkflowCall(workflowLedgerPath, randomUUID(), maximum, {
        operationId: input.operationId,
        attempt: route.attempt,
        sourcePath: source.path,
        sourceSha256: source.captured.sha256,
        model: modelId,
        serviceTier: route.serviceTier,
        provider: route.providerOnly[0],
        endpoint: route.endpoint.tag,
        inputBytes,
        outputTokenLimit: maxCompletionTokens,
        priceEvidence: join(directory, "settings.json"),
        attemptDirectory: directory,
      });
    }
    dispatched = true;
    raw = await client.chat.send({
      chatRequest,
      xOpenRouterMetadata: "enabled",
    });
    response = raw as Record<string, unknown>;
  } catch (error) {
    if (!dispatched) {
      await releaseUnsentReservation(reservationId, "Pre-dispatch source/configuration validation failed");
      throw error;
    }
    const rejectedResponse = rejectedSdkResponse(error);
    try {
      if (rejectedResponse?.bodyText !== undefined) {
        await writeTextAtomic(join(directory, `response-body-attempt-${route.attempt}.txt`), rejectedResponse.bodyText);
      }
      if (rejectedResponse?.response) {
        const rejectedEnvelope = rejectedResponse.response;
        await writeJsonAtomic(join(directory, `response-attempt-${route.attempt}.json`), rejectedEnvelope);
        const responseEvidence =
          rejectedResponse.bodyText === undefined ? join(directory, `response-attempt-${route.attempt}.json`) : join(directory, `response-body-attempt-${route.attempt}.txt`);
        await finishWorkflowReservation(rejectedResponse.actualCostUsd, rejectedResponse.actualCostUsd === undefined ? undefined : responseEvidence);
        const accountedCharge = chargeFromUsageOrEstimate(rejectedResponse.actualCostUsd);
        if (rejectedResponse.actualCostUsd === undefined) {
          await reconcileEstimatedCharge(reservationId, modelId, "SDK-rejected HTTP response omitted usage.cost");
        } else {
          await reconcileCharge(reservationId, accountedCharge, modelId);
        }
        const output = await saveFindings(directory, rejectedEnvelope, material.schema, source.captured, route);
        await writeJsonAtomic(join(directory, `sdk-validation-failure-attempt-${route.attempt}.json`), {
          error_name: "ResponseValidationError",
          message: "The OpenRouter SDK rejected the HTTP response envelope; the original response body is retained for inspection.",
          http_status: 200,
          response_body_retained: rejectedResponse.bodyText !== undefined,
          actual_charge_usd: rejectedResponse.actualCostUsd ?? null,
          accounted_charge_usd: accountedCharge,
          charge_basis: rejectedResponse.actualCostUsd === undefined ? "user_default_estimate" : "openrouter_usage_cost",
        });
        await writeJsonAtomic(join(directory, "provenance.json"), {
          ...(await baseProvenance(directory)),
          requested_model: modelId,
          requested_provider: route.providerOnly[0],
          requested_service_tier: route.serviceTier,
          requested_reasoning_effort: "high",
          usage: rejectedEnvelope.usage ?? null,
          actual_charge_usd: rejectedResponse.actualCostUsd ?? null,
          accounted_charge_usd: accountedCharge,
          charge_basis: rejectedResponse.actualCostUsd === undefined ? "user_default_estimate" : "openrouter_usage_cost",
          validation_status: "sdk_response_validation_failed",
          proposal_counts: output.counts,
        });
        if (rejectedEnvelope.error !== undefined) {
          if (shouldRetryRejectedProviderError(rejectedResponse, input.retryCount)) {
            throw new RetryableDiscoveryError("OpenRouter returned a retryable provider_unavailable response inside HTTP 200");
          }
          throw new NonRetryableError("OpenRouter returned an error envelope inside HTTP 200; the original body is retained");
        }
        await writeJsonAtomic(join(directory, "response.json"), rejectedEnvelope);
        return {
          iterationDirectory: directory,
          sourcePath: source.path,
          sourceSha256: source.captured.sha256,
          status: "findings",
          proposalCounts: output.counts,
          requestId: typeof rejectedEnvelope.id === "string" ? rejectedEnvelope.id : undefined,
        };
      }
      const failure = classifyTransportFailure(error);
      await finishWorkflowReservation();
      await reconcileEstimatedCharge(reservationId, modelId, `Dispatched request returned no usage.cost: ${failure.safeMessage}`);
      await writeJsonAtomic(join(directory, `failure-attempt-${route.attempt}.json`), {
        attempt: route.attempt,
        retryable: failure.retryable,
        http_status: failure.status ?? null,
        error_name: error instanceof Error ? error.name : "UnknownError",
        message: failure.safeMessage,
        charge_reservation: reservationId,
        charge_status: "settled at the default estimate; OpenRouter usage.cost unavailable",
      });
      if (error instanceof NonRetryableError) throw error;
      if (failure.retryable && input.retryCount < 2) {
        throw new RetryableDiscoveryError(failure.safeMessage);
      }
      throw new NonRetryableError(failure.safeMessage);
    } finally {
      // If failure evidence could not be retained, release the lock and keep the maximum reserved.
      await finishWorkflowReservation();
    }
  }

  // Retain the untouched SDK envelope before parsing or any semantic checks.
  const usage = response.usage as Record<string, unknown> | undefined;
  const actualCost = typeof usage?.cost === "number" ? usage.cost : undefined;
  const accountedCharge = chargeFromUsageOrEstimate(actualCost);
  try {
    await writeJsonAtomic(join(directory, "response.json"), response);
    const responseAttemptPath = join(directory, `response-attempt-${route.attempt}.json`);
    await writeJsonAtomic(responseAttemptPath, response);
    await finishWorkflowReservation(actualCost, actualCost === undefined ? undefined : responseAttemptPath);
  } finally {
    // An unwritten or cost-less outcome keeps its conservative reservation.
    await finishWorkflowReservation();
  }
  if (actualCost === undefined) await reconcileEstimatedCharge(reservationId, modelId, "OpenRouter response omitted usage.cost");
  else await reconcileCharge(reservationId, accountedCharge, modelId);

  const output = await saveFindings(directory, response, material.schema, source.captured, route);
  const served = response.openrouterMetadata as Record<string, unknown> | undefined;
  const provenance = {
    ...(await baseProvenance(directory)),
    requested_model: modelId,
    served_model: response.model ?? null,
    requested_provider: route.providerOnly[0],
    served_provider: (served?.endpoints as { available?: Array<Record<string, unknown>> } | undefined)?.available?.find((endpoint) => endpoint.selected === true)?.provider ?? null,
    requested_service_tier: route.serviceTier,
    served_service_tier: response.serviceTier ?? null,
    requested_reasoning_effort: "high",
    served_reasoning_effort: null,
    usage: response.usage ?? null,
    generation_id: response.id ?? null,
    actual_charge_usd: actualCost ?? null,
    accounted_charge_usd: accountedCharge,
    charge_basis: actualCost === undefined ? "user_default_estimate" : "openrouter_usage_cost",
    validation_status: output.findings.status,
    proposal_counts: output.counts,
  };
  await writeJsonAtomic(join(directory, "provenance.json"), provenance);
  return {
    iterationDirectory: directory,
    sourcePath: source.path,
    sourceSha256: source.captured.sha256,
    status: output.findings.status === "valid" ? "complete" : "findings",
    proposalCounts: output.counts,
    requestId: typeof response.id === "string" ? response.id : undefined,
  };
}

export async function inspectSavedIteration(directory: string): Promise<{
  candidateView: string;
  findings: unknown;
  response: unknown;
}> {
  const target = resolve(directory);
  const [candidateView, findings, response] = await Promise.all([
    readFile(join(target, "candidate-view.md"), "utf8"),
    readJson(join(target, "validation-findings.json")),
    readJson(join(target, "response.json")),
  ]);
  return { candidateView, findings, response };
}

export function iterationNumberFromPath(path: string): number | undefined {
  const match = /iteration-(\d{3})$/.exec(resolve(path));
  return match ? Number(match[1]) : undefined;
}
