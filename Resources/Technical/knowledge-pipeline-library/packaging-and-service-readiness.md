# Packaging and service readiness

## Purpose and when to use it

Use this guide when preparing a reproducible development image, checking runtime compatibility, or diagnosing service startup. The target is one Node.js application package and a PostgreSQL service that hosts two separate databases: lore and Hatchet. See [durable workflows and recovery](durable-workflows-and-recovery.md) for recovery semantics and [live verification and semantic review](live-verification-and-semantic-review.md) for acceptance evidence.

## Inputs, outputs, and invariants

- The application runtime is Node.js 24, npm, TypeScript, `tsx` for local execution, and `tsc` for builds. Runtime dependencies and exact versions must be verified and pinned before use.
- Development packaging must be reproducible: pin the base image by version/digest where available, use the lockfile, and build from declared inputs.
- PostgreSQL lore data and Hatchet operational data use separate databases and credentials/configuration. Sharing one PostgreSQL server does not mean sharing schemas or restore boundaries.
- PostgreSQL's data directory must survive container replacement. Keep its persistent storage and independently recoverable backups distinct from the disposable image and compiled application.
- Extension compatibility for lore PostgreSQL (including `pgvector`, and later the proposed graph extension) must be verified against the chosen server image.
- Configuration is explicit and secret values are supplied at runtime. Validate the intended `OPENROUTER_API_KEY` without printing it; do not silently select another similarly named variable. Concrete configuration key names for database connections remain part of the D-009 design.
- Service readiness means each required service is reachable and ready for its role, not merely that its container process exists.
- Image topology, extension versions, and lint/format tooling must follow the specification and explicit selections; examples do not select additional dependencies.

