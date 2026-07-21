import type { BeerViewRow } from "@/components/verkoopstrategie/verkoopstrategieTypes";
import { stripInternal } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceDerivations";
import type { GenericRecord, StrategyRow } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import type { ActionStatusState } from "@/components/ActionStatus";

export type SalesStrategyBeerGroup = {
  biernaam: string;
  rows: BeerViewRow[];
};

export type StrategySkuLookups = {
  beerFormatSkuIdByScope: Map<string, string>;
  articleSkuIdByArticleId: Map<string, string>;
};

export const SALES_STRATEGY_SERVER_SUCCESS = "Opgeslagen.";
export const SALES_STRATEGY_DRAFT_SUCCESS = "Concept opgeslagen.";
export const SALES_STRATEGY_SAVE_ERROR = "Opslaan mislukt.";
export const SALES_STRATEGY_PENDING_STATUS: ActionStatusState = {
  kind: "pending",
  message: "Verkoopstrategie wordt opgeslagen.",
};

export function getSalesStrategyActionStatus(status: string, isSaving: boolean): ActionStatusState | null {
  if (isSaving) return SALES_STRATEGY_PENDING_STATUS;
  if (!status) return null;
  if (status === SALES_STRATEGY_SAVE_ERROR) {
    return {
      kind: "error",
      message: status,
      guidance: "Controleer je verbinding en de ingevoerde prijzen. Probeer daarna opnieuw.",
    };
  }
  if (status.includes("ontbreekt") || status.includes("nieuwere conceptdata")) {
    return { kind: "warning", message: status };
  }
  return { kind: "success", message: status };
}

export function getProductionYears(productie: unknown): number[] {
  const years: number[] = [];
  if (Array.isArray(productie)) {
    productie.forEach((row) => {
      const year = Number((row as GenericRecord | null)?.jaar ?? 0);
      if (Number.isFinite(year) && year > 0) years.push(year);
    });
  } else if (productie !== null && typeof productie === "object") {
    Object.keys(productie as Record<string, unknown>).forEach((key) => {
      const year = Number(key);
      if (Number.isFinite(year) && year > 0) years.push(year);
    });
  }
  return Array.from(new Set(years)).sort((left, right) => left - right);
}

export function getDefaultSalesStrategyYear(productieYears: number[], currentYear = new Date().getFullYear()): number {
  return productieYears.length > 0 ? Math.max(...productieYears) : currentYear;
}

export function getSalesStrategyYearOptions(productieYears: number[]): number[] {
  return [...productieYears].sort((left, right) => right - left);
}

export function getSalesStrategyListPrice(row: BeerViewRow): number {
  return Number(row.sellInPriceOverrides?.list || row.sellInPrices?.list || 0) || 0;
}

export function getSalesStrategyListOpslag(row: BeerViewRow): number {
  const price = getSalesStrategyListPrice(row);
  const cost = Number(row.kostprijs || 0);
  if (price <= 0 || cost <= 0) return 0;
  return ((price / cost) - 1) * 100;
}

export function filterAndGroupSalesStrategyRows(rows: BeerViewRow[], filter: string): SalesStrategyBeerGroup[] {
  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? rows.filter((row) => `${row.biernaam} ${row.product}`.trim().toLowerCase().includes(normalizedFilter))
    : rows;
  const byBeer = new Map<string, BeerViewRow[]>();
  filtered.forEach((row) => {
    byBeer.set(row.biernaam, [...(byBeer.get(row.biernaam) ?? []), row]);
  });
  return [...byBeer.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "nl-NL"))
    .map(([biernaam, beerRows]) => ({
      biernaam,
      rows: [...beerRows].sort((left, right) => left.product.localeCompare(right.product, "nl-NL")),
    }));
}

export function buildStrategySkuLookups(skus: GenericRecord[] | undefined): StrategySkuLookups {
  const beerFormatSkuIdByScope = new Map<string, string>();
  const articleSkuIdByArticleId = new Map<string, string>();
  (Array.isArray(skus) ? skus : []).forEach((row) => {
    const kind = String(row.kind ?? "").trim().toLowerCase();
    const skuId = String(row.id ?? "").trim();
    if (!skuId) return;
    if (kind === "beer_format") {
      const beerId = String(row.beer_id ?? "").trim();
      const formatId = String(row.format_article_id ?? "").trim();
      if (beerId && formatId) beerFormatSkuIdByScope.set(`${beerId}:${formatId}`, skuId);
    }
    if (kind === "article") {
      const articleId = String(row.article_id ?? "").trim();
      if (articleId) articleSkuIdByArticleId.set(articleId, skuId);
    }
  });
  return { beerFormatSkuIdByScope, articleSkuIdByArticleId };
}

export function ensureStrategySkuId(row: StrategyRow, lookups: StrategySkuLookups): StrategyRow {
  if (String(row.sku_id ?? "").trim()) return row;
  const recordType = String(row.record_type ?? "").trim().toLowerCase();
  if (recordType === "verkoopstrategie_product") {
    const beerId = String(row.bier_id ?? "").trim();
    const productId = String(row.product_id ?? "").trim();
    const skuId = beerId && productId ? lookups.beerFormatSkuIdByScope.get(`${beerId}:${productId}`) : undefined;
    return skuId ? { ...row, sku_id: skuId } : row;
  }
  if (recordType === "verkoopstrategie_verpakking") {
    const productId = String(row.product_id ?? "").trim();
    const skuId = productId ? lookups.articleSkuIdByArticleId.get(productId) : undefined;
    return skuId ? { ...row, sku_id: skuId } : row;
  }
  return row;
}

export function buildSalesStrategySavePayload({
  passthroughRows,
  strategyRows,
  skuLookups,
}: {
  passthroughRows: GenericRecord[];
  strategyRows: StrategyRow[];
  skuLookups: StrategySkuLookups;
}): GenericRecord[] {
  return [
    ...passthroughRows,
    ...strategyRows.map((row) => stripInternal(ensureStrategySkuId(row, skuLookups))),
  ];
}
