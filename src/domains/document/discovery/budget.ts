import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./artifacts.js";

export type ChargeBoundInput = {
  inputBytes: number;
  outputTokenLimit: number;
  promptPricePerToken: number;
  inputCacheWritePricePerToken: number;
  completionPricePerToken: number;
  promptThreshold: number;
  overThresholdPromptPricePerToken?: number;
  overThresholdInputCacheWritePricePerToken?: number;
  overThresholdCompletionPricePerToken?: number;
};

export const defaultRunChargeEstimateUsd = 0.01;

export function chargeFromUsageOrEstimate(actualUsageUsd: number | undefined): number {
  return actualUsageUsd !== undefined && Number.isFinite(actualUsageUsd) && actualUsageUsd >= 0 ? actualUsageUsd : defaultRunChargeEstimateUsd;
}

export function chargeBound(input: ChargeBoundInput): number {
  const promptTokenBound = input.inputBytes + 512;
  const overThreshold = promptTokenBound >= input.promptThreshold;
  const promptRate = Math.max(
    overThreshold ? (input.overThresholdPromptPricePerToken ?? input.promptPricePerToken) : input.promptPricePerToken,
    overThreshold ? (input.overThresholdInputCacheWritePricePerToken ?? input.inputCacheWritePricePerToken) : input.inputCacheWritePricePerToken,
  );
  const completionRate = overThreshold ? (input.overThresholdCompletionPricePerToken ?? input.completionPricePerToken) : input.completionPricePerToken;

  return Number(promptTokenBound * promptRate + input.outputTokenLimit * completionRate);
}

export type SpendState = {
  ceiling: number;
  settled: number;
  unresolved: Record<string, number>;
  operations: Array<Record<string, unknown>>;
};

export function availableBudget(state: SpendState): number {
  const held = Object.values(state.unresolved).reduce((sum, amount) => sum + amount, 0);
  return Math.max(0, state.ceiling - state.settled - held);
}

export function assertChargeFits(state: SpendState, nextAttemptEstimate: number): void {
  if (!Number.isFinite(nextAttemptEstimate) || nextAttemptEstimate < 0) {
    throw new Error("The next attempt has no valid charge estimate");
  }
  const held = Object.values(state.unresolved).reduce((sum, amount) => sum + amount, 0);
  if (state.settled + held + nextAttemptEstimate > state.ceiling) {
    throw new Error("Model charge reservation exceeds the shared $4.90 admission ceiling");
  }
}

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const budgetPath = resolve(moduleRoot, "data/operations/luna-budget.json");
const ceilingUsd = 4.9;

type SharedBudget = SpendState & {
  schema_version: 1;
  currency: "USD";
  historical_baseline: {
    settled_calls: number;
    settled_usd: number;
    unresolved_reservations: number;
    evidence_as_of: string;
  };
  reconciliation_note: string;
  updated_at: string;
};

