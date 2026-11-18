import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { authorizedDiscoverySources } from "../domains/document/source-policy.js";
import { loadDiscoveryCandidates } from "../domains/document/decisions/semantic-input.js";
import { questionPolicySchema } from "../domains/document/decisions/policy.js";
import { exploratoryClassificationPolicy } from "../domains/document/classification/policy.js";
import { preflightClassificationBudget, type ClassificationEndpointCost } from "../domains/document/classification/preflight.js";
import { preflightJev } from "../domains/document/decisions/provider.js";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { sha256 } from "../domains/document/decisions/contracts.js";

const usage =
  "Usage: npm run preflight:classification-live -- --discovery <dir> [--discovery <dir> ...] [--blocks <01=dir> ...] [--endpoint-file <preflight.json>] [--policy <policy.json>] [--ledger <live-cost-ledger.json>]";
const args = process.argv.slice(2);
const discoveries: string[] = [];
const blocks = new Map<string, string>();
let endpointFile: string | undefined;
let policyFile: string | undefined;
let ledgerFile: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  const option = args[index]!;
  const value = args[++index];
  if (!value) throw new Error(usage);
  if (option === "--discovery") discoveries.push(resolve(value));
  else if (option === "--endpoint-file") endpointFile = resolve(value);
  else if (option === "--policy") policyFile = resolve(value);
  else if (option === "--ledger") ledgerFile = resolve(value);
  else if (option === "--blocks") {
    const separator = value.indexOf("=");
    if (separator < 0) throw new Error("--blocks must be <document-id>=<operation-directory>");
    blocks.set(value.slice(0, separator), resolve(value.slice(separator + 1)));
  } else throw new Error(`Unknown option ${option}\n${usage}`);
}
if (!discoveries.length) throw new Error(usage);

const sourceIdByPath = new Map(authorizedDiscoverySources().map((path, index) => [resolve(path), String(index + 1).padStart(2, "0")]));
const sourceIdByName = new Map(authorizedDiscoverySources().map((path, index) => [basename(path), String(index + 1).padStart(2, "0")]));
const policy = policyFile ? questionPolicySchema.parse(JSON.parse(await readFile(policyFile, "utf8"))) : exploratoryClassificationPolicy();
const ledgerPath = resolve(ledgerFile ?? process.env.BB_LIVE_COST_LEDGER ?? ".kiro/execution/AP-27/live-cost-ledger.json");
if (ledgerPath !== resolve(".kiro/execution/AP-27/live-cost-ledger.json"))
  throw new Error(`This preflight is scoped to .kiro/execution/AP-27/live-cost-ledger.json; received ${ledgerPath}`);
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
let endpointRecord: Record<string, unknown>;
if (endpointFile) endpointRecord = JSON.parse(await readFile(endpointFile, "utf8")) as Record<string, unknown>;
else endpointRecord = await preflightJev();
const endpoint = (endpointRecord.endpoint ?? endpointRecord) as ClassificationEndpointCost;
const inputLimit = endpointRecord.inputLimit ?? endpointRecord.input_limit ?? null;

const documents = [];
for (const directory of discoveries) {
  const material = await loadDiscoveryCandidates(directory);
  const sourceManifest = (await readJson(join(material.discovery, "source-manifest.json"))) as {
    source_path: string;
    sha256: string;
  };
  const documentId = sourceIdByPath.get(resolve(sourceManifest.source_path)) ?? sourceIdByName.get(basename(sourceManifest.source_path));
  if (!documentId) throw new Error(`Discovery source is not one of the nine authorized lore documents: ${sourceManifest.source_path}`);
  if (sourceManifest.sha256 !== material.captured.sha256) throw new Error(`Discovery source manifest hash differs for ${documentId}`);
  const blockDirectory = blocks.get(documentId);
  if (!blockDirectory) throw new Error(`Missing AP-8 block layout for document ${documentId}; map descriptor upper bound is unknown`);
  const layoutPath = join(blockDirectory, "layout.json");
  const layout = (await readJson(layoutPath)) as {
    source_sha256?: string;
    place_proposals?: Array<{ source_names?: string[] }>;
  };
  if (layout.source_sha256 !== material.captured.sha256) throw new Error(`Block layout source hash differs for ${documentId}`);
  const unnamed = (layout.place_proposals ?? []).filter((proposal) => !proposal.source_names?.length).length;
  documents.push({
    document_id: documentId,
    candidate_count: material.candidates.length,
    unnamed_map_place_count: unnamed,
    discovery_directory: material.discovery,
    source_sha256: material.captured.sha256,
    candidates_sha256: sha256(material.proposalText),
    blocks_directory: blockDirectory,
    blocks_layout_sha256: sha256(await readFile(layoutPath)),
  });
}

const result = preflightClassificationBudget({
  documents,
  endpoint,
  ledger,
  policy,
  requiredDocumentIds: authorizedDiscoverySources().map((_, index) => String(index + 1).padStart(2, "0")),
});
process.stdout.write(
  `${JSON.stringify(
    {
      ...result,
      endpoint_preflight_input_limit: inputLimit,
      ledger_path: ledgerPath,
      discovery_directories: documents.map(({ document_id, discovery_directory, source_sha256, candidates_sha256, blocks_directory, blocks_layout_sha256 }) => ({
        document_id,
        discovery_directory,
        source_sha256,
        candidates_sha256,
        blocks_directory,
        blocks_layout_sha256,
      })),
    },
    null,
    2,
  )}\n`,
);
if (result.status !== "ready_for_per_call_authorization") process.exitCode = 2;
