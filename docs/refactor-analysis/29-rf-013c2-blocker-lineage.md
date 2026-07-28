# RF-013C2 — Read-only blocker-lineage classification

Date: 2026-07-28
Status: implemented; review-only; no financial repair, schema change or consumer switch

## Outcome

RF-013C2 classifies the exact RF-013C1 blockers by their existing authoritative
lineage. The result separates values that can later be reproduced from exact
stored IDs from values that do not have a safe repository/database source.

The administrator-only endpoint is:

- `GET /api/meta/commercial-yearsets/reconciliation-lineage?source_year=2025&target_year=2026`

It returns stable identities, evidence counts, classification and the next
responsible action. It never returns cost components, cost prices, sell-in
amounts, amount-derived hashes, Plan amounts or Forecast amounts.
Every response declares:

- `write_authorized=false`;
- `data_rewritten=false`;
- `consumer_mode=compatibility_only`.

## Evidence sources

`yearset_blocker_lineage_service.review_current_lineage` opens one
`REPEATABLE READ, READ ONLY` transaction and combines:

- `skus` and `canonical_sku_subjects`;
- `kostprijs_sku_activations`;
- `planning_cost_anchors`;
- `cost_version_sku_rows`;
- `sales_pricing_records`;
- `bom_lines`;
- `break_even_plan_snapshots`;
- retained `new_year_drafts`, when present;
- the current RF-013C manifest and RF-013C1 worklist.

It does not call schema initialization and has no insert, update, delete,
approval or activation path. UI labels are presentation-only and excluded from
the deterministic `lineage_review_hash`.

## Protected 2025→2026 classification

### Exactly reproducible later: three Juweel SKUs

The following blockers each have exactly one open 2026 activation, matching
planning anchor and matching balanced, positive cost row:

1. Berlewalde het Juweel — Fles 33cl
2. Berlewalde het Juweel — Doos 24 × 33cl
3. Berlewalde het Juweel — Doos 12 × 33cl

Their classification is `reproducible_from_exact_target_anchor`. A later,
separately approved write slice may reference those exact existing IDs. It must
not recalculate, copy by name or guess an amount.

### Human product-scope and cost decision: four 75cl SKUs

The following protected price projections have no activation, planning anchor
or canonical cost row in any year:

1. Berlewalde Dubbel — Fles 75cl
2. Berlewalde Dubbel — Doos 6 × 75cl
3. Berlewalde Weizen — Fles 75cl
4. Berlewalde Weizen — Doos 6 × 75cl

They do have stable Beer/format identity, historical projection metadata,
price records and BOM presence. Those facts prove that the records exist, but
do not prove a beer-specific cost price. A BOM or product label cannot safely
become financial authority.

Product/finance must therefore decide per SKU:

- if it is truly sellable and must remain in the active 2026 assortment,
  register its first cost through the approved cost workflow;
- if it is not an active sellable SKU, approve a separate product-scope
  correction with evidence.

RF-013C2 does neither automatically. These four decisions also own the four
`target_sell_in_cost_unresolved` blockers.

### Pricing-policy decision: Berlewalde Biervilt

Both protected year records have the same non-positive pricing condition. A
zero cannot safely be interpreted as free, internal-only, unavailable or
missing. Product/finance must decide whether Biervilt:

- receives a positive sell-in price; or
- is explicitly marked by the approved policy as free/non-sellable.

No zero price is copied automatically.

### Management Plan input: five blockers

The active 2026 Plan snapshot exists, but revenue, contribution, liters and
units are not positive and period allocation is absent. No retained 2026 draft
exists. The available 2025 snapshot is a `first_use_backfill` and is itself not
a complete authoritative target Plan.

Management must supply an explicit 2026 Plan and allocation. Actuals, Forecast
or the incomplete 2025 backfill are not automatically promoted to Plan.

## Protected restore verification

The final rehearsal started from a fresh restore of the retained RF-013P dump.
It replayed only the already approved additive RF-013A/B/C prerequisites and
then ran the RF-013C1 and RF-013C2 projections.

It confirmed:

- all 54 pre-existing table fingerprints remained exact;
- all 776 pre-existing schema records remained exact;
- only the sixteen approved RF-013A/B/C tables were additive;
- candidate creation stayed idempotent and blocked;
- blocked approval was rejected;
- active generation count remained zero;
- seven cost blockers split into three exact/reproducible and four human-owned;
- four sell-in dependencies, one pricing-policy decision and five Plan inputs;
- no lineage review write and no consumer switch.

The private report is retained under ignored
`outputs/rf013p/rf013c2-final-rehearsal.json`.

## Next slice

RF-013C3 is a separate, explicitly approved write slice. Before it starts,
product/finance/Management must provide:

1. the active-scope and first-cost decision for each of the four 75cl SKUs;
2. the Biervilt pricing policy;
3. the complete 2026 Plan targets and period allocation.

Once those inputs exist through approved workflows, RF-013C3 may construct a
new candidate, reuse the three exact Juweel chains by ID, and re-run the full
zero-blocker/data-loss gate. It may not overwrite the existing blocked
candidate, historical prices, activations, LOTs, invoices, brew moments,
quotes, Plan snapshots or actuals.