const importedBaseline: SharedBudget = {
  schema_version: 1,
  currency: "USD",
  ceiling: ceilingUsd,
  settled: 0.1526241625,
  unresolved: {},
  operations: [],
  historical_baseline: {
    settled_calls: 52,
    settled_usd: 0.1526241625,
    unresolved_reservations: 0,
    evidence_as_of: "2026-10-02 prior project budget inventory",
  },
  reconciliation_note:
    "This checkout had no budget ledger. Imported the last recorded Luna-only baseline; subsequent authorized model test charges are tracked in the same $4.90 shared admission ceiling and identify their model per operation. OpenRouter analytics requires a management key, so account-wide usage cannot verify project-specific traffic.",
  updated_at: new Date().toISOString(),
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readState(): Promise<SharedBudget> {
  if (!(await exists(budgetPath))) await writeJsonAtomic(budgetPath, importedBaseline);
  return JSON.parse(await readFile(budgetPath, "utf8")) as SharedBudget;
}

async function updateState(state: SharedBudget): Promise<void> {
  state.updated_at = new Date().toISOString();
  await writeJsonAtomic(budgetPath, state);
}

export async function currentBudget(): Promise<SharedBudget> {
  return readState();
}

export async function reserveCharge(
  reservationId: string,
  estimatedUsd: number,
  model: string,
): Promise<{
  availableBefore: number;
  availableAfter: number;
}> {
  const state = await readState();
  if (!Object.hasOwn(state.unresolved, reservationId)) {
    assertChargeFits(state, estimatedUsd);
    const availableBefore = availableBudget(state);
    state.unresolved[reservationId] = estimatedUsd;
    state.operations.push({
      type: "reserved",
      reservation_id: reservationId,
      model,
      estimated_usd: estimatedUsd,
      at: new Date().toISOString(),
    });
    await updateState(state);
    return { availableBefore, availableAfter: availableBudget(state) };
  }
  return {
    availableBefore: availableBudget(state) + state.unresolved[reservationId]!,
    availableAfter: availableBudget(state),
  };
}

export async function reconcileCharge(reservationId: string, actualUsd: number, model: string): Promise<void> {
  if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("Invalid actual model charge");
  const state = await readState();
  const reserved = state.unresolved[reservationId];
  if (reserved === undefined) throw new Error("Cannot reconcile a missing model charge reservation");
  delete state.unresolved[reservationId];
  state.settled += actualUsd;
  state.operations.push({
    type: "settled",
    reservation_id: reservationId,
    model,
    reserved_usd: reserved,
    actual_usd: actualUsd,
    at: new Date().toISOString(),
  });
  await updateState(state);
}

export async function reconcileEstimatedCharge(reservationId: string, model: string, reason: string): Promise<void> {
  const state = await readState();
  const reserved = state.unresolved[reservationId];
  if (reserved === undefined) throw new Error("Cannot estimate a missing model charge reservation");
  delete state.unresolved[reservationId];
  state.settled += defaultRunChargeEstimateUsd;
  state.operations.push({
    type: "settled_estimated",
    reservation_id: reservationId,
    model,
    reserved_usd: reserved,
    estimated_usd: defaultRunChargeEstimateUsd,
    estimate_rule: "$0.01 per dispatched attempt unless OpenRouter usage.cost is reported",
    reason,
    at: new Date().toISOString(),
  });
  await updateState(state);
}

export async function releaseUnsentReservation(reservationId: string, reason: string): Promise<void> {
  const state = await readState();
  const reserved = state.unresolved[reservationId];
  if (reserved === undefined) return;
  delete state.unresolved[reservationId];
  state.operations.push({
    type: "released_before_dispatch",
    reservation_id: reservationId,
    reserved_usd: reserved,
    reason,
    at: new Date().toISOString(),
  });
  await updateState(state);
}

async function withWorkflowLedgerLock<T>(ledgerPath: string, body: () => Promise<T>): Promise<T> {
  const { mkdir, rmdir } = await import("node:fs/promises");
  const lock = `${ledgerPath}.lock`;
  const waitStarted = Date.now();
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - waitStarted > 14 * 60_000) throw new Error("Timed out waiting for the shared live budget ledger lock; no request was dispatched");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await body();
  } finally {
    await rmdir(lock);
  }
}

/** Reserve before dispatch and settle after the response, each under a short ledger lock. */
export async function reserveWorkflowCall(ledgerPath: string, reservationId: string, maximumUsd: number, evidence: Record<string, unknown>) {
  await withWorkflowLedgerLock(ledgerPath, async () => {
    const state = JSON.parse(await readFile(ledgerPath, "utf8"));
    const confirmedUsd = state.calls.reduce((sum: number, call: { state: string; actualUsd?: number }) => sum + (call.state === "settled" ? (call.actualUsd ?? 0) : 0), 0);
    if (
      !Number.isFinite(maximumUsd) ||
      maximumUsd < 0 ||
      !Number.isFinite(state.spentUsd) ||
      !Number.isFinite(state.capUsd) ||
      !Number.isFinite(confirmedUsd) ||
      confirmedUsd > Math.min(5, state.capUsd)
    )
      throw new Error("Invalid cost or confirmed charges exceeded the shared $5 soft cap; stop and report");
    state.spentUsd += maximumUsd;
    state.calls.push({
      reservationId,
      reservedUsd: maximumUsd,
      state: "reserved",
      atUtc: new Date().toISOString(),
      ...evidence,
    });
    await writeJsonAtomic(ledgerPath, state);
  });
  return async (actualUsd?: number, actualEvidence?: string) => {
    if (actualUsd === undefined || !actualEvidence || !Number.isFinite(actualUsd) || actualUsd < 0) return;
    await withWorkflowLedgerLock(ledgerPath, async () => {
      const latest = JSON.parse(await readFile(ledgerPath, "utf8"));
      const entry = latest.calls.find((call: { reservationId: string }) => call.reservationId === reservationId);
      if (entry?.state !== "reserved") throw new Error("Live budget reservation is missing or already settled");
      latest.spentUsd += actualUsd - maximumUsd;
      entry.actualUsd = actualUsd;
      entry.evidence = actualEvidence;
      entry.state = "settled";
      await writeJsonAtomic(ledgerPath, latest);
    });
  };
}
