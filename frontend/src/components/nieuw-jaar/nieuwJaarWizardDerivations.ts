"use client";

type GenericRecord = Record<string, unknown>;

export function createUiId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function vasteKostenKey(row: { omschrijving?: unknown; kostensoort?: unknown }) {
  return `${String(row.omschrijving ?? "").trim().toLowerCase()}||${String(row.kostensoort ?? "")
    .trim()
    .toLowerCase()}`;
}

export function sanitizeVasteKostenTarget(rows: Array<Record<string, unknown>>): GenericRecord[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      id: "",
      omschrijving: String((row as any).omschrijving ?? ""),
      kostensoort: String((row as any).kostensoort ?? ""),
      exact_rekening: String((row as any).exact_rekening ?? ""),
      cost_pool: String((row as any).cost_pool ?? ""),
      domain: String((row as any).domain ?? (row as any).domein ?? "production") || "production",
      allocation_driver: String((row as any).allocation_driver ?? ""),
      allocation_scope: String((row as any).allocation_scope ?? "all") || "all",
      bedrag_per_jaar: Number((row as any).bedrag_per_jaar ?? 0),
      herverdeel_pct: Number((row as any).herverdeel_pct ?? 0),
      ignored: Boolean((row as any).ignored ?? false)
    }));
}

