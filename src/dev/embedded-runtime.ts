import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { HatchetEmbeddedClient } from "@hatchet-dev/typescript-sdk/v1/embedded";

type Client = Awaited<ReturnType<typeof HatchetEmbeddedClient.init>>;
type Worker = Awaited<ReturnType<Client["worker"]>>;
type RunDetails = Awaited<ReturnType<Client["runs"]["getDetails"]>>;
type WorkerOptions = Exclude<Parameters<Client["worker"]>[1], number | undefined>;
export type EmbeddedWorkerOptions = {
  name: string;
  worker: WorkerOptions;
  postgres?: { kind: "temporary" } | { kind: "persistent"; path: string };
  onFailure?: (error: unknown) => void;
  onShutdown?: (event: "worker" | "engine" | "stopped") => void;
};
type WorkerSetup<T> = {
  workflows: NonNullable<Parameters<Worker["registerWorkflows"]>[0]>;
  value: T;
};
export type EmbeddedWorkerContext<T> = {
  value: T;
  throwIfWorkerFailed: () => void;
  waitForRun: (runId: string, options: { timeoutMs: number; pollIntervalMs: number }) => Promise<RunDetails | undefined>;
};

async function embeddedOptions(version: string) {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : undefined;
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
  if (!platform || !arch) return { version };
  const binaryPath = join(homedir(), ".hatchet", "embedded", version, `hatchet-embedded-sidecar_${platform}_${arch}`);
  try {
    const checksum = (await readFile(`${binaryPath}.sha256`, "utf8")).trim().split(/\s+/u)[0];
    if (/^[a-f0-9]{64}$/iu.test(checksum ?? "")) return { version, binaryPath, checksum };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { version };
}

/** One embedded deployment and worker, with caller-owned workflows and storage intent. */
export async function withEmbeddedWorker<T, Result>(
  options: EmbeddedWorkerOptions,
  setup: (hatchet: Client) => WorkerSetup<T>,
  body: (context: EmbeddedWorkerContext<T>) => Promise<Result>,
): Promise<Result> {
  const postgresDataDir = options.postgres?.kind === "temporary" ? join(tmpdir(), `adv-pub-hatchet-${randomUUID()}`) : options.postgres?.path;
  let hatchet: Client | undefined;
  let worker: Worker | undefined;
  let workerFailed = false;
  let workerFailure: unknown;
  const throwIfWorkerFailed = () => {
    if (workerFailed) throw workerFailure;
  };
  try {
    hatchet = await HatchetEmbeddedClient.init({
      ...(await embeddedOptions("v0.107.0")),
      logLevel: "warn",
      ...(postgresDataDir ? { postgresDataDir } : {}),
    });
    const { workflows, value } = setup(hatchet);
    worker = await hatchet.worker(options.name, options.worker);
    await worker.registerWorkflows(workflows);
    void worker.start().catch((error: unknown) => {
      workerFailed = true;
      workerFailure = error;
    });
    await worker.waitUntilReady(30_000);
    throwIfWorkerFailed();
    const client = hatchet;
    return await body({
      value,
      throwIfWorkerFailed,
      waitForRun: async (runId, poll) => {
        let details: RunDetails | undefined;
        const deadline = Date.now() + poll.timeoutMs;
        while (!details?.done && Date.now() < deadline) {
          throwIfWorkerFailed();
          try {
            details = await client.runs.getDetails(runId);
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("workflow run not found")) throw error;
          }
          if (!details?.done) await delay(poll.pollIntervalMs);
        }
        throwIfWorkerFailed();
        return details;
      },
    });
  } catch (error) {
    options.onFailure?.(error);
    throw error;
  } finally {
    try {
      try {
        if (worker) {
          options.onShutdown?.("worker");
          await worker.stop();
        }
      } finally {
        if (hatchet) {
          options.onShutdown?.("engine");
          const keepAlive = setInterval(() => undefined, 1_000);
          try {
            await hatchet.stopEmbedded();
          } finally {
            clearInterval(keepAlive);
          }
          options.onShutdown?.("stopped");
        }
      }
    } finally {
      if (options.postgres?.kind === "temporary" && postgresDataDir) await rm(postgresDataDir, { recursive: true, force: true });
    }
  }
}
