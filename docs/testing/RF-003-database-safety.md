# RF-003 disposable PostgreSQL and schema safety harness

Status: test and CI safety harness only. No application schema, migration, seed,
route, API, UI, authentication, permission, calculation or persisted-data behavior
is changed by RF-003.

## Deployment boundary

CalculatieTool currently has a development setup only. The PostgreSQL service in
GitHub Actions is an ephemeral test container, not a test, acceptance or production
deployment environment. Production deployment design remains out of scope.

## Fail-closed target contract

Before the harness can create, connect to or drop a database, all of the following
must be true:

1. `CALCULATIETOOL_ALLOW_DISPOSABLE_DB_TESTS=1` is explicitly set.
2. The PostgreSQL host is `localhost`, `127.0.0.1` or `::1`.
3. `CALCULATIETOOL_ENV` is empty/local/dev/development/test/ci, never staging or
   production.
4. The database name begins with `calculatietool_test_` and contains only lowercase
   letters, numbers and underscores.
5. Database creation/deletion uses only the loopback `postgres` maintenance
   database.
6. The application connection pool is not initialized in the test process.
7. Every per-test database receives a random RF-003 suffix, verifies
   `current_database()`, terminates only connections to that exact database and is
   dropped in fixture cleanup.

The same guard runs in CI before the existing seed/bootstrap command. CI uses
`calculatietool_test_ci` inside its job-scoped PostgreSQL container. The integration
tests create additional uniquely named sibling databases and never run destructive
checks against the CI application database itself.

The broad Playwright suite previously completed successfully but was marked
non-blocking while database safety was unknown. RF-003 makes it a blocking gate only
after moving its backend to the guarded, job-scoped test database.

Local discovery remains safe by default: PostgreSQL integration tests are skipped
unless the explicit opt-in and safe target are both present. Guard and static
inventory tests always run.

## Runtime DDL inventory

`test_runtime_ddl_inventory.py` freezes 230 runtime DDL operations owned by 34
named functions. The inventory covers `CREATE`, `ALTER`, `DROP` and `TRUNCATE`
statements executed below `backend/app`. A new or moved operation changes the count,
owner map or SHA-256 fingerprint and requires an explicit review.

Important observed owners include:

- `postgres_storage.ensure_schema`: base `app_datasets` creation;
- storage-module `ensure_schema` functions: request/startup-time table, index and
  compatibility DDL;
- `quote_drafts_storage.ensure_schema`: seven legacy quote-table drops;
- reset helpers: four runtime `TRUNCATE` operations;
- `meta.post_dev_hard_reset`: dynamic table drop;
- `dataset_store.validate_phase_g_constraints`: dynamic constraint validation.

## Executable characterization

The disposable PostgreSQL suite records current behavior without correcting it:

- fresh, repeated and concurrent base/quote initialization must finish with the
  same schema fingerprint;
- reinitializing the current `quote_drafts` schema must preserve current rows;
- all seven known legacy quote tables and four legacy quote datasets are removed by
  quote initialization, while an unrelated sentinel remains;
- the first dashboard read on a legacy/fresh fixture changes schema/data, while the
  subsequent warm read must not change row-count hashes or schema fingerprints;
- empty reset and checked-in seed bootstrap must be semantically repeatable;
- a populated cost-version FK fixture reproduces the current non-atomic reset
  failure: production rows are already removed while the referenced cost version
  and activation remain;
- transaction exceptions roll back and direct connections are closed; successful
  transactions remain visible to a new connection.

These outcomes are characterization, not approval. The legacy quote deletion and
partial reset failure remain findings for later behavior/data work. No cleanup or
migration is authorized by RF-003.

## Commands

Safe everywhere (integration class skips unless explicitly enabled):

```powershell
.\.venv\Scripts\python.exe scripts\check_unittest_discovery.py
.\.venv\Scripts\python.exe -m unittest discover -s tests
```

CI runs the integration class with its loopback, test-prefixed container variables.
Do not manually enable it against an existing development database. A local run
requires a separately created disposable PostgreSQL service and the same guarded
test-prefixed configuration used by CI.
