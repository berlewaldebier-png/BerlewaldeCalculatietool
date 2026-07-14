# RF-005 fail-closed authentication and role policy

Status: implemented on `codex/rf-005-fail-closed-auth` for review. This is the authoritative RF-005 contract; RF-002 remains the historical pre-change characterization.

## Security boundary

Authentication bypass is explicit and environment-bounded:

| `CALCULATIETOOL_ENV` | `CALCULATIETOOL_AUTH_ENABLED=false` | `CALCULATIETOOL_AUTH_ENABLED=true` |
|---|---|---|
| `local`, `dev`, `development` | Allowed; requests receive the synthetic local administrator | Allowed; normal cookie authentication |
| `test` | Allowed for isolated automated tests | Allowed; normal cookie authentication |
| `staging`, `production` | Startup rejected; request dependency also fails closed with HTTP 503 | Allowed only with a non-default secret |
| Any other value | Startup rejected when auth is disabled | Existing non-local secret validation applies |

The request-time 503 is defense in depth. A non-local deployment must not use it as an operating mode: startup validation is expected to stop the process first.

Existing authenticated contracts remain unchanged: the session cookie name, 12-hour lifetime, `HttpOnly`, `SameSite=lax`, environment-dependent `Secure`, HTTP 401 `Niet ingelogd.` and HTTP 403 `Geen rechten.`. Role matching remains case-sensitive.

## Approved role matrix

| Capability | Administrator | Management (CEO/CFO) | Brewer | Sales | Legacy `user` |
|---|:---:|:---:|:---:|:---:|:---:|
| View detailed SKU cost prices | Yes | Yes | Yes | Yes | Yes |
| Prepare cost-price drafts | Yes | Yes | Yes | No | No |
| Activate cost prices | Yes | Yes | No | No | No |
| Manage quotations, including cancel/delete | Yes | Yes | No | Yes | Yes |
| View users and assigned roles | Yes | Yes | No | No | No |
| Create/change/deactivate users | Yes | No | No | No | No |
| Change calculation settings | Yes | Yes | No | No | No |
| Start Douano synchronization | Yes | No | No | No | No |
| Correct product mappings/classification | Yes | No | No | No | No |

`user` is retained only as a compatibility role for existing persisted users and has the approved Sales capabilities. It is not offered for new assignments in the UI. No stored user is renamed or migrated by RF-005.

The backend capability policy is the enforcement source of truth. The frontend receives the effective capability list from `/auth/login` and `/auth/me` and uses it only to hide unavailable navigation/actions. A hidden control is not considered an authorization boundary.

Generic dataset mutations are deliberately fail-closed: Administrator may mutate all datasets; Management may mutate cost drafts and calculation settings; Brewer may mutate cost drafts; Sales and legacy `user` may not use generic dataset mutations. Unclassified dataset writes remain Administrator-only until a later role decision explicitly assigns them.

## Deployment and rollback

There is currently only a development setup. Before creating acceptance or production environments:

1. Set `CALCULATIETOOL_ENV` explicitly to the intended environment.
2. Set `CALCULATIETOOL_AUTH_ENABLED=true`.
3. Provide a long, random, non-default `CALCULATIETOOL_AUTH_SECRET` through the deployment secret store.
4. Ensure at least one active Administrator exists using the existing controlled bootstrap process.
5. Start the application and confirm config validation succeeds.
6. Probe unauthenticated access (401), each role's approved actions (success/403), login and logout without recording credentials or tokens.

Rollback may revert the application revision only while authentication remains enabled with a valid secret. Never restore the old silent non-local bypass as a normal rollback. If access is lost, use the existing bootstrap/admin recovery procedure in an isolated environment and investigate configuration before deployment.

## Data and compatibility safety

- No database schema, migration, seed or stored business record changes are part of RF-005.
- SKU calculation formulas, rounding, activation data and persisted cost prices are not changed.
- URLs and existing request payloads are unchanged. Login and `/auth/me` responses add `capabilities`; existing fields remain.
- Existing JWTs retain their embedded role until expiry. Immediate session revocation, maintenance warnings, unsaved-work handling and deployment session coordination remain explicitly out of scope.
- Identity provider, tenancy and quote ownership remain out of scope.

## Verification ownership

Automated contracts cover the environment matrix, exact role/capability mapping, endpoint dependencies, route fingerprint, navigation visibility and quote-summary disclosure. Manual acceptance must still verify login, logout/account switching, direct URL/API denial for each role, normal navigation, cost-price visibility, draft preparation, activation, quotations, user administration, Douano sync and product mapping.
