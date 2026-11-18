import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readJson } from "../domains/document/discovery/artifacts.js";
import { classificationManifestSchema, questionManifestSchema } from "../domains/document/decisions/contracts.js";
import { readValidatedBatch } from "../domains/document/decisions/operation.js";
import { readCatalogClassificationOperation } from "../domains/document/classification/catalog-operation.js";
import { decodeCapturedSource } from "../domains/document/discovery/source.js";

if (process.argv.length !== 3) throw new Error("Usage: npm run inspect:classification -- <classification-directory>");
const directory = resolve(process.argv[2]!);
const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const operationPath = join(directory, "classification-operation.json");
const aliasInputsPath = join(directory, "aliases", "catalog-v1", "alias-inputs.json");
if (!(await exists(operationPath)) && (await exists(aliasInputsPath))) {
  const aliasDirectory = join(directory, "aliases", "catalog-v1");
  const discoveryDirectory = resolve(directory, "../..");
  const source = decodeCapturedSource(await readFile(join(discoveryDirectory, "source.md")));
  const optional = async (path: string) => {
    try {
      return await readJson(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "not_retained", path };
      throw error;
    }
  };
  const aliasInputs = await optional(aliasInputsPath);
  let manifest;
  try {
    manifest = questionManifestSchema.parse(await readJson(join(aliasDirectory, "manifest.json")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const batches = manifest
    ? await Promise.all(
        manifest.batches.map(async (batch) => {
          try {
            return {
              batch_id: batch.batch_id,
              retained: await readValidatedBatch(aliasDirectory, manifest!, batch.batch_id),
            };
          } catch (error) {
            return {
              batch_id: batch.batch_id,
              validation_error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      )
    : [];
  const [aliasDecisions, aliasGroups, aliasResult] = await Promise.all([
    optional(join(aliasDirectory, "decisions.json")),
    optional(join(aliasDirectory, "alias-groups.json")),
    optional(join(aliasDirectory, "catalog-result.json")),
  ]);
  process.stdout.write(
    JSON.stringify(
      {
        directory,
        source: { sha256: source.sha256, byte_length: source.byteLength },
        operation: { status: "not_prepared", classification_operation: "not_retained" },
        aliasIdentity: {
          directory: aliasDirectory,
          status: manifest ? "partial_or_collected" : "preparing_or_empty",
          inputs: aliasInputs,
          manifest: manifest ?? { status: "not_retained" },
          batches,
          decisions: aliasDecisions,
          groups: aliasGroups,
          result: aliasResult,
        },
        entityQualification: { status: "not_prepared" },
        entityType: { status: "not_prepared" },
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}
if (await exists(operationPath)) {
  const { operation, source } = await readCatalogClassificationOperation(directory);
  const optional = async (path: string) => {
    try {
      return await readJson(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "not_retained", path };
      throw error;
    }
  };
  const optionalText = async (path: string) => {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const [
    aliasInputs,
    aliasDecisions,
    aliasGroups,
    aliasResult,
    qualificationInputs,
    qualificationDecisions,
    qualificationPreparation,
    typingInputs,
    typingDecisions,
    mapPlaceProposals,
    mapPlaceProposalResults,
    discoveryCorrections,
    localEntities,
    result,
    view,
  ] = await Promise.all([
    optional(join(operation.alias_directory, "alias-inputs.json")),
    optional(join(operation.alias_directory, "decisions.json")),
    optional(join(operation.alias_directory, "alias-groups.json")),
    optional(join(operation.alias_directory, "catalog-result.json")),
    optional(join(directory, "qualification-inputs.json")),
    optional(join(operation.qualification_directory, "decisions.json")),
    optional(join(directory, "qualification-preparation-result.json")),
    optional(join(directory, "typing-inputs.json")),
    optional(join(operation.typing_directory, "decisions.json")),
    optional(join(directory, "map-place-proposals.json")),
    optional(join(directory, "map-place-proposal-results.json")),
    optional(join(directory, "discovery-correction-findings.json")),
    optional(join(directory, "local-entities.json")),
    optional(join(directory, "result.json")),
    optionalText(join(directory, "classification-view.md")),
  ]);
  process.stdout.write(
    JSON.stringify(
      {
        directory,
        source: { sha256: source.sha256, byte_length: source.byteLength },
        operation,
        aliasIdentity: {
          directory: operation.alias_directory,
          inputs: aliasInputs,
          decisions: aliasDecisions,
          groups: aliasGroups,
          result: aliasResult,
        },
        entityQualification: {
          directory: operation.qualification_directory,
          preparation: qualificationPreparation,
          inputs: qualificationInputs,
          decisions: qualificationDecisions,
        },
        entityType: { directory: operation.typing_directory, inputs: typingInputs, decisions: typingDecisions },
        mapPlaceProposals,
        mapPlaceProposalResults,
        discoveryCorrections,
        localEntities,
        result,
        view,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}
const manifest = classificationManifestSchema.parse(await readJson(join(directory, "manifest.json")));
const batches = await Promise.all(
  manifest.batches.map(async (batch) => ({
    batch_id: batch.batch_id,
    retained: await readValidatedBatch(directory, manifest, batch.batch_id),
  })),
);
process.stdout.write(
  JSON.stringify(
    {
      directory,
      manifest,
      batches,
      result: await readJson(join(directory, "result.json")),
      findings: await readJson(join(directory, "validation-findings.json")),
      candidate_view: await readFile(join(directory, "classification-view.md"), "utf8"),
      aliases: {
        directory: manifest.alias_directory,
        result: await readJson(join(manifest.alias_directory, "result.json")),
        view: await readFile(join(manifest.alias_directory, "alias-view.md"), "utf8"),
      },
    },
    null,
    2,
  ) + "\n",
);
