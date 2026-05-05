export type GenericRecord = Record<string, unknown>;

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function unwrapDatasetListPayload(value: unknown): GenericRecord[] | null {
  if (Array.isArray(value)) {
    return value as GenericRecord[];
  }
  if (value && typeof value === "object") {
    const data = (value as any).data;
    if (Array.isArray(data)) {
      return data as GenericRecord[];
    }
  }
  return null;
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const text = String(value).trim();
  if (!text) return null;

  // Browser locale can produce `6,6` in `<input type="number">` (NL locale).
  const normalized = text.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOptionalNumberFromInput(value: string): number | null {
  if (!String(value ?? "").trim()) return null;
  return parseOptionalNumber(value);
}

export function syncPrimaryInkoopFactuur(row: GenericRecord) {
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null ? (invoer.inkoop as GenericRecord) : {};
  const topLevelFactuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];
  const facturen = Array.isArray(inkoop.facturen) ? ([...(inkoop.facturen as GenericRecord[])] as GenericRecord[]) : [];
  const primaryFactuur = (facturen[0] as GenericRecord | undefined) ?? { id: createId() };

  facturen[0] = {
    ...primaryFactuur,
    id: String(primaryFactuur.id ?? createId()),
    factuurnummer: String(inkoop.factuurnummer ?? ""),
    factuurdatum: String(inkoop.factuurdatum ?? ""),
    verzendkosten: Number(inkoop.verzendkosten ?? 0),
    overige_kosten: Number(inkoop.overige_kosten ?? 0),
    factuurregels: cloneRecord(topLevelFactuurregels),
  };

  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen,
    },
  };
}
