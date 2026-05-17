import { clampNumber } from "../components/offerte-samenstellen/quoteUtils";
import type {
  QuoteBreakEvenSnapshot,
  QuoteScenario,
  ScenarioMetrics,
} from "../components/offerte-samenstellen/types";
import {
  applyDiscountPct,
  computeGratisFreeByRefFromPaidRows,
} from "./pricingEngine";
import { calculateTransportImpact } from "./transportImpact";
import { applyStaffelToLines as applyStaffelBlock } from "./actionBlocks/applyStaffel";
import { applyMixDealToLines as applyMixDealBlock } from "./actionBlocks/applyMixDeal";

type PeriodKey = "standard" | "intro";
type CalculationBlock = QuoteScenario["blocks"][number];

type CalculationLine = {
  ref: string;
  qtyPaid: number;
  qtyFree: number;
  litersPerUnit: number;
  salesUnitLabel: string;
  unitsPerLayer: number | null;
  unitsPerPallet: number | null;
  contributesToLiters: boolean;
  baseUnitPriceEx: number;
  offerUnitPriceEx: number;
  costPriceEx: number;
  revenueEx: number;
  costEx: number;
  notes: string[];
};

type CalculationState = {
  blocks: CalculationBlock[];
  lines: CalculationLine[];
  notes: string[];
  extraCostEx: number;
  transportCostEx: number;
};

type MetricsBuildParams = {
  breakEven: QuoteBreakEvenSnapshot | null;
  notes: string[];
  lines: CalculationLine[];
  revenueEx: number;
  costEx: number;
  extraCostEx: number;
  transportCostEx: number;
};

export function calculateQuoteScenarioMetrics(
  scenario: QuoteScenario,
  activePeriod: PeriodKey,
  breakEven: QuoteBreakEvenSnapshot | null = null
): ScenarioMetrics {
  const state = createCalculationState(scenario, activePeriod);

  if (state.lines.length === 0) {
    return buildEmptyMetrics(breakEven, state.notes);
  }

  applyIntroToLines(state);
  applyStaffelToLines(state);
  applyDiscountToLines(state);
  applyWholesaleToLines(state);
  applyMixDealToLines(state);
  finalizeLineTotals(state);

  let revenueEx = sum(state.lines.map((line) => line.revenueEx));
  let costEx = sum(state.lines.map((line) => line.costEx));

  revenueEx = applyReturnImpact(state, revenueEx);
  applyServiceAndTransportBlocks(state, {
    currentRevenueEx: () => revenueEx,
    addRevenue: (value) => {
      revenueEx += value;
    },
  });

  costEx += state.extraCostEx + state.transportCostEx;

  return buildScenarioMetrics({
    breakEven,
    notes: state.notes,
    lines: state.lines,
    revenueEx,
    costEx,
    extraCostEx: state.extraCostEx,
    transportCostEx: state.transportCostEx,
  });
}

export function calculateQuoteScenarioLines(params: {
  scenario: QuoteScenario;
  activePeriod: PeriodKey;
  includeBlocks?: boolean;
}) {
  const includeBlocks = params.includeBlocks ?? true;
  const scenario = includeBlocks
    ? params.scenario
    : { ...params.scenario, blocks: [] as QuoteScenario["blocks"] };
  const state = createCalculationState(scenario, params.activePeriod);

  if (state.lines.length === 0) {
    return { lines: [], notes: state.notes };
  }

  applyIntroToLines(state);
  applyStaffelToLines(state);
  applyDiscountToLines(state);
  applyWholesaleToLines(state);
  applyMixDealToLines(state);
  finalizeLineTotals(state);

  return { lines: state.lines, notes: state.notes };
}

function createCalculationState(
  scenario: QuoteScenario,
  activePeriod: PeriodKey
): CalculationState {
  const blocks = scenario.blocks.filter(
    (block) =>
      (block.appliesTo ?? "standard") === activePeriod ||
      (block.appliesTo ?? "standard") === "global"
  );

  return {
    blocks,
    lines: buildCalculationLines(scenario),
    notes: [],
    extraCostEx: 0,
    transportCostEx: 0,
  };
}

