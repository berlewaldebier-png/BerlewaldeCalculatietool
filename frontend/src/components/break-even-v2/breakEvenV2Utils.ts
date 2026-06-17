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
  inkoop_total_ex?: number;
  packaging_total_ex?: number;
  excise_total_ex?: number;
  cost_total_ex: number;
  fixed_total_ex: number;
  missing_cost_lines: number;
};

export type RealizedSalesPeriodRow = {
  period: string;
  sku_id: string;
  units: number;
  net_revenue_ex: number;
  inkoop_total_ex?: number;
  packaging_total_ex?: number;
  excise_total_ex?: number;
  cost_total_ex: number;
  fixed_total_ex: number;
  missing_cost_lines: number;
};

export type RealizedSalesBySkuPayload = {
  year: number;
  basis: "invoice" | "order";
  items: RealizedSalesSkuRow[];
  periods?: RealizedSalesPeriodRow[];
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
      example_ref?: string;
      example_date?: string;
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
  inkoopUnitEx: number;
  packagingUnitEx: number;
  exciseUnitEx: number;
  fixedAllocUnitEx: number;
  variableUnitEx: number;
  actualContributionUnitEx: number;
  variablePerLiter: number;
  contributionPerLiter: number;
  contributionUnitEx: number;
  actualContributionTotalEx: number;
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
  strategyRevenueDeltaEx: number;
  totalInkoopEx: number;
  totalPackagingEx: number;
  totalExciseEx: number;
  totalVariableCostEx: number;
  totalIntegralCostEx: number;
  totalAllocatedFixedEx: number;
  totalContributionEx: number;
  totalStrategyContributionEx: number;
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

export type BreakEvenTimelinePoint = {
  period: string;
  label: string;
  contribution: number;
  cumulativeContribution: number;
  breakEvenPoint: number;
};

export type BreakEvenFixedCostBucket = {
  key: string;
  label: string;
  amount: number;
  pct: number;
};

export type BreakEvenWaterfallStep = {
  key: string;
  label: string;
  value: number;
  start: number;
  end: number;
  kind: "positive" | "negative" | "result";
};

export type BreakEvenSimulatorInput = {
  pricePct: number;
  volumePct: number;
  fixedCostPct: number;
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

    const inkoopUnitEx = soldUnits > 0 ? toNumber(salesRow.inkoop_total_ex, 0) / soldUnits : 0;
    const packagingUnitEx = soldUnits > 0 ? toNumber(salesRow.packaging_total_ex, 0) / soldUnits : 0;
    const exciseUnitEx = soldUnits > 0 ? toNumber(salesRow.excise_total_ex, 0) / soldUnits : 0;
    const costUnitEx = soldUnits > 0 ? toNumber(salesRow.cost_total_ex, 0) / soldUnits : 0;
    const fixedAllocUnitEx = soldUnits > 0 ? toNumber(salesRow.fixed_total_ex, 0) / soldUnits : 0;
    if (costUnitEx <= 0) rowWarnings.push("Kostprijs ontbreekt (of niet actief).");

    const explicitVariableUnitEx = inkoopUnitEx + packagingUnitEx + exciseUnitEx;
    const variableUnitEx = explicitVariableUnitEx > 0 ? explicitVariableUnitEx : Math.max(0, costUnitEx - fixedAllocUnitEx);
    const actualRevenueUnitEx = soldUnits > 0 ? soldRevenueNetEx / soldUnits : 0;

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
    const actualContributionUnitEx = actualRevenueUnitEx - variableUnitEx;

    const contributionTotalEx =
      kind === "liter" ? contributionPerLiter * soldLiters : contributionUnitEx * soldUnits;
    const actualContributionTotalEx = soldRevenueNetEx - variableUnitEx * soldUnits;

    const label =
      (fact?.label?.replace(" · ", " - ") ||
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
      inkoopUnitEx,
      packagingUnitEx,
      exciseUnitEx,
      fixedAllocUnitEx,
      variableUnitEx,
      actualContributionUnitEx,
      variablePerLiter,
      contributionPerLiter,
      contributionUnitEx,
      actualContributionTotalEx,
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
      return { ...row, soldLiters: nextSoldLiters, soldUnits: nextSoldUnits, soldRevenueNetEx: row.soldRevenueNetEx * factor };
    }
    return { ...row, soldUnits: Math.max(0, row.soldUnits * factor), soldRevenueNetEx: row.soldRevenueNetEx * factor };
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
    const soldRevenueNetEx = row.soldRevenueNetEx * priceMultiplier;
    const actualRevenueUnitEx = row.soldUnits > 0 ? soldRevenueNetEx / row.soldUnits : 0;
    const actualContributionUnitEx = actualRevenueUnitEx - variableUnitEx;

    const soldLiters = row.kind === "liter" ? row.soldLiters : 0;
    const contributionTotalEx =
      row.kind === "liter" ? contributionPerLiter * soldLiters : contributionUnitEx * row.soldUnits;
    const actualContributionTotalEx = soldRevenueNetEx - variableUnitEx * row.soldUnits;

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
      soldRevenueNetEx,
      sellInEx,
      sellInPerLiter,
      variableUnitEx,
      actualContributionUnitEx,
      variablePerLiter,
      contributionPerLiter,
      contributionUnitEx,
      actualContributionTotalEx,
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
  const totalInkoopEx = params.rows.reduce((sum, row) => sum + row.inkoopUnitEx * row.soldUnits, 0);
  const totalPackagingEx = params.rows.reduce((sum, row) => sum + row.packagingUnitEx * row.soldUnits, 0);
  const totalExciseEx = params.rows.reduce((sum, row) => sum + row.exciseUnitEx * row.soldUnits, 0);
  const totalVariableCostEx = params.rows.reduce((sum, row) => sum + row.variableUnitEx * row.soldUnits, 0);
  const totalIntegralCostEx = params.rows.reduce((sum, row) => sum + row.costUnitEx * row.soldUnits, 0);
  const totalAllocatedFixedEx = params.rows.reduce((sum, row) => sum + row.fixedAllocUnitEx * row.soldUnits, 0);
  const totalContributionEx = params.rows.reduce((sum, row) => sum + row.actualContributionTotalEx, 0);
  const totalStrategyContributionEx = params.rows.reduce((sum, row) => sum + row.contributionTotalEx, 0);
  const fixedCostsTotal = params.fixedCostsTotal;
  const adjustedFixedCostsTotal = applyFixedCostAdjustments(
    Math.max(0, fixedCostsTotal + (params.fixedCostAdjustment || 0)),
    Array.isArray(params.adjustments) ? params.adjustments : []
  );
  const marginOfSafetyEx = totalContributionEx - adjustedFixedCostsTotal;
  const contributionMarginPct =
    totalSoldRevenueNetEx > 0 ? (totalContributionEx / totalSoldRevenueNetEx) * 100 : 0;
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
    strategyRevenueDeltaEx: totalStrategyRevenueEx - totalSoldRevenueNetEx,
    totalInkoopEx,
    totalPackagingEx,
    totalExciseEx,
    totalVariableCostEx,
    totalIntegralCostEx,
    totalAllocatedFixedEx,
    totalContributionEx,
    totalStrategyContributionEx,
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

export function buildContributionTimeline(params: {
  sales: RealizedSalesBySkuPayload | null;
  rows: BreakEvenV2Row[];
  summary: BreakEvenV2Summary;
}) {
  const periods = Array.isArray(params.sales?.periods) ? params.sales?.periods ?? [] : [];
  const bySku = new Map(params.rows.map((row) => [row.skuId, row]));
  const byPeriod = new Map<string, number>();

  periods.forEach((periodRow) => {
    const skuId = String(periodRow.sku_id ?? "").trim();
    const row = bySku.get(skuId);
    if (!row) return;
    const units = toNumber(periodRow.units, 0);
    const explicitVariable =
      toNumber(periodRow.inkoop_total_ex, 0) +
      toNumber(periodRow.packaging_total_ex, 0) +
      toNumber(periodRow.excise_total_ex, 0);
    const costUnitEx = units > 0 ? toNumber(periodRow.cost_total_ex, 0) / units : row.costUnitEx;
    const fixedAllocUnitEx = units > 0 ? toNumber(periodRow.fixed_total_ex, 0) / units : row.fixedAllocUnitEx;
    const variableCostEx = explicitVariable > 0 ? explicitVariable : Math.max(0, costUnitEx - fixedAllocUnitEx) * units;
    const contribution = toNumber(periodRow.net_revenue_ex, 0) - variableCostEx;
    const period = String(periodRow.period ?? "").trim();
    if (!period) return;
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + contribution);
  });

  let cumulative = 0;
  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, contribution]) => {
      cumulative += contribution;
      return {
        period,
        label: formatMonthLabel(period),
        contribution,
        cumulativeContribution: cumulative,
        breakEvenPoint: params.summary.adjustedFixedCostsTotal,
      } satisfies BreakEvenTimelinePoint;
    });
}

