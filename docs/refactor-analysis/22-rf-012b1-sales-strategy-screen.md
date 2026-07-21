# RF-012B1 — Sales-strategy screen boundary

## Outcome

**Observed:** SCREEN-017 (`/verkoopstrategie`) retains the same route, bootstrap request, year selection, visible SKU rows, list-price inputs, storage payload and save behavior. RF-012B1 separates route projection, screen composition, client control, presentation and pure form rules so the high-risk financial contract is independently testable.

No database schema, migration, seed, persisted value, API contract, URL, permission, active-commercial-context source, price source, rounding rule or calculation rule changes in this slice.

## Preserved screen contract

| Concern | Preserved behaviour |
|---|---|
| Entry | `GET /verkoopstrategie` through the existing authenticated app shell |
| Bootstrap | One server bootstrap request for the same eleven datasets, including navigation |
| Year | Production years remain authoritative; newest year remains selected and options remain newest-first |
| SKU source | Existing Central SKU Index and active cost-row projection remain unchanged |
| Price | Explicit `list` override still wins; otherwise the existing calculated/derived list price is shown |
| Opslag | Visible opslag remains `((list price / cost price) - 1) × 100`, with the same zero guards |
| Search/order | Search still matches beer and product labels; beer and product groups keep Dutch alphabetical order |
| Save | Existing item reconciliation for `/data/verkoopprijzen`; fallback `PUT` behavior retained for non-dataset endpoints |
| Payload | Non-strategy rows remain first and unchanged; `_uiId` is removed; empty inherited channel values are omitted |
| Compatibility | `sell_in_*` and legacy `kanaal*` fields remain populated identically |
| SKU identity | Existing SKU IDs remain unchanged; missing beer-format/article IDs use the same current lookup rules |
| Wizard mode | Draft synchronization, conflict warning, reload, exposed save callback and draft success text remain unchanged |
| Semantics | Existing status text now uses the approved live status primitive; accordion state, table context and list-price inputs have explicit accessible semantics |

## Boundary after RF-012B1

- `page.tsx` owns only server bootstrap acquisition.
- `salesStrategyScreenModel.ts` owns typed, pure dataset-to-screen projection.
- `SalesStrategyScreen.tsx` owns PageShell and screen composition.
- `VerkoopstrategieWorkspace.tsx` remains the browser controller and owner of local draft state and save side effects.
- `SalesStrategyWorkspaceView.tsx` owns the existing visible controls, tables, groups and status placement.
- `salesStrategyFormModel.ts` owns pure year, filter/group, visible price/opslag, SKU-enrichment and payload rules.
- Existing Central SKU Index, active-cost derivation, pricing engine and dataset reconciliation remain the authorities used before this slice.

## Protection

- `salesStrategyScreen.contracttest.ts` protects all eleven bootstrap mappings and the exact endpoint.
- The same contract protects year projection, default selection and option ordering.
- The same contract protects pending/success/warning/error classification while retaining existing outcome text.
- Explicit/derived list-price precedence and the visible opslag formula are frozen.
- Search and Dutch grouping order are frozen.
- Passthrough preservation, SKU identity enrichment, `_uiId` removal, empty-channel omission and both compatibility field families are frozen.
- Existing RF-010 financial golden fixtures and RF-011 resolver/transition tests remain green and were not updated to accept different numbers.
- `sales-strategy.screen.spec.ts` protects year/group/search behavior as a blocking, read-only desktop/mobile CI check and asserts that these interactions emit no mutation request.

## Removed code

The controller no longer contains presentation markup or local handlers/state that had no callable path from the rendered SCREEN-017 workspace. Repository-wide reference checks found no active use for those local symbols. Reusable files that might represent deprecated compatibility paths were not deleted; proving and removing such files remains separately controlled cleanup.

## Explicitly unchanged limitations

- RF-012B1 does not switch this screen to RF-013's future active-commercial-context authority.
- It does not repair, reclassify or reprice existing rows.
- It does not change the current year-strategy-default creation message or automatically save defaults.
- It does not change the advice-price screen; that is RF-012B2.
- It does not add migrations, backfills, dual writes or cleanup of persisted records.

## Validation result

- Python unittest discovery collected all 176 expected tests.
- Python unittest: 176 passed, 27 skipped.
- Frontend pricing, workflow and boundary-contract suites passed; workflow coverage includes the new SCREEN-017 contract.
- Typecheck and production build passed.
- Lint passed with zero errors and 64 warnings; the touched screen introduced no new warning and removal of unreachable local code reduced the repository total by three compared with RF-012A.
- Read-only browser verification confirmed the heading, 2026/2025 year options, 56 visible 2026 SKUs, group expansion, row prices/opslag/status, filtering and historical-year selection. No save was submitted.
- At a temporary 390 × 844 viewport, the page had no horizontal body or main-content overflow.
- Browser console verification found no errors.
- The blocking RF-012B1 Playwright contract passed in both desktop and mobile Chromium projects (2/2).
