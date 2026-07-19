# RF-010 core — financial golden fixtures

## Outcome and scope

**Observed:** RF-010 core protects the current pure pricing calculations in `frontend/src/lib/pricingEngine.ts` with an executable, reviewable golden fixture set. It does not change application code, financial formulas, persisted values, database schemas, API contracts or UI behavior.

The selected seam is intentionally limited to one existing rule family: sell-in pricing, markup/margin, quote-line totals, VAT conversion and advice-price rounding. The module was already pure and contract-tested, so no new adapter or abstraction was necessary.

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

## Coverage boundaries and open decisions

- **Observed:** no equivalent Python implementation of this selected rule family was found in the repository. A TypeScript/Python parity runner is therefore not applicable; creating one would introduce a second implementation rather than protect an existing one.
- **Observed:** the selected functions contain no dates or timezones. Timezone cases are not applicable to this seam.
- **Observed:** active SKU cost-source, year-transition and exact-LOT selection happen outside this module. They require the separate RF-010A and RF-010B snapshots already defined in the roadmap.
- **Unknown:** whether a missing cost should block a quotation, show a warning or use another explicit fallback. RF-010 core records the present zero fallback only.
- **Unknown:** the authoritative credit-note calculation path. Negative quantities currently produce zero in this seam.
- **Unknown:** whether final persisted/displayed totals must round per line or only at a later aggregate boundary. This slice preserves the current raw outputs and does not decide that policy.

These unknowns do not justify changing formulas in RF-010 core. They must be decided and implemented in separately approved behavior slices after their consumers and persisted contracts are characterized.

## Regression and data safety

- Fixture tests read a static JSON file and call pure functions only.
- Tests never connect to a database, external service or application API.
- There is no fixture-update or auto-approval command; golden output changes require an intentional reviewed edit.
- No real SKU, beer, quote, customer, price, LOT or user identifier is included.
- No migration or backfill is required.

## Performance observation

**Observed, not a release threshold:** on the local Windows development machine with Node 24.14.1, 100,000 calls to the representative `calcOfferLineTotals` case completed in 30.341 ms (about 3.30 million calls/second; checksum `4353613.865805`). This measurement is recorded only to detect an obvious future order-of-magnitude regression. It is not a stable CI assertion, and GitHub CI on the repository's authoritative Node 22 runtime remains the compatibility gate.

## Approval gate

Before squash-merging RF-010 core, product/finance must review PRICE-001 through PRICE-010. When approved, change the fixture-level status to `approved`, record the approver and date, and change every case decision status to `approved`. A rejected case must not be silently changed: record the discrepancy and open a separately approved behavior decision/fix.
