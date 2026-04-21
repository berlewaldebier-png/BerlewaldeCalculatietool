import type { ReactNode } from "react";

import { clampNumber, euro, normalizeText } from "@/components/offerte-samenstellen/quoteUtils";
import type {
  BuilderBlock,
  OptionType,
  QuoteBlockContext,
  QuoteFormState,
} from "@/components/offerte-samenstellen/types";

type BuildBlockParams = {
  type: OptionType;
  form: QuoteFormState;
  activePeriod: "intro" | "standard";
  tones: Record<OptionType, string>;
  icons: Record<OptionType, ReactNode>;
  existingBlockId?: string | null;
};

export function buildBlockFromForm({
  type,
  form,
  activePeriod,
  tones,
  icons,
  existingBlockId,
}: BuildBlockParams): BuilderBlock {
  const blockId = existingBlockId ?? `${type.toLowerCase()}-${Date.now()}`;

  switch (type) {
    case "Intro":
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Introductieperiode",
        subtitle: `${normalizeText(form.introStart)} t/m ${normalizeText(form.introEnd)}`,
        lines: [
          `Producten: ${normalizeText(form.introProducts) || "—"}`,
          `Promotie: ${normalizeText(form.introAction) || "—"}`,
        ],
        tone: tones[type],
        impact: "Na introductie valt de offerte automatisch terug op de standaardperiode.",
        appliesTo: "intro",
        payload: {
          start: normalizeText(form.introStart),
          end: normalizeText(form.introEnd),
          products: normalizeText(form.introProducts),
          eligibleRefs: Array.isArray(form.introEligibleRefs)
            ? form.introEligibleRefs.map(String)
            : [],
          promoType: normalizeText(form.introPromoType),
          action: normalizeText(form.introAction),
          value: normalizeText(form.introValue),
        },
      };
    case "Staffel":
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: `Staffel — ${normalizeText(form.staffelProduct) || "Product"}`,
        subtitle: "Actief voor standaardperiode",
        lines: Array.isArray(form.staffelRows)
          ? form.staffelRows.map((row) => `${row.from}–${row.to} → € ${row.price}`)
          : [],
        tone: tones[type],
        appliesTo: "standard",
        payload: {
          productLabel: normalizeText(form.staffelProduct),
          eligibleRefs: Array.isArray(form.staffelEligibleRefs)
            ? form.staffelEligibleRefs.map(String)
            : [],
          tiers: Array.isArray(form.staffelRows)
            ? form.staffelRows
                .map((row) => {
                  const from = clampNumber(row?.from, 0);
                  const toRaw = normalizeText(row?.to ?? "");
                  const to =
                    !toRaw || toRaw === "∞" || toRaw.toLowerCase() === "inf"
                      ? null
                      : clampNumber(toRaw, 0);
                  const priceEx = clampNumber(
                    normalizeText(row?.price ?? "").replace(",", "."),
                    0
                  );
                  return { from, to, priceEx };
                })
                .filter((tier) => Number.isFinite(tier.from) && tier.priceEx > 0)
            : [],
        },
      };
    case "Mix":
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Mix deal",
        subtitle: "Assortimentsdeal",
        lines: [
          `Voorwaarde: ${normalizeText(form.mixCondition) || "—"}`,
          `Structuur: ${normalizeText(form.mixStructure) || "—"}`,
        ],
        tone: tones[type],
        appliesTo: activePeriod as QuoteBlockContext,
        payload: {
          condition: normalizeText(form.mixCondition),
          structure: normalizeText(form.mixStructure),
          requiredQty: clampNumber(String(form.mixStructure ?? "").split("+")[0], 0),
          freeQty: clampNumber(String(form.mixStructure ?? "").split("+")[1], 0),
          eligibleRefs: Array.isArray(form.mixEligibleRefs)
            ? form.mixEligibleRefs.map(String)
            : [],
        },
      };
    case "Korting":
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Korting",
        subtitle: `${normalizeText(form.discountMode) || "Totaal"} korting`,
        lines: [`${normalizeText(form.discountValue) || "0"}% korting op verkoopprijs`],
        tone: tones[type],
        appliesTo: activePeriod as QuoteBlockContext,
        payload: {
          discountMode: normalizeText(form.discountMode || "Totaal"),
          discountPct: clampNumber(form.discountValue, 0),
          eligibleRefs: Array.isArray(form.kortingEligibleRefs)
            ? form.kortingEligibleRefs.map(String)
            : [],
        },
      };
    case "Transport": {
      const distance = clampNumber(form.transportDistanceKm, 0);
      const rate = clampNumber(form.transportRateEx, 0);
      const deliveries = Math.max(1, Math.floor(clampNumber(form.transportDeliveries, 1)));
      const thresholdKm = clampNumber(form.transportThresholdKm, 40);
      const amountEx = distance > thresholdKm ? distance * 2 * rate * deliveries : 0;
      const chargedToCustomer = Boolean(form.transportChargedToCustomer ?? false);
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Transport",
        subtitle: "Verzending vanaf brouwerij",
        lines: [
          `${distance} km enkele rit`,
          `${distance * 2} km retour`,
          `${deliveries} levering(en)`,
          `${euro(rate)} per km → ${euro(amountEx)}`,
          chargedToCustomer ? "Extern doorbelast" : "Intern (marge-impact)",
        ],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          distanceKm: distance,
          rateEx: rate,
          deliveries,
          thresholdKm,
          amountEx,
          chargedToCustomer,
        },
      };
    }
    case "Retour": {
      const pct = clampNumber(form.returnPct, 0);
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Retour / consignatie",
        subtitle: "Verwachte retouren",
        lines: [`${pct}% retour verwacht (v1: conservatieve impact)`],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          returnPct: pct,
        },
      };
    }
    case "Proeverij": {
      const costEx = clampNumber(form.tastingCostEx, 0);
      const isFree = Boolean(form.tastingIsFree ?? true);
      const priceEx = clampNumber(form.tastingPriceEx, 0);
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Proeverij",
        subtitle: "Extra service",
        lines: [
          normalizeText(form.tastingCondition) || "Voorwaarde: —",
          isFree ? "Gratis" : `Prijs: ${euro(priceEx)}`,
        ],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          costEx,
          priceEx,
          isFree,
          condition: normalizeText(form.tastingCondition),
        },
      };
    }
    case "Tapverhuur": {
      const costEx = clampNumber(form.tapCostEx, 0);
      const isFree = Boolean(form.tapIsFree ?? true);
      const priceEx = clampNumber(form.tapPriceEx, 0);
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Tapverhuur",
        subtitle: "Extra service",
        lines: [
          normalizeText(form.tapCondition) || "Voorwaarde: —",
          isFree ? "Gratis" : `Prijs: ${euro(priceEx)}`,
        ],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          costEx,
          priceEx,
          isFree,
          condition: normalizeText(form.tapCondition),
        },
      };
    }
  }
}
