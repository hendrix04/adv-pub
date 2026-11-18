# Structured model calls

## Purpose and when to use it

Use this capability for model dispatch across extraction, Jev decisions, retrieval, and later writing/support calls. One shared client boundary should enforce pinned settings, durable provenance, budget reservation, schema validation, and served-setting checks. Source integrity belongs to [source capture and evidence](source-capture-and-evidence.md); decision semantics belong to [candidate admission and support](candidate-admission-and-support.md).

## Inputs, outputs, and invariants

Input is a typed call intent, complete source context where required, a run-pinned configuration, and a validated request/schema version. Output is the raw response retained before parsing, parsed and validated data when valid, usage and billing data, request/response provenance, and any validation or routing findings.

Invariants:

- Route all model access through the official `@openrouter/sdk`, selected by the specification. Its public TypeScript docs show `OpenRouter` with `client.chat.send(...)`; structured-output docs show `responseFormat` and `jsonSchema` casing for that API. See [TypeScript SDK overview](https://openrouter.ai/docs/client-sdks/typescript/overview) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).
- Pin model, provider route, service-tier attempt policy, reasoning effort, strict schema/version, and prompt or question versions for the run. Store them with source-hash provenance.
- Keep discovery to one active model request. Independent source-local Jev decision batches of one question kind may overlap within a stage, with at most four active requests in one Hatchet deployment; mixed-question stages, documents, and dependent stages remain sequential.
- Keep the untouched response before JSON parsing or Zod validation; persist proposed material and record validation findings separately.
- Enforce a shared Luna spend reservation before each attempt, then reconcile actual charges. Never start a call whose conservative bound would exceed the operational $4.90 admission ceiling for the below-$5 total budget.
- Compare the configured model/provider/tier with the endpoint actually served. Missing served proof counts as a mismatch; the response stays inspectable but cannot be used as a decision.

## Practical method

1. Validate the pinned configuration and requested parameter support before paid dispatch. For strict structured output, request JSON Schema strict mode and provider parameter enforcement as specified; confirm live endpoint compatibility under D-009/D-011.
2. Construct the request from a single shared boundary, including complete source text and required candidate framing. Check source hash, text, and byte length immediately before dispatch.
3. Reserve the conservative per-attempt charge from the shared budget ledger. The approved Luna policy is two Flex attempts followed by one standard attempt only after retryable failures. Hatchet owns the retries and delays of at least 30 seconds; the shared call handler selects the attempt settings from `ctx.retryCount()`. Do not add an application retry loop or SDK retries that multiply the policy.
4. Record the exact outbound settings and raw response. Persist discovery output and proposals before parsing or validating the proposed evidence.
5. Persist the untouched response before JSON parsing and Zod validation. Classify invalid JSON, schema failures, and served-setting mismatches as non-retryable outcomes; persist their findings and reject them for product use.
6. Reconcile a reservation against actual billing. If the charge is unknown, keep the reservation held until it can be reconciled; never release it as zero. Block the next call if its conservative charge could cross the budget ceiling.

## Worked example

This example uses a complete fictional source and a toy proposal schema, then traces malformed model content. The toy schema demonstrates response handling; it does not define the full discovery payload or assign source-support decisions to Luna. The TypeScript `chat.send` and `responseFormat` shapes are documented by OpenRouter; route fields, response extraction, failure classification, and persistence/budget helpers are **pseudocode** because their exact project contracts remain unresolved.

```ts
// Pseudocode: SDK casing for route/tier fields and persistence ports remain
// D-009/D-011. Hatchet alone schedules the two retries and >=30s delays.
const source = {
  text: "Lira guards the gate.",
  sha256: createHash("sha256").update("Lira guards the gate.", "utf8").digest("hex"),
};
const jsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    quote: { type: "string" },
  },
  required: ["name", "quote"],
  additionalProperties: false,
};
const ResponseSchema = z.object({
  name: z.string(),
  quote: z.string(),
}).strict();

const config = pinnedRunConfig();
const attempt = selectAttemptPolicy(ctx.retryCount(), [
  { serviceTier: "flex", providerOnly: ["openai/flex"], allowFallbacks: false },
  { serviceTier: "flex", providerOnly: ["openai/flex"], allowFallbacks: false },
  { serviceTier: "default", providerOnly: ["openai"], allowFallbacks: false },
]);
await assertCompatibleEndpoint(config);
await assertSdkRetriesDisabled(); // Hatchet owns retries; D-009 mapping unresolved.
await assertCompleteSourceMatchesStoredCopy(source); // shared source-integrity guard
await budget.reserve({ callId, maxCharge: conservativeChargeBound(config, attempt) });

let rawResponse;
let callFailure;
try {
  rawResponse = await client.chat.send({
    model: config.model,
    messages: [{ role: "user", content: source.text }],
    reasoning: { effort: "high" },
    ...sdkFieldsForApprovedAttempt(attempt),
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "toy_proposal",
        strict: true,
        schema: jsonSchema,
      },
    },
    stream: false,
  });

  // Retain the complete SDK response before content parsing or schema checks.
  await persistRawResponseBeforeValidation({ callId, config, rawResponse });
  let decoded;
  try {
    decoded = JSON.parse(readMessageContent(rawResponse));
  } catch (error) {
    await persistValidationFinding({ callId, kind: "invalid_json", error });
    throw new NonRetryableCallError("response_validation", error);
  }
  // Retain decoded proposal material without a schema or evidence gate.
  // Exact grouping into CANDIDATES remains D-005; malformed JSON already
  // has its untouched response retained there.
  await persistUnvalidatedProposalPayload({ callId, decoded });
  const parsed = ResponseSchema.safeParse(decoded);
  await persistValidationFindings({ callId, parsed });
  if (!parsed.success) {
    throw new NonRetryableCallError("response_validation", parsed.error);
  }
  // Missing served evidence is also a mismatch. Preserve the response and
  // finding, but prevent this response from being used as a product decision.
  const served = compareServedSettings(config, rawResponse);
  if (!served.matches) {
    await persistValidationFinding({ callId, kind: "served_settings_mismatch", served });
    throw new NonRetryableCallError("served_settings_mismatch", served);
  }
  return parsed.data;
} catch (error) {
  callFailure = error;
  const failureClass = classifyCallFailure(error);
  // Store discovery responses/proposals in CANDIDATES. Record call failures
  // in workflow diagnostics; this does not add a lore model-call table.
  await persistFailureDiagnostic({ callId, error, failureClass });
  throw error;
} finally {
  // Reconcile even when JSON parsing, Zod validation, or route checks fail.
  const actualCharge = rawResponse
    ? readActualCharge(rawResponse)
    : await lookupChargeIfAvailable(callId);
  if (actualCharge == null) {
    await budget.keepReservationHeld(callId, { failure: callFailure });
  } else {
    await budget.reconcile({ callId, actualCharge, failure: callFailure });
  }
}
```

For the example source, a well-shaped toy response is `{"name":"Lira","quote":"Lira guards the gate."}`. If the retained SDK response has the content `'{"name":"Lira"'` (missing the final brace), the trace is: persist the SDK response first; `JSON.parse` fails; persist `invalid_json`; classify as non-retryable response validation; reject it for product use; then reconcile any known charge. A parseable but invalid payload such as `{"name":42,"quote":"Lira guards the gate."}` is retained as unvalidated proposal material before Zod rejects it. Both outputs remain inspectable. If billing is not yet known, keep the reservation held. Only a classified transient transport failure reaches Hatchet's next configured attempt; routing mismatch or missing served proof fails the call without accepting the response.

OpenRouter documents `responseFormat`/`jsonSchema` in a TypeScript structured-output example and `strict: true` for JSON Schema; its Chat Completions API accepts top-level `service_tier`, provider preferences, and reasoning fields, and reports the served service tier in the response. The SDK docs show differing request envelopes (`chat.send({...}` in the overview and structured-output page; `chat.send({ chatRequest: {...} })` in provider-routing examples), so pin the package and verify its concrete call shape. The selected endpoint, exact SDK field mapping, actual provider reporting, and response provenance must still be checked against that version and live configuration. The charge-bound formula and durable cross-run ledger remain to be defined. [Service tier API documentation](https://openrouter.ai/docs/guides/features/service-tiers) · [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

## Failure modes and verification

- **Unsupported parameter or endpoint:** fail compatibility validation before the paid call where possible; report provider/model capability failure without substituting another provider.
- **Invalid JSON or schema:** keep the raw response and proposals, record the parsing/schema finding, reject it for product use, and classify it as non-retryable response validation. Do not let Hatchet spend another attempt on a validation defect.
- **Unserved or unknown settings:** compare requested and served model/provider/tier. A mismatch or missing proof is a non-retryable failed call; retain the raw response and finding but gate it from use. Never infer reasoning effort from output quality or token use.
- **Retry multiplication:** ensure only the documented Hatchet attempts execute and the SDK does not silently retry.
- **Budget race, overrun, or unknown charge:** reserve before dispatch and reconcile after response/failure. Keep an unknown charge reservation held; verify the next attempt remains below the admission ceiling.

Review [OPS-002](../../specification.md#ops-002-user-controlled-pinned-ai-configuration), [OPS-003](../../specification.md#ops-003-inspectable-discovery-and-decisions), [TECH-001](../../specification.md#tech-001-technology-and-model-assignments), [TECH-003](../../specification.md#tech-003-workflow-decisions-and-publication), and the entries for D-004, D-005, D-009, and D-011 in the [open-question register](../../specification.md#open-questions-for-development).

## Application to the specification

Keep one official SDK dispatch path and the approved config, provenance, reservation, and served-setting checks. Hatchet owns exactly three total attempts: Flex/Flex/standard, selected using `ctx.retryCount()`, with at least 30 seconds between retryable failures and attempts; the shared call handler makes one dispatch, with no application retry loop or SDK retries multiplying attempts. Flex requests constrain provider selection to `openai/flex`, the third attempt constrains it to `openai`, and every attempt disables fallbacks. Only transient transport failures classified under the pinned policy may reach another Hatchet attempt. Invalid JSON/schema and any model/provider/tier mismatch or missing served proof are persisted non-retryable failures and cannot supply a decision. Keep raw model-call material within the approved candidate and operational diagnostic contracts; do not imply a separate lore model-call table. The SDK's documented `chat.send` request envelopes differ across official pages, so verify the concrete call shape with the pinned package. Precise `@openrouter/sdk` field mappings for reasoning, provider restrictions, tier policy, and response metadata remain unresolved under D-009/D-011 and must be demonstrated against the chosen endpoint before implementation is treated as complete. The exact request/response and persistence payload remains D-005; charge-bound formula and shared ledger details remain D-004. Unknown charges retain their reservation until reconciled.
