import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exploratoryStructurePolicy } from "./policy.js";
import { actionOutcomeCounts, runBlocksOperation } from "./operation.js";

test("durable cancellation propagates without publishing a failed block result", async () => {
  const parent = await mkdtemp(join(tmpdir(), "adv-pub-blocks-abort-"));
  const interruption = new Error("durable invocation evicted");
  interruption.name = "AbortError";
  const directory = join(parent, "operation");
  try {
    await assert.rejects(
      runBlocksOperation(
        {
          capability: "blocks",
          sourcePath: resolve("Resources/Lore/01-unified-church-of-the-realms.md"),
          directory,
          operationId: "abort-test",
          mode: "new",
          inputLimit: 32_000,
          policy: exploratoryStructurePolicy(),
          repeatId: "structure-repeat-v1",
        },
        async () => {
          throw interruption;
        },
      ),
      (error) => error === interruption,
    );
    await assert.rejects(readFile(join(directory, "failure.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(directory, "result.json")), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("operation reporting counts rejected and unresolved decisions by status", () => {
  assert.deepEqual(
    actionOutcomeCounts({
      rejected: { status: "rejected", label: "no", findings: [] },
      unclear: { status: "unresolved", label: null, findings: ["tie"] },
      supported: { status: "supported", label: "yes", findings: [] },
    }),
    { rejected_count: 1, unresolved_count: 1 },
  );
});
