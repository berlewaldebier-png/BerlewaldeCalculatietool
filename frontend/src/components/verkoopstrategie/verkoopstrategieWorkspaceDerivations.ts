"use client";

import type { StrategyRow } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";

type GenericRecord = Record<string, unknown>;

export function stripInternal(row: StrategyRow) {
  const { _uiId, sell_in_margins, sell_in_prices, ...rest } = row;
  return {
    ...rest,
    kanaalmarges: sell_in_margins,
    sell_in_margins,
    kanaalprijzen: sell_in_prices,
    sell_in_prices
  };
}

export function buildArticleLabelMap(rows: GenericRecord[] | undefined, kindFilter: "format" | "bundle") {
  const map = new Map<string, { id: string; label: string }>();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = String((row as any)?.id ?? "").trim();
    if (!id) return;
    const kind = String((row as any)?.kind ?? "").trim().toLowerCase();
    if (kind !== kindFilter) return;
    const label = String((row as any)?.name ?? (row as any)?.naam ?? id).trim() || id;
    map.set(id, { id, label });
  });
  return map;
}

export function buildProductSources({
  basisproducten,
  samengesteldeProducten,
  centralSkuRows,
  skuById,
  bundleArticleById,
  formatArticleById,
  kostprijsproductactiveringen,
}: {
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  centralSkuRows: Array<{ skuId: string; label: string; pricingMethod: string; subtype: string; productId?: string }>;
  skuById: Map<string, GenericRecord>;
  bundleArticleById: Map<string, { id: string; label: string }>;
  formatArticleById: Map<string, { id: string; label: string }>;
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const seen = new Map<string, { id: string; label: string; type: "basis" | "samengesteld" }>();
  basisproducten.forEach((row) => {
    const id = String(row.id ?? "");
    const label = String(row.omschrijving ?? "");
    if (id && label) seen.set(`basis:${id}`, { id, label, type: "basis" });
  });
  samengesteldeProducten.forEach((row) => {
    const id = String(row.id ?? "");
    const label = String(row.omschrijving ?? "");
    if (id && label) seen.set(`samengesteld:${id}`, { id, label, type: "samengesteld" });
  });

  // SKU-aanpak: voeg ook verkoopbare artikelen (bundle/article SKUs) toe als "producttype" bron.
  // Dit is géén fallback: verkoopstrategie moet dezelfde centrale verkoopbare lijst kunnen beprijzen
  // als adviesprijzen/offertes (cost_plus items met actieve kostprijs).
  centralSkuRows
    .filter((row) => row.pricingMethod === "cost_plus")
    .filter((row) => row.subtype === "product")
    .forEach((row) => {
      const sku = skuById.get(row.skuId);
      const kind = String((sku as any)?.kind ?? "").toLowerCase();
      if (kind !== "article") return;
      const articleId = String((sku as any)?.article_id ?? "").trim() || String((row as any)?.productId ?? "").trim();
      if (!articleId) return;
      const label = bundleArticleById.get(articleId)?.label ?? row.label ?? articleId;
      if (!label) return;
      seen.set(`basis:${articleId}`, { id: articleId, label, type: "basis" });
    });

  // SKU-aanpak: na hard reset zijn basis-/samengestelde productlijsten leeg.
  // Gebruik dan de actieve activaties om de beschikbare formats (verpakking) te tonen.
  if (seen.size === 0 && formatArticleById.size > 0) {
    (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).forEach((act) => {
      const skuId = String((act as any)?.sku_id ?? "").trim();
      const sku = skuId ? (skuById.get(skuId) ?? null) : null;
      const formatId = String((sku as any)?.format_article_id ?? "").trim();
      const articleId = String((sku as any)?.article_id ?? "").trim();
      if (formatId) {
        const format = formatArticleById.get(formatId);
        if (format) {
          seen.set(`basis:${format.id}`, { id: format.id, label: format.label, type: "basis" });
        }
        return;
      }
      if (articleId) {
        const bundle = bundleArticleById.get(articleId);
        if (bundle) {
          seen.set(`basis:${bundle.id}`, { id: bundle.id, label: bundle.label, type: "basis" });
        }
      }
    });
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
}

export function buildBasisProductParentMap(samengesteldeProducten: GenericRecord[]) {
  const parents = new Map<string, { productId: string; label: string; score: number }[]>();
  samengesteldeProducten.forEach((row) => {
    const compositeId = String(row.id ?? "");
    const compositeLabel = String(row.omschrijving ?? "");
    const basisRows = Array.isArray((row as any).basisproducten) ? ((row as any).basisproducten as GenericRecord[]) : [];
    basisRows.forEach((basisRow) => {
      const basisId = String((basisRow as any).basisproduct_id ?? "");
      if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
      const current = parents.get(basisId) ?? [];
      const scoreRaw = Number((basisRow as any)?.aantal ?? 0);
      const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
      current.push({ productId: compositeId, label: compositeLabel, score });
      parents.set(basisId, current);
    });
  });

  // If a basisproduct is used in multiple composed products, pick the "primary" parent deterministically.
  // We default to the highest quantity usage (e.g. 24x33cl over 12x33cl), then fall back to label/id ordering.
  const resolved = new Map<string, { productId: string; label: string }>();
  for (const [basisId, items] of parents.entries()) {
    if (!items || items.length === 0) continue;
    const sorted = [...items].sort((left, right) => {
      const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
      if (labelDiff !== 0) return labelDiff;
      return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
    });
    const best = sorted[0];
    if (!best) continue;
    resolved.set(basisId, { productId: best.productId, label: best.label });
  }
  return resolved;
}
