import { buildSellInLookup, resolveSellInPriceEx } from "@/components/offerte-samenstellen/sellInResolver";
import { normalizeUom, text, toNumber, type GenericRecord } from "@/features/sku/adapters/common";
import {
  normalizeActivation,
  normalizeArticle,
  normalizeKostprijsVersie,
  normalizeSku,
  parseBtwPct,
  type NormalizedActivation,
  type NormalizedArticle,
  type NormalizedKostprijsVersie,
  type NormalizedSku,
} from "@/features/sku/normalizers";

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
  isActive: boolean;
  hasActiveCost: boolean;
  kostprijsEx: number;
  btwPct: number;
  manualRateEx: number;
  sellInExByChannel: Record<string, number>;
  warnings: string[];
};

function inferSubtypeFromSku(sku: NormalizedSku, article: NormalizedArticle | null): SellableSubtype {
  const beerId = text(sku.beerId);
  if (beerId) return "bier";
  const explicit = text(article?.sellableSubtypeRaw) || text(sku.sellableSubtypeRaw);
  const normalized = explicit.toLowerCase();
  if (normalized === "dienst" || normalized === "service") return "dienst";
  if (normalized === "bier") return "bier";
  return "product";
}

function inferPricingMethod(subtype: SellableSubtype, sku: NormalizedSku, article: NormalizedArticle | null): PricingMethod {
  const explicit = text(article?.pricingMethodRaw) || text(sku.pricingMethodRaw);
  const normalized = explicit.toLowerCase();
  if (normalized === "manual_rate" || normalized === "rate" || normalized === "manual") return "manual_rate";
  if (subtype === "dienst") return "manual_rate";
  return "cost_plus";
}

function readManualRateEx(sku: NormalizedSku, article: NormalizedArticle | null): number {
  const skuPayload = sku.payload ?? {};
  const articlePayload = article?.payload ?? {};
  return (
    toNumber((skuPayload as any)?.manual_rate_ex, NaN) ||
    toNumber((articlePayload as any)?.manual_rate_ex, NaN) ||
    toNumber((sku as any)?.manual_rate_ex, 0) ||
    toNumber((article as any)?.manual_rate_ex, 0)
  );
}

