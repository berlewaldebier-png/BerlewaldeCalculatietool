"use client";

type GenericRecord = Record<string, unknown>;

export type StrategyRow = Record<string, unknown>;

export function buildBasisParentForStrategy(rows: GenericRecord[]) {
  const compositeDefs = (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => row as any);

  const basisParentMap = new Map<string, { productId: string; label: string; score: number }[]>();
  compositeDefs.forEach((row) => {
    const compositeId = String(row.id ?? "");
    const compositeLabel = String(row.omschrijving ?? "");
    const basisRows = Array.isArray(row.basisproducten) ? row.basisproducten : [];
    basisRows.forEach((basisRow: any) => {
      const basisId = String(basisRow.basisproduct_id ?? "");
      if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
      const current = basisParentMap.get(basisId) ?? [];
      const scoreRaw = Number(basisRow.aantal ?? 0);
      const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
      current.push({ productId: compositeId, label: compositeLabel, score });
      basisParentMap.set(basisId, current);
    });
  });

  const resolved = new Map<string, { productId: string; label: string }>();
  for (const [basisId, items] of basisParentMap.entries()) {
    if (!items || items.length === 0) continue;
    const sorted = [...items].sort((left, right) => {
      const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
      if (labelDiff !== 0) return labelDiff;
      return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
    });
    resolved.set(basisId, { productId: sorted[0].productId, label: sorted[0].label });
  }
  return resolved;
}

export function followProductIdForStrategy(args: {
  productId: string;
  productType: string;
  basisParentForStrategy: Map<string, { productId: string; label: string }>;
}) {
  if (args.productType !== "basis") return "";
  return args.basisParentForStrategy.get(args.productId)?.productId ?? "";
}

export function getStrategyRowsForYear(args: {
  rows: GenericRecord[];
  year: number;
  strategyRecordTypes: Set<string>;
}) {
  const rows = Array.isArray(args.rows) ? args.rows : [];
  return rows.filter(
    (row) =>
      args.strategyRecordTypes.has(String((row as any)?.record_type ?? "")) &&
      Number((row as any)?.jaar ?? 0) === args.year
  ) as any[];
}

export function readMarginFromStrategyRow(row: any, channel: string): number | null {
  const margins = row?.sell_in_margins ?? row?.kanaalmarges ?? {};
  if (!margins || typeof margins !== "object") return null;
  const raw = (margins as any)[channel];
  if (raw === "" || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function readSellInPriceFromStrategyRow(row: any, channel: string): number | null {
  const prices = row?.sell_in_prices ?? row?.kanaalprijzen ?? {};
  if (!prices || typeof prices !== "object") return null;
  const raw = (prices as any)[channel];
  if (raw === "" || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function effectiveSourceMargin(args: {
  bierId: string;
  productId: string;
  productType: string;
  channel: string;
  defaultMargin: number;
  sourceYear: number;
  verkoopprijzen: GenericRecord[];
  strategyRecordTypes: Set<string>;
  basisParentForStrategy: Map<string, { productId: string; label: string }>;
}) {
  const followId = followProductIdForStrategy({
    productId: args.productId,
    productType: args.productType,
    basisParentForStrategy: args.basisParentForStrategy,
  });
  const keyProductId = followId || args.productId;
  const rows = getStrategyRowsForYear({
    rows: args.verkoopprijzen,
    year: args.sourceYear,
    strategyRecordTypes: args.strategyRecordTypes,
  });
  const beerRow =
    rows.find(
      (row) =>
        String((row as any).record_type ?? "") === "verkoopstrategie_product" &&
        String((row as any).bier_id ?? "") === args.bierId &&
        String((row as any).product_id ?? "") === keyProductId
    ) ?? null;
  const beerMargin = readMarginFromStrategyRow(beerRow, args.channel);
  if (beerMargin !== null) return beerMargin;
  const packRow =
    rows.find(
      (row) =>
        String((row as any).record_type ?? "") === "verkoopstrategie_verpakking" &&
        String((row as any).product_id ?? "") === keyProductId
    ) ?? null;
  const packMargin = readMarginFromStrategyRow(packRow, args.channel);
  if (packMargin !== null) return packMargin;
  const yearRow = rows.find((row) => String((row as any).record_type ?? "") === "jaarstrategie") ?? null;
  const yearMargin = readMarginFromStrategyRow(yearRow, args.channel);
  if (yearMargin !== null) return yearMargin;
  return args.defaultMargin;
}

export function explicitSourceSellInPrice(args: {
  bierId: string;
  productId: string;
  productType: string;
  channel: string;
  sourceYear: number;
  verkoopprijzen: GenericRecord[];
  strategyRecordTypes: Set<string>;
  basisParentForStrategy: Map<string, { productId: string; label: string }>;
}): number | null {
  const followId = followProductIdForStrategy({
    productId: args.productId,
    productType: args.productType,
    basisParentForStrategy: args.basisParentForStrategy,
  });
  const keyProductId = followId || args.productId;
  const rows = getStrategyRowsForYear({
    rows: args.verkoopprijzen,
    year: args.sourceYear,
    strategyRecordTypes: args.strategyRecordTypes,
  });
  const beerRow =
    rows.find(
      (row) =>
        String((row as any).record_type ?? "") === "verkoopstrategie_product" &&
        String((row as any).bier_id ?? "") === args.bierId &&
        String((row as any).product_id ?? "") === keyProductId
    ) ?? null;
  return readSellInPriceFromStrategyRow(beerRow, args.channel);
}