function buildCalculationLines(scenario: QuoteScenario): CalculationLine[] {
  return scenario.products
    .filter((product) => product.qty > 0)
    .map((product) => {
      const ref = product.source?.sku_id
        ? `sku:${String(product.source.sku_id)}`
        : product.source?.bier_id && product.source?.product_id
          ? `beer:${String(product.source.bier_id)}:product:${String(product.source.product_id)}`
          : product.id;

      return {
        ref,
        qtyPaid: Math.max(0, clampNumber(product.qty, 0)),
        qtyFree: 0,
        litersPerUnit: Math.max(0, clampNumber(product.litersPerUnit, 0)),
        salesUnitLabel: String((product as any).unit ?? "stuk").toLowerCase(),
        unitsPerLayer:
          typeof (product as any).unitsPerLayer === "number"
            ? ((product as any).unitsPerLayer as number)
            : null,
        unitsPerPallet:
          typeof (product as any).unitsPerPallet === "number"
            ? ((product as any).unitsPerPallet as number)
            : null,
        contributesToLiters: Boolean(
          (product as any).contributesToLiters ?? (product.litersPerUnit > 0)
        ),
        baseUnitPriceEx: Math.max(0, clampNumber(product.standardPriceEx, 0)),
        offerUnitPriceEx: Math.max(0, clampNumber(product.standardPriceEx, 0)),
        costPriceEx: Math.max(0, clampNumber(product.costPriceEx, 0)),
        revenueEx: 0,
        costEx: 0,
        notes: [],
      };
    })
    .filter((line) => line.ref && line.qtyPaid > 0);
}

function buildEmptyMetrics(
  breakEven: QuoteBreakEvenSnapshot | null,
  notes: string[]
): ScenarioMetrics {
  return {
    revenueEx: 0,
    costEx: 0,
    extraCostEx: 0,
    transportCostEx: 0,
    marginPct: 0,
    breakEvenCurrent: breakEven?.breakEvenRevenue ?? null,
    breakEvenProjected:
      typeof breakEven?.breakEvenRevenue === "number" ? -breakEven.breakEvenRevenue : null,
    breakEvenCoveragePct: 0,
    pricingByRef: {},
    notes,
  };
}

function applyIntroToLines(state: CalculationState) {
  const introBlock = findBlock(state.blocks, "Intro");
  if (!introBlock) return;

  const promoType = String(introBlock.payload?.promoType ?? "discount");

  if (promoType === "discount") {
    applyIntroDiscountToLines(state, introBlock);
    return;
  }

  if (promoType === "x_plus_y") {
    applyIntroXPlusYToLines(state, introBlock);
    return;
  }

  if (promoType === "threshold_discount") {
    applyIntroThresholdDiscountToLines(state, introBlock);
    return;
  }

  state.notes.push("Introductieperiode bevat een onbekend actietype en is overgeslagen.");
}

function applyIntroDiscountToLines(
  state: CalculationState,
  introBlock: CalculationBlock
) {
  const eligibleRefs = resolveEligibleTargetRefs(state.lines, introBlock.payload?.eligibleRefs);
  const discountMode = String(introBlock.payload?.discountMode ?? "all");
  const discountsByProduct = asRecord(introBlock.payload?.discountsByProduct);
  const allDiscountPct = clampNumber(introBlock.payload?.discountPercent, 0);

  state.lines = state.lines.map((line) => {
    if (!eligibleRefs.has(line.ref)) return line;

    const discountPct =
      discountMode === "per_product"
        ? clampNumber(discountsByProduct[line.ref], 0)
        : allDiscountPct;

    if (discountPct <= 0) return line;
    return {
      ...line,
      offerUnitPriceEx: applyDiscountPct(line.offerUnitPriceEx, discountPct),
    };
  });
}

function applyIntroXPlusYToLines(
  state: CalculationState,
  introBlock: CalculationBlock
) {
  const requiredQty = clampNumber(introBlock.payload?.xValue, 0);
  const freeQty = clampNumber(introBlock.payload?.yValue, 0);
  if (requiredQty <= 0 || freeQty <= 0) {
    state.notes.push("Introductie X+Y mist een geldige configuratie.");
    return;
  }

  const applyMode = String(introBlock.payload?.applyMode ?? "combined");
  const targetRefs =
    applyMode === "single"
      ? new Set(asStringArray([introBlock.payload?.singleProductRef]).filter(Boolean))
      : resolveEligibleTargetRefs(state.lines, introBlock.payload?.eligibleRefs);

  if (targetRefs.size === 0) {
    state.notes.push("Introductie X+Y heeft geen geldige producten om op toe te passen.");
    return;
  }

  const { freeByRef } = computeGratisFreeByRefFromPaidRows({
    rows: state.lines.map((line) => ({
      included: targetRefs.has(line.ref),
      ref: line.ref,
      qtyPaid: line.qtyPaid,
      unitPriceEx: line.offerUnitPriceEx,
    })),
    requiredQty,
    freeQty,
    eligibleRefs: Array.from(targetRefs),
  });

  state.lines = state.lines.map((line) =>
    targetRefs.has(line.ref)
      ? {
          ...line,
          qtyFree: line.qtyFree + (freeByRef.get(line.ref) ?? 0),
        }
      : line
  );
}

