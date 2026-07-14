# RF-002 authentication, session and permission characterization

Status: characterization only. This document records current repository behavior; it does not approve the behavior or authorize RF-005.

## Scope and safety

- **Observed:** RF-001 is merged and RF-002 changes only tests, pseudonymous fixtures and this evidence document.
- **Observed:** no application implementation, schema, migration, seed, production configuration or persisted data is changed.
- **Observed:** the characterization tests use environment patches, fake requests and fake database cursors. They do not open a database connection.
- **Unknown:** the effective authentication flags, secrets, user duplicates and session practices in production were not inspected.

## Environment and startup matrix

| Classification | Current behavior | Executable evidence | Risk/decision consequence |
|---|---|---|---|
| **Observed** | `CALCULATIETOOL_AUTH_ENABLED` defaults to false and only `1`, `true`, `yes` and `on` enable authentication. | `AuthEnvironmentCharacterizationTests.test_enabled_auth_flag_accepts_only_current_truthy_spellings` | Deployment must not be assumed protected merely from its environment name. |
| **Observed** | With authentication disabled, `get_current_session` returns synthetic `local-admin` with role `admin` in local, dev, development, test, staging and production. | `test_disabled_auth_synthesizes_admin_in_every_environment` | This is the fail-open behavior that RF-005 may change only after OQ-001 is answered. |
| **Observed** | Disabled-auth status advertises one synthetic admin only in local/dev/development, although request authorization synthesizes an admin in every environment. | `test_disabled_auth_status_reports_synthetic_user_only_for_local_environments` | Status output and effective authorization differ outside local environments. |
| **Observed** | Missing auth secret falls back to `local-dev-secret-change-me` in local/dev/development and raises in test/staging/production when a secret is requested. `AUTH_SECRET` remains a compatibility fallback. | Existing `test_auth_service.py` plus `test_missing_secret_uses_local_default_but_fails_in_non_local_environments` | Keep the legacy variable until a separately approved compatibility decision. |
| **Observed** | Startup validation allows production with authentication disabled and no secret. If authentication is enabled, missing or `change-me` secrets fail validation. | `test_production_configuration_currently_allows_disabled_auth_without_a_secret`; `test_enabled_production_auth_rejects_missing_or_default_secret` | OQ-001 blocks fail-closed remediation. |
| **Observed** | Startup validation accepts local/dev/development/staging/production but rejects `CALCULATIETOOL_ENV=test`, whether authentication is enabled or disabled. | `test_startup_config_matrix_accepts_current_environments_but_rejects_test` | “test” is an auth-service environment but not a valid startup environment. Do not normalize this without approval. |
| **Observed** | Temporary `admin/admin` login is available only in local/dev/development. | `test_local_temp_admin_is_available_only_in_current_local_environment_set` | Preserve local convenience until RF-005 explicitly defines its boundary. |

## Session and cookie contract

| Classification | Current behavior | Executable evidence |
|---|---|---|
| **Observed** | Sessions are HS256 JWTs containing `username`, `display_name`, `role`, `iat` and `exp`. The default lifetime and login cookie max age are 12 hours. | `test_session_token_round_trip_preserves_embedded_identity_and_role`; `test_login_cookie_contract_is_12_hours_http_only_lax_and_environment_secure` |
| **Observed** | Cookie name is `calculatietool_session`; it is `HttpOnly`, `SameSite=lax`, path `/`, and `Secure` outside local/dev/development. | Cookie characterization test above. |
| **Observed** | Missing, expired, malformed or tampered tokens produce no session; dependencies expose 401 `Niet ingelogd.`. | `test_expired_or_tampered_session_token_is_rejected`; `test_enabled_auth_returns_401_for_missing_session_and_403_for_non_admin` |
| **Observed** | Admin comparison is exact and case-sensitive. A role `Admin` is not role `admin` and receives 403 `Geen rechten.`. | `test_admin_role_comparison_is_case_sensitive` |
| **Observed** | Verification trusts the role and identity embedded at issuance and performs no user-table lookup. A later role change or deactivation therefore does not revoke an existing token before expiry. | `test_existing_token_is_not_rechecked_against_user_active_state_or_current_role` |
| **Observed** | Logout deletes the browser cookie; there is no server-side token registry or revocation list. | `auth.py::post_logout`; token characterization above. |
| **Unknown** | Whether immediate revocation is required after role change, deactivation, password change or logout. | OQ-003 requires product/security confirmation before change. |

## API route and role matrix

