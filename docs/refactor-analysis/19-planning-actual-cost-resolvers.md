# RF-011B — Read-only planning-cost and actual-LOT-cost resolvers

Date: 2026-07-21
Status: implemented as a pure candidate/shadow boundary; no runtime consumer or data authority switched.

## Outcome

RF-011B introduces two deliberately different read APIs over one supplied snapshot:

- `PlanningCostResolver.resolve_planning_cost(sku_id, planning_year)` resolves the first approved planning activation for a concrete SKU/year, except when a later `explicit_rebaseline` event has recorded approval;
- `ActualLotCostResolver.resolve_actual_lot_cost(sku_id, lot_id)` resolves an exact LOT-linked cost version and canonical cost row.

The facade `ReadOnlyCostResolutionService` reads its input once through `CostResolutionSnapshotReader`. The port has no write, activate, rebuild or backfill method. The resolver modules never import PostgreSQL, dataset storage, API routes or current consumer components.

No schema, migration, persisted record, historical quote, historical sales snapshot, activation, LOT mapping, price, formula, route or permission changed.

## Classification and evidence

- **Observed:** current new-quote and Break-even paths select the latest/open activation in the RF-010B fixture. The approved planning candidate selects the January first activation. The shadow reason is `current_latest_activation_differs_from_planning_anchor`.
- **Observed:** current Omzet en Marge resolves an exact January LOT to the January version even after a May activation. RF-011B returns the same version and components for that exact LOT.
- **Observed:** current Omzet en Marge falls back to the active SKU cost for missing, unknown and near-match LOTs. RF-011B returns blocking typed states and reports `current_actual_fallback_masks_unresolved_lot`; it does not silently substitute a planning anchor.
- **Observed:** current code silently selects one version for an exact LOT collision. RF-011B returns `ambiguous_exact_lot` with all candidate version/row IDs and no amount.
- **Observed:** 910 development snapshots currently use a direct `lot` cost source rather than a canonical cost-version/row lineage. RF-011B reports an exact unlinked direct record as `missing_canonical_lot_lineage` and multiple records as `ambiguous_direct_lot_cost`; it never copies the direct amount into a canonical result.
- **Observed:** the RF-010B development audit contains 11 ambiguous exact LOT keys, 500 explicit LOT fallback snapshots and 940 missing-cost snapshots. RF-011B does not repair or rewrite any of them.
- **Inferred:** after the relevant RF-013 authorities and RF-012C migrations, removing silent fallbacks will make some currently calculated margin lines visibly unresolved until maintained mapping/classification is complete.
- **Unknown:** which individual development records represent valid non-LOT cost-bearing products, intentional `no_cost_required` lines, missing mappings or genuinely incorrect LOT data. Item-level classification remains human/admin work.

## Public contracts

### Planning result

The result contains:

- status and source reason;
- source activation/event ID;
- activation ID;
- cost-version ID;
- canonical cost-row ID;
- effective timestamp;
- whether retained history is sufficient to prove the anchor;
- immutable component values for purchase, packaging, indirect cost, excise and total cost;
- warnings and all candidate IDs when resolution is ambiguous.

Blocking states include missing/ambiguous anchor, missing version, missing/ambiguous row and non-positive cost. Equal-timestamp records pointing to different versions are ambiguous; IDs are not used as a financial tie-break.

### Actual LOT result

The result contains:

- status and source reason;
- requested and resolved LOT identities;
- explicit alias/mapping ID;
- cost-version and cost-row IDs;
- component breakdown;
- warnings and all candidate mapping/LOT/version/row IDs.

The exact comparison normalizes harmless punctuation/case but deliberately keeps the letter `O` distinct from the digit `0`. A near match is diagnostic only and requires an explicit mapping.

Existing direct `lot_cost_records` are accepted as evidence, not yet as the canonical result. Until RF-013B can relate such a record to a canonical SKU cost version/row and complete component breakdown, the resolver returns its record ID and a blocking lineage status without returning its amount. This protects the 910 observed direct-LOT snapshots from both silent loss and unapproved reinterpretation.

## Requirement policy

LOT requirement and cost requirement remain independent:

| Maintained classification | Candidate behaviour |
|---|---|
| LOT required, cost required | Exact LOT must resolve uniquely; otherwise a typed blocking state is returned |
| LOT not required, cost required | Only an explicitly supplied planning year may resolve the SKU planning anchor |
| Cost not required | Returns `no_cost_required`; no zero cost is invented |
| Ignored | Returns `ignored`; the line remains excluded by explicit policy |

The non-LOT path cannot be reached accidentally: callers must supply `lot_requirement="not_required"` and an explicit `planning_year`. A LOT-required call never falls back to the planning resolver.

## Shadow comparison

`compare_cost_selection_shadow` accepts current consumer selections for:

- `price_proposal`;
- `break_even`;
- `omzet_en_marge`.

It returns identifier/status differences only. It does not return or log commercial amounts. Existing consumers do not call the new service in this slice.

## Tests

`tests/test_planning_actual_cost_resolver.py` covers:

1. January first purchase followed by a later same-SKU purchase;
2. first own-production format followed by a later brew;
3. a newly introduced SKU/format;
4. an independent next planning year;
5. approved explicit rebaseline, requiring a real boolean approval rather than truthy text;
6. equal-time anchor ambiguity;
7. duplicate canonical cost rows;
8. exact January and May LOTs without date selection;
9. explicit LOT aliases scoped by canonical SKU ID or its projected SKU code;
10. conflicting mappings;
11. an exact direct LOT record without canonical version/row lineage;
12. missing, unknown, near-match and ambiguous LOTs without silent fallback;
13. cost-bearing non-LOT SKU, `no_cost_required` and ignored policies;
14. explicit planning-year requirement for non-LOT cost;
15. current Price proposal/Break-even/latest-activation deviations;
16. current Omzet en Marge exact parity and fallback/ambiguity deviations;
17. read purity and single snapshot read;
18. indexed resolution on a 2,000-SKU synthetic volume.

The RF-010B golden tests remain unchanged and continue freezing current runtime behaviour. This is intentional: RF-011B proves both the current result and the approved candidate without pretending the consumer switch has happened.

## Rollout and rollback

- **Rollout:** test/shadow only until RF-013B establishes the canonical Beer/SKU/planning-anchor authority and the relevant RF-012C consumer is individually approved.
- **Rollback:** remove the pure resolver modules, facade, tests and documentation. No data rollback is required.
- **Observability:** later consumer migrations must compare status, version/row IDs and reason codes without logging prices. Exact parity is required for resolved exact LOTs. Every newly unresolved fallback must remain visible to the administrator.

RF-013B must reconcile or explicitly classify the observed direct `lot`, packaging-component and composed-SKU actual-cost sources before the relevant RF-012C consumer switch. RF-011B does not invent canonical lineage for those compatibility paths.

## Required approval before authority/consumer switch

The previously agreed target rules are represented as code, but runtime switching still requires finance/data confirmation that:

- first approved activation per SKU/year is the planning anchor;
- only an approved explicit rebaseline replaces it;
- exact LOT determines actual cost regardless of order/invoice date;
- missing, unknown, near-match and ambiguous LOT never silently use planning cost;
- non-LOT cost-bearing products use an explicitly scoped SKU/planning-year cost;
- maintained `no_cost_required` lines such as valid rounding differences receive no invented cost;
- historical quotes and persisted actual snapshots retain their stored context.

These confirmations are required before RF-013B or RF-012C. They are not required to merge this read-only slice when tests and CI pass.
