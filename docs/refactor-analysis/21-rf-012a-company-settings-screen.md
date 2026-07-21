# RF-012A — Company settings screen boundary

## Outcome

**Observed:** SCREEN-029 (`/instellingen/bedrijf`) remains the same user-facing settings screen and keeps the same bootstrap read, fields, defaults, tariff summary, navigation and save request. RF-012A changes only internal ownership so the route, screen projection and form rules can be tested separately.

No database schema, migration, seed, persisted value, API contract, URL, role, business rule or financial calculation changes in this slice.

## Preserved screen contract

| Concern | Preserved behaviour |
|---|---|
| Entry | `GET /instellingen/bedrijf` through the existing authenticated app shell |
| Bootstrap | One server bootstrap request for `application-settings` and `tarieven-heffingen`, including navigation |
| Fields | Bedrijfsnaam, disabled `EUR` valuta and support e-mail, in the same order |
| Defaults | `Berlewalde Brouwerij` and `info@berlewaldebier.nl` for empty values |
| Tariff summary | Highest positive tariff year; identical numeric coercion and empty labels |
| Save | One `PUT /data/application-settings` with JSON; unknown compatibility fields retained |
| Success | Same pending spinner, success message, change event and route refresh |
| Failure | Same known-failure versus uncertain-outcome messages and recovery guidance |
| Exit | Existing link to `/tarieven-heffingen`; no write caused by navigation |

## Boundary after RF-012A

- `page.tsx` owns only server bootstrap acquisition.
- `companySettingsScreenModel.ts` owns pure dataset-to-screen projection.
- `CompanySettingsScreen.tsx` owns the existing section composition.
- `companySettingsFormModel.ts` owns pure form defaults, payload construction and error-status classification.
- `ApplicationSettingsClient.tsx` owns browser state, the single save side effect, the settings-change event and refresh.
- `applicationSettingsApi.ts` remains the public API adapter and retains the existing HTTP contract.

## Protection

- `companySettingsScreen.contracttest.ts` protects tariff ordering, empty state, defaults, trimming, fixed currency, unknown-field retention and error classification.
- `workflowCharacterization.contracttest.ts` protects the exact read/write transport contract.
- `test_workflow_source_boundaries.py` protects the event, status and header refresh coupling while allowing the pure rules to move out of the client component.
- Existing RF-009C Playwright tests protect pending/success/error semantics and duplicate-submit prevention.
- Existing RF-009G Playwright tests protect the tariff navigation as a no-write action.

## Explicitly unchanged limitations

- The `Prijsvoorstel defaults` block remains a visible placeholder; adding those settings is not authorized here.
- Tariffs are only summarized on this screen and remain editable through the existing tariff route.
- Currency remains hard-coded to `EUR`; RF-012A does not introduce multi-currency behavior.
- RF-012A does not combine settings writes, add autosave or introduce unsaved-change navigation protection.
- Broader settings, pricing and active-commercial-context source consolidation remains in later RF-012/013 slices.

## Validation result

- Python unittest discovery collected all 176 expected tests.
- Python unittest: 176 passed, 27 skipped.
- Frontend pricing, workflow and boundary-contract suites passed; workflow coverage includes the new SCREEN-029 contract.
- Typecheck and production build passed.
- Lint passed with zero errors and the same 67 pre-existing warnings.
- Read-only browser verification confirmed the heading, three fields, disabled EUR value, 2026 latest-tariff summary, tariff navigation and return navigation without submitting a save.
- At a temporary 390 × 844 viewport, the content card and all three inputs remained within the viewport without horizontal body overflow.
