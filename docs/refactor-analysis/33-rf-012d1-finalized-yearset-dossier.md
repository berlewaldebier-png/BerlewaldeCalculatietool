# RF-012D1 — Finalized Jaarset dossier

Date: 2026-08-04

Branch: `codex/rf-012d1-yearset-dossier`

Classification: read-model and UI consumer slice; no data or calculation mutation

## Outcome

RF-012D1 separates two workflows that previously shared one action:

1. `Open jaarsetdossier` opens `/beheer/jaarsets/{year}`.
2. `Nieuw jaar voorbereiden` explicitly opens the next-year wizard and is offered only from the latest production-year row.

Opening Jaarset 2026 no longer starts a 2027 wizard. It displays the exact immutable frozen Plan and candidate SKU/price/channel records bound to the finalized RF-013 commercial generation.

## Data-safety boundary

The dossier reader:

- starts one PostgreSQL transaction with `SET TRANSACTION READ ONLY` before its first query;
- does not call any schema-initialization function;
- accepts only ready `active` or `superseded` generations and matching reconciliation runs;
- verifies generation year, generation/run identity, reconciliation counts, Plan readiness, Plan contract hash, initial-Forecast equality and all twelve Plan periods;
- fails closed with typed reason codes when the finalized contract is absent or inconsistent;
- never writes, activates, backfills, migrates, reconstructs or deletes data.

No schema, persisted row, cost-price formula, selling-price formula, advice-price rule, Plan, Actual, Forecast or authorization policy changed in this slice.

## Read-model contents

The dossier exposes:

- generation, reconciliation run, manifest, validation and Plan identity;
- immutable Plan totals and twelve monthly allocations;
- one row per stable generation SKU, including cost components, cost requirement/readiness, target sell-in price, source method/year and stable source IDs;
- advice-channel markup policies;
- activation/approval provenance and audit events.

Actual and Forecast are deliberately excluded. They remain dynamic analysis read models and must not be confused with the frozen Plan dossier.

## Development evidence

The strict reader resolved the local finalized 2026 authority as:

| Contract | Observed value |
|---|---:|
| Generation | `5a152227-146c-5904-bb91-f8ef4d0b52ee` |
| Reconciliation run | `636ff712-89a7-5a4c-87e8-d2a371cb0d8d` |
| Plan revenue | EUR 220,000.00 |
| Plan variable costs | EUR 141,563.598573 |
| Plan contribution | EUR 78,436.401427 |
| Plan volume | 37,751.230999 liters |
| Stable SKU rows | 79 |
| Required/ready cost rows | 77 / 77 |
| Target sell-in prices | 47 |
| Advice channels | 4 |
| Plan SKU allocations | 60 |

The authenticated browser check confirmed:

- Jaarbeheer exposes distinct dossier and next-year actions;
- opening 2026 stays on `/beheer/jaarsets/2026`;
- the page displays the values above and all 79 SKU rows;
- SKU search and table sorting controls are available;
- the page has no browser console errors;
- a year without a finalized commercial generation stays on its dossier URL and shows a safe unavailable state;
- at a 390 × 844 viewport the dossier itself has no page-level horizontal overflow; wide tables remain locally scrollable.

The already-known mobile application-navigation behavior is unchanged and remains outside RF-012D1.

## Files and contracts

- Backend projection and reader: `backend/app/domain/yearset_dossier_service.py`
- Admin-only endpoint: `GET /api/meta/commercial-yearsets/{operational_year}/dossier`
- Dossier route: `frontend/src/app/(app)/beheer/jaarsets/[year]/page.tsx`
- Dossier UI: `frontend/src/components/YearsetDossier.tsx`
- Jaarbeheer action split: `frontend/src/components/JaarsetsPanel.tsx`
- Contract tests: `tests/test_yearset_dossier.py`
- Route-access fingerprint: `tests/test_auth_route_matrix.py`

## Expected manual acceptance

1. Open **Beheer → Jaarsets**.
2. On the 2026 Jaarset row, choose **Open jaarsetdossier**.
3. Confirm the URL is `/beheer/jaarsets/2026` and the page says **Alleen-lezen**.
4. Confirm Planomzet is EUR 220,000.00 and the summary reports 79 SKU rows, 77/77 required costs, 47 prices and four channels.
5. Search for `Juweel` and confirm only Juweel rows remain.
6. Confirm `Nieuw jaar voorbereiden` is a separate action whose URL contains `source_year=2026&target_year=2027`.
7. Return to Jaarbeheer and optionally open 2025; it must show that no finalized commercial dossier is available and must not start a wizard.

## Rollback

Application rollback consists only of reverting this slice. Because RF-012D1 creates no tables and writes no data, no database rollback or data restoration is required.

## Next slice

RF-012D2 switches the current **Kostprijs beheren** overview to the active commercial generation. It must use a separate branch/PR, retain the RF-012D1 dossier unchanged and prove per-SKU parity before replacing the legacy overview reader. RF-012D3 adds variants/history only after D2 is accepted.
