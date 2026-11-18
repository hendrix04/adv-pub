export const meta = {
  name: "ap28-source-review",
  description: "Independent source-linked tuning reviews for the six current AP-28 exploratory documents, then policy calibration",
  phases: [{ title: "Source review" }, { title: "Calibration" }],
};

const context = `Use the current project workspace. Read AGENTS.md, .kiro/execution/AP-28/preparation/packet.md, .kiro/execution/AP-28/preparation/completion-plan.md, .kiro/specs/lore-block-entity-association/design.md (especially calibration method), and .kiro/execution/AP-28/live/fresh/tuning-upstream-summary.json. Older pre-checkpoint AP-26/AP-27/AP-28 runs are incompatible. Current 01–06 exploratory answers and full original lore sources are eligible tuning evidence only. Do not modify application code, native task statuses, approved specs, shared ledger, or source/response artifacts. Do not call OpenRouter or start Hatchet. The original graph implementation attempt cap is exhausted; this workflow does evidence review and policy analysis only. Preserve all four historical implementation attempts and all ledger entries. Cite source bytes and retained answer paths; keep uncertainty visible. Do not infer semantic correctness from model confidence or answer agreement.`;

const documents = ["01", "02", "03", "04", "05", "06"];
const reviews = await parallel(documents.map((document) => () => agent(
  `${context}\nReview document ${document} end to end for Q05 alias identity, Q06 entity qualification, and Q07 entity type tuning. Read the complete original source and current fresh exploratory classification (from tuning-upstream-summary.json). Select a bounded, reproducible, diverse set of cases that tests positive, negative, conflicting/unclear, and source-specific edge cases for each present family. Include exact question IDs, raw answer/decision references, expected source-reviewed meaning, original UTF-8 byte spans/text, and the reason for each expected answer. Report denominator, selected count, errors, missed links, unresolved cases, and unavailable case types. Do not turn provisional model actions into supported entities. Save one JSON review at .kiro/execution/AP-28/live/fresh/calibration/source-review/${document}.json and a concise methodology note next to it. If the source or retained answers cannot support a required case, mark coverage MISSING instead of inventing a gold answer. Return READY only when the review artifact is complete and reproducible.`,
  {
    phase: "Source review",
    label: `Source review ${document}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["document", "status", "reviewPath", "summary"],
      properties: {
        document: { type: "string" },
        status: { enum: ["READY", "BLOCKED"] },
        reviewPath: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
)));
if (reviews.some((review) => !review || review.status !== "READY")) return { status: "BLOCKED", reviews };
const calibration = await agent(
  `${context}\nThe six independently written current-source review artifacts are at ${reviews.map((review) => review.reviewPath).join(", ")}. Independently inspect them and the raw retained answers. Apply the approved threshold sweep per question family and preserve uncertainty/missing coverage. Create a source-linked calibration report and a proposed supported policy artifact under .kiro/execution/AP-28/live/fresh/calibration/. The policy must use the existing question-policy contract and exact catalog wording; no application code edit or paid model call. Show false supported action count on reviewed cases, missed links, unresolved counts, case denominators, threshold candidates, and families without usable thresholds. If evidence is insufficient, return BLOCKED with specific missing coverage and an in-scope path to obtain it; do not assert a frozen policy prematurely. Return the report and policy paths and a concise verdict.`,
  {
    phase: "Calibration",
    label: "Calibrate supported policy",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["status", "reportPath", "policyPath", "summary"],
      properties: {
        status: { enum: ["READY", "BLOCKED"] },
        reportPath: { type: "string" },
        policyPath: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
);
return { status: calibration.status, reviews, calibration };
