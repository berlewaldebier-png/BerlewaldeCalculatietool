type GenericRecord = Record<string, unknown>;

export type TariefRow = {
  id: string;
  jaar: number;
  tarief_hoog: number;
  tarief_laag: number;
  verbruikersbelasting: number;
};

export type PackagingComponent = {
  id: string;
  omschrijving: string;
};

export type PackagingPriceRow = {
  id: string;
  verpakkingsonderdeel_id: string;
  jaar: number;
  prijs_per_stuk: number;
};

export function normalizeTariefRow(raw: GenericRecord): TariefRow {
  return {
    id: String(raw.id ?? ""),
    jaar: Number(raw.jaar ?? 0),
    tarief_hoog: Number(raw.tarief_hoog ?? 0),
    tarief_laag: Number(raw.tarief_laag ?? 0),
    verbruikersbelasting: Number(raw.verbruikersbelasting ?? 0),
  };
}

export function normalizePackagingComponent(raw: GenericRecord): PackagingComponent {
  return {
    id: String(raw.id ?? ""),
    omschrijving: String(raw.omschrijving ?? ""),
  };
}

export function normalizePackagingPriceRow(raw: GenericRecord): PackagingPriceRow {
  return {
    id: String(raw.id ?? ""),
    verpakkingsonderdeel_id: String(raw.verpakkingsonderdeel_id ?? ""),
    jaar: Number(raw.jaar ?? 0),
    prijs_per_stuk: Number(raw.prijs_per_stuk ?? 0),
  };
}

export function clampInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

export function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function formatEur(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

export function snapshotProductCostFromRecord(record: any, productId: string) {
  const costLines = record?.cost_lines ?? record?.costLines ?? [];
  const rows = Array.isArray(costLines) ? costLines : [];
  const found = rows.find((row: any) => String(row.product_id ?? "") === productId) ?? null;
  if (!found) return null;
  return {
    kostprijs: Number(found.kostprijs ?? 0),
    primaireKosten: Number(found.primaire_kosten ?? found.primaireKosten ?? 0),
    productType: String(found.product_type ?? ""),
    productLabel: String(found.verpakking ?? found.verpakkingseenheid ?? found.omschrijving ?? productId),
  };
}

