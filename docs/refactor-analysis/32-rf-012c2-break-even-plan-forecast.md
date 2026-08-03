# RF-012C2 — Break-even Plan and Forecast on the active commercial context

Date: 2026-07-30
Status: implemented and validated

## Outcome

The Break-even screen now resolves its current operational year from the one
active RF-013 commercial generation. Its Plan is the immutable approved Plan
captured in that generation. Forecast is a separate projection and never
changes the Plan.

The active-year read model supplies:

- the generation, reconciliation run, operational year and validation hashes;
- the frozen annual Plan targets;
- the twelve approved Plan periods;
- the approved per-SKU Plan allocations and planning-cost components;
- Actual values derived by the existing transaction reader;
- a Forecast made from Actual completed periods plus the still-approved Plan
  periods;
- the source and cutoff used for every displayed value.

This slice performs no schema migration, backfill or persistent write.

## Source-of-truth rules

### Plan

Plan is accepted only when all of these conditions hold:

- the commercial generation is active;
- its reconciliation run is ready;
- the generation has no unresolved activation blockers;
- its Plan is frozen and belongs to the same generation and run;
- the stored Plan hash matches the reconstructed immutable Plan;
- its initial Forecast is an exact copy of that Plan;
- all twelve period allocations and the SKU allocations are present.

The reader fails closed if these invariants do not hold. It never fills a
missing Plan with Actual.

### Actual

Actual remains the existing realized-transaction read model. RF-012C2 does not
revalue historical sales, write transaction snapshots or silently repair
missing LOT/cost lineage. Missing cost lines therefore remain visible.

### Forecast

For an open year, each completed Actual month replaces the corresponding Plan
month. Approved future Plan months remain unchanged. The cumulative Forecast is
therefore:

`Actual through the cutoff + approved Plan after the cutoff`

Before any Actual period exists, Forecast is exactly equal to Plan. At a closed
year, Forecast is exactly equal to final Actual.

An explicit Forecast revision is accepted only when its persisted binding
matches the exact active generation ID, reconciliation run ID and immutable
Plan hash. An unbound legacy reforecast or a revision for another generation is
ignored rather than silently attached to the active Plan.

## Read-only boundary

The active-context reader starts its transaction with
`SET TRANSACTION READ ONLY`. It reads the existing RF-013 generation,
reconciliation, candidate-SKU and Plan records and does not invoke a schema
initializer.

`GET /api/integrations/break-even/analysis-read-model` keeps its URL and method.
When `year` is omitted, the endpoint selects the active commercial generation.
An explicit historical year continues through the existing historical
compatibility reader.

## UI behaviour

The Break-even route no longer derives its default year from the highest
`productie` key. It omits the year parameter until the backend resolves the
active generation and then reflects the returned operational year in the
selector.

For the active generation:

- the read-model panel identifies the active commercial yearset;
- Plan and Forecast charts use the exact backend period timeline instead of a
  frontend static phasing assumption;
- the Forecast explanation identifies whether it is the initial frozen Plan,
  Actual plus remaining Plan, an exact revision or final Actual;
- Plan-versus-Actual rows use readable SKU codes/names from the canonical SKU
  relationship;
- warnings remain visible and actionable.

Selecting 2025 explicitly remains a historical view and is not relabelled as
the active 2026 generation.

## Development read-only verification

The read-only development check resolved:

- active operational year 2026;
- one active generation and ready reconciliation run;
- one immutable frozen Plan with 12 periods and 60 SKU allocations;
- Plan revenue of EUR 220,000;
- Plan contribution of EUR 78,436.40;
- Actual revenue of EUR 65,174 at the verification moment;
- Forecast revenue of EUR 182,928.19 at the verification moment;
- 76 Plan-versus-Actual rows.

The exact Actual and Forecast values may change after a later Douano
synchronization because they intentionally include realized activity through
the current cutoff. Plan remains unchanged.

The authenticated browser check confirmed:

- `/break-even` opened year 2026 and showed the active-yearset indicator;
- Plan, Actual and Forecast were separately populated;
- the Forecast explanation reported Actual-to-date plus remaining Plan;
- Plan-versus-Actual showed approved Plan volume with readable SKU names;
- `/break-even?year=2025` remained a historical view without the active-yearset
  indicator;
- no form was submitted and no persistent value changed.

## ABC occupancy amendment (2026-08-03)

The original RF-012C2 presentation forced Forecast absorbed ABC to the full
annual fixed-cost amount. This made Forecast occupancy show EUR 0 even when
the realized plus remaining planned volume did not cover the annual ABC
amount. A separate frontend card also assumed a fixed normal capacity of
40,000 liters. Both were calculation-source defects, not persisted-data
defects.

The amended active-year read model now calculates occupancy centrally:

- Plan absorbed ABC equals the approved annual ABC basis, so Plan occupancy is
  EUR 0 by definition;
