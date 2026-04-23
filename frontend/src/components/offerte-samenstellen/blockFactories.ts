import type { ReactNode } from "react";

import { clampNumber, euro, normalizeText } from "@/components/offerte-samenstellen/quoteUtils";
import type {
  BuilderBlock,
  OptionType,
  ProductOption,
  QuoteBlockContext,
  QuoteFormState,
} from "@/components/offerte-samenstellen/types";

type BuildBlockParams = {
  type: OptionType;
  form: QuoteFormState;
  activePeriod: "intro" | "standard";
  tones: Record<OptionType, string>;
  icons: Record<OptionType, ReactNode>;
  productOptions?: ProductOption[];
  baseOfferRefs?: string[];
  existingBlockId?: string | null;
};

function resolveProductLabels(productOptions: ProductOption[] | undefined, refs: string[]) {
  return refs
    .map((ref) => productOptions?.find((product) => product.optionId === ref)?.label ?? "")
    .filter(Boolean);
}

function buildIntroPromoLine(form: QuoteFormState) {
  if (form.introPromoType === "discount") {
    if (form.introDiscountMode === "all") {
      return `Korting: ${normalizeText(form.introDiscountPercent) || "-"}% voor alle geselecteerde producten`;
    }
    return "Korting per product";
  }

  if (form.introPromoType === "x_plus_y") {
    return `Actie: ${normalizeText(form.introXValue) || "-"} + ${normalizeText(form.introYValue) || "-"} (${form.introApplyMode === "single" ? "een product" : "combineren toegestaan"})`;
  }

  return `Drempelkorting: ${normalizeText(form.introThresholdValue) || "-"} ${form.introThresholdType} -> ${normalizeText(form.introThresholdDiscount) || "-"}% (${form.introThresholdApplyMode === "all" ? "alle producten" : "een product"})`;
}

