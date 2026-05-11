import {
  text,
  toNumber,
  type CompositionLine,
  type PackagingLine,
} from "@/features/sku-composition/skuCompositionUtils";
import { parseUpsertBundleResponse, parseUpsertFormatResponse } from "@/lib/parsers/skuCompositionParsers";

type SellableKind = "product" | "dienst";

async function readApiErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text || "{}");
    const detail = (parsed && parsed.detail) || parsed;
    if (detail && typeof detail === "object") {
      const message = String((detail as any).message ?? (detail as any).detail ?? "").trim();
      const fieldErrors = Array.isArray((detail as any).field_errors) ? (detail as any).field_errors : [];
      if (fieldErrors.length > 0) {
        const lines = fieldErrors
          .map((e: any) => {
            const field = String(e?.field ?? "").trim();
            const msg = String(e?.message ?? "").trim();
            return field && msg ? `${field}: ${msg}` : msg || field;
          })
          .filter(Boolean);
        return [message || "Validatiefout.", ...lines].join("\n");
      }
      if (message) return message;
    }
  } catch {
    // fall through
  }
  return text || res.statusText || "Onbekende fout.";
}

export async function saveSellableSkuBundle({
  apiBaseUrl,
  name,
  uom,
  totalsLiters,
  sellableKind,
  manualRateEx,
  productGroup,
  alcoholCategory,
  packagingType,
  composition,
  packaging,
  editArticleId,
  editSkuId,
}: {
  apiBaseUrl: string;
  name: string;
  uom: string;
  totalsLiters: number;
  sellableKind: SellableKind;
  manualRateEx: number;
  productGroup: string;
  alcoholCategory: string;
  packagingType: string;
  composition: CompositionLine[];
  packaging: PackagingLine[];
  editArticleId?: string;
  editSkuId?: string;
}) {
  const res = await fetch(`${apiBaseUrl}/data/sku-composition/upsert-bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      uom,
      totals_liters: Math.max(0, toNumber(totalsLiters, 0)),
      sellable_kind: sellableKind === "dienst" ? "dienst" : "product",
      manual_rate_ex: Math.max(0, toNumber(manualRateEx, 0)),
      product_group: text(productGroup),
      alcohol_category: text(alcoholCategory),
      packaging_type: text(packagingType),
      composition: composition.map((line) => ({
        component_sku_id: text(line.componentSkuId),
        qty: Math.max(0, toNumber(line.qty, 0)),
      })),
      packaging: packaging.map((line) => ({
        kind: line.kind,
        component_id: text(line.componentId),
        qty: Math.max(0, toNumber(line.qty, 0)),
      })),
      edit_article_id: text(editArticleId),
      edit_sku_id: text(editSkuId),
    }),
  });
  if (!res.ok) {
    const msg = await readApiErrorMessage(res);
    throw new Error(msg || "Opslaan mislukt (upsert-bundle)");
  }
  const json = await res.json().catch(() => ({}));
  const parsed = parseUpsertBundleResponse(json);
  return { skuId: parsed.sku_id, articleId: parsed.article_id };
}

export async function saveAfvuleenheidFormat({
  apiBaseUrl,
  name,
  uom,
  totalsLiters,
  afvulParts,
  editFormatId,
}: {
  apiBaseUrl: string;
  name: string;
  uom: string;
  totalsLiters: number;
  afvulParts: PackagingLine[];
  editFormatId?: string;
}) {
  const res = await fetch(`${apiBaseUrl}/data/sku-composition/upsert-format`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      uom,
      totals_liters: Math.max(0, toNumber(totalsLiters, 0)),
      edit_format_id: text(editFormatId),
      afvul_parts: afvulParts.map((line) => ({
        kind: line.kind,
        component_id: text(line.componentId),
        qty: Math.max(0, toNumber(line.qty, 0)),
      })),
    }),
  });
  if (!res.ok) {
    const msg = await readApiErrorMessage(res);
    throw new Error(msg || "Opslaan mislukt (upsert-format)");
  }
  const json = await res.json().catch(() => ({}));
  const parsed = parseUpsertFormatResponse(json);
  return { articleId: parsed.article_id };
}

