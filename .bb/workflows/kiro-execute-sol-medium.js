export const meta = {
  name: "kiro-execute-sol-medium",
  description: "Complete approved parents sequentially with independent review and up to three repairs",
  phases: [{ title: "Implement" }, { title: "Review" }, { title: "Repair" }],
  inputSchema: {
    type: "object", additionalProperties: false,
    required: ["taskKeys", "packetPaths", "ledgerPath"],
    properties: {
      taskKeys: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
      packetPaths: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
      ledgerPath: { type: "string" }
    }
  }
};
const common = "Read the supplied parent packet and every native child body, following governing project instructions. Preserve unrelated and prior accepted work. Leave changes uncommitted. The coordinator owns native task completion after independent PASS and Organizer progress; hidden workers report results.\nResolve routine implementation details within the approved design. Changes to approved behavior, scope, contracts, providers, or explicit design decisions produce BLOCKED for human reopening.\nLive budget: use the shared ledger and reserve the conservative maximum cost by recording it and increasing spentUsd before each billable live call, including retries. Reconcile to actual cost with evidence; retain reservations for uncertain outcomes. Issue calls only when bounded costs fit the remaining $5 budget. Serialize calls across workers; return BLOCKED if budget prevents required live acceptance. Agent model session costs are separate.\n";
const developer = "Implement the authorized parent and all subtasks against the approved\nspecification. Inspect existing functionality, record a short scope ledger\n(required changes, preserved behavior, explicit removals, and out-of-scope\nwork), and reuse project patterns.\n\nResolve routine implementation details within the approved design. Changes\nto approved behavior, scope, contracts, providers, or explicit design decisions\nrequire human reopening; report the conflict and smallest reconciliation.\n\nAdd meaningful unit tests for application logic and regression risks. Run\nrequired checks and real end-to-end acceptance against the required live\nservices within the shared budget. Record results, costs, and acceptance\ncoverage. Fix implementation issues within scope and leave changes uncommitted.\nGive the reviewer changed files, commands, evidence, and remaining issues.\n";
const reviewer = "Independently assess the complete parent and subtasks against approved\nrequirements, design, acceptance criteria, and preservation constraints.\nInspect the changes and developer evidence. Reproduce meaningful checks,\nincluding live checks needed to establish confidence in business acceptance,\nwithin the remaining shared budget. Use existing live evidence where adequate;\nrepeat or extend testing when evidence is missing, questionable, or insufficient.\nUnit tests establish logic and regression coverage; business acceptance also\nrequires real live evidence.\n\nKeep application code unchanged so repairs remain with the developer.\nReturn PASS when all required acceptance and preservation conditions are\nsatisfied, FAIL with actionable implementation findings, or BLOCKED with the\nmissing prerequisite. Distinguish implementation issues from changes to the\napproved specification, which require human reopening. Cite concrete evidence.\n";
const schema = {"type": "object", "additionalProperties": false, "required": ["verdict", "summary", "evidence"], "properties": {"verdict": {"enum": ["PASS", "FAIL", "BLOCKED"]}, "summary": {"type": "string"}, "evidence": {"type": "string"}}};
if (args.taskKeys.length !== args.packetPaths.length) throw new Error("Every parent needs a packet");
const results = [];
for (let index = 0; index < args.taskKeys.length; index++) {
  const key = args.taskKeys[index];
  const context = common + "\nParent: " + key + "\nRead packet: " + args.packetPaths[index]
    + "\nShared ledger: " + args.ledgerPath;
  let findings = "Initial implementation";
  let accepted = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const work = await agent(context + "\n" + developer + "\nFindings: " + findings, {
      provider: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium",
      phase: attempt === 0 ? "Implement" : "Repair", label: key + " implementation " + (attempt + 1), schema
    });
    if (work.verdict === "BLOCKED") return { status: "BLOCKED", results, task: key, work };
    const model = "codex/gpt-6.1-sol/xhigh";
    const prompt = context + "\n" + reviewer + "\nDeveloper handoff: " + JSON.stringify(work);
    const review = await agent(prompt, {
      provider: "codex", model: "gpt-6.1-sol", reasoningLevel: "xhigh",
      phase: "Review", label: key + " independent review " + (attempt + 1), schema
    });
    results.push({ task: key, attempt: attempt + 1, model, review });
    if (review.verdict === "PASS") { accepted = true; break; }
    if (review.verdict === "BLOCKED") return { status: "BLOCKED", results, task: key };
    findings = JSON.stringify(review);
  }
  if (!accepted) return { status: "FAIL", results, task: key, reason: "Three repairs exhausted" };
}
return { status: "PASS", results };
