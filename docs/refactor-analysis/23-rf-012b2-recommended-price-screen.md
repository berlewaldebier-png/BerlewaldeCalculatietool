# RF-012B2 — Recommended-price screen boundary

## Approved objective

RF-012B2 refactors SCREEN-018 (`/adviesprijzen`) as a separate screen slice. It clarifies route, state, presentation and form-rule ownership; adopts the approved status and field semantics; and preserves every current financial and persistence contract.

This slice does **not** select a new commercial source of truth, repair data, add sorting, change a calculation or migrate persisted rows. Those changes remain governed by RF-012C/RF-013 and their prerequisite parity evidence.

## Responsibility map

Before RF-012B2, the route manually projected eleven bootstrap datasets and `AdviesprijzenWorkspace` combined normalization, year state, central-SKU selection, sell-in resolution, advice-price calculations, save orchestration, status handling and all screen JSX in one component.

After RF-012B2:

- `recommendedPriceScreenModel.ts` owns the typed eleven-dataset bootstrap projection.
- `RecommendedPriceScreen.tsx` owns PageShell composition and route identity.
- `AdviesprijzenWorkspace.tsx` is the client controller for local state, existing central-SKU/sell-in derivations and the existing `reconcileDatasetItems("adviesprijzen", ...)` save boundary.
- `recommendedPriceFormModel.ts` owns pure default-year, field-label, display-calculation and action-status rules.
- `RecommendedPriceWorkspaceView.tsx` owns the presentation and interaction markup.
- Existing `adviesprijzenDerivations.ts` remains the source for channel normalization, year rows, product-cost rows and the persisted save payload.

## Preserved contracts

- The route still requests the same eleven dataset keys, includes navigation and uses `/adviesprijzen` as the authentication return path.
- The newest available production/advice year remains selected by default.
- Active channel ordering, zero defaults for missing channel/year rows and open-by-default channel panels remain unchanged.
- The editable state and save granularity remain one advice-markup row per selected year/channel; rows for other years remain first and unchanged in the payload.
- The dataset write remains `reconcileDatasetItems("adviesprijzen", next)` with the same payload fields and the same `Opgeslagen.` / error text outcomes.
- Product eligibility still comes from the existing central SKU index; only `cost_plus` rows with a positive active cost are shown.
- Sell-in still resolves through the existing selling-price lookup and channel-default fallback.
- Cost, sell-in and advice calculations still run ex VAT; the display toggle performs the same VAT conversions.
- The advice range still rounds down to five cents including VAT and displays the same ± five-cent range and customer-margin formula.
- No API, schema, migration, backfill, database or persisted-data change is included.

## UI and accessibility consolidation

- The four number inputs now have stable accessible names in the form `Opslag (%) voor <kanaal>`.
- Save progress, success and failure now use the shared `ActionStatus` semantics. Pending state includes the shared spinner; failures retain the existing error message and add a recovery action.
- Save remains the only mutating control. Year switching, VAT switching and panel open/close interactions remain read-only.
- Tables retain their current order and horizontal-scroll behavior. Sorting is intentionally excluded because adding it would change the characterized interaction contract.

## Scoped cleanup

The former component contained calculations for packaging-component names/prices, a cost-version lookup, active-activation scoring and API symbols that had no consumer in the rendered screen or save path. Repository reference checks and the component call graph confirmed that these local values had no callable side effect. Their dead local calculations/imports were removed; the two packaging datasets and public workspace inputs remain intact for route/API compatibility.

## Regression protection

- `recommendedPriceScreen.contracttest.ts` protects the route projection, year/default behavior, channel ordering, save-payload preservation, accessible field naming, VAT display, advice range, customer margin and action-status semantics.
- `recommended-price.screen.spec.ts` is a blocking CI Playwright contract for desktop and mobile. It verifies year/VAT/panel interactions, accessible markup inputs, no mutation requests and no body-level horizontal overflow without clicking Save.
- RF-010/RF-011 pricing and active-commercial-context golden suites remain unchanged and passed after this extraction.

## Validation result and limitation

- Python unittest discovery collected all 176 expected tests; 176 passed with 27 skipped.
- Frontend workflow, pricing and typecheck suites passed; the new SCREEN-018 contract is included in `test:workflows`.
- Lint passed with zero errors and 63 pre-existing warnings (one fewer than the RF-012B1 baseline).
- The production build passed.
- A pre-change read-only browser baseline captured the 2026 screen, channel values, visible financial rows and four unnamed number inputs.
- The post-change local live replay was blocked before screen rendering by a backend HTTP 500 on the unchanged eleven-dataset bootstrap request while `/health` remained healthy. No save or mutation was attempted. The new blocking CI Playwright job on its disposable database is therefore the authoritative live screen gate for the draft PR.

## Explicitly deferred

- Switching advice prices to the future explicit active-commercial-context authority: RF-012C4 after RF-013A/B/C.
- Repairing missing or inconsistent year/SKU cost lines: RF-013C and RF-012D.
- Adding table sorting, filtering or pagination to SCREEN-018.
- Removing the retained packaging bootstrap inputs or other compatibility paths without separate usage proof.