export function estimateBreakEvenMoment(points: BreakEvenTimelinePoint[]) {
  const hit = points.find((point) => point.cumulativeContribution >= point.breakEvenPoint);
  if (!hit) return null;
  return hit.period;
}

export function formatMonthLabel(period: string) {
  const month = Number(String(period).slice(5, 7));
  const labels = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  return labels[Math.max(0, Math.min(11, month - 1))] ?? period;
}

export function formatBreakEvenMoment(period: string | null) {
  if (!period) return "Nog niet bereikt";
  const month = Number(String(period).slice(5, 7));
  const year = String(period).slice(0, 4);
  const labels = [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
  ];
  return `${labels[Math.max(0, Math.min(11, month - 1))] ?? period} ${year}`;
}

export function buildFixedCostBuckets(vasteKosten: Record<string, unknown>, year: number, total: number) {
  const rows = Array.isArray(vasteKosten[String(year)]) ? (vasteKosten[String(year)] as GenericRecord[]) : [];
  const buckets = new Map<string, { label: string; amount: number }>();
  rows.forEach((row) => {
    const label =
      String((row as any).cost_pool ?? "").trim() ||
      String((row as any).omschrijving ?? "").trim() ||
      "Overig";
    const key = label.toLowerCase();
    const current = buckets.get(key) ?? { label, amount: 0 };
    current.amount += toNumber((row as any).bedrag_per_jaar, 0);
    buckets.set(key, current);
  });
  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      amount: bucket.amount,
      pct: total > 0 ? (bucket.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount) satisfies BreakEvenFixedCostBucket[];
}

