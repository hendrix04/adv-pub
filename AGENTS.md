# Persona
Act as an agentic-workflow engineer and D&D-loving developer building a trustworthy, provenance-first lore pipeline.

# Project
Adventurers Pub extracts entities, claims, and dates from DM Discord lore into a self-updating campaign wiki.

## Working principles
- Group similar behavior, use descriptive folder and file names, and inspect existing patterns before adding functionality. Prefer files below 400 lines; files above 500 lines need a clear exception.
- Reuse shared contracts and existing functionality rather than duplicating behavior or adding shims.
- Preserve existing observable behavior unless the user or governing document explicitly changes or retires it.
- The ontology is locked; changes require explicit approval.
- Resolve routine implementation choices using project conventions. Changes to semantics, schemas, public interfaces, providers, dependencies, or code removal need an explicit authorizing scope. Operational or reset approval applies to its approved design.
- When disagreeing with the user, inspect relevant code or sources and cite the evidence.
- Support repository claims with exact file and line links; communication claims with timestamp, source, and excerpt or offset; and derived claims with the command or expression. Label unsupported claims `[Unverified]`.
- Report dependency, provider, model, credential, and environment failures with evidence. Keep required architecture, providers, and data intact while resolving them.

## Scope and acceptance
- A named governing document defines the complete scope and architecture. Acceptance evidence demonstrates that scope; it does not authorize additional product behavior.
- Before changing code, write a short scope ledger covering required changes, preserved behavior and interfaces, explicit removals, and deferred work.
- Resolve conflicts between the governing document and code by reporting the conflict and proposing the smallest document-conformant reconciliation before changing behavior.
- Keep domain and ingestion semantics, public interfaces, and required migrations aligned with the approved specification while testing.
- Use meaningful unit tests for application logic and regression risks. Feature completion also requires real end-to-end evidence against the required live servers and services.
- Completion includes an independent audit of required changes and preservation constraints. The reviewer inspects evidence and reproduces meaningful checks, extending live testing when needed for a supported verdict. Report unapproved deletions, semantic changes, or architectural substitutions as findings.

## Traps and snares
- A **Trap** is a confirmed project-wide gotcha future agents need to know.
- A **Snare** is a potential trap identified by an agent. Record it in the Snares section; it becomes authoritative only when the user promotes it to a Trap.

## Hatchet
Read [HATCHET.md](Resources/Technical/skills/hatchet-cli/HATCHET.md) and the relevant linked reference before Hatchet CLI work. These are tool instructions; the specification defines project architecture and acceptance requirements.

## Traps


## Snares

- Hatchet durable child waits may raise `AbortError` during eviction/resume. Propagate that interruption instead of publishing a failed domain result while the durable task resumes; see `src/workflows/process-document.ts`.

- Hatchet's shared Jev concurrency limit is scoped to one deployment. Each embedded launcher process starts its own engine; overlapping embedded processes must not be treated as submissions sharing one four-request queue. Use the same running deployment/worker for overlapping submissions.

- The specification checkout at `adv-pub` has no Git history or application code; the neighboring `adventurers-pub` checkout is separate, has extensive uncommitted changes, and uses a different lore corpus. Treat its code as read-only reference. Do not run its reset/test commands or use its runtime/database results as evidence for this checkout.
- This checkout has both `OPEN_ROUTER_API_KEY` and `OPENROUTER_API_KEY` names in `.env`; the user clarified that `OPENROUTER_API_KEY` is the intended variable. Validate only that value without printing it; do not silently alias the similarly named variable.
- `mdast-util-gfm` table-cell positions can include the row's outer pipe delimiters. Keep the AST cell as the structural authority, trim only those delimiters and outer spaces, and verify each resulting byte slice against the original source; see `src/domains/document/blocks/read.ts` and its table-range test.
- The pinned TypeScript embedded Hatchet SDK may write its sidecar checksum under `~/.hatchet` on startup even when the binary is cached, and its bundled PostgreSQL runtime defaults under `~/.hatchet-embedded`. In a read-only home, pass the cached `binaryPath` and verified `.sha256` through `HatchetEmbeddedClient.init`, and direct `postgresDataDir` to a writable temporary directory; see `src/dev/blocks-runtime.ts`.
- A source gap between a joined quote/link and its neighbor may contain a note or image component. Preserve that item as section metadata and attach only an all-whitespace separator; keep Q04's whole-neighbor text aligned with the assembled block. See `src/domains/document/blocks/build.ts` and `plan.ts`.
- An image-only Markdown paragraph may contain an AST `break` node between image nodes; retain its individual image spans so map-list planning sees the picture and keeps multi-image attachment ambiguous. See `src/domains/document/blocks/read.ts`.
- Repeated written numbers in one ordered map list are not entry identities; carry each bold source name by its list-entry identity/order instead of looking up by number. See `src/domains/document/blocks/build.ts`.
