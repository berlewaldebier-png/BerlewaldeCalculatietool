# Break-even Next Implementation Plan

## Purpose

Build a new break-even analysis that separates planning, actuals, reforecasting and year close. The screen must support controller-level analysis and CEO-level steering:

- Are we on track compared with the yearly plan?
- Why are we above or below plan?
- What lever matters most: price, volume, mix, cost or fixed-cost absorption?
- What should be handed into `Nieuw jaar voorbereiden` after year close?

The new model must keep `Omzet & Marge` fast and correct. It must not silently mutate historical cost prices or rewrite plan assumptions when actual volume changes.

## Accounting Model

### Core Split

For break-even and management reporting, the cost price must be split into:

- Variable costs:
  - purchase / production input
  - excise
  - variable packaging
  - other direct variable costs
- Fixed costs:
  - ABC overhead allocation
  - fixed yearly operating costs
  - other fixed costs

The app may still show full product margin in `Omzet & Marge`, but break-even must calculate contribution before fixed costs.

```text
Revenue
- Variable costs
= Contribution

- Fixed costs
= Operating result
```

### Product-Level Display

The card `Van verkoopprijs naar contributie` should show both contribution and allocated margin:

```text
Selling price excl. VAT
- purchase / production
- excise
- variable packaging
= contribution before fixed costs

- ABC overhead allocation
= allocated product margin
```

This prevents double-counting fixed costs while still making the familiar app cost price explainable.

### Bezettingsresultaat

`Bezettingsresultaat` explains the effect of actual volume being different from the planned normal volume used to allocate fixed costs.

```text
Fixed cost rate = planned fixed costs / planned normal volume
Bezettingsresultaat = (actual volume - planned normal volume) * fixed cost rate
```

Lower actual volume gives a negative bezettingsresultaat. Higher actual volume gives a positive bezettingsresultaat. Actual volume must not rewrite the frozen planned cost price.

### Variance Bridge

The analysis should explain plan to reforecast/actual through a bridge:

```text
Planned result
+ price variance
+ volume variance
+ mix variance
+ variable cost variance
+ fixed cost budget variance
+ bezettingsresultaat
= reforecast / actual result
```

No fuzzy matching or hidden correction logic belongs in this model. Differences must come from explicit plan, actual and scenario inputs.

## User Workflow

### During The Year

1. The yearly plan is frozen as the baseline.
2. Actuals flow from `Omzet & Marge`.
3. Break-even shows:
   - plan
   - actual year-to-date
   - reforecast to year-end
   - variance explanation
   - scenario options
4. The user can run scenarios without mutating actuals or the frozen plan.

### At Year Close

1. `Jaar afsluiten` validates that data quality is complete enough.
2. It stores a final immutable actual snapshot.
3. It shows final P&L and variance versus plan.
4. If `Nieuw jaar voorbereiden` is already started, the user gets an explicit option to use closed-year actuals as a baseline. Nothing is silently overwritten.

### Preparing A New Year

1. The user starts from:
   - last frozen plan
   - last closed actuals
   - explicit growth/correction assumptions
2. The new plan becomes a new frozen snapshot only after confirmation.

## Mock-Up Phase

Create a temporary route:

```text
/break-even-next
```

Rules:

- Frontend-only at first.
- Use realistic 2025 example data.
- No database writes.
- No backend migrations.
- No deletion of old break-even code.
- Build the interaction in a way that can later be wired to real snapshot data.

### Mock-Up Screens

#### 1. Dashboard

Shows the answer to “are we on track?”

Cards:

- Planned revenue
- Actual YTD revenue
- Reforecast revenue
- Planned break-even point
- Current expected break-even point
- Expected operating result
- Remaining contribution needed

Visuals:

- break-even progress
- revenue over time:
  - blue line: frozen revenue plan
  - actual YTD line: green when on/above plan, red when below plan
  - dotted reforecast line to year-end
  - status conclusion above/below plan
