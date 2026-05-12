import { buildProductFacts, type ProductFact } from "@/lib/productFacts";
import type { BreakEvenScenarioAdjustment } from "@/components/break-even/breakEvenUtils";
import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";

type GenericRecord = Record<string, unknown>;

export type RealizedSalesSkuRow = {
  sku_id: string;
  units: number;
  net_revenue_ex: number;
  first_date: string;
  last_date: string;
  cost_total_ex: number;
  fixed_total_ex: number;
  missing_cost_lines: number;
};

export type RealizedSalesBySkuPayload = {
  year: number;
  basis: "invoice" | "order";
  items: RealizedSalesSkuRow[];
  meta?: { missing_cost_lines?: number };
  unmapped?: {
    total_units?: number;
    total_net_revenue_ex?: number;
    items?: Array<{
      douano_product_id: number;
      product_name: string;
      product_sku: string;
      units: number;
      net_revenue_ex: number;
    }>;
  };
};

export type BreakEvenV2Row = {
  skuId: string;
  label: string;
  kind: "liter" | "unit";
  litersPerUnit: number;
  soldUnits: number;
  soldRevenueNetEx: number;
  soldLiters: number;
  mixPct: number;
  sellInEx: number;
  sellInPerLiter: number;
  costUnitEx: number;
  fixedAllocUnitEx: number;
  variableUnitEx: number;
  variablePerLiter: number;
  contributionPerLiter: number;
  contributionUnitEx: number;
  contributionTotalEx: number;
  warnings: string[];
};

export type BreakEvenV2Summary = {
  year: number;
  fixedCostsTotal: number;
  adjustedFixedCostsTotal: number;
  totalSoldLiters: number;
  totalSoldUnitsNonLiter: number;
  totalSoldRevenueNetEx: number;
  totalStrategyRevenueEx: number;
  totalContributionEx: number;
  marginOfSafetyEx: number;
  contributionMarginPct: number;
  breakEvenRevenueOverall: number;
  weightedSellInPerLiter: number;
  weightedVariableCostPerLiter: number;
  weightedContributionPerLiter: number;
  breakEvenLiters: number;
  breakEvenRevenue: number;
  warnings: string[];
};

function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function multiplyAdjustmentFactors(
  adjustments: BreakEvenScenarioAdjustment[],
  type: BreakEvenScenarioAdjustment["type"]
) {
  return adjustments
    .filter((adjustment) => adjustment.type === type)
    .reduce((factor, adjustment) => factor * (1 + adjustment.value / 100), 1);
}

function applyFixedCostAdjustments(baseValue: number, adjustments: BreakEvenScenarioAdjustment[]) {
  let current = baseValue;
  adjustments.forEach((adjustment) => {
    if (adjustment.type === "fixed_cost_eur") current += adjustment.value;
    if (adjustment.type === "fixed_cost_pct") current *= 1 + adjustment.value / 100;
  });
  return Math.max(0, current);
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(value) ? value : 0
  );
}

