import { createInitialQuoteFormState } from "@/components/offerte-samenstellen/quoteUtils";
import type { BuilderBlock, QuoteFormState } from "@/components/offerte-samenstellen/types";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

function asStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      String(entry ?? ""),
    ])
  );
}

function asDutchNumberString(value: unknown) {
  return String(value ?? "").replace(".", ",");
}

export function hydrateFormFromBlock(block: BuilderBlock): QuoteFormState {
  const initial = createInitialQuoteFormState();
  const payload = (block.payload ?? {}) as Record<string, unknown>;

  switch (block.type) {
    case "Intro":
      return {
        ...initial,
        introStart: String(payload.start ?? ""),
        introEnd: String(payload.end ?? ""),
        introEligibleRefs: asStringArray(payload.eligibleRefs),
        introPromoType: String(
          payload.promoType ?? initial.introPromoType
        ) as QuoteFormState["introPromoType"],
        introDiscountMode: String(
          payload.discountMode ?? initial.introDiscountMode
        ) as QuoteFormState["introDiscountMode"],
        introDiscountPercent: String(payload.discountPercent ?? ""),
        introDiscountsByProduct: asStringRecord(payload.discountsByProduct),
        introXValue: String(payload.xValue ?? ""),
        introYValue: String(payload.yValue ?? ""),
        introApplyMode: String(
          payload.applyMode ?? initial.introApplyMode
        ) as QuoteFormState["introApplyMode"],
        introSingleProductRef: String(payload.singleProductRef ?? ""),
        introThresholdType: String(
          payload.thresholdType ?? initial.introThresholdType
        ) as QuoteFormState["introThresholdType"],
        introThresholdApplyMode: String(
          payload.thresholdApplyMode ?? initial.introThresholdApplyMode
        ) as QuoteFormState["introThresholdApplyMode"],
        introThresholdSingleProductRef: String(payload.thresholdSingleProductRef ?? ""),
        introThresholdValue: String(payload.thresholdValue ?? ""),
        introThresholdDiscount: String(payload.thresholdDiscount ?? ""),
        introNote: String(payload.note ?? ""),
      };

    case "Staffel":
      return {
        ...initial,
        staffelEligibleRefs: asStringArray(payload.eligibleRefs),
        staffelDiscountMode: String(
          payload.discountMode ?? initial.staffelDiscountMode
        ) as QuoteFormState["staffelDiscountMode"],
        staffelDiscountValue: asDutchNumberString(
          payload.discountValue ?? initial.staffelDiscountValue
        ),
        staffelRows: Array.isArray(payload.tiers)
          ? payload.tiers.map((tier) => {
              const row = tier as Record<string, unknown>;
              return {
                from: String(row.from ?? ""),
                to: row.to === null || row.to === undefined ? "" : String(row.to),
                price: asDutchNumberString(row.priceEx ?? ""),
              };
            })
          : initial.staffelRows,
      };

    case "Mix":
      return {
        ...initial,
        mixCondition: String(payload.condition ?? ""),
        mixStructure: String(payload.structure ?? ""),
        mixEligibleRefs: asStringArray(payload.eligibleRefs),
      };

    case "Korting":
      return {
        ...initial,
        discountMode: String(payload.discountMode ?? initial.discountMode),
        discountValue: String(payload.discountPct ?? initial.discountValue),
        kortingEligibleRefs: asStringArray(payload.eligibleRefs),
      };

    case "Transport":
      return {
        ...initial,
        transportDistanceKm: String(payload.distanceKm ?? initial.transportDistanceKm),
        transportRateEx: String(payload.rateEx ?? initial.transportRateEx),
        transportDeliveries: String(payload.deliveries ?? initial.transportDeliveries),
        transportThresholdKm: String(payload.thresholdKm ?? initial.transportThresholdKm),
        transportChargedToCustomer: Boolean(
          payload.chargedToCustomer ?? initial.transportChargedToCustomer
        ),
      };

    case "Retour":
      return {
        ...initial,
        returnPct: String(payload.returnPct ?? initial.returnPct),
      };

    case "Proeverij":
      return {
        ...initial,
        tastingCondition: String(payload.condition ?? initial.tastingCondition),
        tastingCostEx: String(payload.costEx ?? initial.tastingCostEx),
        tastingPriceEx: String(payload.priceEx ?? initial.tastingPriceEx),
        tastingIsFree: Boolean(payload.isFree ?? initial.tastingIsFree),
      };

    case "Tapverhuur":
      return {
        ...initial,
        tapCondition: String(payload.condition ?? initial.tapCondition),
        tapCostEx: String(payload.costEx ?? initial.tapCostEx),
        tapPriceEx: String(payload.priceEx ?? initial.tapPriceEx),
        tapIsFree: Boolean(payload.isFree ?? initial.tapIsFree),
      };

    default:
      return initial;
  }
}
