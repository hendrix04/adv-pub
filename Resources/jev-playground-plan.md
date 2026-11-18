# Local Jev playground: plan and tracker

**Status:** Implemented and running at `http://localhost:4317`; independent review accepted the final fixes. Local only.

## Outcome

Open the running page, load a question macro or failure-case preset, edit any content/question/criteria, and press **Run Jev**. Show actual answers, probability distributions, timing, and exact request/response. Include a diagram of the current pipeline and explain each question's role.

## Scope ledger

| Area | Scope |
| --- | --- |
| Required | Local server and polished browser UI; arbitrary editable source/state/questions; macros for the entire catalog; common failure-case defaults; live pinned Jev calls; clear validation/errors/results; inspectable request history. |
| Reuse | [Question definitions](../src/domains/document/decisions/questions.ts), [request construction](../src/domains/document/decisions/request.ts), [Jev transport](../src/domains/document/decisions/provider.ts), existing credential loader and artifact helpers. |
| Preserve | Pipeline semantics, ontology, source corpus, existing command behavior, model/provider pinning, credential privacy, and unrelated working-tree changes. Diagnostic requests do not alter canonical knowledge or calibration policies. |
| Authorized additions | Development-only server/browser assets, question/preset data assembled from existing definitions, diagnostic artifacts, startup script, focused verification. Any shared-function extension preserves existing callers. |
| Deferred | Port sharing (user explicitly requested local only), production deployment, Postgres integration, pipeline implementation changes, new providers/dependencies. |

## UI

- Editable source/context with paste, file import, and real document loading.
- All catalog macros with editable instructions, criteria, and structured target defaults; custom questions and batches.
- One-click examples: deity versus followers, valid deity aliases, spelling variants, movement qualification/type, Thor qualification, UCR acronym, Pantheon headings.
- Request preview plus an advanced JSON editor for arbitrary Jev state and questions.
- Results with choice/yes probability, full distributions, confidence, latency, raw JSON, and local run history/download.
- Current-system diagram with question groups and interactions; clearly distinguish model recommendations from application thresholds/grouping.
- Credentials remain on the server; request errors stay visible; running/submission state prevents accidental duplicate clicks.

## Implementation sequence and tracker

- [x] Inspect current repository, catalog, and transport; record scope before implementation.
- [x] Confirm all question macros and actual Jev request/response contracts.
- [x] Implement shared catalog/preset payloads and local server using existing transport.
- [x] Implement browser editor, results/history, and current pipeline diagram.
- [x] Run meaningful request-validation/preset tests and required type/style checks.
- [x] Launch the local server and verify UI interactions in a browser.
- [x] Send bounded real Jev smoke requests; preserve evidence and inspect results.
- [x] Review preservation constraints and user flows; record final commands, evidence, and limitations.
- [x] Deliver the running local URL and concise usage instructions.

## Verification targets

| Case | Check |
| --- | --- |
| Catalog | Every question and acronym variant is available; exact current text/criteria and version provenance are retained. |
| General use | Custom content/state, editable choice criteria, yes/no questions, and multi-question requests work without lore-specific restrictions. |
| Failures | Invalid JSON/criteria/source references produce actionable errors without dispatch; provider/network failures preserve diagnostics. |
| Live service | Actual configured Jev endpoint receives the previewed request and returns inspectable results; no simulated answer is presented as live. |
| UI | Presets populate usable defaults, editors synchronize with previews, Run reflects progress, results and history can be revisited/exported. |
| Preservation | Existing pipeline requests continue to validate; no corpus, ontology, policy, credentials, or prior artifacts are rewritten. |

## Evidence

### Delivered behavior

| Piece | Implementation / evidence |
| --- | --- |
| Catalog | [catalog.ts](../src/dev/jev-playground/catalog.ts:86) loads Q01–Q20 plus the Q05 acronym variant. Q01–Q13 reuse active definitions; Q14–Q20 read the catalog and are labeled planned pipeline stages. Nine project documents and nine editable presets are available. Q20 starts with Organization sections from the catalog. |
| Request builder | [request.ts](../src/dev/jev-playground/request.ts:39) validates SDK contracts and pinned routing, reuses complete-source binding, and supports choice, yes/no, and score. Form imports require an exact deep round trip; arbitrary state and optional metadata remain in raw JSON when needed. Known and custom trace metadata survive SDK serialization; requests with unsupported fields are rejected rather than silently altered. |
| Runtime | [server.ts](../src/dev/jev-playground/server.ts:67) listens on loopback, checks existing credentials/endpoint readiness, retains diagnostic artifacts, and permits one live request at a time. [Startup command](../package.json:16): `npm run jev:playground`. It is already running; no user setup is needed now. |
| UI | [index.html](../src/dev/jev-playground/web/index.html:21) provides presets, editable fields/criteria, JSON preview/import/download, raw editing, results, history, and the clickable current-system diagram. Desktop and mobile screenshots are retained with browser evidence. |
| Transport preservation | [provider.ts](../src/domains/document/decisions/provider.ts:27) adds optional immutable source bytes for generic diagnostic requests. Existing pipeline callers still supply bytes and keep both source checks; the mocked regression proves mismatched source never dispatches. Other edits in that file predate this task. |