export function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function buildRealizedBreakEvenRows(params: {
  year: number;
  channelCode: string;
  sales: RealizedSalesBySkuPayload;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
}) {
  const factsIndex = buildProductFacts({
    year: params.year,
    channelCode: params.channelCode,
    onlyReady: false,
    channels: params.channels,
    bieren: params.bieren,
    kostprijsversies: params.kostprijsversies,
    kostprijsproductactiveringen: params.kostprijsproductactiveringen,
    verkoopprijzen: params.verkoopprijzen,
    skus: params.skus,
    articles: params.articles,
    basisproducten: params.basisproducten,
    samengesteldeProducten: params.samengesteldeProducten,
  });

  const factBySku = new Map<string, ProductFact>();
  factsIndex.facts.forEach((fact) => {
    if (fact.ref.startsWith("sku:")) {
      factBySku.set(fact.ref.slice(4), fact);
    }
  });

  const skuById = new Map<string, GenericRecord>();
  (Array.isArray(params.skus) ? params.skus : []).forEach((row) => {
    const id = String((row as any)?.id ?? "").trim();
    if (id) skuById.set(id, row);
  });

  const formatArticleById = new Map<string, GenericRecord>();
  (Array.isArray(params.articles) ? params.articles : []).forEach((row) => {
    const id = String((row as any)?.id ?? "").trim();
    if (!id) return;
    const kind = String((row as any)?.kind ?? "").trim().toLowerCase();
    if (kind !== "format") return;
    formatArticleById.set(id, row);
  });

  const sellInLookup = buildSellInLookup(params.verkoopprijzen, params.year);
  const channelDefaultOpslag = buildChannelDefaultOpslagMap(params.channels);

  const warnings: string[] = [];
  const rows: BreakEvenV2Row[] = [];

  const totalSoldLiters = (params.sales.items ?? []).reduce((sum, row) => {
    const skuId = String(row.sku_id ?? "").trim();
    if (!skuId) return sum;
    const fact = factBySku.get(skuId);
    const litersPerUnit = fact?.litersPerUnit ?? 0;
    if (litersPerUnit <= 0) return sum;
    return sum + toNumber(row.units, 0) * litersPerUnit;
  }, 0);

  const totalSoldUnitsNonLiter = (params.sales.items ?? []).reduce((sum, row) => {
    const skuId = String(row.sku_id ?? "").trim();
    if (!skuId) return sum;
    const fact = factBySku.get(skuId);
    const litersPerUnit = fact?.litersPerUnit ?? 0;
    if (litersPerUnit > 0) return sum;
    return sum + toNumber(row.units, 0);
  }, 0);

  (params.sales.items ?? []).forEach((salesRow) => {
    const skuId = String(salesRow.sku_id ?? "").trim();
    if (!skuId) return;
    const soldUnits = toNumber(salesRow.units, 0);
    const soldRevenueNetEx = toNumber(salesRow.net_revenue_ex, 0);
    const fact = factBySku.get(skuId) ?? null;
    const rowWarnings: string[] = [];

    const skuRow = skuById.get(skuId) ?? null;
    const skuKind = String((skuRow as any)?.kind ?? "").trim().toLowerCase();
    const bierId = String((skuRow as any)?.beer_id ?? "").trim();
    const productId =
      String((skuRow as any)?.format_article_id ?? "").trim() ||
      String((skuRow as any)?.article_id ?? "").trim();

    const fallbackLitersPerUnit =
      skuKind === "beer_format"
        ? toNumber((formatArticleById.get(productId) as any)?.content_liter, 0)
        : 0;

    const litersPerUnit = fact?.litersPerUnit ?? fallbackLitersPerUnit ?? 0;
    const kind: "liter" | "unit" = litersPerUnit > 0 ? "liter" : "unit";
    const soldLiters = litersPerUnit > 0 ? soldUnits * litersPerUnit : 0;

    const mixPct =
      kind === "liter"
        ? totalSoldLiters > 0
          ? (soldLiters / totalSoldLiters) * 100
          : 0
        : totalSoldUnitsNonLiter > 0
          ? (soldUnits / totalSoldUnitsNonLiter) * 100
          : 0;

    const costUnitEx = soldUnits > 0 ? toNumber(salesRow.cost_total_ex, 0) / soldUnits : 0;
    const fixedAllocUnitEx = soldUnits > 0 ? toNumber(salesRow.fixed_total_ex, 0) / soldUnits : 0;
    if (costUnitEx <= 0) rowWarnings.push("Kostprijs ontbreekt (of niet actief).");

    const variableUnitEx = Math.max(0, costUnitEx - fixedAllocUnitEx);

    let sellInEx = fact?.sellInEx ?? 0;
    if (sellInEx <= 0) {
      if (productId) {
        sellInEx = resolveSellInPriceEx({
          skuId,
          bierId,
          productId,
          costPriceEx: costUnitEx,
          channelCode: params.channelCode,
          lookup: sellInLookup,
          channelDefaultOpslag,
        }).sellInEx;
      }
    }
    if (sellInEx <= 0) rowWarnings.push("Sell-in (strategie) ontbreekt.");

    const sellInPerLiter = litersPerUnit > 0 ? sellInEx / litersPerUnit : 0;
    const variablePerLiter = litersPerUnit > 0 ? variableUnitEx / litersPerUnit : 0;
    const contributionPerLiter = litersPerUnit > 0 ? sellInPerLiter - variablePerLiter : 0;
    const contributionUnitEx = kind === "unit" ? sellInEx - variableUnitEx : 0;

    const contributionTotalEx =
      kind === "liter" ? contributionPerLiter * soldLiters : contributionUnitEx * soldUnits;

    const label =
      (fact?.label?.replace(" Â· ", " - ") ||
        String((skuRow as any)?.name ?? (skuRow as any)?.naam ?? "").trim()) ||
      `SKU ${skuId}`;

    fact?.warnings?.forEach((w) => rowWarnings.push(w));

    rows.push({
      skuId,
      label,
      kind,
      litersPerUnit,
      soldUnits,
      soldRevenueNetEx,
      soldLiters,
      mixPct,
      sellInEx,
      sellInPerLiter,
      costUnitEx,
      fixedAllocUnitEx,
      variableUnitEx,
      variablePerLiter,
      contributionPerLiter,
      contributionUnitEx,
      contributionTotalEx,
      warnings: rowWarnings,
    });
  });

  rows.sort((a, b) => b.contributionTotalEx - a.contributionTotalEx);

  if (rows.length === 0) warnings.push("Geen gerealiseerde verkopen gevonden (of alles is ongekoppeld).");

  return { rows, warnings, totalSoldLiters, totalSoldUnitsNonLiter };
}