function applyIntroThresholdDiscountToLines(
  state: CalculationState,
  introBlock: CalculationBlock
) {
  const thresholdValue = clampNumber(introBlock.payload?.thresholdValue, 0);
  const discountPct = clampNumber(introBlock.payload?.thresholdDiscount, 0);
  if (thresholdValue <= 0 || discountPct <= 0) {
    state.notes.push("Introductie drempelkorting mist een geldige drempel of korting.");
    return;
  }

  const thresholdType =
    String(introBlock.payload?.thresholdType ?? "dozen") === "liters"
      ? "liters"
      : "dozen";
  const applyMode = String(introBlock.payload?.thresholdApplyMode ?? "all");
  const targetRefs =
    applyMode === "single"
      ? new Set(
          asStringArray([introBlock.payload?.thresholdSingleProductRef]).filter(Boolean)
        )
      : resolveEligibleTargetRefs(state.lines, introBlock.payload?.eligibleRefs);

  if (targetRefs.size === 0) {
    state.notes.push("Introductie drempelkorting heeft geen geldige producten om op toe te passen.");
    return;
  }

  const qualifyingValue = sum(
    state.lines
      .filter((line) => targetRefs.has(line.ref))
      .map((line) =>
        thresholdType === "liters" ? line.qtyPaid * line.litersPerUnit : line.qtyPaid
      )
  );

  if (qualifyingValue < thresholdValue) {
    state.notes.push("Introductie drempelkorting is nog niet geactiveerd bij de huidige aantallen.");
    return;
  }

  state.lines = state.lines.map((line) =>
    targetRefs.has(line.ref)
      ? {
          ...line,
          offerUnitPriceEx: applyDiscountPct(line.offerUnitPriceEx, discountPct),
        }
      : line
  );
}

function applyStaffelToLines(state: CalculationState) {
  const staffelBlock = findBlock(state.blocks, "Staffel");
  if (!staffelBlock) return;

  state.lines = applyStaffelBlock({
    lines: state.lines,
    payload: (staffelBlock.payload ?? {}) as Record<string, unknown>,
    resolveEligibleRefs: (value) => resolveEligibleTargetRefs(state.lines, value),
    notes: state.notes,
  }) as any;
}

function applyDiscountToLines(state: CalculationState) {
  const discountBlock = findBlock(state.blocks, "Korting");
  if (!discountBlock) return;

  const discountPct = clampNumber(discountBlock.payload?.discountPct, 0);
  const hasStaffel = Boolean(findBlock(state.blocks, "Staffel"));
  const hasMix = Boolean(findBlock(state.blocks, "Mix"));
  const discountEligibleRefs = asStringArray(discountBlock.payload?.eligibleRefs);
  const discountScope = String(discountBlock.payload?.discountMode ?? "Totaal");
  const discountTargets = new Set(
    discountScope === "Regel" && discountEligibleRefs.length > 0
      ? discountEligibleRefs
      : state.lines.map((line) => line.ref)
  );

  if (discountPct <= 0) return;
  if (hasStaffel || hasMix) {
    state.notes.push(
      "Korting is genegeerd: korting is niet combineerbaar met staffel of mix in dezelfde periode."
    );
    return;
  }

  state.lines = state.lines.map((line) =>
    discountTargets.has(line.ref)
      ? {
          ...line,
          offerUnitPriceEx: applyDiscountPct(line.offerUnitPriceEx, discountPct),
        }
      : line
  );
}