### Reproducible checks

Run from the repository root:

```bash
npx tsx --test src/dev/jev-playground/playground.test.ts src/domains/document/decisions/request.test.ts src/domains/document/decisions/questions.test.ts src/domains/document/decisions/semantic-input.test.ts src/domains/document/decisions/validation.test.ts
npm run typecheck
npx biome check src/dev/jev-playground/*.ts package.json --diagnostic-level=error
node .kiro/execution/jev-playground/verify-browser.mjs --retained
```

- **19 tests passed**, including all macros/presets, arbitrary state/primitives, lossless imports, optional yes/no criteria, source preservation, duplicate JSON keys, overlapping submissions, retained failures, and malformed score output.
- TypeScript and the scoped Biome check passed. That Biome configuration checks TypeScript/package JSON; browser assets were separately formatted and executed in Chrome.
- [Browser verification](../.kiro/execution/jev-playground/browser/verification.json:1): **17 checks passed**, covering editor/preview synchronization, rapid edits, all macros, real document loading, invalid JSON, raw imports, manifest integrity, diagram navigation, mobile width, history replay, and preserved live request/outbound equality. No browser runtime exceptions.
- The browser script uses its own temporary headless Chrome profile. `--retained` verifies existing actual live artifacts without new model calls; `--live` explicitly dispatches the three smoke cases again.

### Live evidence

[Verification JSON](../.kiro/execution/jev-playground/browser/verification.json:1) names the three checked actual runs and their saved artifacts under `.kiro/execution/jev-playground/runs/<id>/`:

| Case | Observed live behavior |
| --- | --- |
| Arbitrary support-ticket content | Choice, yes/no, and score returned in one request with a string state. |
| Apollo matrix | Correct deity/follower aliases and incorrect follower/deity cross-links remain visible as model outputs; the experiment applies no acceptance cutoff. |
| Movement | Qualification and type both return, independently of pipeline eligibility gates. |

For every checked run, the browser preview, saved request, and actual SDK `attempt/outbound-request.json` were compared with deep equality. All seven retained smoke calls completed; total reported provider usage cost was **$0.000728028**. Reproduce the count/cost calculation:

```python
import json
from pathlib import Path
runs = [json.loads(p.read_text()) for p in Path('.kiro/execution/jev-playground/runs').glob('*/run.json')]
print(len(runs), sum(r.get('response', {}).get('usage', {}).get('cost', 0) for r in runs))
```

### Independent review

The [initial read-only audit](../.kiro/execution/jev-playground/independent-review-initial.json:1) identified unsafe import conversion, raw-mode Add behavior, optional yes/no criteria, and score confidence range validation. These were fixed and covered by unit/browser checks. The reviewer also identified source-manifest preview inconsistency; preparation now checks the same manifest before Run becomes available. The [second review](../.kiro/execution/jev-playground/independent-review-fixes.json:1) independently confirmed those fixes and found one remaining trace-metadata mapping defect. All five known trace keys and custom metadata are now preserved, with whole-request serialization equality enforced. The [final focused review](../.kiro/execution/jev-playground/independent-review-final.json:1) independently reproduced metadata equality through validation, API import/preview, fresh browser file import, and mocked SDK outbound transport. **Accepted** with no remaining confirmed findings; earlier independent checks retain their resolved status. The verdict covers this feature, not unrelated worktree changes.

### Operating limits

This is a local diagnostic workspace. It uses the existing configured Jev model/provider and credentials, records artifacts rather than writing Postgres, and offers at most 50 questions per request with a conservative context allowance. Full pipeline execution, model comparison, production hosting, and automatic adjudication are outside this task. The diagram marks later knowledge/publishing stages as planned; it does not imply the whole path is already operational.

## Follow-up: numeric results in history rows

**Scope:** Show each saved question's selected answer and its probability (choice), yes/no probabilities (noul), or score/maximum (score), plus separately labeled confidence when supplied. Include target names and question IDs so batches can be compared. Reuse saved artifacts; preserve order, View/Load actions, request handling, provider, and pipeline behavior. No removals, new dependencies, automatic success ranking, or new model calls.

- [x] Extend history summaries with retained question results and target context.
- [x] Render accessible numeric summaries in desktop/mobile history rows.
- [x] Verify saved-result equality, UI/actions, and independent preservation review.

**Verification:** `npx tsx --test src/dev/jev-playground/playground.test.ts` passed all five tests, including saved result equality and withholding failed outputs. TypeScript and scoped Biome checks passed. `node .kiro/execution/jev-playground/verify-history.mjs` passed five browser checks against retained actual runs: numeric equality for all primitives, target labels, desktop/mobile layout, View/Load preservation, and failed-output handling. [Browser evidence](../.kiro/execution/jev-playground/browser/history-verification.json:1); [desktop screenshot](../.kiro/execution/jev-playground/browser/history-numbers-desktop.png). No new model calls. [Independent review accepted](../.kiro/execution/jev-playground/independent-history-review.json:1), including an independent comparison of 30 saved runs and 48 results and reproduction of all five browser checks.
