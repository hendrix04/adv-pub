import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRetryProbeFetcher } from "./retry-probe.js";

test("retry probe fails two routed requests before network and lets the third request through", async () => {
  const directory = await mkdtemp(join(tmpdir(), "adv-pub-retry-probe-"));
  const tracePath = join(directory, "trace.jsonl");
  let nativeCalls = 0;
  const fetcher = createRetryProbeFetcher(
    "operation-1",
    async () => {
      nativeCalls += 1;
      return new Response("{}", { status: 200 });
    },
    tracePath,
  );
  const request = () =>
    new Request("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-6-luna", service_tier: "flex", provider: { only: ["openai/flex"] } }),
    });

  try {
    await assert.rejects(fetcher(request()), /fetch failed/);
    await assert.rejects(fetcher(request()), /fetch failed/);
    const response = await fetcher(request());
    const trace = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.equal(nativeCalls, 1);
    assert.deepEqual(
      trace.filter((item) => item.event === "attempt-start").map((item) => [item.attempt, item.transport]),
      [
        [1, "synthetic_pre_network_failure"],
        [2, "synthetic_pre_network_failure"],
        [3, "live_network"],
      ],
    );
    assert.ok(trace.every((item) => item.operation_id === "operation-1"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
