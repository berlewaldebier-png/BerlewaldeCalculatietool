import { createInitialQuoteFormState } from "@/components/offerte-samenstellen/quoteUtils";
import type { BuilderBlock, QuoteFormState } from "@/components/offerte-samenstellen/types";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
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
        introProducts: String(payload.products ?? ""),
        introEligibleRefs: asStringArray(payload.eligibleRefs),
        introPromoType: String(payload.promoType ?? initial.introPromoType),
        introAction: String(payload.action ?? ""),
        introValue: String(payload.value ?? ""),
      };
    case "Staffel":
      return {
        ...initial,
        staffelProduct: String(payload.productLabel ?? ""),
        staffelEligibleRefs: asStringArray(payload.eligibleRefs),
        staffelRows: Array.isArray(payload.tiers)
          ? payload.tiers.map((tier) => {
              const row = tier as Record<string, unknown>;
              return {
                from: String(row.from ?? ""),
                to: row.to === null || row.to === undefined ? "∞" : String(row.to),
                price: String(row.priceEx ?? ""),
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
