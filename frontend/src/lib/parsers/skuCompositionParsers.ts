export type UpsertFormatResponse = { article_id: string };
export type UpsertBundleResponse = { sku_id: string; article_id: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function parseUpsertFormatResponse(value: unknown): UpsertFormatResponse {
  const obj = asObject(value);
  if (!obj) throw new Error("Ongeldige response: verwacht object.");
  const articleId = String(obj.article_id ?? "").trim();
  if (!articleId) throw new Error("Ongeldige response: article_id ontbreekt.");
  return { article_id: articleId };
}

export function parseUpsertBundleResponse(value: unknown): UpsertBundleResponse {
  const obj = asObject(value);
  if (!obj) throw new Error("Ongeldige response: verwacht object.");
  const skuId = String(obj.sku_id ?? "").trim();
  const articleId = String(obj.article_id ?? "").trim();
  if (!skuId) throw new Error("Ongeldige response: sku_id ontbreekt.");
  if (!articleId) throw new Error("Ongeldige response: article_id ontbreekt.");
  return { sku_id: skuId, article_id: articleId };
}

