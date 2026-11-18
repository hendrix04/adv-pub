export const meta = {
  name: "ap28-fresh-tuning",
  description: "Rebuild incompatible AP-28 tuning inputs from current sources and discovery names",
  phases: [{ title: "Fresh tuning inputs" }],
};

return await agent(`Continue AP-28 after the user's correction that all earlier AP-26/AP-27/AP-28 runs are incompatible with their checkpoint changes. Only Resources/Lore/proposed_entities/01.json through 09.json may be carried forward. Read AGENTS.md, the AP-28 task packet and child bodies, the governing documents, and .kiro/execution/AP-28/scope-ledger.md. The old workflow wfr_558e845e-7ea0-4f75-8148-0d31a7fd0b8f is historical only. Keep checkpoint c5b828d and old artifacts intact. Do not modify application code, approved specifications, task statuses, or the shared ledger's prior entries and attempt counts. The one implementation and three repairs are already recorded; this assignment is operational evidence collection, not another repair.

Fresh 01 pilot already exists: .kiro/execution/AP-28/live/fresh/structures/01 and .kiro/execution/AP-28/live/fresh/discovery-inputs/01/classifications/4d1946e1-3133-423b-be1d-578dc41990d5. It used only the current source and carried discovery names. Classification exploratory produced zero supported local entities, as expected. All nine fresh discovery input directories and the import-receipt.json are under .kiro/execution/AP-28/live/fresh/discovery-inputs/. Do not use their old AP-26/AP-27 counterparts or old exploratory association output.

Prepare fresh exploratory structure and classification outputs for documents 02-06 in order, using current source files and the new discovery inputs, following the same commands/paths as 01. Set BB_LIVE_COST_LEDGER to .kiro/execution/AP-28/live-cost-ledger.json for every live command. Use one running embedded deployment for overlapping submissions, and otherwise serialize processes; do not imply separate embedded engines share the four-request queue. Keep logs bounded. Reserve and reconcile every call under the existing $5 cap, stop when a cost is unknown or cannot fit. Check result status, lineage, stage completeness, and exact spend. Record paths, run IDs, outcomes, counts, commands, and any failures in .kiro/execution/AP-28/live/fresh/tuning-upstream-summary.json. No association calls or heldout 07-09 calls in this stage. No use of any old run as acceptance evidence. Return READY when all fresh tuning inputs are complete, or BLOCKED with the exact cause and retained partial evidence.`, {
  provider: "codex",
  model: "gpt-6-luna",
  reasoningLevel: "xhigh",
  phase: "Fresh tuning inputs",
  label: "AP-28 fresh tuning inputs 02-06",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "evidence"],
    properties: {
      verdict: { enum: ["READY", "BLOCKED"] },
      summary: { type: "string" },
      evidence: { type: "string" },
    },
  },
});
