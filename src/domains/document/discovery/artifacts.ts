import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${path}.tmp-${randomUUID()}`;
  await ensureDirectory(dirname(path));
  await writeFile(temp, body, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

export async function writeBytesAtomic(path: string, value: Uint8Array): Promise<void> {
  const temp = `${path}.tmp-${randomUUID()}`;
  await ensureDirectory(dirname(path));
  await writeFile(temp, value, { mode: 0o600 });
  await rename(temp, path);
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await writeBytesAtomic(path, Buffer.from(value, "utf8"));
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
