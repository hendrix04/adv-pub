import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./artifacts.js";
import { maxCompletionTokens, type ModelEndpoint } from "./provider.js";
import { defaultRunChargeEstimateUsd, currentBudget } from "./budget.js";
import { decodeCapturedSource } from "./source.js";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function forecastCorpusBudget(
  sourceDirectory: string,
  prompt: string,
  responseFormat: Record<string, unknown>,
  endpoints: [ModelEndpoint, ModelEndpoint],
): Promise<void> {
  const names = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{2}-.*\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const documents: Array<Record<string, unknown>> = [];
  const flexTotal = names.length * defaultRunChargeEstimateUsd;
  const maxStandardIteration = defaultRunChargeEstimateUsd;
  for (const name of names) {
    const bytes = await readFile(resolve(sourceDirectory, name));
    const source = decodeCapturedSource(bytes);
    const messages = [
      { role: "system", content: prompt },
      { role: "user", content: source.text },
    ];
    const inputBytes = Buffer.byteLength(JSON.stringify({ messages, responseFormat }), "utf8");
    for (const endpoint of endpoints) {
      if (endpoint.max_prompt_tokens != null && inputBytes + 512 > endpoint.max_prompt_tokens) {
        throw new Error(`Complete-source budget forecast exceeds ${endpoint.tag} input limit for ${name}`);
      }
      if (endpoint.max_completion_tokens != null && endpoint.max_completion_tokens < maxCompletionTokens) {
        throw new Error(`Complete-source budget forecast cannot honor output limit for ${name} on ${endpoint.tag}`);
      }
    }
    documents.push({
      source: name,
      source_bytes: source.byteLength,
      request_input_byte_bound: inputBytes,
      default_run_charge_estimate_usd: defaultRunChargeEstimateUsd,
    });
  }
  const state = await currentBudget();
  const held = Object.values(state.unresolved).reduce((sum, value) => sum + value, 0);
  const totalProjected = flexTotal + maxStandardIteration;
  if (state.settled + held + totalProjected > state.ceiling) {
    throw new Error("Nine-source Flex forecast plus one separate standard-route development iteration exceeds the shared $4.90 admission ceiling");
  }
  await writeJsonAtomic(resolve(rootDirectory, "data/operations/document-01-cost-forecast.json"), {
    evidence_type: "pre-dispatch source-size validation and default-charge forecast; no model requests for sources other than the current workflow input",
    route: "One $0.01 default charge per source; one separate $0.01 development-attempt reserve",
    calculation: "Each dispatched attempt is estimated at $0.01 unless OpenRouter returns usage.cost; successful usage.cost replaces the estimate during reconciliation.",
    sources: documents,
    corpus_default_estimate_usd: flexTotal,
    separate_development_attempt_default_estimate_usd: maxStandardIteration,
    forecast_total_usd: totalProjected,
    settled_before_forecast_usd: state.settled,
    unresolved_before_forecast_usd: held,
    available_before_forecast_usd: state.ceiling - state.settled - held,
    admission_ceiling_usd: state.ceiling,
  });
}

export async function forecastSingleSourceBudget(
  sourcePath: string,
  prompt: string,
  responseFormat: Record<string, unknown>,
  endpoints: [ModelEndpoint, ModelEndpoint],
): Promise<void> {
  const bytes = await readFile(sourcePath);
  const source = decodeCapturedSource(bytes);
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: source.text },
  ];
  const inputBytes = Buffer.byteLength(JSON.stringify({ messages, responseFormat }), "utf8");
  for (const endpoint of endpoints) {
    if (endpoint.max_prompt_tokens != null && inputBytes + 512 > endpoint.max_prompt_tokens) {
      throw new Error(`Complete source and prompt exceed the ${endpoint.tag} input limit for this one-off test`);
    }
    if (endpoint.max_completion_tokens != null && endpoint.max_completion_tokens < maxCompletionTokens) {
      throw new Error(`The ${endpoint.tag} endpoint cannot honor the bounded completion allowance`);
    }
  }
  const flex = defaultRunChargeEstimateUsd;
  const standard = defaultRunChargeEstimateUsd;
  const state = await currentBudget();
  const held = Object.values(state.unresolved).reduce((sum, value) => sum + value, 0);
  const forecastTotal = flex + standard;
  if (state.settled + held + forecastTotal > state.ceiling) {
    throw new Error("One-source Flex and standard-route forecast exceeds the shared $4.90 admission ceiling");
  }
  await writeJsonAtomic(resolve(rootDirectory, "data/operations/document-01-sol-cost-forecast.json"), {
    evidence_type: "single-source forecast for the explicitly requested GPT-6.1 Sol test; no other source is processed or forecast",
    source: sourcePath,
    route: "One Flex request with one standard-route retry allowance for document 01 only",
    calculation: "Each dispatched attempt is estimated at $0.01 unless OpenRouter returns usage.cost; successful usage.cost replaces the estimate during reconciliation.",
    source_bytes: source.byteLength,
    request_input_byte_bound: inputBytes,
    flex_default_estimate_usd: flex,
    standard_default_estimate_usd: standard,
    forecast_total_usd: forecastTotal,
    settled_before_forecast_usd: state.settled,
    unresolved_before_forecast_usd: held,
    available_before_forecast_usd: state.ceiling - state.settled - held,
    admission_ceiling_usd: state.ceiling,
  });
}
