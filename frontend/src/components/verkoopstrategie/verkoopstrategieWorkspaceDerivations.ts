"use client";

import type { StrategyRow } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import { normalizeUnitLabel } from "@/lib/skuLabels";

type GenericRecord = Record<string, unknown>;

export function stripInternal(row: StrategyRow) {
  const { _uiId, sell_in_margins, sell_in_prices, ...rest } = row;

  const stripEmpty = (src: Record<string, number | ""> | undefined) => {
    const out: Record<string, number> = {};
    Object.entries(src ?? {}).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      out[key] = parsed;
    });
    return out;
  };

  const cleanedMargins = stripEmpty(sell_in_margins as any);
  const cleanedPrices = (() => {
    const out: Record<string, number | ""> = {};
    Object.entries(sell_in_prices ?? {}).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      out[key] = parsed;
    });
    return out;
  })();
  return {
    ...rest,
    kanaalmarges: cleanedMargins,
    sell_in_margins: cleanedMargins,
    kanaalprijzen: cleanedPrices,
    sell_in_prices: cleanedPrices
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
  formatArticleById,
}: {
  formatArticleById: Map<string, { id: string; label: string }>;
}) {
  const seen = new Map<string, { id: string; label: string; type: "basis" | "samengesteld" }>();
  // SKU-aanpak: voeg ook verkoopbare artikelen (bundle/article SKUs) toe als "producttype" bron.
  // Dit is géén fallback: verkoopstrategie moet dezelfde centrale verkoopbare lijst kunnen beprijzen
  // als adviesprijzen/offertes (cost_plus items met actieve kostprijs).
  formatArticleById.forEach((row) => {
    const id = String(row.id ?? "").trim();
    const label = normalizeUnitLabel(row.label || id);
    if (!id || !label) return;
    seen.set(`basis:${id}`, { id, label, type: "basis" });
  });

  const uniqueByVisibleLabel = new Map<string, { id: string; label: string; type: "basis" | "samengesteld" }>();
  [...seen.values()].forEach((row) => {
    const label = normalizeUnitLabel(row.label);
    const key = label.trim().toLowerCase();
    if (!key) return;
    uniqueByVisibleLabel.set(key, { ...row, label });
  });

  return [...uniqueByVisibleLabel.values()].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
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