- **Observed:** `test_complete_route_access_fingerprint_matches_rf_002_baseline` freezes 158 method/path/access rows with SHA-256 `b72db2ac9b7f8efacfb72f8dbac442058cd2a96a15663cc7b458f7f4c11135f6`. A mismatch prints the full current matrix for review.
- **Observed:** every route in the data, meta, quotes and integrations routers has at least the router-level `require_user` dependency. Individual endpoints may additionally require admin.
- **Observed:** public auth endpoints are status, login, forgot-password, reset-password and logout.
- **Observed:** `/auth/me` and `/auth/change-password` perform manual cookie checks rather than declaring `require_user`.
- **Observed:** `/auth/bootstrap-admin` is public at the session layer and uses `X-Bootstrap-Token` outside local environments.
- **Observed:** user listing, user creation and user updates require admin.
- **Observed:** all quote reads, creates, updates and deletes require an authenticated user but not admin; no ownership filter is expressed by the auth dependency.
- **Observed:** Douano connect, probe, debug, callback and status require an authenticated user but not admin. Synchronization and mapping mutations covered by the route matrix require admin.
- **Observed:** selected draft mutations remain user-accessible, including `PUT/DELETE /meta/kostprijs-activatie-draft`; destructive/admin endpoints elsewhere remain represented in the fingerprint.
- **Unknown:** whether the user-accessible quote, draft and Douano diagnostic operations match the intended role/capability policy. OQ-002 remains open.

## Frontend visibility and direct access

- **Observed:** `AuthGate` checks only `/auth/me`; it does not accept a required role.
- **Observed:** `DashboardHeader` hides Bedrijfsinstellingen, Calculatie instellingen, Team & rechten and Datakwaliteit for a client session whose normalized role is not `admin`. Mijn account and Kostprijsbeheer remain visible.
- **Observed:** the `/beheer/users` page has no frontend admin gate. Its first admin-only data request can fail, after which it retries public/user bootstrap data and renders an error state. The underlying `/auth/users` APIs enforce admin.
- **Observed:** `auth.permissions.spec.ts` exercises current ordinary-user/admin menu visibility on desktop and mobile without writing data.
- **Observed:** GitHub CI runs that focused role-visibility spec as a blocking RF-002 gate against its dedicated PostgreSQL service. The broad legacy audit remains non-blocking.
- **Inferred (high confidence):** hidden navigation is presentation guidance, not an authorization boundary; direct API dependencies remain authoritative.
- **Unknown:** the approved page/action visibility matrix for ordinary users. OQ-002 must be answered before aligning UI and API access.

## Identity normalization and duplicate audit

- **Observed:** `app_users.username` has a case-sensitive database `UNIQUE` constraint. User creation checks `WHERE username = %s`, while login and update lookup use `LOWER(username) = LOWER(%s)`.
- **Observed:** case variants can pass the application duplicate pre-check while later login lookup is case-insensitive. The stored username casing is returned.
- **Observed:** inactive users cannot authenticate, but tokens issued before deactivation remain independently valid until expiry.
- **Observed:** email is nullable and has no uniqueness constraint. Password-reset lookup is case-insensitive and uses one unordered `fetchone` result.
- **Observed:** `auth_identity_conflicts.json` and `test_auth_identity_audit.py` prove a read-only normalization audit against pseudonymous fixtures; missing emails are not treated as duplicate identities.
- **Unknown:** whether production contains case-variant usernames or duplicate normalized emails. No production query was run. A DBA/security-approved, read-only inventory is required before any constraint, merge, rename or backfill.

## Human decisions required before RF-005

1. **OQ-001 — deployment guarantee:** Is `CALCULATIETOOL_AUTH_ENABLED=true` guaranteed and monitored in every test, acceptance and production deployment? Supply non-secret effective configuration evidence and an owner.
2. **OQ-002 — capability policy:** Approve a route/page/action matrix for administrator and ordinary user, specifically quotes, cost-price activation drafts, Douano connect/probe/debug/callback, `/beheer/users`, and settings visibility.
3. **OQ-003 — session revocation:** Decide whether role change, deactivation, password change and logout must revoke existing sessions immediately or whether validity until the current 12-hour expiry is acceptable.

Until these decisions are recorded, RF-005 must not change permissions, fail-open behavior or session invalidation.

## Validation commands

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_auth_service tests.test_api_authorization tests.test_auth_characterization tests.test_auth_route_matrix tests.test_auth_identity_audit -v
.\.venv\Scripts\python.exe scripts\check_unittest_discovery.py
.\.venv\Scripts\python.exe -m unittest discover -s tests
```

Run from `frontend`:

```powershell
npm run typecheck
npx eslint tests/e2e/auth.permissions.spec.ts --ext .ts
npx playwright test --list
```

The focused RF-002 role-visibility spec is a blocking GitHub CI gate. It is not run against an existing local database because read purity is not proven yet. The full Playwright audit remains non-blocking until RF-003, as established by RF-001. A fully authoritative enabled-auth user/admin E2E matrix still depends on RF-003's guarded disposable-data harness.
