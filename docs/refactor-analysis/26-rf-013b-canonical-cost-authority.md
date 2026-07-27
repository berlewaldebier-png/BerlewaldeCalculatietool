# RF-013B — Canonical Beer/SKU planning-cost authority

Date: 2026-07-27
Status: implemented additively; existing consumers remain on compatibility reads

## Outcome

RF-013B adds relational authorities beside the existing application data. It
does not delete, rename, move or reinterpret a historical Beer, SKU, cost
version, cost row, activation, LOT, quote or actual snapshot.

The authority separates:

- stable Beer identity;
- a concrete SKU's subject (`beer`, `article`, `service` or `bundle`);
- the explicit subject of a cost-version header;
- one planning-cost anchor for `(sku_id, planning_year)`;
- exact LOT-to-cost-version/SKU-row lineage;
- unresolved and ambiguous legacy mappings.

No price, quote, Break-even or Omzet en Marge consumer reads these tables yet.
`consumer_mode=compatibility_only` is intentional. RF-013C must first build a
complete yearset candidate; RF-012C/RF-012D switch consumers later.

## Additive schema

RF-013B creates only:

- `canonical_beers`;
- `canonical_sku_subjects`;
- `cost_version_subjects`;
- `planning_cost_anchors`;
- `planning_cost_anchor_events`;
- `planning_cost_rebaseline_requests`;
- `canonical_lot_cost_lineage`;
- `cost_authority_mapping_manifest`.

Foreign keys use `ON DELETE RESTRICT`. Existing compatibility sources,
including `app_datasets.bieren`, remain present. No destructive migration or
cleanup is included.

## Planning-cost invariant

Normal activation dual-writes an anchor only if:

1. the `(sku_id, planning_year)` has no prior active/history evidence;
2. the new cost version contains exactly one canonical row for that SKU;
3. no planning anchor already exists.

A later activation for the same SKU/year closes/opens the existing activation
history exactly as before, but it does not replace the planning anchor. A newly
introduced SKU/year receives its own first anchor.

The deterministic legacy backfill uses the RF-011B resolver. Missing or
ambiguous headers/rows stop that scope; it never inserts a zero cost or chooses
an ID tie-breaker.

## Explicit rebaseline workflow

Rebaseline is not part of normal activation:

1. Brewer prepares a proposal and mandatory reason.
2. Management approves it.
3. Administrator executes it.

Execution checks that the planning anchor still equals the before-version and
before-row captured during preparation. It then atomically moves only the
authority pointer and appends an immutable event containing before/after IDs,
reason, approval actor and executor. Sales cannot prepare, approve or execute a
rebaseline.

## Legacy mapping review

Backfill matches an exact Beer ID first. A unique legacy Beer name may be
projected, but duplicate-name matches remain ambiguous. The manifest stores the
candidate IDs and source hash.

An Administrator may approve one ambiguous cost-version-to-Beer mapping only
with:

- the exact reviewed source hash;
- an existing canonical Beer ID;
- a review reason;
- and, for an ambiguous mapping, a target from the captured candidate set.

Approval updates only the additive subject/manifest rows. It does not rewrite
`cost_versions.bier_id`.

## Actual LOT invariant

Canonical LOT lineage is inserted only for one exact normalized LOT + SKU
candidate resolving to one cost version and one cost row. A later collision
marks the new authority scope ambiguous; it never silently keeps an apparently
valid winner.

Legacy `lot_cost_records` without version/row lineage are captured as blockers.
Non-LOT and no-cost-required policies remain separate; RF-013B does not invent a
planning fallback or a zero cost.

## Automatic backfill contract

The backfill is:

- dry-run first;
- deterministic and hash-addressed;
- compare-and-swap protected with `expected_manifest_hash`;
- additive and idempotent;
- restartable after blockers are reviewed;
- aggregate-only at the API boundary.

It may upsert deterministic authority rows and mapping evidence. It never
deletes or updates the legacy sources.

## RF-013P restore rehearsal

A fresh copy of `outputs/rf013p/calculatietool-rf013p.dump` was restored into
the loopback-only database `calculatietool_test_rf013b_restore`. Before
expansion it matched the retained RF-013P source baseline exactly.

After RF-013B expansion and backfill:

- all 54 pre-existing table fingerprints were unchanged;
- all 776 pre-existing schema records were unchanged;
- every compatibility dataset, 2025/2026 aggregate and integrity reason count
  remained unchanged;
- exactly the eight RF-013B tables were added;
- a second identical backfill created no second planning anchor.

Aggregate projection evidence:

| Authority/result | Count |
|---|---:|
| Canonical Beers | 16 |
| Canonical SKU subjects | 83 |
| Cost-version subjects | 57 |
| Resolved cost-version subjects | 52 |
| Planning-cost anchors | 108 |
| Canonical exact LOT lineages | 59 |
| Mapping-manifest rows | 405 |

The restore remains intentionally **not ready**. Preserved blockers are:

| Blocker | Count |
|---|---:|
| Missing canonical cost row | 35 |
| Direct LOT cost record lacks canonical version/row lineage | 21 |
| Exact LOT + SKU maps to multiple version rows | 26 |
| Cost version contains multiple subjects | 4 |
| Legacy Beer name maps to multiple Beer IDs | 1 |

These are reason counts per authority scope, not automatic repair
instructions. RF-013C addresses the incomplete target-year candidate. Beer
ambiguity uses the reviewed mapping command. LOT and multi-subject ambiguity
remain blocked until explicit evidence is approved.

## Validation

Protected tests cover:

- first anchor versus later same-SKU versions;
- a new SKU/year first anchor;
- exact LOT separation;
- direct unlinked LOT cost blocking;
- duplicate Beer ID/name handling;
- article/service/bundle discrimination;
- deterministic/idempotent backfill;
- zero changes to legacy table counts;
- Brewer → Management → Administrator rebaseline permissions and order;
- source-hash-guarded Beer mapping review;
- exact additive-table allow-list;
- startup, route-permission and runtime-DDL inventories.

The local full repository gate passed: 212 Python tests (including all
PostgreSQL integration tests), frontend lint with no errors, type-check,
pricing/workflow/permission contracts and the production build. GitHub CI must
still pass before merge.

## Rollback

Before any consumer switch, code rollback means reverting RF-013B and leaving
the additive tables unused. Do not drop the tables as part of rollback: they
contain audit/mapping evidence. Existing consumers continue to use the same
legacy tables throughout this slice.

## Next dependency

RF-013C may now create a new additive yearset-reconciliation candidate. It must
not activate the current incomplete 2026 state. RF-012C/RF-012D remain blocked
until RF-013C proves complete SKU/cost/Plan/Forecast parity and receives
product/finance approval.