The specification selects [Node.js 24](https://nodejs.org/en/about/previous-releases) and separates application and Hatchet databases in [TECH-001](../../specification.md#tech-001-technology-and-model-assignments). Exact compatible dependency and extension versions remain to be verified under D-011.

## Practical method

1. Read the package manifest and lockfile as the build contract. Use [`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci) in images and fail if the lockfile does not match the manifest.
2. Compile with the repository's TypeScript configuration in the build stage and run the compiled entrypoint in the runtime image. Keep source execution through `tsx` limited to local development tasks; the production runtime image need not contain `tsc`.
3. Configure distinct connection settings for lore and Hatchet, even when both point to the same PostgreSQL server. Their final variable names and config schema remain [D-009](../../specification.md#open-questions-for-development) work. Keep credentials out of image layers and committed files.
4. Use a PostgreSQL health check, then a separate readiness check that authenticates to both named databases and confirms required extensions exist in their intended database.
5. Confirm Hatchet readiness through its supported health/readiness surface and prove that a worker registers before calling the setup ready. Use the official [local setup](https://docs.hatchet.run/v1/running-locally) and [worker](https://docs.hatchet.run/v1/workers) guides for the deployed version's checks.
6. During authorized live verification, inspect required app-schema privileges and perform a lore-database read/write probe using an approved reversible test row/table, then make a small call through the pinned OpenRouter configuration and inspect the served model, route, and tier. Health endpoints alone do not prove database writes, worker execution, or provider access.
7. Check imports across the domain public ports, CLI, wiki, and workflow layers. Require callers to use exported port operations, reject prohibited cross-layer imports and dependency cycles, and report the exact path that violates a boundary. Select a checker already compatible with the package design rather than adding a new linter or dependency without an approved design.
8. Record an immutable source release identifier and image digest, Node/npm versions, lockfile hash, database image identity, and extension versions with reproducible build evidence. Compare declared inputs and release metadata across builds; do not assume identical image digests unless the build process promises bit-for-bit reproducibility.
9. Fail startup with a clear diagnostic when required configuration or a service is unavailable. Do not silently install packages, substitute providers, or switch database topology to get a green check.
10. Configure a persistent PostgreSQL data mount suited to the selected environment. Record its actual path/volume and backup destination; verify an image update or container recreation reattaches the same data rather than initializing a fresh database. A persistent mount is not a backup. Exact service placement and mount configuration remain deployment choices.

Hatchet's official guides above describe supported service setup and worker readiness. Use them to verify current service details; this project guide does not prescribe a deployment topology beyond the specification.

## Worked example

Use illustrative libpq service aliases `lore-check` and `hatchet-check` in a local `pg_service.conf` or equivalent secret-managed runtime configuration. These are example connection aliases, not application variable names or a new product config contract. The fragment builds the locked package, checks PostgreSQL connection status, authenticates to both databases, verifies the expected schema/table and grants, and performs a rolled-back write probe:

```sh
npm ci
npm run build
node --version
npm --version
pg_isready --dbname "service=lore-check"
pg_isready --dbname "service=hatchet-check"
psql "service=lore-check" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_user;"
psql "service=hatchet-check" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_user;"
psql "service=lore-check" -X -v ON_ERROR_STOP=1 -v schema_name=APP_SCHEMA -v probe_table=APP_SCHEMA.APP_TABLE <<'SQL'
SELECT to_regclass(:'probe_table') AS required_table,
       has_schema_privilege(current_user, :'schema_name', 'USAGE') AS schema_usage,
       has_table_privilege(current_user, :'probe_table', 'SELECT') AS can_select,
       has_table_privilege(current_user, :'probe_table', 'INSERT') AS can_insert,
       has_table_privilege(current_user, :'probe_table', 'UPDATE') AS can_update,
       has_table_privilege(current_user, :'probe_table', 'DELETE') AS can_delete;
SQL
# Substitute actual table/column/key names and use only an approved safe row.
psql "service=lore-check" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $probe$
DECLARE affected bigint;
BEGIN
  UPDATE APP_SCHEMA.APP_TABLE
     SET APP_PROBE_COLUMN = APP_PROBE_COLUMN
   WHERE APP_KEY_COLUMN = 'KNOWN_READINESS_ROW';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'readiness probe expected one row, got %', affected;
  END IF;
END;
$probe$;
SELECT APP_KEY_COLUMN FROM APP_SCHEMA.APP_TABLE WHERE APP_KEY_COLUMN = 'KNOWN_READINESS_ROW';
ROLLBACK;
SQL
psql "service=lore-check" -X -v ON_ERROR_STOP=1 -c "BEGIN; CREATE TEMP TABLE readiness_probe(value integer); INSERT INTO readiness_probe VALUES (1); SELECT value FROM readiness_probe; ROLLBACK;"
psql "service=lore-check" -X -At -v ON_ERROR_STOP=1 -c "SELECT extname || ':' || extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm', 'fuzzystrmatch', 'unaccent') ORDER BY extname;"
```

`APP_SCHEMA`, `APP_TABLE`, and the probe row/column are placeholders. Replace them with an existing, explicitly safe row/table and the least app-role privileges selected by the schema design. The catalog query reports privileges separately; it does not require every privilege, schema `CREATE`, or table `DELETE`. Inspect sequence grants separately if the runtime path requires them. The app-table transaction must affect exactly one approved probe row, return its key, and roll back; zero or multiple affected rows raise an error. Omit it if the schema has no safe probe row and leave this readiness check unresolved until one is designed. The temporary-table transaction tests only session-local PostgreSQL writes, not lore-table access.

Catalog and extension queries are diagnostic output, not automatic readiness assertions. A readiness wrapper must compare `current_database()`/role with the intended destinations, reject missing relations and false required privileges, and compare installed extension names **and versions** with the approved compatibility record under D-011. A printed row or a zero SQL exit code cannot replace those comparisons. `pg_isready` only checks whether the server accepts connections; it does not prove user authentication, database access, or app-schema grants. PostgreSQL documents [`pg_isready`](https://www.postgresql.org/docs/current/app-pg-isready.html), [`psql`](https://www.postgresql.org/docs/current/app-psql.html), [`ROW_COUNT` diagnostics](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-DIAGNOSTICS), installed [`pg_extension`](https://www.postgresql.org/docs/current/catalog-pg-extension.html), and available extensions in [`pg_available_extensions`](https://www.postgresql.org/docs/current/view-pg-available-extensions.html).

Build the production image from an immutable source revision and publish/record its digest. A multi-stage outline is: a pinned Node 24 build stage runs `npm ci` and the TypeScript build; a pinned compatible Node 24 runtime stage receives only compiled output, production dependencies resolved from the same lockfile, and runtime assets. Run as a non-root user and set an explicit compiled entrypoint. Verify the built entrypoint starts in that runtime image; `tsc` need not be copied into it. This is an outline, not a fixed image recipe; verify the pinned base image and native modules for the target runtime.

Install PostgreSQL extensions through an image built or packaged for the same PostgreSQL major version and ABI as the server. Do not copy arbitrary extension binaries from another image. Verify both extension availability in the image and installed extension versions in the target lore database. Graph-extension compatibility remains separate from the core lore path.

## Failure modes and verification

- **Non-reproducible install:** Build twice from the same immutable source revision and lockfile; compare dependency resolution, declared build inputs, and recorded release metadata. Compare image digests only if the build promises bit-for-bit reproducibility.
- **Wrong Node runtime:** Run `node --version` inside both build and runtime images and confirm Node 24; run the TypeScript compiler in the build stage and the compiled entrypoint in the runtime stage.
- **Database confusion:** Verify each connection reaches the correct database and that lore restore procedures cannot alter Hatchet state.
- **Disposable database storage:** In an authorized development verification environment, record source hashes and retained lore plus a known Hatchet run, recreate the database container using the configured mount, and compare the records afterward. Separately restore a backup into an isolated target and verify its contents; retaining a volume alone does not prove recovery.
- **Process-only health:** Remember that `pg_isready` can succeed without valid application credentials. Deny credentials and confirm the `psql` authentication and schema/grant checks fail while connection status may still pass.
- **Extension drift:** Query installed extension versions on the target PostgreSQL image and compare them with the approved lock/pin record.
- **Secret leakage or aliasing:** Scan build/config logs for values, not merely variable names; verify only the intended key is checked and never print it.
- **Unapproved dependency or topology change:** Review manifest, lockfile, base images, ports, volumes, and service database configuration against the governing specification before acceptance.

Build and configuration checks are useful evidence, but product completion still requires live workflow, database, and provider checks with inspectable outputs.

## Application to the specification

This guide applies [TECH-001](../../specification.md#tech-001-technology-and-model-assignments), [TECH-002](../../specification.md#tech-002-one-package-and-three-domain-ports), [OPS-004](../../specification.md#ops-004-fresh-database-baseline), and [D-011](../../specification.md#open-questions-for-development). Keep the proposed one-container development arrangement with distinct application and Hatchet databases; a later hosting topology is not inferred here.
