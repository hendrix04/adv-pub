import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTestExecution } from "./execution-retention.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "test-retention-"));
  return { root, registry: () => readFile(join(root, "test-executions.json"), "utf8").then(JSON.parse) };
}

test("retention keeps ten whole executions, includes failed runs, and refreshes resume recency", async () => {
  const { root, registry } = await fixture();
  try {
    for (let index = 0; index < 12; index++) {
      const directory = join(root, `run-${String(index).padStart(2, "0")}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const execution = withTestExecution(
        directory,
        async () => {
          await mkdir(join(directory, "documents", "batches"), { recursive: true });
          await writeFile(join(directory, "documents", "batches", "wire.json"), String(index));
          if (index === 11) throw new Error("deliberate test failure");
        },
        root,
      );
      if (index === 11) await assert.rejects(execution, /deliberate test failure/);
      else await execution;
    }
    let saved = await registry();
    assert.equal(saved.length, 10);
    await assert.rejects(readFile(join(root, "run-00", "documents", "batches", "wire.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "run-02", "documents", "batches", "wire.json"), "utf8"), "2");
    assert.equal(saved.find((entry: any) => entry.directory.endsWith("run-11")).status, "failed");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await withTestExecution(join(root, "run-02"), async () => {}, root);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await withTestExecution(join(root, "run-12"), () => mkdir(join(root, "run-12")), root);
    saved = await registry();
    assert.equal(saved.length, 10);
    assert.ok(saved.some((entry: any) => entry.directory.endsWith("run-02")));
    await assert.rejects(readFile(join(root, "run-03", "documents", "batches", "wire.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an active execution survives newer completions and concurrent registry updates", async () => {
  const { root, registry } = await fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = withTestExecution(
    join(root, "active"),
    async () => {
      await mkdir(join(root, "active"));
      started();
      await held;
    },
    root,
  );
  try {
    await ready;
    for (let index = 0; index < 12; index++) {
      const directory = join(root, `finished-${index}`);
      await withTestExecution(directory, () => mkdir(directory), root);
    }
    assert.equal((await registry()).length, 10);
    assert.ok((await registry()).some((entry: any) => entry.directory.endsWith("active") && entry.status === "running"));
    release();
    await active;
    assert.equal((await registry()).length, 10);
  } finally {
    release();
    await active;
    await rm(root, { recursive: true, force: true });
  }
});

test("retention rejects symlinks and unmanaged existing directories without deleting them", async () => {
  const { root } = await fixture();
  const external = await mkdtemp(join(tmpdir(), "retention-external-"));
  try {
    await writeFile(join(external, "keep.txt"), "protected");
    await symlink(external, join(root, "link"), "dir");
    await assert.rejects(
      withTestExecution(join(root, "link", "run"), async () => {}, root),
      /symlinks/,
    );
    const directory = join(root, "unmanaged");
    await mkdir(directory);
    await writeFile(join(directory, "keep.txt"), "keep");
    await assert.rejects(
      withTestExecution(directory, async () => {}, root),
      /without test execution evidence/,
    );
    assert.equal(await readFile(join(external, "keep.txt"), "utf8"), "protected");
    assert.equal(await readFile(join(directory, "keep.txt"), "utf8"), "keep");
    await withTestExecution(external, async () => {}, root);
    assert.equal(await readFile(join(external, "keep.txt"), "utf8"), "protected");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("separate test processes cannot lose an active registration for the same output", async () => {
  const { root, registry } = await fixture();
  try {
    const entered = join(root, "entered");
    await mkdir(entered);
    const modulePath = fileURLToPath(new URL("./execution-retention.ts", import.meta.url));
    const program = `
      import { withTestExecution } from ${JSON.stringify(modulePath)};
      import { mkdir, writeFile } from 'node:fs/promises';
      import { join } from 'node:path';
      const root = process.argv[1];
      try {
        await withTestExecution(join(root, 'shared'), async () => {
          await mkdir(join(root, 'shared'));
          await writeFile(join(root, 'entered', String(process.pid)), 'entered');
          await new Promise(resolve => setTimeout(resolve, 700));
        }, root);
      } catch (error) {
        if (!String(error).includes('already active')) throw error;
      }
    `;
    const processes = Array.from(
      { length: 6 },
      () =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", program, root], {
            stdio: ["ignore", "ignore", "pipe"],
          });
          let errors = "";
          child.stderr.on("data", (text) => {
            errors += text;
          });
          child.once("error", reject);
          child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(errors))));
        }),
    );
    await Promise.all(processes);
    assert.equal((await readdir(entered)).length, 1);
    assert.equal((await registry()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
