# RF-013A — Active commercial yearset authority

## Outcome

RF-013A introduces an additive, versioned authority for the operational commercial year without changing any existing commercial record or switching a runtime consumer.

Two PostgreSQL tables are added:

- `commercial_yearsets`: candidate, active, superseded and failed generations;
- `commercial_yearset_events`: ordered immutable audit events for candidate creation, activation, superseding and pointer rollback.

A partial unique index enforces at most one `active` generation. Activation uses an advisory transaction lock, row locks, a validation hash and compare-and-swap against the expected current generation. A failed or stale activation leaves the prior active generation unchanged. Rollback activates a previously validated generation and retains both generations and all domain data.

## Current rollout state

No commercial generation is activated by this slice. Existing readers keep their current explicit year input and the authority API reports:

- `authority = legacy_explicit_fallback`;
- `fallback_used = true`;
- warning `active_commercial_yearset_missing`.

This fallback is observable and does not internally choose `max(productie)` or the calendar year. Runtime consumers are migrated separately in RF-012C after RF-013B and RF-013C.

## Readiness contract

A candidate is ready only when all of the following are proven:

- the explicit source year is positive, precedes the target year and has a closed year snapshot;
- the target production year exists;
- source and target have non-empty canonical SKU activation sets;
- each required source SKU occurs in the target;
- target activation scope is unique and references existing SKUs;
- every target activation has exactly one positive canonical cost-version SKU row;
- Beer SKUs have a valid format and positive liters;
- target selling-pricing records exist;
- an explicit active channel policy exists and every active channel has advice pricing;
- exactly one active Break-even Plan exists with source `new_year_preparation`;
- Plan revenue, variable costs, contribution, liters and units are complete and balanced;
- Plan period and SKU allocations exist and sum to the frozen totals;
- exactly one initial Forecast with basis `frozen_plan` is an exact order-independent copy of that Plan.

The stored readiness payload contains identifiers, counts, reason codes and domain-separated fingerprints, not commercial prices.

## API and permissions

All authority operations are administrator-only:

- `GET /api/meta/commercial-yearsets`
- `POST /api/meta/commercial-yearsets/backfill`
- `POST /api/meta/commercial-yearsets/{generation_id}/activate`
- `POST /api/meta/commercial-yearsets/{generation_id}/rollback`

`GET /api/meta/yearsets` gains an additive `commercial_authority` field. Existing response fields remain unchanged.

Backfill is a dry run by default. A write creates only an idempotent candidate and audit event. Activation requires both the captured validation hash and the expected current active generation ID. The readiness data is re-read under locks immediately before the pointer transaction.

Once an authority is active, the two legacy destructive year rollback routes return HTTP 409. Pointer rollback remains available and never deletes year, SKU, price, Plan, Forecast, LOT, quote or actual-history records.

## Protected-data rehearsal

The RF-013P dump was restored into the guarded loopback database `calculatietool_test_rf013p_restore`. The rehearsal:

1. matched the restored database to the retained RF-013P source manifest;
2. captured schema and content fingerprints for all 54 existing public tables;
3. applied the two additive authority tables;
4. created an idempotent 2025 → 2026 candidate;
5. recaptured and compared all pre-existing schema and table content;
6. verified that no generation became active.

Result:

- all 776 pre-existing schema records remained unchanged;
- every pre-existing table count and content fingerprint remained unchanged;
- only `commercial_yearsets` and `commercial_yearset_events` were added;
- the candidate remained `blocked`;
- active generation count remained zero.

The restored 2026 evidence contains 77 unique open SKU activations and 35 missing canonical cost rows. It also lacks the required populated frozen Plan allocations and initial Forecast. These are explicit blockers for RF-013C; RF-013A does not fill, recalculate or reinterpret them.

The private dump and detailed rehearsal report remain under ignored `outputs/rf013p/`.

## Regression protection

Automated coverage protects:

- deterministic readiness and validation hashes;
- order-independent exact Plan/Forecast comparison;
- missing source/year-close/channel/cost/Plan/Forecast blockers;
- additive and idempotent candidate creation;
- blocked-candidate refusal;
- one-winner concurrent compare-and-swap activation;
- exactly-one-active database constraint;
- ordered actor/time audit events;
- pointer-only rollback with both generations retained;
- explicit legacy fallback and authoritative context projection;
- blocking of destructive legacy rollback once authority is active;
- admin-only route policy;
- runtime DDL ownership;
- RF-013P existing-schema and existing-data parity.

## Manual acceptance

After CI is green:

1. Open the application and confirm existing navigation and year-based screens still work as before.
2. As Administrator, call or inspect the yearset overview and confirm there is no active generation yet.
3. Confirm the fallback warning is visible in the API result and reports the explicitly supplied current year.
4. Run a 2025 → 2026 backfill dry run and confirm it reports blockers without writing a candidate.
5. If desired, create the candidate and confirm it remains `blocked`; do not attempt to override it.
6. Confirm existing 2025/2026 SKU, cost, pricing, quote, LOT and actual-history counts remain unchanged.

Expected behaviour is deliberately unchanged for Quote, Advice prices, Break-even and Omzet en Marge. They are not switched in RF-013A.

## Next slices

- RF-013B adds canonical Beer/SKU and planning-cost authority without deleting compatibility data.
- RF-013C creates a complete, reviewable target-year revision and resolves the known 2026 readiness blockers without overwriting historical rows.
- RF-012C migrates consumers one workflow at a time only after RF-013A/B/C parity succeeds.
