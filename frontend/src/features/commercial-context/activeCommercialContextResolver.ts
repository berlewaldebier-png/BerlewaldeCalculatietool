import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";
import { buildCentralSkuIndex, type CentralSkuRow } from "@/features/sku/centralSkuIndex";
import { buildActiveCommercialContextShadow } from "@/features/commercial-context/activeCommercialContextShadow";
import { selectPlanningCostCandidate } from "@/features/commercial-context/activeCommercialContextPlanning";
import {
  number,
  record,
  round,
  text,
} from "@/features/commercial-context/activeCommercialContextUtils";
import { calcAdviesprijsInclBtwRange } from "@/lib/pricingEngine";
import type {
  ActiveCommercialContext,
  ActiveCommercialContextInput,
  ActiveCommercialContextReader,
  ActiveCommercialSkuContext,
  AdvicePriceResolution,
  ContextWarning,
  GenericRecord,
  SellingPriceResolution,
} from "@/features/commercial-context/activeCommercialContextTypes";

export type {
  ActiveCommercialContext,
  ActiveCommercialContextInput,
  ActiveCommercialContextReader,
  ActiveCommercialSkuContext,
  AdvicePriceResolution,
  ConsumerDifference,
  ContextWarning,
  CostComponents,
  GenericRecord,
  PlanningCostResolution,
  SellingPriceResolution,
} from "@/features/commercial-context/activeCommercialContextTypes";