- Actual absorbed ABC remains the ABC component observed in realized sales;
- Forecast absorbed ABC equals realized absorbed ABC plus the approved ABC
  absorption belonging to the unelapsed part of the frozen Plan;
- the current Plan month is split at the latest actual transaction date, so
  only its elapsed fraction is replaced by Actual;
- the volume driver is selected from the approved Plan data in the order
  liters, units, then revenue; no fixed 40,000-liter assumption remains.

The read-only development check on 2026-08-03 resolved Actual through
2026-07-03 and produced:

- Plan: 37,751.231 liters, EUR 90,545.32 absorbed ABC and EUR 0 occupancy;
- Actual: 10,925.31 liters, EUR 3,114.22 absorbed ABC and EUR -87,431.10
  occupancy;
- Forecast: 30,026.319 liters, EUR 48,927.48 absorbed ABC and
  EUR -41,617.84 occupancy.

The authenticated browser showed the rounded values EUR 0, EUR -87,431 and
EUR -41,618 and explained the Forecast using the frozen Plan volume of 37,751
liters. The three scenario controls now start at a neutral 0%; no browser
errors were observed.

### Hardcoded-parameter audit

The audit removed these business-like frontend assumptions:

- 40,000 liters as normal capacity;
- a static monthly revenue/cost phasing curve;
- the year-number heuristic for choosing the fixed-cost source label;
- automatic +5% price and +8% volume scenario defaults;
- unexplained 25% contribution-ratio and EUR 9,000 contribution labels.

The active commercial year uses the exact backend period timeline. The neutral
equal-month fallback remains presentation-only for a compatibility response
without that timeline and is not stored or used as financial authority.

The following constants remain intentionally presentational or input-boundary
settings and do not feed persisted or authoritative financial values: table
page size, chart tick spacing, progress-ring cap, one-euro display
reconciliation tolerance, scenario slider ranges and the supported UI year
range. They are not cost, Plan, Actual or Forecast sources.

## Regression protection

Backend contracts cover:

- exact generation/run/hash and frozen-Plan binding;
- approved SKU allocations and candidate cost components;
- rejection of an initial Forecast that differs from Plan;
- rejection of unbound or differently bound Forecast revisions;
- acceptance of an exactly bound Forecast revision;
- Forecast equal to Plan before Actual exists;
- completed Actual periods replacing only the corresponding Plan periods;
- Forecast equal to final Actual after year close;
- active-year consumer isolation from legacy Plan/reforecast readers;
- read-only SQL before all authority queries and no schema initialization.

Frontend contracts cover:

- active-generation source recognition;
- human-readable Forecast source labels;
- exact sorted cumulative Plan/Actual/Forecast chart values;
- rejection of absent or incompatible active timelines.

The RF-010/RF-011 financial golden tests remain in the same pricing gate.

## Validation result

The complete local baseline passed:

- backend discovery guard: 266 tests discovered, including every required
  RF-012C2 contract;
- backend unit suite: 266 passed, 40 skipped;
- frontend type-check: passed;
- frontend pricing and financial golden contracts: passed;
- frontend workflow contracts: passed;
- frontend API and navigation contracts: passed;
- frontend lint: passed with 62 pre-existing warnings and no new RF-012C2
  warning;
- frontend production build: passed.

The production build retained the pre-existing Next.js warning that
`typedRoutes` is not recognized in `next.config.mjs`. It is not caused or
changed by RF-012C2.

## Data safety and rollback

- Schema migration: none.
- Data backfill: none.
- Persistent data writes: none.
- Historical rewrite: none.
- Existing URL and permission boundary: unchanged.
- Rollback: switch the active-year Break-even consumer back to its legacy
  reader; RF-013 generation and Plan data remain untouched.
- Cleanup of legacy readers: deferred until every active and historical
  consumer is proven and separately approved.

## Manual acceptance

1. Open `/break-even` without a year parameter and confirm 2026 is selected and
   “actieve jaarset gekoppeld” is visible.
2. Confirm current Plan revenue is EUR 220,000 and Plan contribution is about
   EUR 78,436.40.
3. Confirm Actual and Forecast are separate; at the verification cutoff the
   Forecast revenue was about EUR 172,747.12.
4. Open Plan versus Actual and confirm rows contain readable SKU names and
   populated Plan volumes.
5. Select 2025 and confirm it remains a historical view without the active
   2026 indicator.
6. Confirm the warning about unresolved sales-line costs remains visible. It is
   expected until RF-012C3 and must not be interpreted as an RF-012C2 failure.

## Explicitly deferred

- Exact LOT/cost resolution and approved non-LOT classifications for Omzet en
  Marge Actuals: RF-012C3.
- Remaining Verkoopstrategie and Adviesprijzen consumer switches: RF-012C4.
- Cost overview and immutable history dossier: RF-012D.
- Legacy reader removal and destructive cleanup: RF-014/RF-015 after usage is
  proven absent.
