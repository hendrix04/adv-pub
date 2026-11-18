import { spawn } from "node:child_process";
import { access, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../domains/document/discovery/artifacts.js";

export const retainedTestExecutions = 10;
type Execution = { directory: string; started_at_utc: string; pid: number; status: "running" | "complete" | "failed" };
const defaultRoot = resolve(".kiro/execution");
let mutations = Promise.resolve();

function inside(path: string, root: string) {
  const local = relative(root, path);
  return local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && !local.startsWith(sep);
}

async function checkDirectory(directory: string, roots: string[]) {
  const root = roots.find((root) => inside(directory, root));
  if (!root) throw new Error(`Test execution is outside managed test storage: ${directory}`);
  let existing = directory;
  while (true) {
    try {
      const actual = await realpath(existing);
      if (actual !== existing) throw new Error(`Test retention does not follow symlinks: ${existing}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = resolve(existing, "..");
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

function running(entry: Execution) {
  if (entry.status !== "running") return false;
  try {
    process.kill(entry.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function editRegistry(root: string, edit: (entries: Execution[]) => Promise<Execution[]>) {
  const next = mutations.then(async () => {
    await mkdir(root, { recursive: true });
    // flock holds the inherited open-file description until this parent closes it.
    // The kernel releases it even if a test process is killed during registry updates.
    const lock = await open(join(root, "test-executions.lock"), "a");
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("flock", ["--exclusive", "--timeout", "10", "3"], {
          stdio: ["ignore", "ignore", "ignore", lock.fd],
        });
        child.once("error", reject);
        child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Could not acquire test retention lock"))));
      });
      const path = join(root, "test-executions.json");
      let entries: Execution[] = [];
      try {
        entries = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (
        !Array.isArray(entries) ||
        entries.some(
          (entry) =>
            !entry ||
            typeof entry.directory !== "string" ||
            !Number.isFinite(Date.parse(entry.started_at_utc)) ||
            !Number.isInteger(entry.pid) ||
            entry.pid <= 0 ||
            !["running", "complete", "failed"].includes(entry.status),
        )
      ) {
        throw new Error("Invalid test execution registry; no retention deletion performed");
      }
      if (
        new Set(entries.map((entry) => entry.directory)).size !== entries.length ||
        entries.some((entry, index) => entries.slice(index + 1).some((other) => inside(entry.directory, other.directory) || inside(other.directory, entry.directory)))
      ) {
        throw new Error("Duplicate or overlapping test execution registry entries; no deletion performed");
      }
      await writeJsonAtomic(path, await edit(entries));
    } finally {
      await lock.close();
    }
  });
  mutations = next.catch(() => {});
  await next;
}

/** Shared by test launchers only; product discovery/classification storage is not registered. */
export async function withTestExecution<T>(directory: string, body: () => Promise<T>, storageRoot = defaultRoot): Promise<T> {
  const root = resolve(storageRoot);
  const target = resolve(directory);
  const roots = root === defaultRoot ? [root, resolve(".bb/ap25-evidence")] : [root];
  // Explicit outputs outside the managed testing areas retain their existing CLI behavior.
  if (!roots.some((root) => inside(target, root))) return body();
  await checkDirectory(target, roots);
  const started = new Date().toISOString();
  await editRegistry(root, async (entries) => {
    if (entries.some((entry) => entry.directory !== target && (inside(entry.directory, target) || inside(target, entry.directory))))
      throw new Error("Overlapping test execution directories cannot be retained separately");
    if (entries.some((entry) => entry.directory === target && running(entry))) throw new Error("Test execution directory is already active");
    try {
      await access(target);
      if (!entries.some((entry) => entry.directory === target)) {
        const markers = await Promise.all(
          ["run-manifest.json", "operation.json", "report.json"].map((name) =>
            access(join(target, name)).then(
              () => true,
              () => false,
            ),
          ),
        );
        if (!markers.some(Boolean)) throw new Error("Refusing to register an existing directory without test execution evidence");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return [...entries.filter((entry) => entry.directory !== target), { directory: target, started_at_utc: started, pid: process.pid, status: "running" }];
  });
  let status: Execution["status"] = "failed";
  let failure: unknown;
  try {
    const result = await body();
    status = "complete";
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await editRegistry(root, async (entries) => {
        const available: Execution[] = [];
        for (const entry of entries) {
          await checkDirectory(entry.directory, roots);
          try {
            if (!(await lstat(entry.directory)).isDirectory()) throw new Error("Test execution is not a directory");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          available.push(entry.directory === target ? { ...entry, status } : entry);
        }
        available.sort((a, b) => b.started_at_utc.localeCompare(a.started_at_utc) || a.directory.localeCompare(b.directory));
        const active: Execution[] = [];
        const finished: Execution[] = [];
        for (const entry of available) (running(entry) ? active : finished).push(entry);
        const keep = [...active, ...finished.slice(0, Math.max(0, retainedTestExecutions - active.length))];
        for (const entry of finished.slice(Math.max(0, retainedTestExecutions - active.length))) await rm(entry.directory, { recursive: true });
        return keep;
      });
    } catch (error) {
      if (status === "failed") throw new AggregateError([failure, error], "Test execution and retention both failed");
      throw error;
    }
  }
}
