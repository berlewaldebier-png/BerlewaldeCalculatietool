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

function getChannelSellInPriceOverride(
  row: GenericRecord | null | undefined,
  channelCode: string
) {
  if (!row) return null;
  const prices = normalizeChannelMap(
    (row as any).sell_in_prices ?? (row as any).kanaalprijzen ?? {}
  );
  const value = prices[channelCode];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type SellInLookup = {
  yearStrategy: GenericRecord | null;
  packagingOverrideByProduct: Map<string, GenericRecord>;
  productOverrideByScope: Map<string, GenericRecord>;
};

export function buildSellInLookup(
  verkoopprijzenRows: GenericRecord[],
  year: number
): SellInLookup {
  const lookup: SellInLookup = {
    yearStrategy: null,
    packagingOverrideByProduct: new Map<string, GenericRecord>(),
    productOverrideByScope: new Map<string, GenericRecord>(),
  };

  verkoopprijzenRows.forEach((row) => {
    const recordType = String((row as any).record_type ?? "").trim().toLowerCase();
    const rowYear = Number((row as any).jaar ?? 0);
    if (rowYear !== year) return;

    if (recordType === "jaarstrategie") {
      lookup.yearStrategy = row;
      return;
    }

    if (recordType === "verkoopstrategie_verpakking") {
      const productId = String((row as any).product_id ?? "").trim();
      if (productId) lookup.packagingOverrideByProduct.set(productId, row);
      return;
    }

    if (recordType === "verkoopstrategie_product") {
      const bierId = String((row as any).bier_id ?? "").trim();
      const productId = String((row as any).product_id ?? "").trim();
      if (bierId && productId) {
        lookup.productOverrideByScope.set(`${bierId}:${productId}`, row);
      }
    }
  });

  return lookup;
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
  bierId: string;
  productId: string;
  costPriceEx: number;
  channelCode: string;
  lookup: SellInLookup;
  channelDefaultOpslag: Map<string, number>;
}) {
  const productOverride =
    params.lookup.productOverrideByScope.get(
      `${params.bierId}:${params.productId}`
    ) ?? null;
  const packagingOverride =
    params.lookup.packagingOverrideByProduct.get(params.productId) ?? null;

  const priceOverride =
    getChannelSellInPriceOverride(productOverride, params.channelCode) ??
    getChannelSellInPriceOverride(packagingOverride, params.channelCode);

  if (priceOverride !== null) {
    return {
      sellInEx: priceOverride,
      opslagPct:
        params.costPriceEx > 0
          ? ((priceOverride / params.costPriceEx) - 1) * 100
          : 0,
      source: "prijs" as const,
    };
  }

  const opslagPct =
    getChannelOpslag(productOverride, params.channelCode) ??
    getChannelOpslag(packagingOverride, params.channelCode) ??
    getChannelOpslag(params.lookup.yearStrategy, params.channelCode) ??
    params.channelDefaultOpslag.get(params.channelCode) ??
    0;

  return {
    sellInEx: calcSellInExFromOpslagPct(params.costPriceEx, opslagPct),
    opslagPct,
    source: "opslag" as const,
  };
}
