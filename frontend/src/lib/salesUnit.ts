import { getPackagingDefaultsForLabel } from "@/lib/packagingConfig";

export type SalesUnitLabel = string;

export type SalesUnit = {
  salesUnitLabel: SalesUnitLabel;
  litersPerSalesUnit: number | null;
  unitsPerLayer: number | null;
  unitsPerPallet: number | null;
  contributesToLiters: boolean;
  contributesToMargin: boolean;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferLabelFromPackagingType(packagingType: string): SalesUnitLabel | null {
  const value = String(packagingType ?? "").trim().toLowerCase();
  if (!value) return null;
  const head = value.split("-")[0]?.trim();
  return head || null;
}

function inferLabelFromFormatId(formatArticleId: string): SalesUnitLabel | null {
  const value = String(formatArticleId ?? "").trim().toLowerCase();
  if (!value) return null;
  // Deterministic: format IDs are stable and already encode the packaging family.
  if (value.includes("fust")) return "fust";
  if (value.includes("keg")) return "fust";
  if (value.includes("doos")) return "doos";
  if (value.includes("case")) return "doos";
  if (value.includes("fles")) return "fles";
  if (value.includes("blik")) return "blik";
  return null;
}

function normalizeLabel(raw: SalesUnitLabel | null): SalesUnitLabel {
  const label = String(raw ?? "").trim().toLowerCase();
  return label || "stuk";
}

export function buildSalesUnit(params: {
  label: SalesUnitLabel | null;
  litersPerSalesUnit: number | null;
  contributesToLiters: boolean;
  contributesToMargin: boolean;
}): SalesUnit {
  const label = normalizeLabel(params.label);
  const defaults = getPackagingDefaultsForLabel(label);

  return {
    salesUnitLabel: label,
    litersPerSalesUnit:
      params.litersPerSalesUnit && params.litersPerSalesUnit > 0
        ? params.litersPerSalesUnit
        : null,
    unitsPerLayer: defaults.unitsPerLayer,
    unitsPerPallet: defaults.unitsPerPallet,
    contributesToLiters: Boolean(params.contributesToLiters),
    contributesToMargin: Boolean(params.contributesToMargin),
  };
}

export function resolveSalesUnitForProduct(params: {
  skuKind: string;
  packagingType?: string | null;
  formatArticleId?: string | null;
  litersPerUnit?: number | null;
}): SalesUnit {
  const skuKind = String(params.skuKind ?? "").trim().toLowerCase();
  const packagingType = String(params.packagingType ?? "").trim();
  const formatArticleId = String(params.formatArticleId ?? "").trim();

  const inferredLabel =
    inferLabelFromPackagingType(packagingType) ??
    inferLabelFromFormatId(formatArticleId) ??
    null;

  const litersPerSalesUnit = toNumber(params.litersPerUnit);

  // Default rules:
  // - Beer formats / bundles contribute to margin
  // - Liters are only meaningful when litersPerSalesUnit is present
  const contributesToMargin = true;
  const contributesToLiters =
    (skuKind === "beer_format" || skuKind === "bundle" || skuKind === "inkoop") &&
    Boolean(litersPerSalesUnit && litersPerSalesUnit > 0);

  return buildSalesUnit({
    label: inferredLabel,
    litersPerSalesUnit,
    contributesToLiters,
    contributesToMargin,
  });
}

