export type GenericRecord = Record<string, unknown>;

export type Uom = "stuk" | "pakket" | "uur" | "liter";

export function text(value: unknown) {
  return String(value ?? "").trim();
}

export function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeUom(raw: unknown): Uom {
  const value = text(raw).toLowerCase();
  if (value === "uur") return "uur";
  if (value === "pakket") return "pakket";
  if (value === "liter" || value === "l") return "liter";
  return "stuk";
}

export function moneyEUR(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

