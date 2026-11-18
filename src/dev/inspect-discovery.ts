import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inspectSavedIteration } from "../domains/document/index.js";

async function latestIteration(): Promise<string> {
  const base = resolve("data/runs/01-unified-church-of-the-realms/iterations");
  const entries = (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^iteration-\d{3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!entries[0]) throw new Error("No retained discovery iterations found");
  return join(base, entries[0]);
}

const directory = resolve(process.argv[2] ?? (await latestIteration()));
const result = await inspectSavedIteration(directory);
const [request, provenance, source, decoded, tables] = await Promise.all([
  readFile(join(directory, "outbound-request.json"), "utf8").catch(() => "null"),
  readFile(join(directory, "provenance.json"), "utf8").catch(() => "null"),
  readFile(join(directory, "source-manifest.json"), "utf8").catch(() => "null"),
  readFile(join(directory, "decoded-proposals.json"), "utf8").catch(() => "null"),
  readFile(join(directory, "table-inventory.json"), "utf8").catch(() => "[]"),
]);
process.stdout.write(
  JSON.stringify(
    {
      directory,
      candidate_view: result.candidateView,
      validation_findings: result.findings,
      source_manifest: JSON.parse(source),
      request: JSON.parse(request),
      decoded_proposals: JSON.parse(decoded),
      table_inventory: JSON.parse(tables),
      provenance: JSON.parse(provenance),
      original_sdk_response: result.response,
    },
    null,
    2,
  ) + "\n",
);