export function buildBlockFromForm({
  type,
  form,
  activePeriod,
  tones,
  icons,
  productOptions,
  baseOfferRefs = [],
  existingBlockId,
}: BuildBlockParams): BuilderBlock {
  const blockId = existingBlockId ?? `${type.toLowerCase()}-${Date.now()}`;

  switch (type) {
    case "Intro": {
      const eligibleRefs = Array.isArray(form.introEligibleRefs)
        ? form.introEligibleRefs.map(String)
        : [];
      const productLabels = resolveProductLabels(productOptions, eligibleRefs);

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Introductieperiode",
        subtitle: `${normalizeText(form.introStart)} t/m ${normalizeText(form.introEnd)}`,
        lines: [
          `Producten: ${productLabels.length > 0 ? productLabels.join(", ") : "-"}`,
          buildIntroPromoLine(form),
          ...(normalizeText(form.introNote)
            ? [`Toelichting: ${normalizeText(form.introNote)}`]
            : []),
        ],
        tone: tones[type],
        impact:
          "Na introductie vallen prijs en voorwaarden automatisch terug op de standaardperiode.",
        appliesTo: "intro",
        payload: {
          start: normalizeText(form.introStart),
          end: normalizeText(form.introEnd),
          eligibleRefs,
          productLabels,
          promoType: form.introPromoType,
          discountMode: form.introDiscountMode,
          discountPercent: normalizeText(form.introDiscountPercent),
          discountsByProduct: { ...form.introDiscountsByProduct },
          xValue: normalizeText(form.introXValue),
          yValue: normalizeText(form.introYValue),
          applyMode: form.introApplyMode,
          singleProductRef: normalizeText(form.introSingleProductRef),
          thresholdType: form.introThresholdType,
          thresholdApplyMode: form.introThresholdApplyMode,
          thresholdSingleProductRef: normalizeText(form.introThresholdSingleProductRef),
          thresholdValue: normalizeText(form.introThresholdValue),
          thresholdDiscount: normalizeText(form.introThresholdDiscount),
          note: normalizeText(form.introNote),
        },
      };
    }

    case "Staffel": {
      const eligibleRefs = form.staffelUseBaseOfferProducts
        ? baseOfferRefs.map(String)
        : Array.isArray(form.staffelEligibleRefs)
          ? form.staffelEligibleRefs.map(String)
          : [];
      const productLabels = resolveProductLabels(productOptions, eligibleRefs);

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Staffel",
        subtitle: `${productLabels.length || 0} product${productLabels.length === 1 ? "" : "en"} in standaardperiode`,
        lines: Array.isArray(form.staffelRows)
          ? [
              `Producten: ${productLabels.length > 0 ? productLabels.join(", ") : "-"}`,
              `Logica: ${
                form.staffelDiscountMode === "percent"
                  ? `Volgende regel ${normalizeText(form.staffelDiscountValue) || "0"}% lager`
                  : form.staffelDiscountMode === "absolute"
                    ? `Volgende regel EUR ${normalizeText(form.staffelDiscountValue) || "0"} lager`
                    : "Vrij invullen"
              }`,
              ...form.staffelRows.map((row) => {
                const rangeLabel = normalizeText(row.to)
                  ? `${row.from} t/m ${row.to}`
                  : `Vanaf ${row.from}`;
                return rangeLabel;
              }),
            ]
          : [],
        tone: tones[type],
        appliesTo: "standard",
        payload: {
          useBaseOfferProducts: form.staffelUseBaseOfferProducts,
          eligibleRefs,
          productLabels,
          discountMode: form.staffelDiscountMode,
          discountValue: clampNumber(
            normalizeText(form.staffelDiscountValue).replace(",", "."),
            0
          ),
          tiers: Array.isArray(form.staffelRows)
            ? form.staffelRows
                .map((row) => {
                  const from = clampNumber(row?.from, 0);
                  const toRaw = normalizeText(row?.to ?? "");
                  const to = !toRaw || toRaw.toLowerCase() === "inf" ? null : clampNumber(toRaw, 0);
                  const rawPrice = normalizeText(row?.price ?? "");
                  const priceEx = rawPrice
                    ? clampNumber(rawPrice.replace(",", "."), 0)
                    : null;
                  return { from, to, priceEx };
                })
                .filter((tier) => Number.isFinite(tier.from))
            : [],
        },
      };
    }

    case "Mix":
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Mix deal",
        subtitle: "Assortimentsdeal",
        lines: [
          `Voorwaarde: ${normalizeText(form.mixCondition) || "-"}`,
          `Structuur: ${normalizeText(form.mixStructure) || "-"}`,
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

    case "Korting": {
      const eligibleRefs = form.kortingUseBaseOfferProducts
        ? baseOfferRefs.map(String)
        : Array.isArray(form.kortingEligibleRefs)
          ? form.kortingEligibleRefs.map(String)
          : [];

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Korting",
        subtitle: `${normalizeText(form.discountMode) || "Totaal"} korting`,
        lines: [
          `${normalizeText(form.discountValue) || "0"}% korting op verkoopprijs`,
          `Producten: ${
            eligibleRefs.length > 0
              ? resolveProductLabels(productOptions, eligibleRefs).join(", ")
              : "Alle producten in dit voorstel"
          }`,
        ],
        tone: tones[type],
        appliesTo: activePeriod as QuoteBlockContext,
        payload: {
          useBaseOfferProducts: form.kortingUseBaseOfferProducts,
          discountMode: normalizeText(form.discountMode || "Totaal"),
          discountPct: clampNumber(form.discountValue, 0),
          eligibleRefs,
        },
      };
    }

    case "Groothandel": {
      const eligibleRefs = form.wholesaleUseBaseOfferProducts
        ? baseOfferRefs.map(String)
        : Array.isArray(form.wholesaleEligibleRefs)
          ? form.wholesaleEligibleRefs.map(String)
          : [];
      const productLabels = resolveProductLabels(productOptions, eligibleRefs);
      const marginPct = clampNumber(form.wholesaleMarginPct, 0);

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Groothandel",
        subtitle: `${normalizeText(form.wholesaleMarginPct) || "0"}% kanaalmarge`,
        lines: [
          `Gewenste groothandelsmarge: ${normalizeText(form.wholesaleMarginPct) || "0"}%`,
          `Producten: ${productLabels.length > 0 ? productLabels.join(", ") : "Alle producten in dit voorstel"}`,
          "Verkoopprijs aan groothandel wordt teruggerekend vanaf de huidige horeca-sell-in prijs.",
        ],
        tone: tones[type],
        appliesTo: activePeriod as QuoteBlockContext,
        payload: {
          useBaseOfferProducts: form.wholesaleUseBaseOfferProducts,
          marginPct,
          eligibleRefs,
          productLabels,
        },
      };
    }

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
          `${euro(rate)} per km -> ${euro(amountEx)}`,
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
          normalizeText(form.tastingCondition) || "Voorwaarde: -",
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
          normalizeText(form.tapCondition) || "Voorwaarde: -",
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
