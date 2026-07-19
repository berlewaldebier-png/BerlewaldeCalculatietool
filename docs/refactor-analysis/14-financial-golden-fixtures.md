# RF-010 core — financial golden fixtures

## Outcome and scope

**Observed:** RF-010 core protects the current pure commercial-pricing calculations in `frontend/src/lib/pricingEngine.ts` and the current SKU cost-price calculations in `frontend/src/lib/costpriceCalculationEngine.ts` with executable, reviewable golden fixture sets. It does not change application code, financial formulas, persisted values, database schemas, API contracts or UI behavior.

Both modules were already pure and contract-tested, so no new adapter or abstraction was necessary. The first fixture family covers sell-in pricing, markup/margin, quote-line totals, VAT conversion and advice-price rounding. The second covers direct purchased and own-recipe SKU aggregation, box-to-basis derivation, additional packaging and composed-product validation.

RF-010A (active commercial context) and RF-010B (planning-cost anchor versus actual LOT cost) remain separate later slices. This fixture set does not select an active year, cost version, SKU activation or LOT.

## Contract under protection

| Aspect | Classification | Current contract |
| --- | --- | --- |
| Owner | **Inferred** | Product/finance owns the commercial meaning; engineering owns deterministic implementation. Human confirmation is required before merge. |
| Input currency | **Observed** | The engine accepts numbers and performs no currency lookup or conversion. Fixtures label the values as EUR. |
| Unit | **Inferred** | `kostprijsEx` and `offerPriceEx` are per quoted sellable SKU unit; `qty` is the number of those same units. |
| VAT | **Observed** | `toInclBtw` multiplies by `1 + btwPct / 100`; `fromInclBtw` reverses this. Neither function rounds. |
| Quote totals | **Observed** | Discount and per-unit fee reduce revenue; return percentage reduces post-fee revenue; cost applies to all non-negative quantity. |
| Free units | **Observed** | Revenue applies to paid units; cost applies to all units; the free value is reported as discount. |
| Advice price | **Observed** | VAT is applied after advice markup, then the inclusive price is rounded down to EUR 0.05. The range is EUR 0.05 below/above that result. |
| General precision | **Observed** | Most functions return raw JavaScript numbers. Display rounding is owned by consumers and is outside this seam. |
| Missing cost | **Observed, not approved policy** | A missing/non-finite cost becomes zero and can produce a 100% margin. The fixture exposes this; it does not endorse or fix it. |
| Negative quantity / credits | **Observed, not approved policy** | Negative quantity is clamped to zero. Credit-note behavior is not represented by this calculation seam. |

## Fixture review matrix

The executable source is `frontend/scripts/fixtures/pricing-engine.golden.json`. Every case is classified **Observed** and remains `needs-human-approval` until product/finance confirms that it correctly records the existing baseline.

| ID | Protected behavior | Expected review decision |
| --- | --- | --- |
| PRICE-001 | EUR 10 cost plus 50% markup gives EUR 15 sell-in, 33.333…% margin and a 50% reverse markup | Confirm the markup/margin distinction. |
| PRICE-002 | Representative 24-unit quote with discount, fee and return percentage | Confirm inputs use one sellable SKU unit and raw outputs are intentionally unrounded here. |
| PRICE-003 | Historical values are explicit inputs; this pure seam performs no later master-data lookup | Confirm only as characterization. Source selection is deferred to RF-010A/B. |
| PRICE-004 | Missing cost becomes zero and the calculated margin becomes 100% | Confirm this is the current baseline, not the desired missing-cost policy. A future behavior fix requires a separate approved slice. |
| PRICE-005 | An all-zero line produces zero for every total and margin | Confirm zero-value behavior. |
| PRICE-006 | Negative/credit-like quantity becomes zero | Confirm credits are outside this rule; do not interpret this as a credit-note implementation. |
| PRICE-007 | Two of ten units are free; revenue is EUR 32, costs EUR 20 and margin 37.5% | Confirm free-unit cost applies to every delivered unit. |
| PRICE-008 | EUR 12.50 excluding 21% VAT becomes EUR 15.125 and reverses to EUR 12.50 | Confirm there is no rounding inside VAT conversion. |
| PRICE-009 | EUR 3.58 including the advice calculation becomes EUR 4.30 after downward EUR 0.05 rounding, with range EUR 4.25–4.35 | Confirm downward five-cent rounding and range semantics. |
| PRICE-010 | `round2(1.005)` is EUR 1.01 and `roundDownTo5Cents(4.3318)` is EUR 4.30 | Confirm these representative rounding boundaries. |

