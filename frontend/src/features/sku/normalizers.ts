import { normalizeUom, text, toNumber, type GenericRecord, type Uom } from "@/features/sku/adapters/common";

export type NormalizedSku = {
  id: string;
  kind: string;
  name: string;
  beerId: string;
  formatArticleId: string;
  articleId: string;
  payload: GenericRecord;
  pricingMethodRaw: string;
  sellableSubtypeRaw: string;
  uom: Uom;
};

export type NormalizedArticle = {
  id: string;
  kind: string;
  name: string;
  uom: Uom;
  contentLiter: number;
  payload: GenericRecord;
  pricingMethodRaw: string;
  sellableSubtypeRaw: string;
};

export type NormalizedActivation = {
  skuId: string;
  year: number;
  kostprijsversieId: string;
  productId: string;
  effectiefTot: string;
  effectiefVanaf: string;
  createdAt: string;
  bierId: string;
  raw: GenericRecord;
};

export type NormalizedKostprijsVersie = {
  id: string;
  kostprijs: number;
  basisBtwTarief: string;
  resultaatSnapshot: GenericRecord;
  raw: GenericRecord;
};

function readPayload(row: GenericRecord): GenericRecord {
  const payload = (row as any)?.payload;
  return payload && typeof payload === "object" ? (payload as GenericRecord) : {};
}

export function parseBtwPct(value: unknown) {
  const raw = text(value);
  if (!raw) return 0;
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeSku(row: GenericRecord): NormalizedSku | null {
  const id = text((row as any)?.id);
  if (!id) return null;
  const payload = readPayload(row);
  const kind = text((row as any)?.kind).toLowerCase();
  return {
    id,
    kind,
    name: text((row as any)?.name) || text((row as any)?.naam),
    beerId: text((row as any)?.beer_id),
    formatArticleId: text((row as any)?.format_article_id),
    articleId: text((row as any)?.article_id),
    payload,
    pricingMethodRaw: text((payload as any)?.pricing_method) || text((row as any)?.pricing_method),
    sellableSubtypeRaw: text((payload as any)?.sellable_subtype) || text((row as any)?.sellable_subtype),
    uom: normalizeUom((row as any)?.uom || (payload as any)?.uom),
  };
}

export function normalizeArticle(row: GenericRecord): NormalizedArticle | null {
  const id = text((row as any)?.id);
  if (!id) return null;
  const payload = readPayload(row);
  const kind = text((row as any)?.kind).toLowerCase();
  return {
    id,
    kind,
    name: text((row as any)?.name) || text((row as any)?.naam),
    uom: normalizeUom((row as any)?.uom || (payload as any)?.uom),
    contentLiter: toNumber((row as any)?.content_liter, 0),
    payload,
    pricingMethodRaw: text((payload as any)?.pricing_method) || text((row as any)?.pricing_method),
    sellableSubtypeRaw: text((payload as any)?.sellable_subtype) || text((row as any)?.sellable_subtype),
  };
}

export function normalizeActivation(row: GenericRecord): NormalizedActivation | null {
  const skuId = text((row as any)?.sku_id);
  const year = toNumber((row as any)?.jaar, 0);
  const kostprijsversieId = text((row as any)?.kostprijsversie_id);
  if (!skuId || !year || !kostprijsversieId) return null;
  return {
    skuId,
    year,
    kostprijsversieId,
    productId: text((row as any)?.product_id) || "",
    effectiefTot: text((row as any)?.effectief_tot),
    effectiefVanaf: text((row as any)?.effectief_vanaf),
    createdAt: text((row as any)?.created_at),
    bierId: text((row as any)?.bier_id),
    raw: row,
  };
}

export function normalizeKostprijsVersie(row: GenericRecord): NormalizedKostprijsVersie | null {
  const id = text((row as any)?.id);
  if (!id) return null;
  const basis = ((row as any)?.basisgegevens ?? {}) as GenericRecord;
  const resultaat = ((row as any)?.resultaat_snapshot ?? (row as any)?.resultaatSnapshot ?? {}) as GenericRecord;
  return {
    id,
    kostprijs: toNumber((row as any)?.kostprijs, 0),
    basisBtwTarief: text((basis as any)?.btw_tarief),
    resultaatSnapshot: resultaat,
    raw: row,
  };
}

