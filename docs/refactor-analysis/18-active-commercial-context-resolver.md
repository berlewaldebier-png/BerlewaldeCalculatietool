# RF-011A — Read-only active commercial context resolver

Status update (RF-014B): this historical characterization was superseded and
its unused frontend resolver was removed. The active runtime authorities are
documented in RF-012C1 through RF-012C4B. This document remains decision
history, not a current implementation guide.

Original RF-011A status: implemented as a read-only candidate resolver; no consumer or persisted authority had switched.

## Outcome

RF-011A introduces one typed application service for an explicitly supplied operational year. The service returns an explainable commercial-context candidate per canonical SKU and a read-only reader port with only `readSnapshot(year)`. It performs no API request, database write, schema creation, activation, migration or historical-record update.

The existing Quote, Advice-price and Break-even screens still execute their existing derivations. RF-011A runs those paths only as an in-memory shadow comparison. Its differences contain identifiers, fields and reason codes but no logged commercial values.

## Public contract

`resolveActiveCommercialContext(input)` returns:

- the explicitly requested operational-year candidate, marked as a candidate because RF-013A has not established an active-yearset authority;
- every active canonical SKU with Beer/product identity, calculation method and version provenance;
- the first observable planning activation per `(sku_id, year)`, or the latest explicitly approved rebaseline event;
- cost-version ID, canonical cost-row ID and a cloned, frozen component breakdown;
- resolved sell-in price and its exact record/scope/key/year per active channel;
- advice-price input, output and source row per active channel;
- active Break-even plan ID and generation, or a typed missing/ambiguous state;
- Quote, Advice-price and Break-even readiness flags;
- actionable completeness reason codes;
- a shadow comparison with the current consumers.

`readActiveCommercialContext(year, reader)` adds the storage/application boundary. The reader interface exposes no mutation method. A future adapter may read the existing stores without changing this result contract; current screens are deliberately not connected to it in this slice.

## Preserved and candidate rules

| Context | RF-011A rule | Runtime effect in this slice |
| --- | --- | --- |
| Operational year | Must be supplied as a positive integer; no calendar-year or `max(year)` guess | Candidate only |
| Planning cost | Earliest observable activation; an `explicit_rebaseline` event is accepted only when `metadata.approved=true` | Read-only target result; existing consumers remain unchanged |
| Cost row | Canonical `cost_lines` row for the same stable `sku_id`; no label fallback | Missing row is a typed incomplete state |
| Components | Purchase, packaging, indirect, excise and total are cloned and frozen | No source object is mutated |
| Manual-rate service | Cost price is not required; the explicit manual rate is the sell-in source | No invented zero cost |
| Packaging component | A positive year-specific component price may be the non-version planning source | No activation is created |
| Sell-in | SKU product → Beer/product → SKU packaging → product packaging → year strategy → channel default; exact record, key and resolved year are returned | Existing numeric result is preserved; trace metadata is additive |
| Advice price | Uses the resolver's same SKU sell-in source, approved advice markup, VAT and existing rounding engine | Candidate only; current Advice screen is not switched |
| Break-even plan | Exactly one active plan for the explicit year resolves; zero is missing and multiple are ambiguous | No plan is activated or selected persistently |
| Historical records | Quotes, actuals, closed years and cost versions are not inputs to mutation | Fully unchanged |

LOT/actual-cost selection is intentionally excluded. RF-011B owns the separate actual-LOT resolver and the final public planning-cost resolver. Year-transition planning remains RF-011C. Active-yearset persistence remains RF-013A.

## Observed shadow finding

The committed synthetic RF-010A fixture exposes one existing source inconsistency:

- **Observed:** Quote resolves the 2026 SKU-specific `list` sell-in price because it supplies `sku_id`.
- **Observed:** the current Advice-price derivation calls the same sell-in function without `sku_id`; it therefore ignores that SKU price row and uses a channel/default margin in the fixture.
- **Observed:** RF-011A reports this as `current_advice_omits_sku_price_scope` for Horeca and Retail. It does not change either screen.
- **Inferred:** development SKUs with a SKU-specific price and no equivalent Beer/product row may show the same cross-screen difference.
- **Unknown:** how many development SKUs are affected. A private read-only audit is required before any Advice consumer switch.

This difference is practical SSOT evidence, not permission to pick a winner silently. Product/finance must confirm that the same SKU sell-in source is authoritative for Quote, Advice and Break-even before RF-012C4.

## Typed incomplete states

The resolver distinguishes at least:

- missing planning activation;
- unknown cost version;
- missing canonical SKU cost row;
- non-positive cost;
- planning history that does not yet prove the first anchor;
- unknown SKU referenced by an activation;
- missing/fallback sell-in context;
- missing advice markup;
- missing or ambiguous active Break-even plan;
- manual-rate service without a positive rate.

These states remain visible. RF-011A does not repair the 35 non-canonical activation/cost relations, the 2025→2026 identity/lineage differences, the 940 actual missing-cost snapshots or the 11 exact-LOT ambiguities recorded by RF-010A/RF-010B/RF-010C.

## Executable protection

`activeCommercialContextResolver.contracttest.ts` covers:

1. explicit-year-only resolution;
2. stable source IDs and frozen component values;
3. SKU price and `list` precedence with additive trace metadata;
4. advice-price calculation through the existing pricing engine;
5. manual-rate service without an invented cost;
6. exactly one active Break-even plan;
7. first activation versus later current activation;
8. explicitly approved rebaseline;
9. shadow differences without a consumer switch;
10. missing activation, version, row, advice and plan;
11. ambiguous active plan;
12. reader-port purity and source-object immutability.

The existing RF-010 golden tests continue running in the same `npm run test:pricing` gate. This proves that adding sell-in trace metadata did not change the current numeric results.

## Data safety, rollout and rollback

- **Migration:** none.
- **Persistent writes:** none.
- **Runtime routing:** none; no screen imports the new resolver.
- **External contracts/URLs:** unchanged.
- **Historical data:** not read for mutation and never rewritten.
- **Rollout:** test/shadow use only until RF-013A/RF-013B/RF-013C establish compatible authorities and an individual RF-012C consumer is approved.
- **Rollback:** remove the resolver, reader port and contract test; the additive sell-in trace fields can also be removed without a data rollback.

## Human confirmation before later switching

- [ ] Confirm that an explicit SKU price has precedence over broader Beer/product, packaging, year and channel defaults.
- [ ] Confirm that Quote, Advice and Break-even must use that same resolved SKU sell-in source for new work.
- [ ] Confirm that missing/ambiguous Break-even plans block an operational context instead of being selected silently.
- [ ] Confirm that `planning_anchor_history_unproven` remains blocking until the activation/event history is reconciled.
- [ ] Confirm that historical quotes, actual snapshots and closed-year dossiers remain bound to their stored context.

Approval is required before RF-013A or any RF-012C consumer switch. It is not required to merge this read-only seam, provided its tests and CI pass.