function applyWholesaleToLines(state: CalculationState) {
  const wholesaleBlock = findBlock(state.blocks, "Groothandel");
  if (!wholesaleBlock) return;

  const wholesaleMarginPct = clampNumber(wholesaleBlock.payload?.marginPct, 0);
  const hasStaffel = Boolean(findBlock(state.blocks, "Staffel"));
  const hasMix = Boolean(findBlock(state.blocks, "Mix"));
  const discountBlock = findBlock(state.blocks, "Korting");
  const discountPct = discountBlock
    ? clampNumber(discountBlock.payload?.discountPct, 0)
    : 0;
  const wholesaleTargets = resolveEligibleTargetRefs(
    state.lines,
    wholesaleBlock.payload?.eligibleRefs
  );

  if (wholesaleMarginPct <= 0) return;
  if (hasStaffel || hasMix || discountPct > 0) {
    state.notes.push(
      "Groothandel-pricing is genegeerd: deze actie is niet combineerbaar met andere pricingacties in dezelfde periode."
    );
    return;
  }

  const factor = 1 + wholesaleMarginPct / 100;
  state.lines = state.lines.map((line) =>
    wholesaleTargets.has(line.ref)
      ? {
          ...line,
          offerUnitPriceEx: factor > 0 ? line.offerUnitPriceEx / factor : line.offerUnitPriceEx,
        }
      : line
  );
}

function applyMixDealToLines(state: CalculationState) {
  const mixBlock = findBlock(state.blocks, "Mix");
  if (!mixBlock) return;

  state.lines = applyMixDealBlock({
    lines: state.lines,
    payload: (mixBlock.payload ?? {}) as Record<string, unknown>,
    resolveEligibleRefs: (value) => resolveEligibleTargetRefs(state.lines, value),
    notes: state.notes,
  }) as any;
}

function finalizeLineTotals(state: CalculationState) {
  state.lines = state.lines.map((line) => ({
    ...line,
    revenueEx: line.qtyPaid * line.offerUnitPriceEx,
    costEx: (line.qtyPaid + line.qtyFree) * line.costPriceEx,
  }));
}

function applyReturnImpact(state: CalculationState, revenueEx: number) {
  const returnBlock = findBlock(state.blocks, "Retour");
  if (!returnBlock) return revenueEx;

  const returnPct = clampNumber(returnBlock.payload?.returnPct, 0);
  if (returnPct <= 0) return revenueEx;

  const retourEur = (revenueEx * Math.max(0, Math.min(100, returnPct))) / 100;
  state.notes.push("Retour-effect verlaagt de omzet, terwijl de kosten gelijk blijven.");
  return Math.max(0, revenueEx - retourEur);
}

