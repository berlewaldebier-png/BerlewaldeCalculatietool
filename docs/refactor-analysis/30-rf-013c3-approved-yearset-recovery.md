# RF-013C3 — Approved 2026 yearset recovery

Date: 2026-07-28
Status: implemented and activated in development; additive recovery input and candidate projection

## Outcome

RF-013C3 turns the human decisions collected after RF-013C2 into one
hash-guarded recovery input. It does not edit the incomplete 2026 records.
Instead, the existing RF-013C planner projects a new candidate and applies all
normal cost, price, Plan and Forecast validation before that candidate can be
approved or activated.

The approved 2025→2026 decisions are:

- Plan revenue: EUR 220,000 excluding VAT;
- three Juweel SKU costs: reuse the exact existing 2026 activation, planning
  anchor and cost-row IDs; do not recalculate their amounts;
- four Dubbel/Weizen 75cl SKUs: retain all existing records as historical
  catalogue data, but exclude them from the active/planned 2026 candidate;
- Berlewalde Biervilt: sell-in price EUR 0.01 excluding VAT;
- Plan allocation: scale the closed 2025 actual mix to the approved revenue,
  using the already saved 2026 production driver as an independent consistency
  check.

No application reader is switched in this slice.

## Additive storage

The single new table is `commercial_yearset_recovery_inputs`.

It stores:

- source and target year;
- status (`approved` or `superseded`);
- exact RF-013C2 lineage-review hash;
- base candidate manifest hash;
- recovery decision hash;
- the explicit scope, price, authority-ID and Plan reconstruction input;
- approver, timestamp and reason;
- a pointer from a superseded decision to its replacement.

There is at most one approved input for a target year. Replacing it preserves
the previous row. The table has no delete or cascade path. Application startup
creates the additive table automatically, consistent with the current
repository schema strategy.

## API and separation of duties

- `POST /api/meta/commercial-yearsets/recovery/preview`
  - requires `costs:activate`;
  - uses `REPEATABLE READ, READ ONLY`;
  - returns the decision hash and projected candidate result;
  - persists nothing.
- `POST /api/meta/commercial-yearsets/recovery/approve`
  - requires `costs:activate`;
  - the service additionally requires the exact `management` role;
  - requires the decision hash returned by a current preview;
  - stores only the approved recovery input.
- `GET /api/meta/commercial-yearsets/recovery-inputs`
  - Administrator-only audit history.

After approval, the existing RF-013C endpoints remain responsible for:

1. Administrator candidate construction;
2. Management approval of the exact ready manifest;
3. Administrator atomic activation of the commercial-yearset pointer.

The recovery endpoint cannot activate a generation.

## Financial reconstruction

The source is exactly one closed 2025 `year_close_snapshots` dossier. The
projection uses:

- closed actual revenue, variable cost and contribution;
- closed actual SKU mix;
- closed actual monthly transaction mix;
- closed sold liters;
- saved `production_years` values for 2026.

The approved revenue multiplier is applied to the source totals. SKU and month
allocations are separately normalized so their sums exactly equal the target
totals; the final row absorbs only deterministic six-decimal rounding. The
following contract must balance:

`revenue = variable_cost + contribution`

Plan requires positive revenue, contribution, liters and units plus balanced
period and SKU allocations. Initial Forecast is a detached exact copy of the
new frozen Plan. The existing incomplete Plan snapshot is not updated.

## Fail-closed checks

Preview or candidate construction stops when:

- the RF-013C2 lineage hash changed;
- the approved exact-anchor set is not exactly the current automatic set;
- any exact Juweel authority ID or authority hash changed;
- the four human scope decisions do not exactly cover the current set;
- the pricing decision does not exactly cover the current pricing-policy set;
- the target production liters do not match the revenue factor;
- the closed source dossier is missing or ambiguous;
- any allocation cannot be balanced;
- the base manifest changed after preview;
- a duplicate or missing target authority or pricing row appears.

Labels and grouped UI rows never establish identity.

## Protected restore result

A fresh RF-013P restore was expanded through RF-013A/B/C and then exercised
through RF-013C3.

The rehearsal proved:

- the retained source baseline matched;
- all 54 pre-existing table fingerprints and all 776 pre-existing schema
  records remained exact;
- only the seventeen approved additive RF-013A/B/C tables existed as additions;
- the original blocked candidate remained stored and blocked;
- the approved recovery created a new candidate with 79 SKU rows;
- 77 required costs, 47 prices and four advice channels were ready;
- two catalogue references remained cost-not-required;
- blocker count was zero;
- the reconstructed Plan had 12 periods and 60 SKU allocations;
- initial Forecast exactly copied Plan;
- Management approved the exact candidate;
- Administrator atomically activated one pointer;
- historical costs, activations, LOTs, invoices, brew moments, prices, Plan
  snapshots, quotes and actual snapshots were not rewritten.

The private evidence is retained under ignored
`outputs/rf013p/rf013c3-final-rehearsal.json`.

## Development database execution

After merge, the approved operational sequence was executed against the
ordinary development database:

1. a fresh private `pg_dump` was created and its archive listing verified;
2. pre-write data/schema fingerprints were captured;
3. the exact RF-013B manifest was dry-run, applied and rerun idempotently;
4. protected legacy fingerprints remained unchanged;
5. the exact RF-013C3 preview returned 79 SKUs, 77/77 required costs, 47/47
   prices, four channels, 12 Plan periods, 60 SKU allocations and zero blockers;
6. Management approved the exact decision/candidate;
7. Administrator atomically activated generation
   `5a152227-146c-5904-bb91-f8ef4d0b52ee` and run
   `636ff712-89a7-5a4c-87e8-d2a371cb0d8d`;
8. independent post-activation comparison again found no protected legacy,
   dataset, per-year or integrity difference.

The private backup and comparison artifacts remain ignored under
`outputs/rf013p/`. RF-012C consumers can now migrate one at a time; activation
does not itself authorize changing historical readers.

## Remaining work

The active commercial generation is still not consumed by screens in this
slice. RF-012C/RF-012D must separately switch and shadow-compare:

- Kostprijs beheren and the read-only yearset dossier;
- Verkoopstrategie and Adviesprijzen;
- Offerte maken;
- Break-even Plan and Forecast;
- Omzet en Marge actual-cost lineage.

The 2026 Jaarset screen must open the finalized dossier read-only. A separate
action starts preparation for 2027. Legacy readers may be removed only after
the consumer slices prove parity.
