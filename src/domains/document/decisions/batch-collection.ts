import type { Manifest, RetainedDecision } from "./contracts.js";
import { readValidatedBatch, withValidatedBatchSnapshot } from "./operation.js";

// Callers own missing-batch findings, domain coverage, and whether invalid evidence stops collection.
export async function* readValidatedBatches<T>(
  directory: string,
  manifest: Manifest,
  input: {
    parse: (decision: RetainedDecision) => T;
    repeatId?: string;
    onError?: (error: unknown, batchId: string) => void;
  },
) {
  const rows = await withValidatedBatchSnapshot(directory, manifest, async (snapshot) => {
    const rows = [];
    for (const batch of snapshot.manifest.batches) {
      try {
        const ordinary = await readValidatedBatch(directory, snapshot.manifest, batch.batch_id, undefined, snapshot);
        const repeat = ordinary && input.repeatId ? await readValidatedBatch(directory, snapshot.manifest, batch.batch_id, input.repeatId, snapshot) : undefined;
        rows.push({
          batchId: batch.batch_id,
          ordinary: ordinary ? { ...ordinary, decisions: ordinary.decisions.map(input.parse) } : undefined,
          repeat: repeat ? { ...repeat, decisions: repeat.decisions.map(input.parse) } : undefined,
        });
      } catch (error) {
        if (!input.onError) throw error;
        input.onError(error, batch.batch_id);
      }
    }
    return rows;
  });
  for (const row of rows) yield row;
}
