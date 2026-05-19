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
      const scopeAllProducts = Boolean(form.introScopeAllProducts ?? true);
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
          scopeAllProducts,
          eligibleRefs: scopeAllProducts ? [] : eligibleRefs,
          productLabels,
          contractDurationMonths: normalizeText(form.introContractDurationMonths),
          contractEndDate: normalizeText(form.introContractEndDate),
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
      const scopeAllProducts = Boolean(form.staffelScopeAllProducts ?? true);
      const eligibleRefs = scopeAllProducts
        ? []
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
          scopeAllProducts,
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
      const scopeAllProducts = Boolean(form.kortingScopeAllProducts ?? true);
      const eligibleRefs = scopeAllProducts
        ? []
        : Array.isArray(form.kortingEligibleRefs)
          ? form.kortingEligibleRefs.map(String)
          : [];
      const discountMode = scopeAllProducts ? "Totaal" : "Regel";

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Korting",
        subtitle: `${discountMode} korting`,
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
          scopeAllProducts,
          discountMode,
          discountPct: clampNumber(form.discountValue, 0),
          eligibleRefs,
        },
      };
    }

    case "Groothandel": {
      const scopeAllProducts = Boolean(form.wholesaleScopeAllProducts ?? true);
      const eligibleRefs = scopeAllProducts
        ? []
        : Array.isArray(form.wholesaleEligibleRefs)
          ? form.wholesaleEligibleRefs.map(String)
          : [];
      const productLabels = resolveProductLabels(productOptions, eligibleRefs);
      const marginPct = clampNumber(form.wholesaleMarginPct, 0);
      const sameMarginAllProducts = Boolean(form.wholesaleSameMarginAllProducts ?? true);

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
          scopeAllProducts,
          marginPct,
          eligibleRefs,
          productLabels,
          sameMarginAllProducts,
          marginsByRef: { ...(form.wholesaleMarginsByRef ?? {}) },
        },
      };
    }

    case "Transport": {
      const thresholdValue = clampNumber(form.transportFreeShippingThresholdValue, 0);
      const thresholdUnit = String(form.transportFreeShippingThresholdUnit ?? "pallets");
      const transportCostEx = clampNumber(form.transportCostEx, 0);
      const transportCostType = String(form.transportCostType ?? "fixed");
      const distanceKm = clampNumber(form.transportDistanceKm, 0);
      const ratePerKmEx = clampNumber(form.transportRateEx, 0.45);
      const includeInMargin = Boolean(form.transportIncludeInMargin ?? true);
      const chargedToCustomer = Boolean(form.transportChargedToCustomer ?? true);

      const freeLabel =
        thresholdUnit === "km"
          ? `Gratis tot: ${thresholdValue} km (enkele reis)`
          : `Gratis vanaf: ${thresholdValue} ${thresholdUnit}`;

      const roundTripKm = Math.max(0, distanceKm) * 2;
      const internalLabel = `Intern: ${roundTripKm} km × ${euro(ratePerKmEx)} /km`;

      const costLabel =
        transportCostType === "fixed" || transportCostType === "manual"
          ? `Transportkosten: ${euro(transportCostEx)} (${transportCostType})`
          : null;

      const modeLabel = chargedToCustomer
        ? "Doorbelast aan klant (als niet gratis)"
        : "Niet doorbelast (intern)";

      const marginLabel = includeInMargin
        ? "Meenemen in netto effect & break-even"
        : "Niet meenemen in netto effect & break-even";
      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Transport",
        subtitle: "Verzending vanaf brouwerij",
        lines: [freeLabel, ...(costLabel ? [costLabel] : []), internalLabel, modeLabel, marginLabel],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          freeShippingThresholdValue: thresholdValue,
          freeShippingThresholdUnit: thresholdUnit,
          transportCostType,
          transportCostEx,
          distanceKm,
          ratePerKmEx,
          includeInMargin,
          chargedToCustomer,
        },
      };
    }

    case "Palletopbouw": {
      // Defaults must be stable and non-zero so rounding & cost calculations keep working,
      // even when older drafts have missing form fields.
      const doosUnitsPerLayer = clampNumber(form.palletDoosUnitsPerLayer, 12);
      const doosUnitsPerPallet = clampNumber(form.palletDoosUnitsPerPallet, 72);
      const fustUnitsPerLayer = clampNumber(form.palletFustUnitsPerLayer, 20);
      const fustUnitsPerPallet = clampNumber(form.palletFustUnitsPerPallet, 40);
      const doosCostPerPallet = clampNumber(form.palletDoosCostPerPallet, 15);
      const doosPickCostPerExtraSku = clampNumber(form.palletDoosPickCostPerExtraSku, 5);
      const fustCostPerPallet = clampNumber(form.palletFustCostPerPallet, 15);
      const fustPickCostPerExtraSku = clampNumber(form.palletFustPickCostPerExtraSku, 5);
      const chargedToCustomer = Boolean(form.palletChargedToCustomer ?? true);

      return {
        id: blockId,
        type,
        icon: icons[type],
        title: "Palletopbouw",
        subtitle: "Defaults voor afronden",
        lines: [
          `Doos: ${doosUnitsPerLayer} per laag, ${doosUnitsPerPallet} per pallet`,
          `Fust: ${fustUnitsPerLayer} per laag, ${fustUnitsPerPallet} per pallet`,
          `Kosten: €${doosCostPerPallet}/pallet (doos), €${fustCostPerPallet}/pallet (fust)`,
        ],
        tone: tones[type],
        appliesTo: "global",
        payload: {
          doosUnitsPerLayer,
          doosUnitsPerPallet,
          fustUnitsPerLayer,
          fustUnitsPerPallet,
          doosCostPerPallet,
          doosPickCostPerExtraSku,
          fustCostPerPallet,
          fustPickCostPerExtraSku,
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
