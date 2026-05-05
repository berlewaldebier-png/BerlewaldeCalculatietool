import { buildSellInLookup, resolveSellInPriceEx } from "@/components/offerte-samenstellen/sellInResolver";
import { clampNumber } from "@/components/adviesprijzen/adviesprijzenUtils";

type Channel = {
  code: string;
  naam: string;
  actief: boolean;
  volgorde: number;
  default_marge_pct: number;
};

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
};

type ProductCostRow = {
  skuId: string;
  bierId: string;
  biernaam: string;
  btwPct: number;
  kostprijsversieId: string;
  productId: string;
  productType: "basis" | "samengesteld" | "catalog";
  verpakking: string;
  kostprijsEx: number;
};

type CentralSkuRow = {
  skuId: string;
  label: string;
  pricingMethod: string;
  hasActiveCost: boolean;
  kostprijsEx: number;
  btwPct: number;
};

type GenericRecord = Record<string, unknown>;

export function normalizeChannels(input: any[]): Channel[] {
  return (Array.isArray(input) ? input : [])
    .filter((row) => row && typeof row === "object")
    .map((row: any) => ({
      code: String(row.code ?? row.id ?? "").toLowerCase(),
      naam: String(row.naam ?? row.label ?? row.code ?? ""),
      actief: Boolean(row.actief ?? true),
      volgorde: Number(row.volgorde ?? 0),
      default_marge_pct: Number(row.default_marge_pct ?? row.default_marge ?? 0) || 0,
    }))
    .filter((row) => row.code)
    .sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
}

export function normalizeAdviesprijsRows(input: any[]): AdviesprijsRow[] {
  return (Array.isArray(input) ? input : [])
    .filter((row) => row && typeof row === "object")
    .map((row: any) => ({
      id: String(row.id ?? ""),
      jaar: Number(row.jaar ?? 0),
      channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
      opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0),
    }))
    .filter((row) => row.jaar > 0 && row.channel_code);
}

export function buildProductionYears(productie: Record<string, any>): number[] {
  return Object.keys(productie ?? {})
    .filter((key) => /^\d+$/.test(key))
    .map((key) => Number(key))
    .filter((y) => y > 0)
    .sort((a, b) => a - b);
}

export function buildYears(productionYears: number[], rows: AdviesprijsRow[]): number[] {
  const yearSet = new Set<number>(productionYears);
  rows.forEach((row) => yearSet.add(Number(row.jaar ?? 0)));
  return Array.from(yearSet).filter((y) => y > 0).sort((a, b) => a - b);
}

export function buildAdviesOpslagByChannel(rows: AdviesprijsRow[], selectedYear: number) {
  const map = new Map<string, number>();
  rows
    .filter((row) => Number(row.jaar ?? 0) === selectedYear)
    .forEach((row) => map.set(row.channel_code, Number(row.opslag_pct ?? 0) || 0));
  return map;
}

export function buildChannelDefaultOpslag(activeChannels: Channel[]) {
  const map = new Map<string, number>();
  activeChannels.forEach((c) => map.set(c.code, Number((c as any).default_marge_pct ?? 0) || 0));
  return map;
}

export function buildProductCostRows({
  centralRows,
  skuById,
  beerById,
  articleNameById,
}: {
  centralRows: CentralSkuRow[];
  skuById: Map<string, GenericRecord>;
  beerById: Map<string, any>;
  articleNameById: Map<string, string>;
}): ProductCostRow[] {
  const out: ProductCostRow[] = [];
  for (const item of centralRows) {
    if (item.pricingMethod !== "cost_plus") continue;
    if (!item.hasActiveCost || item.kostprijsEx <= 0) continue;

    const sku = skuById.get(item.skuId) ?? null;
    const kind = String((sku as any)?.kind ?? "").toLowerCase();
    const isArticle = kind === "article";

    const bierId = isArticle ? "" : String((sku as any)?.beer_id ?? "");
    const bierSnapshot = bierId ? beerById.get(bierId) : null;
    const biernaam = isArticle ? item.label : (bierSnapshot?.biernaam || bierId || item.label);

    const productId = isArticle ? String((sku as any)?.article_id ?? "") : String((sku as any)?.format_article_id ?? "");
    const verpakking = articleNameById.get(productId) ?? productId ?? "";

    out.push({
      skuId: item.skuId,
      bierId,
      biernaam,
      btwPct: item.btwPct,
      kostprijsversieId: "",
      productId,
      productType: isArticle ? ("catalog" as const) : ("basis" as const),
      verpakking: verpakking || item.label,
      kostprijsEx: item.kostprijsEx,
    });
  }

  return out.sort((a, b) => {
    const bn = a.biernaam.localeCompare(b.biernaam);
    if (bn !== 0) return bn;
    const pt = a.productType.localeCompare(b.productType);
    if (pt !== 0) return pt;
    return a.verpakking.localeCompare(b.verpakking);
  });
}

export function getSellInPriceEx({
  row,
  channelCode,
  verkoopprijzenRows,
  selectedYear,
  channelDefaultOpslag,
}: {
  row: ProductCostRow;
  channelCode: string;
  verkoopprijzenRows: any[];
  selectedYear: number;
  channelDefaultOpslag: Map<string, number>;
}) {
  const sellInLookup = buildSellInLookup(verkoopprijzenRows, selectedYear);
  return resolveSellInPriceEx({
    bierId: row.bierId,
    productId: row.productId,
    costPriceEx: row.kostprijsEx,
    channelCode,
    lookup: sellInLookup,
    channelDefaultOpslag,
  });
}

export function buildYearRows({
  rows,
  selectedYear,
  activeChannels,
}: {
  rows: AdviesprijsRow[];
  selectedYear: number;
  activeChannels: Channel[];
}) {
  const byCode = new Map<string, AdviesprijsRow>();
  rows
    .filter((row) => Number(row.jaar ?? 0) === selectedYear)
    .forEach((row) => byCode.set(row.channel_code, row));
  return activeChannels.map((channel) => {
    const existing = byCode.get(channel.code);
    return {
      channel,
      row: existing ?? { id: "", jaar: selectedYear, channel_code: channel.code, opslag_pct: 0 },
    };
  });
}

export function buildAdviesprijzenSavePayload({
  rows,
  selectedYear,
  yearRows,
}: {
  rows: AdviesprijsRow[];
  selectedYear: number;
  yearRows: { row: AdviesprijsRow }[];
}) {
  const kept = rows.filter((row) => Number(row.jaar ?? 0) !== selectedYear);
  return [
    ...kept,
    ...yearRows.map(({ row }) => ({
      id: row.id,
      jaar: selectedYear,
      channel_code: row.channel_code,
      opslag_pct: clampNumber(row.opslag_pct, 0),
    })),
  ];
}

