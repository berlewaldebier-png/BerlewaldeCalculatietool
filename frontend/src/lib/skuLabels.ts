export function normalizeSkuLabel(value: unknown): string {
  const raw = String(value ?? "").trim();
  const parts = raw.split(" - ").map((part) => part.trim()).filter(Boolean);
  const withoutRepeatedPrefix =
    parts.length >= 3 && parts[0].toLowerCase() === parts[1].toLowerCase()
      ? [parts[0], ...parts.slice(2)].join(" - ")
      : raw;
  return withoutRepeatedPrefix.replace(
    /\b(\d+)\s*[x×*]\s*(\d+)\s*cl\b/gi,
    (_match, count, volume) => `${count} * ${volume}cl`
  );
}

export function normalizeUnitLabel(value: unknown): string {
  const raw = normalizeSkuLabel(value);
  if (!raw) return "";
  const unitMatch = raw.match(/\b(fles(?:je)?|doos|fust|vat|blik|can|sixpack|krat|pakket)\b.*$/i);
  return (unitMatch?.[0] ?? raw).replace(/\s{2,}/g, " ").trim();
}

export function makeBeerSkuLabel(beerName: unknown, unitLabel: unknown): string {
  const beer = String(beerName ?? "").trim();
  const unit = normalizeUnitLabel(unitLabel);
  if (!beer) return unit;
  if (!unit) return beer;
  return `${beer} - ${unit}`;
}