export function applyScenarioToRealizedRows(params: {
  baseRows: BreakEvenV2Row[];
  adjustments: BreakEvenScenarioAdjustment[];
}) {
  const adjustments = Array.isArray(params.adjustments) ? params.adjustments : [];
  const priceMultiplier = multiplyAdjustmentFactors(adjustments, "price_pct");
  const variableCostMultiplier = multiplyAdjustmentFactors(adjustments, "variable_cost_pct");

  // Apply volume shifts (target_key is skuId) before re-normalising the mix.
  const volumeAdjustments = adjustments.filter((adj) => adj.type === "volume_mix_pct");
  const volumeBySku = new Map<string, number>();
  volumeAdjustments.forEach((adj) => {
    const key = String(adj.target_key ?? "").trim();
    if (!key) return;
    volumeBySku.set(key, (volumeBySku.get(key) ?? 0) * 0 + adj.value); // last write wins
  });

  const withVolumes = params.baseRows.map((row) => {
    const pct = volumeBySku.get(row.skuId);
    if (pct === undefined) return row;
    const factor = 1 + pct / 100;
    if (row.kind === "liter") {
      const nextSoldLiters = Math.max(0, row.soldLiters * factor);
      const nextSoldUnits = row.litersPerUnit > 0 ? nextSoldLiters / row.litersPerUnit : row.soldUnits;
      return { ...row, soldLiters: nextSoldLiters, soldUnits: nextSoldUnits };
    }
    return { ...row, soldUnits: Math.max(0, row.soldUnits * factor) };
  });

  const totalLiters = withVolumes.filter((r) => r.kind === "liter").reduce((sum, r) => sum + r.soldLiters, 0);
  const totalUnitsNonLiter = withVolumes.filter((r) => r.kind === "unit").reduce((sum, r) => sum + r.soldUnits, 0);

  const rows = withVolumes.map((row) => {
    const sellInEx = row.sellInEx * priceMultiplier;
    const variableUnitEx = row.variableUnitEx * variableCostMultiplier;
    const sellInPerLiter = row.litersPerUnit > 0 ? sellInEx / row.litersPerUnit : 0;
    const variablePerLiter = row.litersPerUnit > 0 ? variableUnitEx / row.litersPerUnit : 0;
    const contributionPerLiter = row.litersPerUnit > 0 ? sellInPerLiter - variablePerLiter : 0;
    const contributionUnitEx = row.kind === "unit" ? sellInEx - variableUnitEx : 0;

    const soldLiters = row.kind === "liter" ? row.soldLiters : 0;
    const contributionTotalEx =
      row.kind === "liter" ? contributionPerLiter * soldLiters : contributionUnitEx * row.soldUnits;

    const mixPct =
      row.kind === "liter"
        ? totalLiters > 0
          ? (soldLiters / totalLiters) * 100
          : 0
        : totalUnitsNonLiter > 0
          ? (row.soldUnits / totalUnitsNonLiter) * 100
          : 0;

    return {
      ...row,
      mixPct,
      sellInEx,
      sellInPerLiter,
      variableUnitEx,
      variablePerLiter,
      contributionPerLiter,
      contributionUnitEx,
      contributionTotalEx,
    };
  });

  return { rows, totalSoldLiters: totalLiters, totalSoldUnitsNonLiter: totalUnitsNonLiter };
}