export function buildWaterfallSteps(row: BreakEvenV2Row | null) {
  if (!row) return [];
  const sellIn = Math.max(0, row.sellInEx);
  const actualRevenue = row.soldUnits > 0 ? row.soldRevenueNetEx / row.soldUnits : 0;
  const priceDelta = actualRevenue - sellIn;
  const inkoop = Math.max(0, row.inkoopUnitEx);
  const packaging = Math.max(0, row.packagingUnitEx);
  const excise = Math.max(0, row.exciseUnitEx);
  const contribution = row.actualContributionUnitEx;
  const steps: BreakEvenWaterfallStep[] = [];
  let cursor = 0;

  function add(key: string, label: string, value: number, kind: BreakEvenWaterfallStep["kind"]) {
    const start = cursor;
    const end = kind === "negative" ? cursor - value : kind === "result" ? value : cursor + value;
    steps.push({ key, label, value, start, end, kind });
    cursor = end;
  }

  add("sell-in", "Verkoopprijs (sell-in)", sellIn, "positive");
  if (priceDelta < 0) {
    add("discount", "Prijs-/kortingseffect", Math.abs(priceDelta), "negative");
  } else if (priceDelta > 0) {
    add("price-upside", "Prijs-/kortingseffect", priceDelta, "positive");
  }
  add("inkoop", "Inkoop", inkoop, "negative");
  add("packaging", "Verpakking / variabel", packaging, "negative");
  add("excise", "Accijns", excise, "negative");
  steps.push({
    key: "contribution",
    label: "Contributie p/e voor overhead",
    value: contribution,
    start: 0,
    end: contribution,
    kind: "result",
  });
  return steps;
}

export function applySimulator(params: {
  rows: BreakEvenV2Row[];
  summary: BreakEvenV2Summary;
  input: BreakEvenSimulatorInput;
}) {
  const priceFactor = 1 + params.input.pricePct / 100;
  const volumeFactor = 1 + params.input.volumePct / 100;
  const fixedFactor = 1 + params.input.fixedCostPct / 100;
  const rows = params.rows.map((row) => {
    const sellInEx = row.sellInEx * priceFactor;
    const contributionUnit = Math.max(0, sellInEx - row.variableUnitEx);
    const soldUnits = row.soldUnits * volumeFactor;
    const soldLiters = row.soldLiters * volumeFactor;
    const soldRevenueNetEx = row.soldRevenueNetEx * priceFactor * volumeFactor;
    const actualRevenueUnitEx = soldUnits > 0 ? soldRevenueNetEx / soldUnits : 0;
    const actualContributionUnitEx = actualRevenueUnitEx - row.variableUnitEx;
    const actualContributionTotalEx = soldRevenueNetEx - row.variableUnitEx * soldUnits;
    return {
      ...row,
      sellInEx,
      soldRevenueNetEx,
      sellInPerLiter: row.litersPerUnit > 0 ? sellInEx / row.litersPerUnit : 0,
      contributionUnitEx: row.kind === "unit" ? contributionUnit : 0,
      contributionPerLiter: row.litersPerUnit > 0 ? contributionUnit / row.litersPerUnit : 0,
      soldUnits,
      soldLiters,
      actualContributionUnitEx,
      actualContributionTotalEx,
      contributionTotalEx: contributionUnit * soldUnits,
    };
  });

  const totalSoldLiters = rows.reduce((sum, row) => sum + row.soldLiters, 0);
  const adjustedFixedCostsTotal = Math.max(0, params.summary.adjustedFixedCostsTotal * fixedFactor);
  return calculateBreakEvenV2Summary({
    year: params.summary.year,
    fixedCostsTotal: adjustedFixedCostsTotal,
    fixedCostAdjustment: 0,
    adjustments: [],
    rows,
    totalSoldLiters,
  });
}
