import assert from "node:assert/strict";
import { mkdir, readFile, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { HatchetEmbeddedClient } from "@hatchet-dev/typescript-sdk/v1/embedded";
import { withEmbeddedWorker } from "./embedded-runtime.js";

function fakeClient() {
  const events: string[] = [];
  const worker = {
    registerWorkflows: async (_workflows: unknown) => {
      events.push("register");
    },
    start: async () => {
      events.push("start");
    },
    waitUntilReady: async (timeout: number) => {
      assert.equal(timeout, 30_000);
      events.push("ready");
    },
    stop: async () => {
      events.push("stop-worker");
    },
  };
  const client = {
    worker: async (name: string, options: unknown) => {
      assert.equal(name, "test-worker");
      assert.deepEqual(options, { slots: 4, durableSlots: 1 });
      events.push("worker");
      return worker;
    },
    runs: {
      getDetails: async (_runId: string): Promise<{ done: boolean; status: string }> => ({
        done: true,
        status: "COMPLETED",
      }),
    },
    stopEmbedded: async () => {
      events.push("stop-engine");
    },
  };
  return { client, worker, events };
}
const options = { name: "test-worker", worker: { slots: 4, durableSlots: 1 } };
const setup = () => ({ workflows: [], value: "workflow" });

test("embedded lifetime preserves registration/settings and tolerates delayed run visibility", async (t) => {
  const { client, events } = fakeClient();
  let polls = 0;
  client.runs.getDetails = async () => {
    if (++polls === 1) throw new Error("workflow run not found");
    return { done: polls === 3, status: polls === 3 ? "COMPLETED" : "RUNNING" };
  };
  t.mock.method(HatchetEmbeddedClient, "init", async (init: { version: string; postgresDataDir?: string }) => {
    assert.equal(init.version, "v0.107.0");
    assert.equal(init.postgresDataDir, undefined);
    return client;
  });
  await withEmbeddedWorker(options, setup, async ({ value, waitForRun }) => {
    assert.equal(value, "workflow");
    assert.deepEqual(await waitForRun("run-id", { timeoutMs: 1_000, pollIntervalMs: 1 }), {
      done: true,
      status: "COMPLETED",
    });
  });
  assert.equal(polls, 3);
  assert.deepEqual(events, ["worker", "register", "start", "ready", "stop-worker", "stop-engine"]);
});

test("worker startup rejection prevents submissions and still cleans up", async (t) => {
  const { client, worker, events } = fakeClient();
  const failure = new Error("worker unavailable");
  worker.start = async () => {
    throw failure;
  };
  t.mock.method(HatchetEmbeddedClient, "init", async () => client);
  let submitted = false;
  await assert.rejects(
    withEmbeddedWorker(options, setup, async () => {
      submitted = true;
    }),
    (error) => error === failure,
  );
  assert.equal(submitted, false);
  assert.deepEqual(events.slice(-2), ["stop-worker", "stop-engine"]);
});

test("polling keeps timeout diagnosis in the caller and propagates transport failures", async (t) => {
  const { client, events } = fakeClient();
  client.runs.getDetails = async () => {
    throw new Error("workflow run not found");
  };
  t.mock.method(HatchetEmbeddedClient, "init", async () => client);
  await withEmbeddedWorker(options, setup, async ({ waitForRun }) => {
    assert.equal(await waitForRun("absent", { timeoutMs: 4, pollIntervalMs: 1 }), undefined);
    const failure = new Error("authentication rejected");
    client.runs.getDetails = async () => {
      throw failure;
    };
    await assert.rejects(waitForRun("run-id", { timeoutMs: 10, pollIntervalMs: 1 }), (error) => error === failure);
  });
  assert.deepEqual(events.slice(-2), ["stop-worker", "stop-engine"]);
});

test("engine stops and temporary storage is removed even if worker shutdown fails", async (t) => {
  const { client, worker, events } = fakeClient();
  const failure = new Error("worker stop failed");
  worker.stop = async () => {
    throw failure;
  };
  let directory = "";
  t.mock.method(HatchetEmbeddedClient, "init", async (init: { postgresDataDir: string }) => {
    directory = init.postgresDataDir;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "fixture"), "temporary data");
    return client;
  });
  await assert.rejects(
    withEmbeddedWorker({ ...options, postgres: { kind: "temporary" } }, setup, async () => {
      assert.equal(await readFile(join(directory, "fixture"), "utf8"), "temporary data");
    }),
    (error) => error === failure,
  );
  assert.equal(events.at(-1), "stop-engine");
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("evidence-directory storage stays explicit and cleanup preserves it", async (t) => {
  const { client } = fakeClient();
  t.mock.method(HatchetEmbeddedClient, "init", async (init: { postgresDataDir?: string }) => {
    assert.equal(init.postgresDataDir, "evidence/hatchet-runtime");
    return client;
  });
  const events: string[] = [];
  const failure = new Error("task rejected");
  await assert.rejects(
    withEmbeddedWorker(
      {
        ...options,
        postgres: { kind: "persistent", path: "evidence/hatchet-runtime" },
        onFailure: () => {
          events.push("failure");
        },
        onShutdown: (event) => {
          events.push(event);
        },
      },
      setup,
      async () => {
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  assert.deepEqual(events, ["failure", "worker", "engine", "stopped"]);
});
