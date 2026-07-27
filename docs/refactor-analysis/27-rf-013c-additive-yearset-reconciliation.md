# RF-013C — Additive yearset reconciliation and canonical activation

Date: 2026-07-27
Status: implemented additively; current 2026 candidate is blocked; existing consumers remain on compatibility reads

## Outcome

RF-013C adds a deterministic, reviewable yearset candidate beside the existing
application data. It does not repair or overwrite the incomplete 2026 records.
It proves exactly which stable SKUs can already be reconciled and which inputs
must still be supplied before activation.

Canonical identity comes only from:

- `skus.id`;
- `canonical_sku_subjects`;
- the RF-013B planning-cost anchor for `(sku_id, source_year)`;
- explicit target-year activation membership.

Grouped rows, product names and UI labels never establish identity. Multiple UI
rows for one SKU collapse only when their complete financial signatures are
identical. A financial conflict for one SKU blocks the candidate.

## Additive schema

RF-013C creates only:

- `commercial_yearset_reconciliation_runs`;
- `commercial_yearset_candidate_skus`;
- `commercial_yearset_candidate_prices`;
- `commercial_yearset_candidate_channels`;
- `commercial_yearset_candidate_plan`;
- `commercial_yearset_reconciliation_events`.

All relations to existing authority data use `ON DELETE RESTRICT`. Candidate
rows receive deterministic new IDs, including reserved target cost-version and
cost-row IDs. Existing cost versions, SKU cost rows, activations, LOTs, prices,
Plans, Forecasts, quotes, invoices, brew moments and actual snapshots are not
updated or deleted.

The candidate tables are the isolated expansion model. Existing application
screens do not consume them in this slice. This prevents a partially prepared
yearset from becoming visible as the current commercial truth.

## Candidate scope and rules

Every active canonical SKU is represented exactly once and classified as:

- `carried_forward`: the source year has a planning-cost anchor;
- `target_operational_addition`: the SKU was introduced operationally in the
  target year;
- `sellable_without_anchor`: pricing exists but canonical planning lineage is
  missing, which blocks activation;
- `catalog_reference_only`: no planning cost is required.

For every cost-required SKU the candidate requires:

- one unambiguous target-engine input;
- exact source-version lineage when a source anchor exists;
- non-negative cost components;
- a positive total cost;
- component sum equal to total cost within the existing tolerance;
- liters for Beer SKUs;
- stable SKU/subject identity and structure/mapping fingerprints.

The target-engine input supplies financial values and calculation provenance
only. It is not an identity source.

## Pricing, advice, Plan and Forecast

The candidate separately records:

- explicit target-year sell-in per SKU;
- active advice channels and their target markup;
- one frozen Break-even Plan from `new_year_preparation`;
- one initial Forecast that is a detached exact copy of that Plan.

The Plan must have positive revenue, contribution, liters and units, a valid
variable-cost balance, balanced period allocation and balanced SKU allocation.
An incomplete Plan produces visible blocker codes; zero or missing values are
not inferred.

The separate deep copy matters: a later Forecast mutation cannot alter the
frozen Plan object.

## Prepare, approve and activate

The workflow is deliberately separated:

1. Administrator runs a dry reconciliation.
2. Administrator writes the candidate using the exact dry-run manifest hash.
3. Management reviews and approves that same manifest with a reason.
4. Administrator activates the approved, still-current manifest.

Activation recomputes and locks the source/input snapshot. Any source, BOM,
mapping, price, advice or Plan change after preparation invalidates the
manifest and stops approval/activation. A compare-and-swap check also protects
the current active-generation pointer.

Candidate creation, generation creation and activation/pointer movement are
transactional. A failure after generation creation rolls the whole candidate
write back. Rollback selects a previously complete approved generation and
moves only the authority pointer; it never deletes either generation.

The older generic commercial-yearset activation route is blocked for a target
year once an RF-013C reconciliation run exists, preventing bypass of the
Management approval gate.

## API and observability

The additive endpoints are:

