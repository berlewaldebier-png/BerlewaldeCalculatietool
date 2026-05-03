import { buildSellInLookup, resolveSellInPriceEx } from "@/components/offerte-samenstellen/sellInResolver";

type GenericRecord = Record<string, unknown>;

export type SellableSubtype = "bier" | "product" | "dienst";
export type PricingMethod = "cost_plus" | "manual_rate";
export type Uom = "stuk" | "pakket" | "uur" | "liter";

export type CentralSkuRow = {
  skuId: string;
  label: string;
  subtype: SellableSubtype;
  pricingMethod: PricingMethod;
  uom: Uom;
  contentLiter: number;
  hasActiveCost: boolean;
  kostprijsEx: number;
  btwPct: number;
  manualRateEx: number;
  sellInExByChannel: Record<string, number>;
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBtwPct(value: unknown) {
  const raw = text(value);
  if (!raw) return 0;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readArticlePayload(row: GenericRecord) {
  const payload = (row as any)?.payload;
  return payload && typeof payload === "object" ? (payload as GenericRecord) : {};
}

function readSkuPayload(row: GenericRecord) {
  const payload = (row as any)?.payload;
  return payload && typeof payload === "object" ? (payload as GenericRecord) : {};
}

function normalizeUom(raw: unknown): Uom {
  const value = text(raw).toLowerCase();
  if (value === "uur") return "uur";
  if (value === "pakket") return "pakket";
  if (value === "liter" || value === "l") return "liter";
  return "stuk";
}

function inferSubtypeFromSku(sku: GenericRecord, article: GenericRecord | null): SellableSubtype {
  const beerId = text((sku as any)?.beer_id);
  if (beerId) return "bier";
  const articlePayload = article ? readArticlePayload(article) : {};
  const explicit =
    text((articlePayload as any)?.sellable_subtype) ||
    text((article as any)?.sellable_subtype) ||
    text((sku as any)?.sellable_subtype);
  const normalized = explicit.toLowerCase();
  if (normalized === "dienst" || normalized === "service") return "dienst";
  if (normalized === "bier") return "bier";
  return "product";
}

function inferPricingMethod(subtype: SellableSubtype, sku: GenericRecord, article: GenericRecord | null): PricingMethod {
  const articlePayload = article ? readArticlePayload(article) : {};
  const explicit =
    text((articlePayload as any)?.pricing_method) ||
    text((article as any)?.pricing_method) ||
    text((sku as any)?.pricing_method);
  const normalized = explicit.toLowerCase();
  if (normalized === "manual_rate" || normalized === "rate" || normalized === "manual") return "manual_rate";
  if (subtype === "dienst") return "manual_rate";
  return "cost_plus";
}

function readManualRateEx(sku: GenericRecord, article: GenericRecord | null): number {
  const skuPayload = readSkuPayload(sku);
  const articlePayload = article ? readArticlePayload(article) : {};
  return (
    toNumber((skuPayload as any)?.manual_rate_ex, NaN) ||
    toNumber((articlePayload as any)?.manual_rate_ex, NaN) ||
    toNumber((sku as any)?.manual_rate_ex, 0) ||
    toNumber((article as any)?.manual_rate_ex, 0)
  );
}

function getSnapshotProductRow(version: GenericRecord | undefined, ids: { skuId: string; productId: string }) {
  if (!version) return null;
  const products = ((version as any).resultaat_snapshot ?? (version as any).resultaatSnapshot ?? {}).producten ?? {};
  const rows = [
    ...(Array.isArray(products.basisproducten) ? products.basisproducten : []),
    ...(Array.isArray(products.samengestelde_producten) ? products.samengestelde_producten : []),
  ] as any[];

  const skuId = text(ids.skuId);
  if (skuId) {
    const bySku = rows.find((row) => text(row?.sku_id) === skuId);
    if (bySku) return bySku ?? null;
  }
  const productId = text(ids.productId);
  if (!productId) return null;
  return rows.find((row) => text(row?.product_id) === productId) ?? null;
}

export function buildCentralSkuIndex(params: {
  year: number;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const skuById = new Map<string, GenericRecord>();
  (Array.isArray(params.skus) ? params.skus : []).forEach((row) => {
    const id = text((row as any)?.id);
    if (id) skuById.set(id, row);
  });
  const articleById = new Map<string, GenericRecord>();
  (Array.isArray(params.articles) ? params.articles : []).forEach((row) => {
    const id = text((row as any)?.id);
    if (id) articleById.set(id, row);
  });
  const versionById = new Map<string, GenericRecord>();
  (Array.isArray(params.kostprijsversies) ? params.kostprijsversies : []).forEach((row) => {
    const id = text((row as any)?.id);
    if (id) versionById.set(id, row);
  });

  const activeActivationBySku = new Map<string, GenericRecord>();
  (Array.isArray(params.kostprijsproductactiveringen) ? params.kostprijsproductactiveringen : [])
    .filter((row) => toNumber((row as any)?.jaar, 0) === params.year)
    .forEach((row) => {
      const skuId = text((row as any)?.sku_id);
      const tot = text((row as any)?.effectief_tot);
      if (!skuId || tot) return;
      const existing = activeActivationBySku.get(skuId);
      const score = text((row as any)?.effectief_vanaf) || text((row as any)?.created_at);
      const existingScore = existing ? text((existing as any)?.effectief_vanaf) || text((existing as any)?.created_at) : "";
      if (!existing || score >= existingScore) activeActivationBySku.set(skuId, row);
    });

  const sellInLookup = buildSellInLookup(params.verkoopprijzen, params.year);
  const channelDefaultOpslag = new Map<string, number>();
  (Array.isArray(params.channels) ? params.channels : []).forEach((row) => {
    const code = text((row as any)?.code || (row as any)?.id).toLowerCase();
    if (!code) return;
    channelDefaultOpslag.set(code, toNumber((row as any)?.default_marge_pct, 0));
  });
  const channelCodes = Array.from(channelDefaultOpslag.keys()).sort((a, b) => a.localeCompare(b));

  const rows: CentralSkuRow[] = [];
  for (const [skuId, activation] of activeActivationBySku.entries()) {
    const sku = skuById.get(skuId);
    if (!sku) continue;

    const skuKind = text((sku as any)?.kind).toLowerCase();
    const productId =
      text((activation as any)?.product_id) ||
      text((sku as any)?.format_article_id) ||
      text((sku as any)?.article_id);
    const versionId = text((activation as any)?.kostprijsversie_id);
    const version = versionById.get(versionId);
    const article = productId ? articleById.get(productId) ?? null : null;

    const subtype = inferSubtypeFromSku(sku, article);
    const pricingMethod = inferPricingMethod(subtype, sku, article);
    const uom = normalizeUom((article as any)?.uom || (sku as any)?.uom || (readArticlePayload(article ?? {}) as any)?.uom);
    const contentLiter = toNumber((article as any)?.content_liter, 0);
    const manualRateEx = readManualRateEx(sku, article);

    const snapshotRow = getSnapshotProductRow(version, { skuId, productId });
    const kostprijsFromSnapshot = toNumber((snapshotRow as any)?.kostprijs, 0);
    const kostprijsFromVersion = toNumber((version as any)?.kostprijs, 0);
    const kostprijsEx = kostprijsFromSnapshot || (skuKind === "article" ? kostprijsFromVersion : 0);

    const btwPct = parseBtwPct(((version as any)?.basisgegevens ?? {}).btw_tarief);
    const label =
      text((sku as any)?.name) ||
      text((article as any)?.name) ||
      text((sku as any)?.naam) ||
      text((article as any)?.naam) ||
      skuId;

    const warnings: string[] = [];
    if (pricingMethod === "cost_plus") {
      if (kostprijsEx <= 0) warnings.push("Kostprijs ontbreekt.");
    }
    if (pricingMethod === "manual_rate") {
      if (manualRateEx <= 0) warnings.push("Tarief ontbreekt.");
    }

    const sellInExByChannel: Record<string, number> = {};
    if (pricingMethod === "cost_plus") {
      for (const channelCode of channelCodes) {
        const resolved = resolveSellInPriceEx({
          bierId: text((activation as any)?.bier_id) || text((sku as any)?.beer_id),
          productId,
          costPriceEx: kostprijsEx,
          channelCode,
          lookup: sellInLookup,
          channelDefaultOpslag,
        });
        sellInExByChannel[channelCode] = toNumber(resolved.sellInEx, 0);
      }
    }

    rows.push({
      skuId,
      label,
      subtype,
      pricingMethod,
      uom,
      contentLiter,
      hasActiveCost: pricingMethod === "cost_plus" ? kostprijsEx > 0 : false,
      kostprijsEx,
      btwPct,
      manualRateEx,
      sellInExByChannel,
      warnings,
    });
  }

  return {
    rows: rows.sort((a, b) => a.label.localeCompare(b.label, "nl-NL")),
    bySkuId: new Map(rows.map((row) => [row.skuId, row])),
  };
}

