export function toSummaryValue(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "-";
}

export function roundValue(value: number, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatDecimalValue(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }

  return roundValue(value, decimals).toFixed(decimals);
}

export function formatCurrencyDisplay(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  return `\u20AC ${roundValue(numericValue, 2).toFixed(2)}`;
}