## Cost-price construction under protection

The executable source is `frontend/scripts/fixtures/costprice-engine.golden.json`. The engine uses this component model:

```text
cost price = primary/purchase-or-ingredients
           + packaging
           + fixed/ABC overhead
           + excise
```

For a derived basis SKU, each parent component is divided by the parent factor and any child-specific packaging is then added. For a composed sellable product, component SKU breakdowns are multiplied by BOM quantity and direct packaging-component prices are added.

| ID | Business-readable current calculation | Expected review decision |
| --- | --- | --- |
| COST-001 | Purchased Juweel box: EUR 22.75 purchase + EUR 0.00 packaging + EUR 11.25 overhead + EUR 3.86 excise = **EUR 37.86** | Confirm these four component categories and addition order represent a directly purchased SKU. |
| COST-002 | Basis bottle from a 24-bottle box: every COST-001 component is divided by 24; raw total `1.5775`, displayed **EUR 1.58** | Confirm parent-component division and that no packaging is silently added. |
| COST-003 | Own-recipe box: EUR 18.42 ingredients + EUR 9.36 packaging + EUR 12.84 overhead + EUR 4.08 excise = **EUR 44.70** | Confirm own-production uses the same final four-part aggregation once upstream recipe/packaging values have been calculated. This case does not yet derive the EUR 18.42 from individual recipe lines. |
| COST-004 | Gift set: two basis bottles at raw EUR 1.5775 each + EUR 0.91 gift box = raw `4.0649999999999995`; current aggregate display **EUR 4.06** | Review the component model. Also decide whether the observed EUR 4.06 aggregate versus EUR 4.07 sum of displayed components is acceptable as a frozen baseline or requires a separately approved rounding fix. |
| COST-005 | Basis bottle with EUR 0.12 child packaging: raw EUR 1.5775 + EUR 0.12 = `1.6975`, displayed **EUR 1.70** | Confirm child-specific packaging is added after parent division. |
| COST-006 | Missing primary cost is silently converted to EUR 0.00; other components total **EUR 1.00** and status remains `ok` | Confirm only as observed current behavior. Decide separately whether missing primary cost should block activation. |
| COST-007 | A composed product without BOM lines is invalid, returns zero and reports `missing_bom` | Confirm this must remain blocking. |
| COST-008 | A cyclic composition is invalid, returns zero and reports `component_cycle` | Confirm this must remain blocking. |
| COST-009 | Representative `Zwaar onder de boom` composition created in the Producten en verpakkingen shape: two Juweel bottles + one Blond bottle + one glass + one gift box. Component categories total EUR 5.50 primary + EUR 2.50 packaging + EUR 2.25 overhead + EUR 0.75 excise = **EUR 11.00** | Confirm the rule that every distinct component SKU and packaging component is multiplied by its BOM quantity and included once. The amounts are deterministic test values, not the live product's current prices. |

### Cost-price scope boundary