function getSnapshotProductRow(version: NormalizedKostprijsVersie | undefined, ids: { skuId: string; productId: string }) {
  if (!version) return null;
  const products = (version.resultaatSnapshot as any)?.producten ?? {};
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
  includeDraftCostPlus?: boolean;
}) {
  const skuById = new Map<string, NormalizedSku>();
  (Array.isArray(params.skus) ? params.skus : []).forEach((row) => {
    const normalized = normalizeSku(row);
    if (normalized) skuById.set(normalized.id, normalized);
  });
  const articleById = new Map<string, NormalizedArticle>();
  (Array.isArray(params.articles) ? params.articles : []).forEach((row) => {
    const normalized = normalizeArticle(row);
    if (normalized) articleById.set(normalized.id, normalized);
  });
  const versionById = new Map<string, NormalizedKostprijsVersie>();
  (Array.isArray(params.kostprijsversies) ? params.kostprijsversies : []).forEach((row) => {
    const normalized = normalizeKostprijsVersie(row);
    if (normalized) versionById.set(normalized.id, normalized);
  });

  const latestVersionBySkuId = new Map<string, NormalizedKostprijsVersie>();
  if (params.includeDraftCostPlus) {
    const latestTsBySkuId = new Map<string, string>();
    (Array.isArray(params.kostprijsversies) ? params.kostprijsversies : []).forEach((row) => {
      const normalized = normalizeKostprijsVersie(row);
      if (!normalized) return;
      const basis = ((row as any)?.basisgegevens ?? {}) as any;
      const jaar = toNumber((row as any)?.jaar ?? basis?.jaar ?? 0, 0);
      if (jaar !== params.year) return;
      const skuId = text(basis?.sku_id);
      if (!skuId) return;
      const ts =
        text((row as any)?.finalized_at) ||
        text((row as any)?.aangepast_op) ||
        text((row as any)?.updated_at) ||
        text((row as any)?.created_at) ||
        text((row as any)?.aangemaakt_op);
      const prevTs = latestTsBySkuId.get(skuId) ?? "";
      if (!prevTs || (ts && ts > prevTs)) {
        latestTsBySkuId.set(skuId, ts);
        latestVersionBySkuId.set(skuId, normalized);
      }
    });
  }

  const activeActivationBySku = new Map<string, NormalizedActivation>();
  (Array.isArray(params.kostprijsproductactiveringen) ? params.kostprijsproductactiveringen : [])
    .map((row) => normalizeActivation(row))
    .filter((row): row is NormalizedActivation => Boolean(row))
    .filter((row) => row.year === params.year)
    .forEach((row) => {
      if (row.effectiefTot) return;
      const existing = activeActivationBySku.get(row.skuId);
      const score = row.effectiefVanaf || row.createdAt;
      const existingScore = existing ? existing.effectiefVanaf || existing.createdAt : "";
      if (!existing || score >= existingScore) activeActivationBySku.set(row.skuId, row);
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

  function pushRow(args: {
    skuId: string;
    sku: NormalizedSku;
    article: NormalizedArticle | null;
    productId: string;
    activation: NormalizedActivation | null;
    version: NormalizedKostprijsVersie | undefined;
  }) {
    const { skuId, sku, article, productId, activation, version } = args;
    const skuKind = text(sku.kind).toLowerCase();
    const subtype = inferSubtypeFromSku(sku, article);
    const pricingMethod = inferPricingMethod(subtype, sku, article);
    const uom = normalizeUom(text(article?.uom) || text(sku.uom));
    const contentLiter = toNumber(article?.contentLiter, 0);
    const manualRateEx = readManualRateEx(sku, article);

    const snapshotRow = getSnapshotProductRow(version, { skuId, productId });
    const kostprijsFromSnapshot = toNumber((snapshotRow as any)?.kostprijs, 0);
    const kostprijsFromVersion = toNumber(version?.kostprijs, 0);
    const kostprijsEx = kostprijsFromSnapshot || (skuKind === "article" ? kostprijsFromVersion : 0);

    const btwPct = parseBtwPct(version?.basisBtwTarief);
    const label =
      text(sku.name) ||
      text(article?.name) ||
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
          bierId: text(activation?.bierId) || text(sku.beerId),
          productId,
          costPriceEx: kostprijsEx,
          channelCode,
          lookup: sellInLookup,
          channelDefaultOpslag,
        });
        sellInExByChannel[channelCode] = toNumber(resolved.sellInEx, 0);
      }
    }

    const isActive = Boolean(activation);
    const hasCost = pricingMethod === "cost_plus" ? kostprijsEx > 0 : false;

    rows.push({
      skuId,
      label,
      subtype,
      pricingMethod,
      uom,
      contentLiter,
      isActive,
      hasActiveCost: hasCost,
      kostprijsEx,
      btwPct,
      manualRateEx,
      sellInExByChannel,
      warnings,
    });
  }

  // Primary list: active cost activations (cost_plus and bundles that are costed).
  for (const [skuId, activation] of activeActivationBySku.entries()) {
    const sku = skuById.get(skuId);
    if (!sku) continue;
    const productId =
      text(activation.productId) ||
      text(sku.formatArticleId) ||
      text(sku.articleId);
    const versionId = text(activation.kostprijsversieId);
    const version = versionById.get(versionId);
    const article = productId ? articleById.get(productId) ?? null : null;
    pushRow({ skuId, sku, article, productId, activation, version });
  }

  // Secondary list: manual-rate services that exist as SKUs (even without cost activation).
  // This matches the UX expectation: once a service is created and "afgerond" (tarief present),
  // it should appear in selectors without requiring liters/cost.
  for (const [skuId, sku] of skuById.entries()) {
    const kind = text(sku.kind).toLowerCase();
    if (kind !== "article") continue;
    if (rows.some((row) => row.skuId === skuId)) continue;
    const articleId = text(sku.articleId);
    if (!articleId) continue;
    const article = articleById.get(articleId) ?? null;
    const subtype = inferSubtypeFromSku(sku, article);
    const pricingMethod = inferPricingMethod(subtype, sku, article);
    if (pricingMethod !== "manual_rate") continue;
    const manualRateEx = readManualRateEx(sku, article);
    if (manualRateEx <= 0) continue;
    pushRow({ skuId, sku, article, productId: articleId, activation: null, version: undefined });
  }

  // Optional: include cost-plus sellables that exist as SKUs but are not yet activated.
  // This is used by beheer/workspace views to show "concept/nog te activeren" items
  // without exposing them as active offerable items.
  if (params.includeDraftCostPlus) {
    for (const [skuId, sku] of skuById.entries()) {
      if (rows.some((row) => row.skuId === skuId)) continue;
      const kind = text(sku.kind).toLowerCase();
      if (kind !== "article") continue;
      const articleId = text(sku.articleId);
      if (!articleId) continue;
      const article = articleById.get(articleId) ?? null;
      const subtype = inferSubtypeFromSku(sku, article);
      const pricingMethod = inferPricingMethod(subtype, sku, article);
      if (pricingMethod !== "cost_plus") continue;
      const version = latestVersionBySkuId.get(skuId);
      pushRow({ skuId, sku, article, productId: articleId, activation: null, version });
    }
  }

  return {
    rows: rows.sort((a, b) => a.label.localeCompare(b.label, "nl-NL")),
    bySkuId: new Map(rows.map((row) => [row.skuId, row])),
  };
}
