# RF-013P — Protected data baseline and restore gate

Date: 2026-07-23
Runtime status: tooling/characterisation only; no schema, data, API or application behaviour changed

## Outcome

RF-013P is the mandatory data-protection gate before RF-013A/B/C. It formalizes the approved distinction between:

- structural product type (`basis`, `samengesteld`, explicitly created sellable variant, article/service);
- immutable cost-version SKU rows containing purchase, packaging, overhead/indirect, excise and total cost;
- one planning-cost anchor per concrete SKU and commercial generation;
- exact LOT-to-cost-version lineage for realized cost;
- one logical current planning-cost list obtained by joining the active generation to those authorities.

The current 2025/2026 data is evidence to preserve, not a structure to overwrite. RF-013C may later build a new corrected candidate generation, but only after this baseline and a restore rehearsal pass.

## Added tooling

### Read-only baseline

`scripts/rf013p_data_baseline.py`:

- refuses environments other than explicit `local`, `dev` or `development`;
- accepts loopback by default and a private IP-literal development host only with explicit opt-in;
- starts one PostgreSQL transaction and verifies `transaction_read_only=on`;
- calls no application `ensure_schema` and performs no DDL/DML;
- fingerprints the public schema and every public table;
- fingerprints table rows as an order-independent multiset so server collation and
  row-return order cannot create false differences;
- emits only table/dataset names, counts, integrity reason counts and domain-separated SHA-256 fingerprints;
- keeps private JSON artifacts under ignored `outputs/rf013p/`;
- compares a later capture to an earlier manifest and fails on any protected difference.

The capture includes all public tables, not only the tables known when this slice was written. Explicit critical-coverage reporting prevents a missing Beer/SKU/cost/advice table or compatibility dataset from being silently ignored.

### Backup and restore rehearsal

`scripts/rf013p_backup_restore.py`:

- requires PostgreSQL `pg_dump` and `pg_restore`;
- writes a custom-format `.dump` only below ignored `outputs/rf013p/`;
- never puts a password in command arguments;
- requires an existing empty restore database guarded by the RF-003 rules:
  - loopback only;
  - database name starts with `calculatietool_test_`;
  - `CALCULATIETOOL_ALLOW_DISPOSABLE_DB_TESTS=1`;
  - no staging/production-like environment;
- captures the source before and after `pg_dump` and fails if a writer changed protected state during backup;
- restores in one transaction;
- captures the restored database and requires exact protected schema/table/data fingerprints.

The backup contains private application data. It must not be committed, attached to a PR or copied into normal logs.

## Commands

From the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
. .\backend\.env.local.ps1
$env:CALCULATIETOOL_ENV = "development"
.\.venv\Scripts\python.exe scripts\rf013p_data_baseline.py `
  --years 2025 2026 `
  --allow-private-development-host `
  --acknowledge-aggregate-fingerprints `
  --output outputs\rf013p\source-baseline.json
```

Run the same command with `--compare outputs\rf013p\source-baseline.json` to prove that protected state has not changed.

For a private backup/restore rehearsal, first install compatible PostgreSQL client
tools and create an empty local disposable database such as
`calculatietool_test_rf013p_restore`. Then set its URL without printing it:

```powershell
$env:CALCULATIETOOL_ALLOW_DISPOSABLE_DB_TESTS = "1"
$env:CALCULATIETOOL_RF013P_RESTORE_URL = "<private loopback URL for calculatietool_test_rf013p_restore>"
.\.venv\Scripts\python.exe scripts\rf013p_backup_restore.py `
  --years 2025 2026 `
  --allow-private-development-host `
  --acknowledge-sensitive-backup
```

If the PostgreSQL binaries are not on `PATH`, pass `--pg-dump` and `--pg-restore` with their local executable paths.

## Required evidence before RF-013A

- `source-baseline.json` exists outside Git under `outputs/rf013p/`.
- A custom-format backup exists outside Git.
- The source was quiescent during backup.
- Restore target passed the disposable guard and was empty.
- `source-baseline.json` and `restored-baseline.json` match in schema, tables, compatibility datasets, per-year counts and integrity counts.
- The private backup location and retention period are confirmed by the repository owner.
- The known RF-010/RF-011 discrepancies still exist as classified evidence; obtaining parity must not silently remove them.

