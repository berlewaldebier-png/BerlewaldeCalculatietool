import { slugifyId, text, toNumber, type CompositionLine, type GenericRecord, type PackagingLine } from "@/features/sku-composition/skuCompositionUtils";

type SellableKind = "product" | "dienst";

async function putDataset(apiBaseUrl: string, endpoint: string, payload: unknown) {
  const res = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `Opslaan mislukt (${endpoint})`);
  }
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
  existingArticles,
  existingSkus,
  existingBomLines,
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
  existingArticles: GenericRecord[];
  existingSkus: GenericRecord[];
  existingBomLines: GenericRecord[];
}) {
  const articleId = `bundle-${slugifyId(name)}`;
  const skuId = `sku-${articleId}`;

  const articlePayload: GenericRecord = {
    id: articleId,
    name,
    kind: "bundle",
    uom,
    content_liter: totalsLiters,
    sellable_subtype: sellableKind === "dienst" ? "dienst" : "product",
    pricing_method: sellableKind === "dienst" ? "manual_rate" : "cost_plus",
    manual_rate_ex: sellableKind === "dienst" ? toNumber(manualRateEx, 0) : 0,
    product_group: text(productGroup),
    alcohol_category: text(alcoholCategory),
    packaging_type: text(packagingType),
  };

  const nextArticles = [...existingArticles, articlePayload];
  const nextSkus = [
    ...existingSkus,
    {
      id: skuId,
      kind: "article",
      article_id: articleId,
      name,
      pricing_method: articlePayload.pricing_method,
      manual_rate_ex: articlePayload.manual_rate_ex,
      product_group: text(productGroup),
      alcohol_category: text(alcoholCategory),
      packaging_type: text(packagingType),
    },
  ];

  const nextBomLines: GenericRecord[] = [];
  composition.forEach((line, idx) => {
    nextBomLines.push({
      id: `bom-${articleId}-sku-${idx}`,
      parent_article_id: articleId,
      component_sku_id: line.componentSkuId,
      component_article_id: "",
      quantity: line.qty,
      uom: "stuk",
    });
  });
  packaging.forEach((line, idx) => {
    nextBomLines.push({
      id: `bom-${articleId}-pkg-${idx}`,
      parent_article_id: articleId,
      component_article_id: line.componentId,
      component_sku_id: "",
      quantity: line.qty,
      uom: "stuk",
    });
  });

  const mergedBom = [...existingBomLines, ...nextBomLines];

  await putDataset(apiBaseUrl, "/data/articles", nextArticles);
  await putDataset(apiBaseUrl, "/data/skus", nextSkus);
  await putDataset(apiBaseUrl, "/data/bom-lines", mergedBom);

  return { skuId, articleId };
}

export async function saveAfvuleenheidFormat({
  apiBaseUrl,
  name,
  uom,
  totalsLiters,
  afvulParts,
  existingArticles,
  existingBomLines,
  editFormatId,
}: {
  apiBaseUrl: string;
  name: string;
  uom: string;
  totalsLiters: number;
  afvulParts: PackagingLine[];
  existingArticles: GenericRecord[];
  existingBomLines: GenericRecord[];
  editFormatId?: string;
}) {
  const articleId = `fmt-${slugifyId(name)}`;
  const targetArticleId = editFormatId ? text(editFormatId) || articleId : articleId;

  const articlePayload: GenericRecord = {
    id: targetArticleId,
    name,
    kind: "format",
    uom: uom === "pakket" || uom === "uur" ? "stuk" : uom,
    content_liter: Math.max(0, toNumber(totalsLiters, 0)),
  };

  const nextArticles = [...existingArticles.filter((row) => text((row as any).id) !== targetArticleId), articlePayload];
  const nextBomLines: GenericRecord[] = afvulParts.map((line, idx) => ({
    id: `bom-${targetArticleId}-${line.kind}-${idx}`,
    parent_article_id: targetArticleId,
    component_article_id: line.componentId,
    component_sku_id: "",
    quantity: line.qty,
    uom: "stuk",
  }));
  const mergedBom = [
    ...existingBomLines.filter((row) => text((row as any).parent_article_id) !== targetArticleId),
    ...nextBomLines,
  ];

  await putDataset(apiBaseUrl, "/data/articles", nextArticles);
  await putDataset(apiBaseUrl, "/data/bom-lines", mergedBom);

  return { articleId: targetArticleId };
}