- short explanation of the largest variance driver
- suggested steering action when reforecast is below plan:
  - required price increase
  - required contribution volume increase
  - combination scenario

Primary steering metric:

- contribution

Secondary reference metrics:

- revenue
- liters
- units

Revenue remains visible because it is intuitive, but the app should steer decisions on contribution and operating result.

#### 2. Resultaatrekening

Controller-readable P&L:

```text
Revenue
- variable cost of sales
= contribution

- fixed costs
= operating result
```

Below the P&L, show the explanation bridge:

```text
Planned result
+/- price variance
+/- volume variance
+/- mix variance
+/- variable cost variance
+/- fixed cost variance
+/- bezettingsresultaat
= explained result
```

#### 3. Break-Even

Dedicated control tab to prove and explain the break-even calculation.

Shows:

- break-even revenue
- break-even liters
- break-even units where meaningful
- current progress toward break-even
- expected break-even date based on reforecast
- remaining contribution needed
- control calculation proving that result is zero at break-even

This tab should make the calculation auditable for a controller and readable for a CEO.

#### 4. Van Verkoopprijs Naar Contributie

SKU/style drilldown. Because there are around 90 SKUs, do not start with a giant table.

Required grouping:

- style
- SKU type: fust, fles, doos, geschenk, merchandise
- top contributors
- margin risks
- search/filter
- pagination

Each row must explain:

- selling price
- discount / realized net price
- purchase / production
- excise
- packaging
- contribution before fixed costs
- ABC overhead allocation
- allocated margin

#### 5. Plan Vs Actual

Shows:

- planned liters / units
- actual liters / units YTD
- reforecast liters / units full year
- planned contribution
- actual contribution
- reforecast contribution
- plan vs actual by style and SKU group

Avoid requiring manual plans for every SKU by default. Start with high-level assumptions:

- total revenue
- total liters
- price change
- volume growth
- mix correction

Allow SKU/style exceptions only where needed. Closed 2025 actuals can become the starting point for 2026 planning after explicit confirmation.

#### 6. Variance Analysis

Waterfall and table:

- price variance
- volume variance
- mix variance
- cost variance
- fixed cost budget variance
- bezettingsresultaat

#### 7. Scenario Lab

Controls:

- price +3%, +5%, +10%
- volume +10%
- fixed costs +/-
- product mix shift
- selected style/SKU impact

Scenarios must not write to plan or actual data. They are analysis-only until explicitly promoted into a planning process.

When reforecast is below plan, show suggested scenarios:

- price needed to close the gap
- volume/contribution needed to close the gap
- fixed-cost reduction needed to close the gap
- combined balanced scenario

#### 8. Year Close Preview

Shows:

- final actual result
- warnings
- data quality dependency
- variance vs frozen plan
- what will be handed to `Nieuw jaar voorbereiden`

### Category Handling

Giftsets, tastings and merchandise must not disappear into a generic SKU bucket.

- Giftsets:
  - show as their own sold product for revenue/contribution
  - roll component beers into style/liter/mix analysis where the composition is known
- Tastings/services:
  - show as service revenue/contribution
  - optionally allocate beer usage as variable cost when configured
- Merchandise:
  - show as merchandise contribution
  - exclude from beer liters

This allows scenario questions like "how many glasses do we need to sell to reach break-even?" without polluting beer volume reporting.

## Real Implementation Phases

### Phase 1: Mock-Up Route

Goal: validate interaction and accounting story.

Tasks:

- Add `/break-even-next`.
- Add static example dataset.
- Build tabs and cards.
- Build dashboard revenue timeline with plan, actual and reforecast.
- Build conclusion/advice card based on plan gap.
- Build `Van verkoopprijs naar contributie`.
- Build P&L and variance bridge with example numbers.
- Keep all old break-even functionality intact.

Acceptance:

- User can click through the complete flow.
- The screen explains contribution vs allocated margin.
- The screen makes bezettingsresultaat understandable.
- Dashboard shows whether revenue/reforecast is above or below plan.
- Dashboard makes clear that contribution is the main steering metric.

