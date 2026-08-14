# RF-012C4A — Verkoopstrategie op actieve commerciële context

Status: implemented; awaiting human acceptance and CI.

## Outcome

SCREEN-017 (`/verkoopstrategie`) no longer reconstructs its runtime rows from
legacy activations, repeated calculation lines, labels or the highest available
production year. The active RF-013 generation now owns the exact stable-SKU
scope, owner group and planning cost. Every stable SKU occurs once.

The price boundary deliberately contains two meanings:

- `activation_list_price` is the immutable sell-in snapshot that was approved
  when the commercial generation was activated;
- `list_price` is the current editable sell-in price in the exact
  `sales_pricing_records` target row for that SKU and active year.

This separation lets the application retain historical evidence while allowing
the current sales strategy to change without rewriting the yearset. New
quotations for the active generation resolve the same current target record.
Superseded generations continue to use their immutable candidate snapshot.

## SKU ownership and visibility

The projection uses the finalized dossier's explicit owner fields:

- Beer-owned SKU: grouped under its canonical Beer;
- bundle: grouped once under `Samengestelde producten`;
- service: grouped once under `Diensten`;
- article without Beer owner: grouped under `Overige artikelen`.

BOM or wizard presentation membership never creates another financial row.
Missing, non-positive, ambiguous and not-applicable price states remain visible.
A required missing price is never silently derived or filtered.

## Write safety

Only Administrator retains the current mutation right. A save sends only dirty
SKU rows and verifies all of the following before one transaction writes:

1. active generation ID;
2. active reconciliation run ID;
3. exact run manifest hash;
4. membership of every SKU in that run;
5. exact target record or one unambiguous explicit SKU record;
6. optimistic hash of the current JSON payload.

Unknown compatibility fields are preserved. The update neither deletes stale
rows nor replaces a complete year. It does not change candidate SKU/price rows,
generation state, cost anchors, cost history, LOT snapshots, quotes or closed
yearsets. No schema or migration is included.

## Development evidence

The pre-switch read-only audit found:

- 79 stable SKU rows in the active 2026 generation;
- 47 immutable candidate prices and exact target record IDs;
- 46 live target prices still equal to their activation snapshot;
- one live target price changed from its activation snapshot;
- four explicit current-year price rows outside active-generation scope.

The implemented strictly read-only projection returned:

| State | Count |
| --- | ---: |
| Active stable SKUs | 79 |
| Owner groups | 16 |
| Ready current prices | 46 |
| Missing current prices | 30 |
| Non-positive current prices | 1 |
| Not-applicable catalogue references | 2 |
| Ambiguous current prices | 0 |
| Compatibility-only price rows retained outside scope | 4 |
| Blond-owned SKUs | 7 |
| Duplicate stable SKU IDs | 0 |

The one non-positive current row is surfaced as an action; RF-012C4A does not
silently replace it with the immutable activation value. The four
compatibility-only rows remain stored and untouched.

## Regression protection

Backend tests protect:

- exact target price precedence and separate activation evidence;
- one row per stable SKU and no cloning of shared products;
- typed missing/non-positive/ambiguous/not-applicable states;
- strict read-only acquisition without schema initialization;
- atomic targeted writes that preserve unknown payload fields;
- optimistic conflict rejection before a write;
- unchanged immutable candidate tables and absence of broad deletes;
- active Quote use of the current exact target price;
- unchanged superseded-generation snapshot behavior;
- `costs:view` read access and Administrator-only mutation.

Frontend contracts protect:

- thin route acquisition from the active endpoint;
- active-year binding instead of `max(productie)`;
- owner-group search and list-price/opslag display;
- dirty-row-only request data and optimistic record hash;
- pending, success and actionable failure feedback;
- unchanged editable new-year wizard draft flow.

## Manual acceptance

1. Open Verkoopstrategie and confirm the page shows active year 2026 and 79
   SKU rows in total.
2. Open Berlewalde Blond and confirm exactly seven directly owned SKU rows are
   shown. Shared gift sets/services must not be repeated under Blond.
3. Search for a shared bundle such as `Alles onder de boom` and confirm it is
   shown once under `Samengestelde producten`.
4. Confirm missing prices remain visible as `prijs ontbreekt`; catalogue-only
   rows show `niet van toepassing`.
5. As Administrator, change one known test list price, save and confirm the
   success message. Reload and confirm the exact value remains.
6. Open a brand-new quotation and confirm that SKU now receives the same current
   list price. Do not use a customer-facing definitive quote for this test.
7. Reopen an already saved quotation and confirm its persisted line amounts did
   not change.
8. As a non-Administrator with `costs:view`, confirm the screen is readable but
   price inputs cannot be changed.

## Rollback and next slice

Rollback SCREEN-017 to its previous runtime reader and remove the active
sell-in overlay for new quotations. No data rollback is needed because the new
endpoint writes the same existing `sales_pricing_records` target rows and does
not migrate or delete data.

After manual acceptance and CI, RF-012C4B switches Adviesprijzen separately to
the same current SKU sell-in authority while retaining its channel markup, VAT
and five-cent rounding rules.