export function calculateBreakEvenV2Summary(params: {
  year: number;
  fixedCostsTotal: number;
  fixedCostAdjustment: number;
  adjustments: BreakEvenScenarioAdjustment[];
  rows: BreakEvenV2Row[];
  totalSoldLiters: number;
}) : BreakEvenV2Summary {
  const warnings: string[] = [];

  const literRows = params.rows.filter((row) => row.kind === "liter" && row.soldLiters > 0);
  const totalSoldRevenueNetEx = params.rows.reduce((sum, row) => sum + row.soldRevenueNetEx, 0);
  const totalStrategyRevenueEx = params.rows.reduce(
    (sum, row) => sum + (row.sellInEx > 0 ? row.sellInEx * row.soldUnits : 0),
    0
  );
  const totalContributionEx = params.rows.reduce((sum, row) => sum + row.contributionTotalEx, 0);
  const fixedCostsTotal = params.fixedCostsTotal;
  const adjustedFixedCostsTotal = applyFixedCostAdjustments(
    Math.max(0, fixedCostsTotal + (params.fixedCostAdjustment || 0)),
    Array.isArray(params.adjustments) ? params.adjustments : []
  );
  const marginOfSafetyEx = totalContributionEx - adjustedFixedCostsTotal;
  const contributionMarginPct =
    totalStrategyRevenueEx > 0 ? (totalContributionEx / totalStrategyRevenueEx) * 100 : 0;
  const breakEvenRevenueOverall =
    contributionMarginPct > 0 ? adjustedFixedCostsTotal / (contributionMarginPct / 100) : 0;

  let weightedSellInPerLiter = 0;
  let weightedVariableCostPerLiter = 0;
  let weightedContributionPerLiter = 0;

  if (params.totalSoldLiters <= 0) {
    warnings.push("Geen liters verkocht (bier/formats) in dit jaar; break-even liters is niet berekenbaar.");
  } else {
    literRows.forEach((row) => {
      const weight = row.soldLiters / params.totalSoldLiters;
      weightedSellInPerLiter += weight * row.sellInPerLiter;
      weightedVariableCostPerLiter += weight * row.variablePerLiter;
      weightedContributionPerLiter += weight * row.contributionPerLiter;
    });
  }

  if (adjustedFixedCostsTotal <= 0) warnings.push("Geen vaste kosten gevonden voor dit jaar.");
  if (weightedContributionPerLiter <= 0 && params.totalSoldLiters > 0) warnings.push("Gewogen contributie/L is 0 of lager.");

  const breakEvenLiters =
    weightedContributionPerLiter > 0 ? adjustedFixedCostsTotal / weightedContributionPerLiter : 0;
  const breakEvenRevenue = breakEvenLiters * weightedSellInPerLiter;

  return {
    year: params.year,
    fixedCostsTotal,
    adjustedFixedCostsTotal,
    totalSoldLiters: params.totalSoldLiters,
    totalSoldUnitsNonLiter: params.rows
      .filter((row) => row.kind === "unit")
      .reduce((sum, row) => sum + row.soldUnits, 0),
    totalSoldRevenueNetEx,
    totalStrategyRevenueEx,
    totalContributionEx,
    marginOfSafetyEx,
    contributionMarginPct,
    breakEvenRevenueOverall,
    weightedSellInPerLiter,
    weightedVariableCostPerLiter,
    weightedContributionPerLiter,
    breakEvenLiters,
    breakEvenRevenue,
    warnings,
  };
}
