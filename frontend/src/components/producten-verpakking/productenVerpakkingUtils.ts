export type GenericRecord = Record<string, unknown>;

export function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function determineDefaultYear(rows: GenericRecord[]) {
  const years = rows
    .map((row) => toNumber((row as any)?.jaar, 0))
    .filter((year) => Number.isFinite(year) && year > 0);
  return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
}

