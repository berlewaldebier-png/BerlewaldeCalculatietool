type GenericRecord = Record<string, unknown>;

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeFactuurRegel(raw?: GenericRecord): GenericRecord {
  const row = raw ? cloneValue(raw) : {};
  return {
    id: String(row.id ?? createId()),
    aantal: Number(row.aantal ?? 0),
    eenheid: String(row.eenheid ?? ""),
    liters: Number(row.liters ?? 0),
    subfactuurbedrag: Number(row.subfactuurbedrag ?? 0),
    afvulkosten_fust:
      row.afvulkosten_fust === null || row.afvulkosten_fust === undefined
        ? null
        : Number(row.afvulkosten_fust),
  };
}

export function normalizeFactuur(raw?: GenericRecord): GenericRecord {
  const factuur = raw ? cloneValue(raw) : {};
  const rows = Array.isArray(factuur.factuurregels)
    ? (factuur.factuurregels as GenericRecord[]).map((row) => normalizeFactuurRegel(row))
    : [];

  return {
    id: String(factuur.id ?? createId()),
    factuurnummer: String(factuur.factuurnummer ?? ""),
    factuurdatum: String(factuur.factuurdatum ?? ""),
    verzendkosten: Number(factuur.verzendkosten ?? 0),
    overige_kosten: Number(factuur.overige_kosten ?? 0),
    factuurregels: rows,
  };
}