function applyServiceAndTransportBlocks(
  state: CalculationState,
  handlers: { addRevenue: (value: number) => void; currentRevenueEx: () => number }
) {
  for (const block of state.blocks) {
    if (block.type === "Transport") {
      const payload = asRecord(block.payload);
      const thresholdValue = clampNumber(payload.freeShippingThresholdValue, 0);
      const thresholdUnit = String(payload.freeShippingThresholdUnit ?? "").trim().toLowerCase();
      const costType = String(payload.transportCostType ?? "fixed").trim().toLowerCase();
      const transportCostEx = clampNumber(payload.transportCostEx ?? payload.amountEx, 0);
      const chargedToCustomer = Boolean(payload.chargedToCustomer ?? false);
      const includeInMargin = Boolean(payload.includeInMargin ?? true);

      const hasNewModelFields =
        Boolean(thresholdUnit) ||
        payload.freeShippingThresholdValue !== undefined ||
        payload.transportCostType !== undefined ||
        payload.transportCostEx !== undefined ||
        payload.includeInMargin !== undefined;

      const hasLegacyModelFields =
        payload.distanceKm !== undefined ||
        payload.rateEx !== undefined ||
        payload.deliveries !== undefined ||
        payload.thresholdKm !== undefined;

      // New model: compute applied transport cost based on quote totals (not per-km).
      if (hasNewModelFields) {
        if (!thresholdUnit) {
          state.notes.push("Transport mist drempeltype; transportimpact wordt genegeerd.");
          continue;
        }
        if (!(transportCostEx > 0 || costType === "manual")) {
          state.notes.push("Transport staat actief maar bedrag is 0.");
          continue;
        }

        const totalsWarnings: string[] = [];
        const currentRevenueEx = Math.max(0, handlers.currentRevenueEx());
        const lineUnits = (line: CalculationLine) => Math.max(0, (line.qtyPaid ?? 0) + (line.qtyFree ?? 0));

        let totalLiters = 0;
        let totalBoxes = 0;
        let totalLayers = 0;
        let totalPallets = 0;

        for (const line of state.lines) {
          const units = lineUnits(line);
          if (line.contributesToLiters && line.litersPerUnit > 0) {
            totalLiters += units * line.litersPerUnit;
          }
          if (line.salesUnitLabel === "doos") {
            totalBoxes += units;
          }
          if (line.unitsPerLayer && line.unitsPerLayer > 0) {
            totalLayers += units / line.unitsPerLayer;
          } else if (thresholdUnit === "layers") {
            totalsWarnings.push(`Laag-informatie ontbreekt voor '${line.ref}'.`);
          }
          if (line.unitsPerPallet && line.unitsPerPallet > 0) {
            totalPallets += units / line.unitsPerPallet;
          } else if (thresholdUnit === "pallets") {
            totalsWarnings.push(`Pallet-informatie ontbreekt voor '${line.ref}'.`);
          }
        }

        const impact = calculateTransportImpact({
          rule: {
            freeShippingThresholdValue: thresholdValue,
            freeShippingThresholdUnit: thresholdUnit as any,
            transportCostType: costType as any,
            transportCostEx,
            includeInMargin,
            chargedToCustomer,
          },
          totals: {
            totalRevenueEx: currentRevenueEx,
            totalLiters,
            totalBoxes,
            totalLayers,
            totalPallets,
            warnings: totalsWarnings,
          },
        });

        impact.warnings.forEach((w) => state.notes.push(w));
        if (impact.transportRevenueEx > 0) handlers.addRevenue(impact.transportRevenueEx);
        if (impact.transportCostInMarginEx > 0) state.transportCostEx += impact.transportCostInMarginEx;
        continue;
      }

      // Legacy fallback: keep km-based amountEx behaviour ONLY for old drafts.
      if (!hasLegacyModelFields) {
        state.notes.push("Transport block is incompleet; transportimpact wordt genegeerd.");
        continue;
      }

      const amountEx = clampNumber(payload.amountEx, 0);
      if (amountEx <= 0) continue;
      if (chargedToCustomer) handlers.addRevenue(amountEx);
      else if (includeInMargin) state.transportCostEx += amountEx;
      else state.notes.push("Transport staat actief maar is uitgesloten van marge-impact.");
      continue;
    }

    if (block.type === "Proeverij" || block.type === "Tapverhuur") {
      const priceEx = clampNumber(block.payload?.priceEx, 0);
      const costEx = clampNumber(block.payload?.costEx, 0);
      const isFree = Boolean(block.payload?.isFree ?? false);
      if (!isFree) handlers.addRevenue(priceEx);
      state.extraCostEx += costEx;
    }
  }
}

function buildScenarioMetrics(params: MetricsBuildParams): ScenarioMetrics {
  const breakEvenCurrent = params.breakEven?.breakEvenRevenue ?? null;
  const breakEvenProjected =
    typeof breakEvenCurrent === "number" ? params.revenueEx - breakEvenCurrent : null;
  const breakEvenCoveragePct =
    typeof breakEvenCurrent === "number" && breakEvenCurrent > 0
      ? (params.revenueEx / breakEvenCurrent) * 100
      : null;
  const notes = uniqueStrings([
    ...params.notes,
    ...params.lines.flatMap((line) => line.notes),
  ]);

  if (breakEvenCurrent === null) {
    notes.push("Geen actieve break-even versie gekoppeld aan deze offerte.");
  } else if (breakEvenProjected !== null && breakEvenProjected < 0) {
    notes.push("Scenario ligt onder de huidige break-even omzet.");
  }

  return {
    revenueEx: Math.max(0, params.revenueEx),
    costEx: Math.max(0, params.costEx),
    extraCostEx: params.extraCostEx,
    transportCostEx: params.transportCostEx,
    marginPct:
      params.revenueEx > 0
        ? ((params.revenueEx - params.costEx) / params.revenueEx) * 100
        : 0,
    breakEvenCurrent,
    breakEvenProjected,
    breakEvenCoveragePct,
    pricingByRef: Object.fromEntries(
      params.lines.map((line) => [
        line.ref,
        {
          baseUnitPriceEx: line.baseUnitPriceEx,
          offerUnitPriceEx: line.offerUnitPriceEx,
        },
      ])
    ),
    notes,
  };
}

function findBlock(blocks: CalculationBlock[], type: CalculationBlock["type"]) {
  return blocks.find((block) => block.type === type);
}

function resolveEligibleTargetRefs(lines: CalculationLine[], value: unknown) {
  const refs = asStringArray(value);
  return new Set(refs.length > 0 ? refs : lines.map((line) => line.ref));
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