### Phase 2: Backend Snapshot Read Model

Goal: define the read model before replacing current break-even.

Proposed snapshots:

- `break_even_plan_snapshots`
  - frozen plan
  - planned volume
  - planned prices
  - planned SKU mix
  - planned variable costs
  - planned fixed costs
  - planned ABC allocation
- `break_even_actual_snapshots`
  - actuals from `Omzet & Marge`
  - revenue
  - sold units/liters
  - actual variable cost components
  - actual contribution
- `break_even_reforecast_snapshots`
  - actual YTD + forecast rest-of-year
- `break_even_variance_snapshots`
  - price variance
  - volume variance
  - mix variance
  - variable cost variance
  - fixed cost variance
  - bezettingsresultaat

Existing snapshot tables may be extended where clean. If the shape no longer fits, introduce new versioned payload keys rather than hidden fallback logic.

### Phase 3: Real Data Service

Goal: compute the same information as the mock-up from actual app data.

Tasks:

- Build one backend service for plan/actual/reforecast/variance.
- Read actuals from margin snapshots, not live heavy joins.
- Read planned costs from frozen plan snapshot.
- Split cost components consistently.
- Add indexes if needed for year, SKU and snapshot status.

Acceptance:

- Break-even page loads fast.
- 2025 actuals reconcile with `Omzet & Marge`.
- Fixed costs are not double counted.

### Phase 4: Year Close Integration

Goal: make `Jaar afsluiten` the final truth for actuals.

Tasks:

- Show final P&L.
- Show variance vs plan.
- Block or warn if data quality is not complete.
- Store immutable close snapshot.
- Offer explicit handoff to `Nieuw jaar voorbereiden`.

Acceptance:

- Closed year can be reproduced.
- New-year preparation can use closed actuals only after explicit user action.

### Phase 5: Replace Old Break-Even

Goal: promote the new screen.

Tasks:

- Compare old and new outputs for 2025.
- Keep old screen available temporarily under an internal route if needed.
- Rename `/break-even-next` to `/break-even`.
- Remove old break-even code only after validation.

Acceptance:

- No loss of existing function.
- New screen is the production break-even screen.
- Old code is removed only after data and UX validation.

## Role-Based Plan

### Senior Developer

- Keep calculation code in backend/domain services.
- Keep UI as read-only rendering plus scenario inputs.
- Avoid duplicating formulas across frontend and backend.
- Use explicit versioned payloads for snapshots.
- Keep the old screen until parity is proven.

### Data Engineer

- Separate plan, actual, reforecast and close snapshots.
- Treat actuals as facts and plan as frozen assumption.
- Make all variance lines reproducible.
- Ensure cost components are stored/read separately.
- Precompute heavy summaries for performance.

### Infrastructure Architect

- Avoid live recalculation of 90 SKUs and historical order lines on every page load.
- Use indexed snapshot reads.
- Refresh actual/reforecast snapshots explicitly after relevant changes:
  - Omzet & Marge snapshot refresh
  - LOT/cost source correction
  - year close
  - plan freeze
- Keep mock-up frontend-only until model is approved.

### Business Owner

- Use Break-even during the year for steering.
- Use Year Close for final truth.
- Use New Year Preparation for next-year assumptions.
- Do not mix forecast corrections with actual performance measurement.

## Open Questions Before Real Build

- What is the primary volume unit for management: liters, units, or contribution-weighted units?
- Should fixed-cost allocation be shown per liter, per SKU unit, or both?
- Which costs are truly variable for Berlewalde?
- Should excise be treated as variable cost in every view? Current recommendation: yes.
- Should packaging be split into variable packaging and fixed packaging overhead? Current recommendation: yes where data supports it.
- How should giftsets and tastings appear in contribution analysis: own line, component rollup, or both?
- Which Exact Online P&L lines should be mirrored for reconciliation?
