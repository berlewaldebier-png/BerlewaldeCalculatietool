# 20 — Canonical read-only year-transition planner

Date: 2026-07-21
Slice: RF-011C
Runtime status: shadow/test only; no consumer or write path switched

## Outcome

RF-011C introduces a pure, read-only planner for a source-year to target-year transition. It accepts store-shaped canonical SKU, article, BOM, activation, cost-version, mapping, target-year input and Plan records. It produces one deterministic candidate entry per source-year `sku_id`, including identity, source cost lineage, recalculated component values, readiness, provenance, changed fields and typed blockers.

The planner does not import React components, `ActiveCostRow`, grouped cost-overview rows or labels as identity. Current UI-derived target rows may be supplied only to the shadow comparison; they cannot create, remove or alter a canonical candidate entry.

No endpoint, activation, database schema, migration, persisted record, historical snapshot, quotation, Break-even screen or existing `Nieuw jaar voorbereiden` workflow has changed.

## Public contract

The implementation is split by responsibility:

- `canonicalYearTransitionTypes.ts`: input, output, blocker and read-port contracts;
- `planForecastContract.ts`: frozen Plan and initial Forecast validation;
- `canonicalYearTransitionPlanner.ts`: canonical SKU transition, calculations, lineage, history separation and UI shadow comparison.

Input boundaries:

- explicit `sourceYear` and later `targetYear`;
- source-year SKU activations and cost-version rows;
- canonical SKU/article/BOM and external-mapping records;
- explicit target-year calculation inputs keyed by stable `sku_id`;
- required sell-in channels;
- the frozen target-year Plan from `Nieuw jaar voorbereiden`;
- optional current UI-derived rows for read-only shadow comparison;
- optional original historical dossier and normalized rows as separate representations.

Output boundaries:

- exactly one entry per unique source-year activated `sku_id`;
- Beer/subject, format/article, structural classification and canonical BOM/mapping fingerprints;
- source cost-version and cost-row IDs plus immutable component breakdown;
- recalculated target components through the existing RF-010-protected direct, derived and composed calculation functions;
- target readiness, changed-field allowlist and typed blockers;
- frozen Plan validation and an initial Forecast that is a detached exact copy of a valid Plan;
- separate original and normalized historical representations;
- identifier/status-only shadow differences against the current UI-derived target output.

`CanonicalYearTransitionReader` is a read port only. It exposes no save, activation, backfill, delete or migration method.

## Plan, Actual and Forecast contract

The following meanings are now explicit and independently testable:

- **Plan:** the approved target-year revenue, variable cost, contribution, liters, units and period/SKU allocation from `Nieuw jaar voorbereiden`. It becomes immutable after activation.
- **Actual:** realized transactions. Later RF-012C2/RF-012C3 consumers must use exact LOT cost or an already frozen transaction/year-close snapshot; RF-011C does not read Actual.
- **Forecast:** at activation, a detached exact copy of Plan. During the year the approved future consumer policy is Actual-to-date plus the remaining frozen Plan allocation plus an explicit revision. At year close it equals immutable final Actual.

RF-011C does not guess missing Plan values, infer a monthly/SKU distribution, calculate a live Forecast, or store a revision. Missing totals, inconsistent totals, missing allocations and allocation mismatches are blockers.

## Current behavior versus candidate behavior

- **Observed:** the current wizard can save UI-derived `costprice_engine_target_rows`; the backend activation path reads those rows.
- **Observed:** current Break-even plan creation can create an active plan whose totals are zero/missing and whose per-SKU planning rows are all zero.
- **Observed:** the current Break-even read model deliberately reports missing Plan values instead of substituting Actual.
- **Observed:** RF-010C found UI fan-out, missing target cost rows, readiness gaps and historical snapshot/read-model differences in the development-shaped 2025→2026 comparison.
- **Observed:** RF-011C’s synthetic contract proves that UI fan-out cannot change canonical manifest count, composed and derived structures remain distinct, target input duplicates/extras/missing rows block, and Plan/Forecast are detached.
- **Inferred:** the reported empty 2026 Plan was created from a draft without usable positive Plan targets or before the complete bridge existed. The exact stored cause has not been inspected in this slice.
- **Unknown:** the approved business allocation method that distributes a target Plan over months/periods and SKUs. RF-011C requires an explicit balanced allocation and does not invent one.

## Typed blocker families

- transition scope: invalid years;
- identity: unknown source SKU, extra/duplicate/missing target input, product mismatch or unknown calculation mode;
- financial source: unresolved source planning cost;
- target calculation: missing/invalid derived parent, missing BOM, unresolved composed cost or non-positive cost;
- readiness: missing liters or required channel;
- Plan: missing source, revenue, contribution, liters or units; negative variable cost; inconsistent revenue/variable-cost/contribution totals; missing or unbalanced period/SKU allocation.

The complete blocker list is part of the TypeScript result contract. RF-013C must treat these blockers as an activation stop, not as warnings that can be silently ignored.

## Tests

`frontend/scripts/canonicalYearTransitionPlanner.contracttest.ts` covers:

- deterministic output under reversed input ordering;
- a bounded 250-SKU performance check;
- a source-boundary check that rejects React, `ActiveCostRow`, wizard, network and write/activation dependencies;
- one entry per canonical source SKU despite duplicate UI projection rows;
- stable identity and structural basis/variant/composed classification;
- direct, derived and BOM-composed calculations through existing cost functions;
- source cost-version and cost-row lineage;
- missing, duplicate and extra target inputs;
- product identity, liters and required-channel blockers;
- non-forward year blocker;
- missing/zero/inconsistent Plan values;
- missing and unbalanced Plan allocations;
- initial Forecast equality without object aliasing;
- input/output detachment and reader-port purity;
- original historical snapshot and normalized rows remaining separate.

The contract test is part of `npm run test:pricing`.

## Deferred work

- RF-013A adds the versioned active commercial-generation pointer.
- RF-013B adds canonical Beer/SKU/planning-anchor authority and reconciles the cross-stack planning-cost source.
- RF-013C supplies approved target-year inputs, writes a new additive candidate, validates this planner result, stores the frozen Plan and initial Forecast, and activates atomically only after approval.
- RF-012C2 switches Break-even Plan/Actual/Forecast consumers after RF-013C parity.
- RF-012D presents canonical current cost and immutable history separately.

Existing incomplete 2026 rows and Plan snapshots remain untouched. Any future recovery must create a new reviewable generation/revision, prove source lineage and preserve old hashes; ambiguous Plan values require human input.
