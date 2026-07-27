# RF-013C1 — Read-only blocker worklist

Date: 2026-07-27
Status: implemented; review-only; no financial repair or consumer switch

## Outcome

RF-013C1 turns the aggregate RF-013C blocker totals into an actionable,
administrator-only worklist. It answers which stable SKU, channel or Plan
record is blocking the candidate and where the input belongs. It does not
answer an unresolved financial value by inference.

The endpoint is:

- `GET /api/meta/commercial-yearsets/reconciliation-blockers?source_year=2025&target_year=2026`

It returns:

- the current manifest and validation hashes;
- aggregate readiness and coverage;
- counts by blocker and work area;
- one deterministic work item per blocker occurrence;
- stable SKU and subject identity, a presentation label and scope;
- an explicit owner and next-action category;
- `consumer_mode=compatibility_only`;
- `data_rewritten=false`.

Only an Administrator can use the endpoint. It exposes no cost components,
cost prices, sell-in amounts, markups, frozen Plan values or Forecast values.

## Identity and safety

The worklist uses the exact RF-013C candidate manifest. SKU identity remains
`skus.id` plus the canonical subject projection. A name is read separately and
is only a display aid. Changing that name cannot change the candidate manifest
or validation hash.

The projection contains no update, insert, delete, activation or approval
path. It does not introduce schema. Existing application screens remain on
compatibility readers.

## Protected 2025→2026 result

The correctly prepared RF-013P restore produces 17 work items:

| Area | Count | Meaning |
|---|---:|---|
| Cost | 7 | Required target-engine input is missing |
| Plan | 5 | Required frozen Plan field/allocation is missing |
| Sell-in | 5 | Four rows depend on missing cost; one value is non-positive |

The seven missing cost inputs are:

1. Berlewalde Dubbel — Doos 6 × 75cl
2. Berlewalde Dubbel — Fles 75cl
3. Berlewalde Weizen — Doos 6 × 75cl
4. Berlewalde Weizen — Fles 75cl
5. Berlewalde het juweel — Doos 12 × 33cl
6. Berlewalde het juweel — Doos 24 × 33cl
7. Berlewalde het juweel — Fles 33cl

The first four also account for all four `target_sell_in_cost_unresolved`
items. Their price rows cannot become ready until their cost lineage is ready.

`Berlewalde biervilt` is the one separate
`target_sell_in_non_positive` item. RF-013C1 does not replace its price.

The 2026 Plan lacks:

- revenue;
- contribution;
- liters;
- units;
- period allocation.

These inputs remain Management-owned and are not reconstructed from actuals or
Forecast.

## Verification

Contracts prove:

- exact SKU-level blocker projection;
- deterministic work-item IDs;
- labels do not affect the candidate identity;
- commercial amount fields are absent recursively;
- global blockers cannot disappear from the worklist;
- the route remains Administrator-only;
- the protected restore retains the exact known 7/5/5 distribution and stable
  SKU identities.

The final disposable rehearsal started from the retained RF-013P backup,
replayed the already approved RF-013B and RF-013C additive prerequisites, and
confirmed:

- all 54 pre-existing table fingerprints remained exact;
- all 776 pre-existing schema records remained exact;
- the existing sixteen RF-013A/B/C tables were the only additive tables;
- candidate creation remained idempotent;
- approval remained blocked;
- active generation count remained zero;
- the worklist returned the exact 17 known blocker occurrences;
- the aggregate fingerprint immediately before and after the review projection
  was identical.

Private restore reports remain below ignored `outputs/rf013p/`.

## What must happen next

RF-013C2 should inspect the exact existing lineage available for each cost and
Plan blocker. It may automatically reproduce a value only when a previously
approved business rule and unambiguous source IDs prove the same value. It must
stop for human confirmation where evidence is absent or ambiguous.

Only after explicit inputs produce a zero-blocker RF-013C manifest may
Management approve it and Administrator activate it. RF-012C consumer switches
and RF-012D historical/current presentation remain blocked until that gate
passes.
