import { calcSellInExFromOpslagPct } from "@/lib/pricingEngine";
import type { GenericRecord } from "@/components/offerte-samenstellen/types";

function normalizeChannelMap(raw: unknown) {
  const src =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number | ""> = {};

  Object.entries(src).forEach(([key, value]) => {
    const code = String(key ?? "").toLowerCase().trim();
    if (!code) return;
    if (value === "" || value === null || value === undefined) {
      out[code] = "";
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    out[code] = parsed;
  });

  return out;
}

function getChannelOpslag(
  row: GenericRecord | null | undefined,
  channelCode: string
) {
  if (!row) return null;
  const margins = normalizeChannelMap(
    (row as any).sell_in_margins ?? (row as any).kanaalmarges ?? {}
  );
  const value = margins[channelCode];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getChannelOpslagWithKey(
  row: GenericRecord | null | undefined,
  channelCode: string
) {
  const value = getChannelOpslag(row, channelCode);
  return value === null ? null : { value, key: channelCode };
}

function getChannelSellInPriceOverrideWithKey(
  row: GenericRecord | null | undefined,
  channelCode: string
) {
  if (!row) return null;
  const prices = normalizeChannelMap(
    (row as any).sell_in_prices ?? (row as any).kanaalprijzen ?? {}
  );
  const channelValue = prices[channelCode];
  if (typeof channelValue === "number" && Number.isFinite(channelValue)) {
    return { value: channelValue, key: channelCode };
  }
  const listValue = prices.list;
  return typeof listValue === "number" && Number.isFinite(listValue)
    ? { value: listValue, key: "list" }
    : null;
}

export type SellInLookup = {
  yearStrategy: GenericRecord | null;
  resolvedYear: number;
  packagingOverrideByProduct: Map<string, GenericRecord>;
  packagingOverrideBySkuId: Map<string, GenericRecord>;
  productOverrideByScope: Map<string, GenericRecord>;
  productOverrideBySkuId: Map<string, GenericRecord>;
};

export type SellInResolutionSourceScope =
  | "sku_product"
  | "beer_product"
  | "sku_packaging"
  | "product_packaging"
  | "year_strategy"
  | "channel_default";

export type SellInResolution = {
  sellInEx: number;
  opslagPct: number;
  source: "prijs" | "opslag";
  sourceRecordId: string;
  sourceScope: SellInResolutionSourceScope;
  sourceKey: string;
  resolvedYear: number;
};

function initLookup(resolvedYear: number): SellInLookup {
  return {
    yearStrategy: null,
    resolvedYear,
    packagingOverrideByProduct: new Map<string, GenericRecord>(),
    packagingOverrideBySkuId: new Map<string, GenericRecord>(),
    productOverrideByScope: new Map<string, GenericRecord>(),
    productOverrideBySkuId: new Map<string, GenericRecord>(),
  };
}

function hasAnyRowsForYear(rows: GenericRecord[], year: number) {
  return rows.some((row) => Number((row as any).jaar ?? 0) === year);
}

export function buildSellInLookupWithFallback(
  verkoopprijzenRows: GenericRecord[],
  year: number,
  opts?: { maxLookbackYears?: number }
): SellInLookup {
  const maxLookbackYears = Math.max(0, Number(opts?.maxLookbackYears ?? 3));
  const rows = Array.isArray(verkoopprijzenRows) ? verkoopprijzenRows : [];

  let resolvedYear = year;
  if (!hasAnyRowsForYear(rows, resolvedYear)) {
    for (let step = 1; step <= maxLookbackYears; step += 1) {
      const candidate = year - step;
      if (hasAnyRowsForYear(rows, candidate)) {
        resolvedYear = candidate;
        break;
      }
    }
  }

  const lookup = initLookup(resolvedYear);

  rows.forEach((row) => {
    const recordType = String((row as any).record_type ?? "").trim().toLowerCase();
    const rowYear = Number((row as any).jaar ?? 0);
    if (rowYear !== resolvedYear) return;

    if (recordType === "jaarstrategie") {
      lookup.yearStrategy = row;
      return;
    }

    if (recordType === "verkoopstrategie_verpakking") {
      const skuId = String((row as any).sku_id ?? "").trim();
      if (skuId) {
        lookup.packagingOverrideBySkuId.set(skuId, row);
        return;
      }
      const productId = String((row as any).product_id ?? "").trim();
      if (productId) lookup.packagingOverrideByProduct.set(productId, row);
      return;
    }

    if (recordType === "verkoopstrategie_product") {
      const skuId = String((row as any).sku_id ?? "").trim();
      if (skuId) {
        lookup.productOverrideBySkuId.set(skuId, row);
        return;
      }
      const bierId = String((row as any).bier_id ?? "").trim();
      const productId = String((row as any).product_id ?? "").trim();
      if (bierId && productId) {
        lookup.productOverrideByScope.set(`${bierId}:${productId}`, row);
      }
    }
  });

  return lookup;
}

// Backward compatible default: allow fallback up to 3 years.
export function buildSellInLookup(
  verkoopprijzenRows: GenericRecord[],
  year: number
): SellInLookup {
  return buildSellInLookupWithFallback(verkoopprijzenRows, year, {
    maxLookbackYears: 3,
  });
}

export function buildChannelDefaultOpslagMap(channels: GenericRecord[]) {
  const map = new Map<string, number>();

  channels.forEach((row) => {
    const code = String((row as any).code ?? (row as any).id ?? "")
      .trim()
      .toLowerCase();
    if (!code) return;
    const defaultOpslag = Number(
      (row as any).default_marge_pct ?? (row as any).default_marge ?? 0
    );
    map.set(code, Number.isFinite(defaultOpslag) ? defaultOpslag : 0);
  });

  return map;
}

export function resolveSellInPriceEx(params: {
  skuId?: string;
  bierId: string;
  productId: string;
  costPriceEx: number;
  channelCode: string;
  lookup: SellInLookup;
  channelDefaultOpslag: Map<string, number>;
}): SellInResolution {
  const skuId = String(params.skuId ?? "").trim();
  const skuProductOverride = skuId
    ? params.lookup.productOverrideBySkuId.get(skuId) ?? null
    : null;
  const beerProductOverride =
    params.lookup.productOverrideByScope.get(`${params.bierId}:${params.productId}`) ??
    null;
  const skuPackagingOverride = skuId
    ? params.lookup.packagingOverrideBySkuId.get(skuId) ?? null
    : null;
  const productPackagingOverride =
    params.lookup.packagingOverrideByProduct.get(params.productId) ?? null;
  const productOverride = skuProductOverride ?? beerProductOverride;
  const productScope: SellInResolutionSourceScope = skuProductOverride
    ? "sku_product"
    : "beer_product";
  const packagingOverride = skuPackagingOverride ?? productPackagingOverride;
  const packagingScope: SellInResolutionSourceScope = skuPackagingOverride
    ? "sku_packaging"
    : "product_packaging";

  const productPrice = getChannelSellInPriceOverrideWithKey(
    productOverride,
    params.channelCode
  );
  const packagingPrice = getChannelSellInPriceOverrideWithKey(
    packagingOverride,
    params.channelCode
  );
  const priceOverride = productPrice ?? packagingPrice;

  if (priceOverride !== null) {
    const sourceRow = productPrice ? productOverride : packagingOverride;
    return {
      sellInEx: priceOverride.value,
      opslagPct:
        params.costPriceEx > 0
          ? (priceOverride.value / params.costPriceEx - 1) * 100
          : 0,
      source: "prijs",
      sourceRecordId: String((sourceRow as any)?.id ?? "").trim(),
      sourceScope: productPrice ? productScope : packagingScope,
      sourceKey: priceOverride.key,
      resolvedYear: params.lookup.resolvedYear,
    };
  }

  const productMargin = getChannelOpslagWithKey(productOverride, params.channelCode);
  const packagingMargin = getChannelOpslagWithKey(
    packagingOverride,
    params.channelCode
  );
  const strategyMargin = getChannelOpslagWithKey(
    params.lookup.yearStrategy,
    params.channelCode
  );
  const defaultMargin = params.channelDefaultOpslag.get(params.channelCode);
  const margin =
    productMargin ??
    packagingMargin ??
    strategyMargin ??
    (typeof defaultMargin === "number" && Number.isFinite(defaultMargin)
      ? { value: defaultMargin, key: params.channelCode }
      : { value: 0, key: params.channelCode });
  const sourceRow = productMargin
    ? productOverride
    : packagingMargin
      ? packagingOverride
      : strategyMargin
        ? params.lookup.yearStrategy
        : null;
  const sourceScope: SellInResolutionSourceScope = productMargin
    ? productScope
    : packagingMargin
      ? packagingScope
      : strategyMargin
        ? "year_strategy"
        : "channel_default";

  return {
    sellInEx: calcSellInExFromOpslagPct(params.costPriceEx, margin.value),
    opslagPct: margin.value,
    source: "opslag",
    sourceRecordId: String((sourceRow as any)?.id ?? "").trim(),
    sourceScope,
    sourceKey: margin.key,
    resolvedYear: params.lookup.resolvedYear,
  };
}