function boolean(value: unknown, fallback = true): boolean {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function vatRate(version: GenericRecord, fallback: number): number {
  const basis = record(version.basisgegevens);
  const raw = text(basis.btw_tarief ?? version.btw_pct).replace("%", "");
  return raw ? number(raw, fallback) : fallback;
}

function sourceYear(version: GenericRecord): number | null {
  const metadata = record(version.bron_metadata || version.source_metadata);
  const basis = record(version.basisgegevens);
  const value = number(
    version.source_year || metadata.source_year || metadata.bronjaar || basis.source_year,
    0
  );
  return value > 0 ? value : null;
}

function buildBreakEvenPlanContext(input: ActiveCommercialContextInput) {
  const candidates = (input.activeBreakEvenPlans ?? [])
    .filter(
      (row) =>
        number(row.jaar ?? row.year) === input.operationalYear &&
        text(row.status).toLowerCase() === "active"
    )
    .slice()
    .sort((left, right) => text(left.id).localeCompare(text(right.id)));
  const candidateIds = candidates.map((row) => text(row.id)).filter(Boolean);
  if (candidates.length === 0) {
    return {
      status: "missing" as const,
      planId: "",
      generationId: "",
      source: "",
      candidateIds,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous" as const,
      planId: "",
      generationId: "",
      source: "",
      candidateIds,
    };
  }
  const selected = candidates[0];
  const payload = record(selected.payload);
  return {
    status: "resolved" as const,
    planId: text(selected.id),
    generationId: text(selected.generation_id || payload.generation_id),
    source: text(selected.source),
    candidateIds,
  };
}

function contextWarning(
  code: string,
  message: string,
  options: Omit<ContextWarning, "code" | "message"> = {}
): ContextWarning {
  return { code, message, ...options };
}

function inferPricingMethod(
  sku: GenericRecord,
  article: GenericRecord,
  central: CentralSkuRow | undefined
): "cost_plus" | "manual_rate" {
  if (central?.pricingMethod === "manual_rate") return "manual_rate";
  const skuPayload = record(sku.payload);
  const articlePayload = record(article.payload);
  const explicit = text(
    sku.pricing_method ||
      skuPayload.pricing_method ||
      article.pricing_method ||
      articlePayload.pricing_method
  ).toLowerCase();
  if (["manual", "manual_rate", "rate"].includes(explicit)) return "manual_rate";
  const subtype = text(
    sku.sellable_subtype ||
      skuPayload.sellable_subtype ||
      article.sellable_subtype ||
      articlePayload.sellable_subtype
  ).toLowerCase();
  return subtype === "dienst" || subtype === "service" ? "manual_rate" : "cost_plus";
}

function manualRate(
  sku: GenericRecord,
  article: GenericRecord,
  central: CentralSkuRow | undefined
) {
  if (central?.manualRateEx) return central.manualRateEx;
  const skuPayload = record(sku.payload);
  const articlePayload = record(article.payload);
  return number(
    sku.manual_rate_ex ||
      skuPayload.manual_rate_ex ||
      article.manual_rate_ex ||
      articlePayload.manual_rate_ex
  );
}

function activeChannelRows(rows: GenericRecord[]) {
  return rows
    .filter((row) => boolean(row.actief ?? row.active, true))
    .map((row) => ({
      row,
      code: text(row.code || row.id).toLowerCase(),
    }))
    .filter((row) => row.code)
    .sort((left, right) => left.code.localeCompare(right.code));
}

function warningMessage(code: string): string {
  const messages: Record<string, string> = {
    planning_activation_missing: "Geen planningactivatie voor deze SKU en dit jaar.",
    planning_cost_version_missing: "De planningactivatie verwijst naar een onbekende kostprijsversie.",
    canonical_cost_row_missing: "De kostprijsversie bevat geen canonieke kostprijsregel voor deze SKU.",
    planning_cost_non_positive: "De geplande kostprijs is nul of negatief.",
    planning_anchor_history_unproven: "De beschikbare activatiehistorie bewijst het eerste planningsanker nog niet.",
    sell_in_missing: "De sell-in prijs kan niet positief worden opgelost.",
    sell_in_year_fallback: "De sell-in prijs gebruikt een eerder jaar als terugval.",
    advice_price_missing: "Voor dit kanaal ontbreekt een adviesprijsopslag.",
    manual_rate_missing: "Voor deze dienst ontbreekt een positief handmatig tarief.",
  };
  return messages[code] ?? code;
}

export function resolveActiveCommercialContext(
  input: ActiveCommercialContextInput
): ActiveCommercialContext {
  if (!Number.isInteger(input.operationalYear) || input.operationalYear <= 0) {
    throw new Error("operationalYear must be an explicit positive integer");
  }

  const versionsById = new Map(
    input.costVersions
      .map((row) => [text(row.id), row] as const)
      .filter(([id]) => Boolean(id))
  );
  const articlesById = new Map(
    input.articles
      .map((row) => [text(row.id), row] as const)
      .filter(([id]) => Boolean(id))
  );
  const central = buildCentralSkuIndex({
    year: input.operationalYear,
    channels: input.channels,
    verkoopprijzen: input.sellingPrices,
    skus: input.skus,
    articles: input.articles,
    packagingComponentPrices: input.packagingComponentPrices ?? [],
    kostprijsversies: input.costVersions,
    kostprijsproductactiveringen: input.activations,
    includeDraftCostPlus: true,
  });
  const sellInLookup = buildSellInLookup(
    input.sellingPrices,
    input.operationalYear
  );
  const channelDefaults = buildChannelDefaultOpslagMap(input.channels);
  const channels = activeChannelRows(input.channels);
  const adviceByChannel = new Map(
    input.advicePrices
      .filter((row) => number(row.jaar) === input.operationalYear)
      .map((row) => [text(row.channel_code || row.code).toLowerCase(), row] as const)
      .filter(([code]) => Boolean(code))
  );
  const skus: ActiveCommercialSkuContext[] = [];
  const completenessWarnings: ContextWarning[] = [
    contextWarning(
      "active_yearset_authority_not_established",
      "Het operationele jaar is expliciet aangeleverd; een actieve jaarsetautoriteit volgt pas in RF-013A."
    ),
  ];
  const knownSkuIds = new Set(input.skus.map((row) => text(row.id)).filter(Boolean));
  const unknownActivationIds = input.activations
    .filter(
      (row) =>
        number(row.jaar) === input.operationalYear &&
        text(row.sku_id) &&
        !knownSkuIds.has(text(row.sku_id))
    )
    .map((row) => text(row.id))
    .filter(Boolean)
    .sort();
  if (unknownActivationIds.length > 0) {
    completenessWarnings.push(
      contextWarning(
        "activation_unknown_sku",
        "Een of meer activaties verwijzen naar een onbekende SKU.",
        { sourceIds: unknownActivationIds }
      )
    );
  }

  for (const sku of input.skus
    .filter((row) => text(row.id) && boolean(row.active ?? row.actief, true))
    .slice()
    .sort((left, right) => text(left.id).localeCompare(text(right.id)))) {
    const skuId = text(sku.id);
    const centralRow = central.bySkuId.get(skuId);
    const beerId = text(sku.beer_id || sku.bier_id);
    const productId = text(sku.format_article_id || sku.article_id);
    const article = articlesById.get(productId) ?? {};
    const pricingMethod = inferPricingMethod(sku, article, centralRow);
    const planningCost = selectPlanningCostCandidate({
      skuId,
      year: input.operationalYear,
      pricingMethod,
      productId,
      activations: input.activations,
      activationEvents: input.activationEvents ?? [],
      versionsById,
      packagingComponentPrices: input.packagingComponentPrices ?? [],
    });
    const manualRateEx = manualRate(sku, article, centralRow);
    const costVersion = planningCost.costVersionId
      ? versionsById.get(planningCost.costVersionId) ?? {}
      : {};
    const resolvedVatRate = vatRate(costVersion, centralRow?.btwPct ?? 0);
    const itemWarnings = [...planningCost.warnings];
    const sellingPrices: SellingPriceResolution[] = channels.map(({ code }) => {
      if (pricingMethod === "manual_rate") {
        const resolved = manualRateEx > 0;
        if (!resolved) itemWarnings.push("manual_rate_missing");
        return {
          channelCode: code,
          status: resolved ? ("resolved" as const) : ("missing" as const),
          sellInEx: resolved ? round(manualRateEx) : null,
          marginPct: null,
          resolvedYear: input.operationalYear,
          source: resolved ? ("manual_rate" as const) : ("unresolved" as const),
          sourceRecordId: text(sku.id),
          sourceScope: resolved ? ("manual_rate" as const) : ("unresolved" as const),
          sourceKey: "manual_rate_ex",
          warnings: resolved ? [] : ["manual_rate_missing"],
        };
      }
      if (planningCost.status !== "resolved" || planningCost.costPriceEx === null) {
        return {
          channelCode: code,
          status: "missing" as const,
          sellInEx: null,
          marginPct: null,
          resolvedYear: input.operationalYear,
          source: "unresolved" as const,
          sourceRecordId: "",
          sourceScope: "unresolved" as const,
          sourceKey: "",
          warnings: ["sell_in_missing"],
        };
      }
      const resolved = resolveSellInPriceEx({
        skuId,
        bierId: beerId,
        productId,
        costPriceEx: planningCost.costPriceEx,
        channelCode: code,
        lookup: sellInLookup,
        channelDefaultOpslag: channelDefaults,
      });
      const warnings: string[] = [];
      if (resolved.sellInEx <= 0) warnings.push("sell_in_missing");
      if (resolved.resolvedYear !== input.operationalYear) {
        warnings.push("sell_in_year_fallback");
      }
      itemWarnings.push(...warnings);
      return {
        channelCode: code,
        status: resolved.sellInEx > 0 ? ("resolved" as const) : ("missing" as const),
        sellInEx: resolved.sellInEx > 0 ? round(resolved.sellInEx) : null,
        marginPct: round(resolved.opslagPct),
        resolvedYear: resolved.resolvedYear,
        source: resolved.source,
        sourceRecordId: resolved.sourceRecordId,
        sourceScope: resolved.sourceScope,
        sourceKey: resolved.sourceKey,
        warnings,
      };
    });

    const advicePrices: AdvicePriceResolution[] = channels.map(({ code }) => {
      if (pricingMethod === "manual_rate") {
        return {
          channelCode: code,
          status: "not_applicable" as const,
          sourceRecordId: "",
          markupPct: null,
          priceInclVat: null,
          minimumInclVat: null,
          maximumInclVat: null,
          customerMarginPct: null,
          warnings: [],
        };
      }
      const adviceRow = adviceByChannel.get(code);
      const sellIn = sellingPrices.find((row) => row.channelCode === code);
      if (!adviceRow || sellIn?.sellInEx === null || sellIn?.sellInEx === undefined) {
        itemWarnings.push("advice_price_missing");
        return {
          channelCode: code,
          status: "missing" as const,
          sourceRecordId: text(adviceRow?.id),
          markupPct: adviceRow ? round(number(adviceRow.opslag_pct || adviceRow.opslag)) : null,
          priceInclVat: null,
          minimumInclVat: null,
          maximumInclVat: null,
          customerMarginPct: null,
          warnings: ["advice_price_missing"],
        };
      }
      const markupPct = number(adviceRow.opslag_pct || adviceRow.opslag);
      const advice = calcAdviesprijsInclBtwRange({
        kostprijsEx: planningCost.costPriceEx ?? 0,
        sellInEx: sellIn.sellInEx,
        adviesOpslagPct: markupPct,
        btwPct: resolvedVatRate,
      });
      return {
        channelCode: code,
        status: "resolved" as const,
        sourceRecordId: text(adviceRow.id),
        markupPct: round(markupPct),
        priceInclVat: round(advice.inclRounded),
        minimumInclVat: round(advice.min),
        maximumInclVat: round(advice.max),
        customerMarginPct: round(advice.margeKlantPct),
        warnings: [],
      };
    });

    const uniqueWarnings = Array.from(new Set(itemWarnings)).sort();
    uniqueWarnings.forEach((code) => {
      completenessWarnings.push(
        contextWarning(code, warningMessage(code), { skuId })
      );
    });
    const hasResolvedSelling =
      channels.length > 0 && sellingPrices.every((row) => row.status === "resolved");
    const hasPlanningCost =
      planningCost.status === "resolved" || planningCost.status === "not_required";
    const litersPerUnit = centralRow?.contentLiter ?? number(article.content_liter);
    const isArticle = text(sku.kind).toLowerCase() === "article";
    const quoteReady = hasPlanningCost && hasResolvedSelling;
    skus.push({
      skuId,
      beerId,
      productId,
      skuKind: text(sku.kind),
      costMethod:
        pricingMethod === "manual_rate"
          ? "manual_rate"
          : planningCost.source === "packaging_component_price"
            ? "packaging_component"
            : text(costVersion.type) || centralRow?.costOrigin || "unknown",
      versionProvenance: {
        calculationType: text(costVersion.type),
        sourceType: text(
          costVersion.source_type ||
            record(costVersion.bron_metadata || costVersion.source_metadata).source_type
        ),
        sourceYear: sourceYear(costVersion),
      },
      pricingMethod,
      litersPerUnit: round(litersPerUnit),
      vatRatePct: round(resolvedVatRate),
      planningCost,
      sellingPrices,
      advicePrices,
      readiness: {
        quote: quoteReady,
        breakEven:
          pricingMethod === "cost_plus" &&
          quoteReady &&
          (isArticle || litersPerUnit > 0) &&
          sellingPrices.some(
            (row) => row.channelCode === "horeca" && row.status === "resolved"
          ),
        advice:
          pricingMethod === "cost_plus" &&
          advicePrices.length > 0 &&
          advicePrices.every((row) => row.status === "resolved"),
      },
      warnings: uniqueWarnings,
    });
  }

  const breakEvenPlan = buildBreakEvenPlanContext(input);
  if (breakEvenPlan.status === "missing") {
    completenessWarnings.push(
      contextWarning(
        "break_even_plan_missing",
        "Voor het operationele jaar ontbreekt een actief break-evenplan."
      )
    );
  } else if (breakEvenPlan.status === "ambiguous") {
    completenessWarnings.push(
      contextWarning(
        "break_even_plan_ambiguous",
        "Voor het operationele jaar zijn meerdere actieve break-evenplannen gevonden.",
        { sourceIds: breakEvenPlan.candidateIds }
      )
    );
  }

  return {
    resolverVersion: "rf-011a-v1",
    operationalContext: {
      year: input.operationalYear,
      status: "candidate",
      authority: "explicit_parameter",
      activeYearsetAuthorityEstablished: false,
    },
    skus,
    breakEvenPlan,
    completenessWarnings,
    shadowComparison: buildActiveCommercialContextShadow(input, skus),
  };
}

export async function readActiveCommercialContext(
  operationalYear: number,
  reader: ActiveCommercialContextReader
): Promise<ActiveCommercialContext> {
  const snapshot = await reader.readSnapshot(operationalYear);
  return resolveActiveCommercialContext({ operationalYear, ...snapshot });
}
