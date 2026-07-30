# RF-012C1 — New quotations on the active commercial context

Date: 2026-07-30
Status: implemented and validated

## Outcome

Brand-new quotations no longer choose their financial year from the highest
`productie` key and no longer assemble their selectable SKU prices from several
independent legacy readers. They read one activated RF-013 commercial
generation through a read-only quote-specific contract.

For each quotation-ready stable SKU, that contract supplies:

- the active generation, reconciliation run and operational year;
- the RF-013C reserved target cost-version and cost-row identities;
- the planning cost and component provenance captured by RF-013B/RF-013C;
- the approved SKU-specific target list/sell-in price;
- cost and price readiness;
- typed exclusion reasons when the SKU is not quotation-ready.

No cost, price, yearset, quote, LOT, invoice, Plan, Forecast or historical row is
rewritten by the reader.

## New boundary

`GET /api/quotes/commercial-context` is protected by the existing
`quotes:manage` capability. It is declared before the dynamic quote-ID route and
therefore does not change any existing quote URL.

Without a query parameter it returns the one active generation. With
`generation_id=<saved-id>` it may return only an `active` or `superseded`
generation. Candidate, approved-but-not-active, blocked and unknown generations
fail closed and return no selectable SKU rows.

The reader starts its database transaction with `SET TRANSACTION READ ONLY`. It
does not call a schema initializer.

## Quote readiness

A candidate SKU is selectable only when all applicable rules are true:

- the active/superseded generation and its reconciliation run are both ready
  and operational;
- the SKU is not classified as `catalog_reference_only`;
- its cost status is `ready` or explicitly `not_required`;
- a cost-required SKU has a positive planning cost;
- the candidate has a ready, positive SKU-specific target list price.

Every excluded candidate remains in the API response with stable reason codes.
The frontend groups those codes into actionable Dutch warnings. It never
substitutes zero, a latest cost, another year or a broader price fallback.

Packaging components remain governed by the existing explicit
`beschikbaar_voor_offertes` and positive year-price policy. They are kept as a
separate non-SKU compatibility path.

## Persisted and historical quotations

The quote payload schema is additive version 3. New snapshots persist:

- generation ID;
- reconciliation run ID;
- operational year;
- manifest hash;
- validation hash.

A reopened RF-012C1 quotation requests that exact generation, even when another
yearset has since been activated or a rollback moved the active pointer.
Persisted product rows already contain their amount and cost references and are
not repriced during hydration.

Pre-RF-012C1 quotations have no generation binding. They are explicitly marked
`legacy_persisted` at their stored year and continue through the old reader.
They are not silently attached to the current active generation. Saving such a
quotation records this compatibility classification without changing its
stored product amounts.

If an exact saved generation cannot be read, existing rows still open unchanged
but adding a new product is blocked and the UI explains the recovery action.

## Development read-only verification

After the separately approved RF-013B/C3 operations had activated the 2026
generation, the RF-012C1 reader was run read-only against development. It
resolved:

- generation `5a152227-146c-5904-bb91-f8ef4d0b52ee`;
- run `636ff712-89a7-5a4c-87e8-d2a371cb0d8d`;
- operational year 2026;
- 79 candidate SKUs;
- 47 quotation-ready SKUs;
- 32 excluded SKUs without a candidate SKU-specific target sell-in price;
- two of those 32 also classified as catalogue references.

Only identifiers, counts and reason-code counts were printed. No commercial
amount was printed and no database write occurred.

## Validation result

The complete local baseline passed:

- backend discovery guard: 251 tests discovered, including every required
  RF-012C1 contract;
- backend unit suite: 251 passed, 40 skipped;
- frontend type-check: passed;
- frontend pricing contracts: passed;
- frontend workflow contracts: passed;
- frontend API/data contracts: passed;
- frontend lint: passed with 62 pre-existing warnings and no new RF-012C1
  warning;
- frontend production build: passed.

The authenticated browser smoke test opened the quotation builder against the
development database. The product selector showed the 47 quotation-ready SKUs
from the active 2026 generation. The UI also showed actionable warnings for the
32 excluded SKUs and did not add them as zero-priced or fallback-priced
options. No quotation was saved during this smoke test.

## Regression protection

Backend contracts cover:

- exact active generation/run/hash binding;
- exact candidate planning cost, list price and reserved target IDs;
- typed non-silent exclusions;
- fail-closed non-operational generations;
- read-only SQL before all authority queries;
- unchanged `quotes:manage` authorization and the complete route fingerprint.

Frontend contracts cover:

- active candidate cost/list values and operational year;
- exclusion warnings and non-selection of blocked/catalogue SKUs;
- unchanged packaging-component policy;
- source-version VAT compatibility metadata;
- schema-version 3 generation persistence;
- legacy historical binding;
- exact-generation reopen behavior;
- refusal to silently rebind after activation or rollback.

The existing RF-010/RF-011 financial golden tests remain part of the same
pricing gate.

## Data safety and rollback

- Schema migration: none.
- Data backfill: none.
- Persistent writes performed by this slice: none, except the existing
  user-triggered quote save with its additive JSON metadata.
- Historical rewrite: none.
- Rollback: route new quotations back through the old option reader; existing
  schema-3 JSON remains readable because unknown payload fields are preserved.
- Destructive cleanup: explicitly deferred to RF-014/RF-015 after compatibility
  usage is proven absent.

## Manual acceptance

1. Open a brand-new quotation and confirm year 2026 is shown.
2. Select a known ready SKU such as an active Blond/Juweel sales SKU and compare
   its cost and standard price with the activated 2026 yearset locally.
3. Confirm an SKU without a ready target sell-in is not selectable and produces
   a visible action-oriented warning rather than a zero/fallback value.
4. Save the quotation, reopen it and confirm all line amounts are identical.
5. Reopen a quotation created before RF-012C1 and confirm its stored year and
   amounts remain unchanged and a historical-context notice is shown.
6. As a user without `quotes:manage`, confirm direct access remains HTTP 403 and
   the navigation remains hidden.

## Explicitly deferred

- Break-even Plan and Forecast consumption: RF-012C2.
- Actual LOT cost consumption in Omzet en Marge: RF-012C3.
- Verkoopstrategie and Adviesprijzen consumer switches: RF-012C4.
- Cost overview/history dossier: RF-012D.
- Removal of the highest-production-year heuristic and old reader: RF-014 only
  after all relevant consumers and historical quote paths are proven.
