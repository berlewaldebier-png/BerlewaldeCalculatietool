# RF-012C4B — Adviesprijzen op actieve commerciële context

Status: implemented; awaiting human acceptance and CI.

## Outcome

SCREEN-018 (`/adviesprijzen`) no longer reconstructs its runtime products from
eleven legacy bootstrap datasets, legacy activations or the highest production
year. It now consumes one active-commercial projection:

- the RF-013 active generation owns stable-SKU scope, owner group and planning
  cost;
- the exact current RF-012C4A SKU price row owns sell-in;
- the immutable candidate channel row retains activation evidence;
- the exact current `advice_channel_pricing` row owns the editable advice
  markup;
- the source cost-version field supplies VAT only when it is explicitly
  present.

The existing advice calculation is unchanged: cost and sell-in remain ex VAT,
the channel advice markup produces sell-out, conversion uses the explicit VAT
percentage, inclusive advice prices round down to five cents, and the existing
plus/minus five-cent range and customer-margin formula remain intact.

## Visibility and fail-closed rules

All 79 active stable SKUs remain present for every active channel. A row is not
silently filtered when a financial input is absent. Each SKU has one state:

- `ready`;
- `missing_cost`;
- `missing_sell_in`;
- `missing_vat`;
- `not_applicable`.

A missing VAT source is not interpreted as 0%. The row keeps its known cost and
sell-in visible, but no advice price or customer margin is calculated. Restoring
VAT master data is intentionally outside this slice.

The active year is fixed on the screen. Historical years remain available
through finalized Yearsets; the active screen no longer selects a year by
`max(productie)`.

## Channel policy and write safety

The activation markup and current markup have separate meanings:

- `activation_advice_markup_pct` is immutable yearset evidence;
- `advice_markup_pct` is the current editable channel policy.

Only Administrator retains the existing mutation right. A save sends only
dirty channels and checks, inside one transaction:

1. active generation ID;
2. active reconciliation run ID;
3. exact manifest hash;
4. channel membership and readiness in that run;
5. exact active-year/channel record identity;
6. optimistic hash of its current value and timestamp.

No broad `adviesprijzen` reconciliation or delete remains in SCREEN-018. A
missing current channel row may be restored under a deterministic UUID only
when the browser also observed it as missing. No schema, migration, candidate
mutation, historical rewrite or data repair is included.

## Read-only development evidence

The audit explicitly set the PostgreSQL transaction to read-only and returned:

| State | Count |
| --- | ---: |
| Active stable SKUs | 79 |
| Owner groups | 16 |
| Active channels | 4 |
| Ready current channel markups | 4 |
| Fully calculable advice SKU rows | 45 |
| Missing current sell-in | 31 |
| Otherwise-ready but missing VAT | 1 |
| Not applicable | 2 |
| Duplicate stable SKU IDs | 0 |

Channel snapshots and current rows match at implementation time: Horeca 190%;
Retail, Slijterij and Zakelijk 65%. Source-version VAT exists for 69 of 79
SKUs and contains explicit 21% and 9% values. Ten SKUs lack that VAT source:
eight cost-bearing article/bundle rows and two no-cost services. Seven of those
eight cost-bearing rows are already blocked by missing sell-in; one becomes the
explicit `missing_vat` action above.

## Regression protection

Backend contracts protect:

- current sell-in and current channel markup precedence;
- separate immutable activation evidence;
- complete unique active-SKU visibility and typed missing states;
- missing live channel rows never falling back silently to snapshots;
- strict read-only acquisition without schema initialization;
- active generation/run/manifest binding;
- targeted channel updates and deterministic missing-row creation;
- optimistic stale-write rejection before mutation;
- absence of deletes and candidate-channel writes;
- `costs:view` reads and Administrator-only mutation.

Frontend contracts protect:

- thin acquisition from the active endpoint;
- fixed active year instead of a production-year maximum;
- exact reuse of VAT, five-cent rounding and customer-margin formulas;
- one visible row per active SKU in each channel;
- typed missing cost/sell-in/VAT states;
- dirty-channel-only request payloads and optimistic hashes;
- pending, success and actionable conflict feedback;
- unchanged new-year advice draft flow.

## Manual acceptance

1. Open Adviesprijzen and confirm active year 2026 is fixed and 79 SKU rows are
   represented in each opened channel.
2. Confirm Horeca shows 190% and Retail, Slijterij and Zakelijk each show 65%.
3. Search for Berlewalde Blond and compare one SKU sell-in value with the same
   SKU in Verkoopstrategie; the values must be identical.
4. Switch Excl./Incl. BTW and verify a known 21% SKU while retaining five-cent
   inclusive downward rounding.
5. Confirm missing sell-in and VAT rows remain visible and display no invented
   advice price.
6. As Administrator, change one non-critical test channel markup, save, reload
   and confirm the exact value remains. Restore it after the check if desired.
7. Confirm changing a channel markup changes only calculated advice output and
   never the SKU sell-in price in Verkoopstrategie or a stored quote.
8. As a non-Administrator with `costs:view`, confirm the screen is readable but
   channel inputs cannot be changed.

## Rollback and next slice

Rollback SCREEN-018 to its previous runtime reader and generic channel save
flow. No migration rollback is required. Channel values written through the new
endpoint remain ordinary existing `advice_channel_pricing` rows.

After acceptance, the active pricing-consumer programme RF-012C4 is complete.
The next roadmap phase is RF-014, which must prove one deprecated path unused
before removing it. No deprecated financial path may be deleted solely because
SCREEN-017 and SCREEN-018 have switched.