- **Observed:** COST-001/COST-003 protect the final component aggregation, not how an invoice line or recipe engine produced each input component.
- **Observed:** COST-002/COST-005 protect the exact raw parent division and current wizard currency display.
- **Observed:** COST-004 protects both the total and the component breakdown, including the current floating-point/display discrepancy. It does not silently normalize the total.
- **Observed:** COST-009 starts from the exact Article/SKU/BOM field shape written by the current `upsert-bundle` endpoint and protects a multi-SKU composition rather than a single repeated beer component. `FLOW-COMPOSE-001` separately protects how that shape is requested and persisted.
- **Observed:** COST-007/COST-008 protect validation output; neither case writes or activates a zero cost.
- **Unknown:** whether missing primary cost in COST-006 should remain non-blocking.
- **Unknown:** whether the COST-004 aggregate must round mathematically to EUR 4.07, whether persisted precision should change, or whether only display behavior should change. RF-010 records the current EUR 4.06 result and stops before deciding.

## Coverage boundaries and open decisions

### FLOW-COMPOSE-001 — composed-product creation boundary

`frontend/scripts/skuCompositionWorkflow.contracttest.ts` verifies that the Producten en verpakkingen save adapter sends all selected SKU components, quantities and packaging components to `/data/sku-composition/upsert-bundle`. `tests/test_sku_composition_contract.py` invokes the existing backend handler with in-memory mocked stores and verifies that it atomically prepares one parent Article, one sellable SKU and four BOM lines, then forwards the same lines to the normalized product-model projection.

These tests perform no real database write. Together with COST-009 they protect the deterministic path from wizard save payload to persisted-shaped BOM to calculated component total. They do not prove that a particular live `Zwaar onder de boom` record currently has these fixture components or prices.

- **Observed:** no equivalent Python implementation of these selected rule families was found in the repository. A TypeScript/Python parity runner is therefore not applicable; creating one would introduce a second implementation rather than protect an existing one.
- **Observed:** the selected functions contain no dates or timezones. Timezone cases are not applicable to these seams.
- **Observed:** active SKU cost-source, year-transition and exact-LOT selection happen outside this module. They require the separate RF-010A and RF-010B snapshots already defined in the roadmap.
- **Unknown:** whether a missing cost should block a quotation, show a warning or use another explicit fallback. RF-010 core records the present zero fallback only.
- **Unknown:** the authoritative credit-note calculation path. Negative quantities currently produce zero in this seam.
- **Unknown:** whether final persisted/displayed totals must round per line or only at a later aggregate boundary. This slice preserves the current raw outputs and does not decide that policy.

These unknowns do not justify changing formulas in RF-010 core. They must be decided and implemented in separately approved behavior slices after their consumers and persisted contracts are characterized.

## Regression and data safety

- Fixture tests read static JSON files and call pure functions and the existing calculation-wizard currency formatter only.
- Tests never connect to a database, external service or application API.
- The FLOW-COMPOSE-001 backend test replaces dataset and normalized projection persistence with in-memory mocks; it cannot modify development data.
- There is no fixture-update or auto-approval command; golden output changes require an intentional reviewed edit.
- No persisted SKU, quote, customer, LOT or user identifier is included. Cost fixtures use deterministic Juweel-shaped labels and synthetic identifiers only.
- No migration or backfill is required.

## Performance observation

**Observed, not a release threshold:** on the local Windows development machine with Node 24.14.1, 100,000 calls to the representative `calcOfferLineTotals` case completed in 30.341 ms (about 3.30 million calls/second; checksum `4353613.865805`). This measurement is recorded only to detect an obvious future order-of-magnitude regression. It is not a stable CI assertion, and GitHub CI on the repository's authoritative Node 22 runtime remains the compatibility gate.

On the same machine/runtime, 10,000 complete COST-004 gift-set composition calculations completed in 61.308 ms (about 163,110 calls/second; checksum `40650`). This is likewise an observation, not a timing assertion.

## Approval gate

Before squash-merging RF-010 core, product/finance must review PRICE-001 through PRICE-010 and COST-001 through COST-009. When approved, change both fixture-level statuses to `approved`, record the approver and date, and change every case decision status to `approved`. A rejected case must not be silently changed: record the discrepancy and open a separately approved behavior decision/fix.
