# RF-006 quote list/delete boundary contract

## Scope and source chain

RF-006 inventories one low-risk vertical boundary without changing its wire format:

1. `quote_drafts_storage.list_drafts` and `quote_drafts_storage.delete_draft` own the PostgreSQL reads/deletion.
2. `backend/app/api/routes/quotes.py` exposes `GET /quotes` and `DELETE /quotes/{quote_id}`.
3. `backend/app/contracts/quote_boundary.py` adds typed views without filtering, copying, coercing, or rejecting values.
4. `frontend/src/components/offerte-samenstellen/quoteBoundary.ts` inspects untrusted JSON, retains the raw payload, exposes typed known values, and reports only sanitized paths/type information.
5. The quote overview consumes the list adapter; `deleteQuoteDraft` consumes the delete adapter.

The executable registry is `contracts/boundary-contracts.json`; pseudonymous request, response, future/legacy, malformed-value, and OpenAPI fixtures are under `contracts/fixtures/quotes/`.

## Preserved behavior

- Routes, query/path parameters, HTTP status handling, authentication dependency, cache invalidation, and navigation are unchanged.
- List records and unknown fields pass through without normalization. A non-array `items` value retains the overview's existing empty-list fallback.
- Delete continues to return the integer PostgreSQL row count: `{ "deleted": 1 }` or `{ "deleted": 0 }`.
- The historical frontend-only `{ ok: boolean }` declaration was not the server response. It is now a tolerated legacy alias and is never converted into `deleted`.
- Nulls, unknown future fields, malformed-but-tolerated known fields, and raw payload identity remain available. Deviations are counted and reported without payload values.
- Quote create/update/load payloads, calculations, prices, margins, persistence schema, and database data are not changed.

## Compatibility and rollback

No migration, backfill, dual write, or persisted-data cleanup is involved. The adapter can be reverted while retaining the registry, snapshots, and characterization tests. OpenAPI remains intentionally permissive and is snapshot-protected; a future strict response model requires a separately approved compatibility change.
