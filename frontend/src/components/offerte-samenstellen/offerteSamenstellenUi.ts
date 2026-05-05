export function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function clampNumber(value: unknown, fallback: number) {
  const num = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