## Local backup and restore evidence

The missing environment gate was completed on 2026-07-23:

- the official EDB PostgreSQL 17.10 Windows x64 binary archive was installed
  portably below `C:\Users\hansh\.codex\runtimes\postgresql-17.10`; nothing was
  added to the system `PATH` and no Windows service was installed;
- the downloaded archive contained PostgreSQL 17.10 `pg_dump`, `pg_restore`,
  `initdb`, `pg_ctl` and `psql`; its locally calculated SHA-256 was
  `EF9B1E5E23D2E8A83914BA13D9DC536A72210FBA53FD1808FF1F7E06BB22B106`
  (integrity/repeatability evidence, not an upstream-published checksum);
- the development source reported PostgreSQL 16.14;
- an empty PostgreSQL 17.10 database named
  `calculatietool_test_rf013p_restore` ran only on `127.0.0.1:55432`;
- the restore target contained zero public tables before the rehearsal;
- a fresh custom-format backup was written to the ignored
  `outputs/rf013p/calculatietool-rf013p.dump`;
- the source fingerprints were identical immediately before and after
  `pg_dump`, proving that protected state did not change during the backup;
- `pg_restore --single-transaction --exit-on-error` completed successfully;
- the restored database matched the source exactly for 776 schema records,
  all 54 public tables, compatibility datasets, 2025/2026 aggregates and
  integrity controls;
- the disposable server was stopped after verification and no longer responds
  on port 55432.

The first strict comparison exposed a verifier defect rather than a restore
difference: equal row sets could be hashed in database collation order. The
verifier now sorts serialized rows in the client as a multiset. A regression
test proves that row order does not affect a fingerprint and duplicate rows
remain significant. The complete backup/restore rehearsal then passed.

The private backup and manifests remain intentionally ignored. Keep them until
RF-013 is completed and accepted, and until a newer independently restored
backup replaces them. Deleting or exporting those artifacts is an explicit
repository-owner action.

## Local read-only baseline evidence

The private development capture completed twice with an immediate exact comparison. Only the following aggregate evidence is recorded here:

| Protected aggregate | 2025 | 2026 |
|---|---:|---:|
| Open SKU activations | 66 | 77 |
| Activations with matching `(version_id, sku_id)` cost row | 66 | 42 |
| Activations missing that canonical cost row | 0 | 35 |
| Cost versions | 29 | 28 |
| Normalized cost rows across all versions | 107 | 63 |
| Advice channel rows | 0 | 4 |
| Sales-pricing rows | 55 | 57 |

Additional aggregate results:

- 54 public tables and 776 schema records were fingerprinted;
- every explicitly critical table and compatibility dataset was present;
- no activation referenced a missing SKU or cost-version header;
- no cost row referenced a missing SKU or cost-version header;
- no duplicate open `(sku_id, year)` activation or duplicate `(version_id, sku_id)` cost-row scope was found;
- exactly 35 open activations lack their matching canonical cost row, all in 2026.

**Observed:** the reported missing products are not explained by missing SKU/version foreign identities or duplicate active scopes. The directly confirmed defect is incomplete 2026 activation-to-cost-row coverage. This matches RF-010C and explains why readiness-filtered consumers can hide products.

**Unknown:** whether each of those 35 rows can be reconstructed deterministically from its original finalized snapshot/current target inputs. RF-013C must classify them individually and stop rather than guess.

**Observed:** advice-pricing persistence contains four 2026 channel rows and no 2025 channel rows. Therefore the current 2026 Horeca percentage cannot be proven to have been copied from a retained 2025 advice row. Its exact provenance remains unknown until generation lineage is introduced; the value must be preserved as compatibility evidence.

## Tests

`tests/test_rf013p_data_baseline.py` protects:

- deterministic/domain-separated fingerprints;
- order-independent rowset fingerprints that still detect duplicate-row changes;
- positive sorted year scope;
- protected-section comparisons;
- artifact-path containment;
- rejection of production and unverified hosts;
- password-free PostgreSQL command arguments;
- custom backup and transactional restore flags.

The RF-001 unittest discovery gate now requires the RF-013P safety contracts.

## Rollback

Remove the two scripts, tests and this documentation/roadmap amendment. There is no data or schema rollback because RF-013P performs no application write or migration.
