# Running and inspecting the document pipeline

Install the locked dependencies with `npm ci` using the Node version in [the project version file](../.nvmrc). The quick offline check is in the [project overview](../README.md#try-it-locally).

| Operation | Entry point |
| --- | --- |
| Check embedded Hatchet readiness | `npm run ready` |
| Discover candidate names and inspect a saved result | `npm run discover` then `npm run inspect` |
| Build source blocks | `npm run blocks -- --source <lore.md> --output <dir> --mode new` |
| Classify local entities | `npm run classify` |
| Associate source passages with local entities | [Single-document arguments and ledger](#associate-passages) |
| Inspect the question and its response in Jev Lab | `npm run jev:playground` |

The model-backed commands read `OPENROUTER_API_KEY` from the environment or the project’s `.env` file. Inspection commands read saved artifacts. Live operations use generated run directories, so substitute paths from your own run for the examples below. [Command definitions](../package.json#L9-L32) · [Credential lookup](../src/domains/document/discovery/provider.ts#L120-L131) · [Association arguments](../src/dev/associate.ts)

For a live prompt experiment, start `npm run jev:playground` and open `http://localhost:4317`. Select the Apollo preset to inspect the proposed request before running it. [Lab presets](../src/dev/jev-playground/catalog.ts) · [Local server](../src/dev/jev-playground/server.ts#L239-L244)

## Catalog Q05–Q07 classification

Start with a retained discovery iteration. The first command illustrates a historical run directory. Use the directory printed by discovery on a fresh checkout. Supply the matching blocks operation for map proposals and a reviewed policy file to produce supported actions.

```bash
npm run classify -- data/runs/01-unified-church-of-the-realms/iterations/iteration-043
npm run classify -- <discovery-iteration> --blocks <blocks-operation> --policy <reviewed-policy.json>
npm run inspect:classification -- <printed-classification-directory>
npm run verify:classification -- <printed-classification-directory>
```

The same `process-document` workflow runs durable Q05, saves its all-unordered-pairs alias decisions and fully supported groups, then runs Q06 qualification and routes eligible positive answers to Q07 typing. Exploratory runs can type provisional positives. Emitting a local entity requires supported answers at both stages. Every child uses the shared Hatchet-owned `jev-decision-batch` task and sends the complete retained source through OpenRouter's Decisions API to `typesafe/jev-1.13`; Q06 and Q07 also receive the locked ontology rules. The [active execution settings](../src/domains/document/decisions/execution-policy.ts#L4-L15) set the shared request limit per deployment. Batches shrink to fit the conservative complete-input bound. Q05 groups remain document-local, and alias agreement does not qualify a candidate.

Results live beneath the discovery iteration in `classifications/<operation-id>/`. The `aliases/catalog-v1/` directory retains Q05 targets, acronym clues, raw decisions, pair groups, and unresolved findings. `qualification/catalog-v1/` and `typing/catalog-v1/` retain separate Q06/Q07 stage decisions. `map-place-proposals.json` keeps source names, exact entry evidence, and generated section/number labels in separate fields. Unnamed map entries can receive Q06 based on their whole source descriptor; generated display labels are never treated as names. Discovery omissions create exact-span correction findings and block Q06 until a new compatible Sol iteration supplies the missing candidates; the inspector retains the blocked preparation result. Saved Sol output is never edited.

Without a reviewed `--policy` file, actions are exploratory and provisional; they do not produce supported local entities. The Q07 wire choices are exactly `Creature`, `Location`, `Organization`, `Item`, `Event`, `Quest`, and `Concept`. There is no `not_an_entity` Q07 option. All requests, raw responses, answers, actions, and upstream hashes remain inspectable. The capability result sets `full_product_status` to `not_run`; it creates no canonical entities, claims, or cross-document identity.

Pass a printed classification directory to `npm run classify -- <classification-directory>` to resume unchanged inputs. Validated saved batches are reused without new model calls. Changed source, candidates, policy, map layout, question version, or upstream stage requires a new operation. Historical combined-classification and alias artifacts remain readable through the same commands; new operations use catalog Q05–Q07.

The read-only verifier independently checks retained Q05–Q07 wire requests and responses, pair coverage, gating, map evidence, source-local lineage, confidence/probabilities, concurrency, retry timing, and saved-result reuse. Its PASS establishes structural/operational behavior; inspect model choices against the source before admission.

Before an ordered 01–09 live pass, `npm run preflight:classification-live` takes one compatible `--discovery <dir>` and `--blocks <NN=dir>` per document. It estimates the request costs and reports missing inputs. Use `--endpoint-file <preflight.json>` to supply saved endpoint metadata. Live attempts record reservations and reconcile reported usage against the shared ledger. [Preflight command](../src/dev/preflight-classification-live.ts) · [Budget accounting](../src/domains/document/discovery/budget.ts#L219-L255)

For live Hatchet retry verification, add `--verify-retry` to a new classification run. This injects one clearly marked pre-network failure in the first batch; Hatchet waits at least 30 seconds before retrying against real Jev. It does not change model answers or provider routing.

## Associate passages

The association launcher expects the retained AP-28 cost ledger. Set `BB_LIVE_COST_LEDGER` to `.kiro/execution/AP-28/live-cost-ledger.json` in a workspace with that ledger. [Ledger check](../src/dev/associate.ts#L86-L94)

For a single document, supply its original source, compatible structure and classification directories, and an output directory. Add `--policy` to apply a reviewed association policy. [Association options](../src/dev/associate.ts#L37-L76)

```bash
npm run associate -- --source <lore.md> --structure <blocks-operation> --classification <classification-directory> --output <new-operation-directory>
```

## Source structure verification

The live verification example requires a separately retained source review at the specified path. Supply your own matching review and run directories.

`npm run verify:blocks -- --output <new-run-directory> --review .kiro/execution/AP-26/source-review.json` runs the live Q01–Q04 structure review over the nine authorized lore files. To recheck a saved run without model requests or filesystem writes, run `npm run verify:blocks -- --audit <run-directory>`. `npm run inspect:blocks -- <operation-directory>` prints one saved operation's retained source, layout, and decisions.

## Test execution retention

Test launchers (`blocks`, live `verify:blocks`, catalog live checks, and catalog recovery checks) automatically retain the ten most recently started execution directories across `.kiro/execution/` and `.bb/ap25-evidence/`. A corpus pass counts as one execution; its document stages, repeats, and raw responses stay together. Failed runs count too, current active runs are protected, and resuming an output updates its recency. Read-only inspection/auditing does not change retention.

Outputs explicitly placed outside these managed testing areas and product `data/runs/` are not automatically deleted. Keep shared budget ledgers and planning inputs outside disposable execution directories. The registry is `.kiro/execution/test-executions.json`; retention removes older directories without making backup copies. Registry updates use the installed Linux `flock` utility to protect active runs across test processes.
