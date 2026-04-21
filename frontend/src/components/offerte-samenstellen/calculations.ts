import {
  applyDiscountPct,
  calcOfferLineTotals,
  calcOfferLineTotalsWithGratis,
  computeGratisFreeByRefFromPaidRows,
} from "@/lib/pricingEngine";
import { clampNumber } from "@/components/offerte-samenstellen/quoteUtils";
import type { QuoteScenario, ScenarioMetrics } from "@/components/offerte-samenstellen/types";

export function calculateScenarioMetrics(
  scenario: QuoteScenario,
  activePeriod: "standard" | "intro"
): ScenarioMetrics {
  const notes: string[] = [];

  const periodBlocks = scenario.blocks.filter(
    (block) =>
      (block.appliesTo ?? "standard") === activePeriod ||
      (block.appliesTo ?? "standard") === "global"
  );

  const staffelBlock = periodBlocks.find((block) => block.type === "Staffel");
  const discountBlock = periodBlocks.find((block) => block.type === "Korting");
  const mixBlock = periodBlocks.find((block) => block.type === "Mix");
  const returnBlock = periodBlocks.find((block) => block.type === "Retour");
  const introBlock = periodBlocks.find((block) => block.type === "Intro");

  if (introBlock) {
    notes.push(
      "Introductieperiode: berekening is beperkt tot eenvoudige korting of X+Y gratis (v1)."
    );
  }

  const lines = scenario.products
    .filter((product) => product.qty > 0)
    .map((product) => {
      const ref =
        product.source?.bier_id && product.source?.product_id
          ? `beer:${String(product.source.bier_id)}:product:${String(product.source.product_id)}`
          : product.id;

      return {
        ref,
        qtyPaid: Math.max(0, clampNumber(product.qty, 0)),
        unitPriceEx: Math.max(0, clampNumber(product.standardPriceEx, 0)),
        costPriceEx: Math.max(0, clampNumber(product.costPriceEx, 0)),
      };
    })
    .filter((row) => row.ref && row.qtyPaid > 0);

  if (lines.length === 0) {
    return {
      revenueEx: 0,
      costEx: 0,
      extraCostEx: 0,
      transportCostEx: 0,
      marginPct: 0,
      breakEvenCurrent: null,
      breakEvenProjected: null,
      notes,
    };
  }

  const unitPriceByRef = new Map<string, number>();
  for (const row of lines) {
    unitPriceByRef.set(row.ref, row.unitPriceEx);
  }

  if (staffelBlock) {
    const tiersRaw = Array.isArray(staffelBlock.payload?.tiers)
      ? (staffelBlock.payload?.tiers as Array<Record<string, unknown>>)
      : [];
    const eligible = new Set<string>(
      Array.isArray(staffelBlock.payload?.eligibleRefs)
        ? (staffelBlock.payload?.eligibleRefs as unknown[]).map(String)
        : []
    );

    if (tiersRaw.length === 0 || eligible.size === 0) {
      notes.push("Staffel is actief maar mist tiers/productselectie (v1).");
    } else {
      for (const row of lines) {
        if (!eligible.has(row.ref)) continue;

        const tier = tiersRaw.find((candidate) => {
          const from = clampNumber(candidate?.from, 0);
          const to =
            candidate?.to === null ||
            candidate?.to === undefined ||
            String(candidate?.to).trim() === ""
              ? Number.POSITIVE_INFINITY
              : clampNumber(candidate?.to, Number.POSITIVE_INFINITY);

          return row.qtyPaid >= from && row.qtyPaid <= to;
        });

        const nextPrice = tier ? clampNumber(tier.priceEx, 0) : 0;
        if (nextPrice > 0) {
          unitPriceByRef.set(row.ref, nextPrice);
        }
      }
    }
  }

  const discountPct = discountBlock ? clampNumber(discountBlock.payload?.discountPct, 0) : 0;
  const hasStaffel = Boolean(staffelBlock);
  const hasMix = Boolean(mixBlock);

  if (discountPct > 0 && (hasStaffel || hasMix)) {
    notes.push(
      "Korting is genegeerd: korting is niet combineerbaar met staffel/mix in dezelfde periode."
    );
  } else if (discountPct > 0) {
    for (const row of lines) {
      const current = unitPriceByRef.get(row.ref) ?? row.unitPriceEx;
      unitPriceByRef.set(row.ref, applyDiscountPct(current, discountPct));
    }
  }

  let freeByRef = new Map<string, number>();
  if (mixBlock) {
    const requiredQty = clampNumber(mixBlock.payload?.requiredQty, 0);
    const freeQty = clampNumber(mixBlock.payload?.freeQty, 0);
    const eligibleRefs = Array.isArray(mixBlock.payload?.eligibleRefs)
      ? (mixBlock.payload?.eligibleRefs as unknown[]).map(String)
      : [];

    if (requiredQty <= 0 || freeQty <= 0) {
      notes.push("Mix deal mist geldige X+Y configuratie (v1).");
    } else {
      const rows = lines.map((row) => ({
        included: eligibleRefs.length === 0 ? true : eligibleRefs.includes(row.ref),
        ref: row.ref,
        qtyPaid: row.qtyPaid,
        unitPriceEx: unitPriceByRef.get(row.ref) ?? row.unitPriceEx,
      }));

      const { freeByRef: computed } = computeGratisFreeByRefFromPaidRows({
        rows,
        requiredQty,
        freeQty,
        eligibleRefs,
      });

      freeByRef = computed;
    }
  }

  let revenueEx = 0;
  let costEx = 0;
  for (const row of lines) {
    const unitPriceEx = unitPriceByRef.get(row.ref) ?? row.unitPriceEx;
    const freeQty = freeByRef.get(row.ref) ?? 0;

    if (freeQty > 0) {
      const totals = calcOfferLineTotalsWithGratis({
        kostprijsEx: row.costPriceEx,
        offerPriceEx: unitPriceEx,
        qty: row.qtyPaid,
        freeQty,
      });
      revenueEx += totals.omzet;
      costEx += totals.kosten;
      continue;
    }

    const totals = calcOfferLineTotals({
      kostprijsEx: row.costPriceEx,
      offerPriceEx: unitPriceEx,
      qty: row.qtyPaid,
      kortingPct: 0,
      feeExPerUnit: 0,
      retourPct: 0,
    });
    revenueEx += totals.omzet;
    costEx += totals.kosten;
  }

  const returnPct = returnBlock ? clampNumber(returnBlock.payload?.returnPct, 0) : 0;
  if (returnPct > 0) {
    const retourEur = (revenueEx * Math.max(0, Math.min(100, returnPct))) / 100;
    revenueEx = Math.max(0, revenueEx - retourEur);
    notes.push("Retour-effect is conservatief: omzet wordt verlaagd, kosten blijven gelijk (v1).");
  }

  let extraCostEx = 0;
  let transportCostEx = 0;
  for (const block of periodBlocks) {
    if (block.type === "Transport") {
      const charged = Boolean(block.payload?.chargedToCustomer ?? false);
      const amount = clampNumber(block.payload?.amountEx, 0);
      if (amount <= 0) continue;
      if (charged) revenueEx += amount;
      else transportCostEx += amount;
      continue;
    }

    if (block.type === "Proeverij" || block.type === "Tapverhuur") {
      const priceEx = clampNumber(block.payload?.priceEx, 0);
      const costLocal = clampNumber(block.payload?.costEx, 0);
      const isFree = Boolean(block.payload?.isFree ?? false);
      if (!isFree) revenueEx += priceEx;
      extraCostEx += costLocal;
    }
  }

  costEx += extraCostEx + transportCostEx;
  const marginPct = revenueEx > 0 ? ((revenueEx - costEx) / revenueEx) * 100 : 0;

  return {
    revenueEx: Math.max(0, revenueEx),
    costEx: Math.max(0, costEx),
    extraCostEx,
    transportCostEx,
    marginPct,
    breakEvenCurrent: null,
    breakEvenProjected: null,
    notes,
  };
}

