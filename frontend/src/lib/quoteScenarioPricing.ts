import { clampNumber } from "../components/offerte-samenstellen/quoteUtils";
import {
  formatStaffelInput,
  getDerivedStaffelPrice,
} from "../components/offerte-samenstellen/staffelUtils";
import type {
  QuoteBreakEvenSnapshot,
  QuoteScenario,
  ScenarioMetrics,
} from "../components/offerte-samenstellen/types";
import {
  applyDiscountPct,
  computeGratisFreeByRefFromPaidRows,
} from "./pricingEngine";

type PeriodKey = "standard" | "intro";
type CalculationBlock = QuoteScenario["blocks"][number];

type CalculationLine = {
  ref: string;
  qtyPaid: number;
  qtyFree: number;
  litersPerUnit: number;
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
      const ref =
        product.source?.bier_id && product.source?.product_id
          ? `beer:${String(product.source.bier_id)}:product:${String(
              product.source.product_id
            )}`
          : product.id;

      return {
        ref,
        qtyPaid: Math.max(0, clampNumber(product.qty, 0)),
        qtyFree: 0,
        litersPerUnit: Math.max(0, clampNumber(product.litersPerUnit, 0)),
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

  const tiersRaw = asArrayOfRecords(staffelBlock.payload?.tiers);
  const discountMode = String(staffelBlock.payload?.discountMode ?? "absolute");
  const discountValue = formatStaffelInput(
    clampNumber(staffelBlock.payload?.discountValue, 0)
  );
  const eligibleRefs = resolveEligibleTargetRefs(state.lines, staffelBlock.payload?.eligibleRefs);

  if (tiersRaw.length === 0 || eligibleRefs.size === 0) {
    state.notes.push("Staffel is actief maar mist tiers of productselectie.");
    return;
  }

  state.lines = state.lines.map((line) => {
    if (!eligibleRefs.has(line.ref)) return line;

    const tierIndex = tiersRaw.findIndex((candidate) => {
      const from = clampNumber(candidate.from, 0);
      const to =
        candidate.to === null ||
        candidate.to === undefined ||
        String(candidate.to).trim() === ""
          ? Number.POSITIVE_INFINITY
          : clampNumber(candidate.to, Number.POSITIVE_INFINITY);

      return line.qtyPaid >= from && line.qtyPaid <= to;
    });

    if (tierIndex < 0) return line;

    const tier = tiersRaw[tierIndex];
    const nextPrice =
      getDerivedStaffelPrice(
        {
          optionId: line.ref,
          bierId: "",
          productId: "",
          label: line.ref,
          bierName: "",
          packLabel: "",
          litersPerUnit: line.litersPerUnit,
          staffelCompatibilityKey: "",
          staffelCompatibilityLabel: "",
          costPriceEx: line.costPriceEx,
          standardPriceEx: line.baseUnitPriceEx,
          vatRatePct: 0,
          kostprijsversieId: "",
        },
        tierIndex,
        {
          from: String(tier.from ?? ""),
          to: tier.to === null || tier.to === undefined ? "" : String(tier.to),
          price: String(tier.priceEx ?? ""),
        },
        discountMode as "percent" | "absolute" | "free",
        discountValue
      ) ?? 0;

    return nextPrice > 0 ? { ...line, offerUnitPriceEx: nextPrice } : line;
  });
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

  const requiredQty = clampNumber(mixBlock.payload?.requiredQty, 0);
  const freeQty = clampNumber(mixBlock.payload?.freeQty, 0);
  const eligibleRefs = resolveEligibleTargetRefs(state.lines, mixBlock.payload?.eligibleRefs);

  if (requiredQty <= 0 || freeQty <= 0) {
    state.notes.push("Mix deal mist een geldige X+Y configuratie.");
    return;
  }

  const { freeByRef } = computeGratisFreeByRefFromPaidRows({
    rows: state.lines.map((line) => ({
      included: eligibleRefs.has(line.ref),
      ref: line.ref,
      qtyPaid: line.qtyPaid,
      unitPriceEx: line.offerUnitPriceEx,
    })),
    requiredQty,
    freeQty,
    eligibleRefs: Array.from(eligibleRefs),
  });

  state.lines = state.lines.map((line) => ({
    ...line,
    qtyFree: line.qtyFree + (freeByRef.get(line.ref) ?? 0),
  }));
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
  handlers: { addRevenue: (value: number) => void }
) {
  for (const block of state.blocks) {
    if (block.type === "Transport") {
      const chargedToCustomer = Boolean(block.payload?.chargedToCustomer ?? false);
      const amountEx = clampNumber(block.payload?.amountEx, 0);
      if (amountEx <= 0) continue;
      if (chargedToCustomer) handlers.addRevenue(amountEx);
      else state.transportCostEx += amountEx;
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