- `GET /api/meta/commercial-yearsets/reconciliations`;
- `POST /api/meta/commercial-yearsets/reconcile`;
- `POST /api/meta/commercial-yearsets/reconciliations/{run_id}/approve`;
- `POST /api/meta/commercial-yearsets/reconciliations/{run_id}/activate`;
- `POST /api/meta/commercial-yearsets/reconciliations/{run_id}/rollback`.

The API exposes hashes, readiness, counts and reason codes. It does not expose
commercial amounts in the aggregate overview.

## RF-013P restore rehearsal

A fresh copy of `outputs/rf013p/calculatietool-rf013p.dump` was restored into a
new loopback-only disposable database. Before expansion, it matched the
retained RF-013P baseline exactly.

The rehearsal then applied RF-013B authority backfill and RF-013C dry-run/write
twice. Results:

- all 54 pre-existing table fingerprints stayed exact;
- all 776 pre-existing schema records stayed exact;
- compatibility datasets, 2025/2026 aggregates and integrity controls stayed
  exact;
- exactly the sixteen allowed RF-013A/B/C tables existed as additions;
- two dry runs produced the same manifest hash;
- two writes resolved to one generation and one reconciliation run;
- the blocked candidate could not be approved;
- no active commercial generation existed afterward;
- existing consumers stayed `compatibility_only`.

Current restored candidate coverage:

| Candidate scope | Count |
|---|---:|
| Active canonical SKUs | 83 |
| Cost-required SKUs | 81 |
| Cost-ready SKUs | 74 |
| Catalogue references without required cost | 2 |
| Target price rows | 51 |
| Price-ready rows | 46 |
| Active advice channels | 4 |
| Advice-ready channels | 4 |
| UI target-engine rows | 103 |
| Unique target-engine SKU IDs | 74 |

Preserved blockers:

| Blocker | Count |
|---|---:|
| Required target cost input missing | 7 |
| Target sell-in cost unresolved | 4 |
| Target sell-in non-positive | 1 |
| Frozen Plan revenue missing | 1 |
| Frozen Plan contribution missing | 1 |
| Frozen Plan liters missing | 1 |
| Frozen Plan units missing | 1 |
| Frozen Plan period allocation missing | 1 |

The 103-to-74 difference is confirmed presentation fan-out with financially
identical rows, not 29 missing SKUs. The seven missing inputs are separate,
explicit blockers.

## Validation

Contracts cover:

- one candidate row per stable SKU;
- identical UI fan-out collapse;
- conflicting duplicate financial rows blocking;
- missing target input and non-positive sell-in blocking;
- deterministic manifests independent of row order;
- exact, detached Plan/Forecast copies;
- authenticated route and role separation;
- stale dry-run/source hashes blocking writes and approval;
- failed intermediate candidate writes rolling back generation and run;
- Management approval followed by Administrator activation;
- single active pointer enforcement;
- additive runtime-DDL inventory;
- exact restored baseline preservation and idempotence.

## What RF-013C deliberately does not do

RF-013C does not:

- invent the seven missing cost inputs;
- change a cost formula or business rule;
- repair the incomplete Plan with guessed values;
- switch Quote, Break-even, sales strategy, advice-price or margin consumers;
- rewrite 2025 or the existing 2026 evidence;
- remove JSON compatibility data or legacy tables;
- activate the blocked 2026 candidate.

## Next dependency

Before RF-012C/RF-012D can switch consumers, the seven cost inputs, five price
readiness gaps and incomplete Plan must be resolved through explicit approved
inputs. RF-013C is rerun afterward; only a zero-blocker manifest can be approved
and activated.

Once an active complete generation exists:

- RF-012C migrates Quote, Break-even, sales strategy and advice-price reads one
  consumer at a time;
- RF-012D presents historical/current cost variants and yearset dossiers;
- RF-014 may later prove temporary compatibility readers unused;
- RF-015 remains separately approved destructive cleanup only.

## Rollback

Before consumer migration, code rollback leaves the additive audit/candidate
tables unused and current screens continue on compatibility readers. Do not
drop the tables during rollback. After future activation, rollback moves the
commercial-yearset pointer to the previously approved complete generation; it
does not delete candidate or historical data.
