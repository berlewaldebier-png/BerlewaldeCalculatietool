type GenericRecord = Record<string, unknown>;

export type TarievenHeffingenRow = {
  jaar: number;
  tarief_hoog?: number;
  tarief_laag?: number;
  verbruikersbelasting?: number;
};

export type AccijnsInput = {
  litersPerProduct: number;
  basisgegevens: GenericRecord;
  tarievenHeffingenRows: GenericRecord[] | TarievenHeffingenRow[];
  year: number;
};

function parseOptionalNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function clampPct(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

function findTarievenRow(
  tarievenHeffingenRows: GenericRecord[] | TarievenHeffingenRow[],
  year: number
): TarievenHeffingenRow {
  const found =
    (Array.isArray(tarievenHeffingenRows)
      ? tarievenHeffingenRows.find((row) => Number((row as any)?.jaar ?? 0) === year)
      : null) ?? {};
  return {
    jaar: Number((found as any).jaar ?? year),
    tarief_hoog: Number((found as any).tarief_hoog ?? 0),
    tarief_laag: Number((found as any).tarief_laag ?? 0),
    verbruikersbelasting: Number((found as any).verbruikersbelasting ?? 0)
  };
}

function calculateAccijnsPerProductCore({
  litersPerProduct,
  basisgegevens,
  tarievenHeffingenRows,
  year
}: AccijnsInput): number {
  const tarieven = findTarievenRow(tarievenHeffingenRows, year);

  const belastingsoort = String((basisgegevens as any).belastingsoort ?? "").trim().toLowerCase();
  const alcoholpercentage = (parseOptionalNumber((basisgegevens as any).alcoholpercentage) ?? 0) / 100;
  const tariefAccijns = String((basisgegevens as any).tarief_accijns ?? "").trim().toLowerCase();

  if (!Number.isFinite(litersPerProduct) || litersPerProduct <= 0) {
    return 0;
  }

  if (belastingsoort === "verbruiksbelasting") {
    return Number(tarieven.verbruikersbelasting ?? 0) * (litersPerProduct / 100);
  }

  const tarief =
    tariefAccijns === "laag"
      ? Number(tarieven.tarief_laag ?? 0)
      : Number(tarieven.tarief_hoog ?? 0);
  return tarief * alcoholpercentage * litersPerProduct;
}

// Central, canonical frontend accijns calculation. This matches Kostprijsbeheer (BerekeningenWizard).
//
// Note: we accept both the new object-style signature and the legacy positional signature
// to avoid runtime breakage during refactors, while keeping the same math.
export function calculateAccijnsPerProduct(
  input: AccijnsInput | number,
  basisgegevens?: GenericRecord,
  tarievenHeffingenRows?: GenericRecord[] | TarievenHeffingenRow[],
  year?: number
): number {
  if (typeof input === "number") {
    return calculateAccijnsPerProductCore({
      litersPerProduct: input,
      basisgegevens: (basisgegevens ?? {}) as GenericRecord,
      tarievenHeffingenRows: (tarievenHeffingenRows ?? []) as any,
      year: Number(year ?? 0)
    });
  }
  return calculateAccijnsPerProductCore(input);
}

export type VasteKostenRow = {
  bedrag_per_jaar?: number;
  herverdeel_pct?: number;
  kostensoort?: string;
};

export type ProductieYear = {
  hoeveelheid_inkoop_l?: number;
  hoeveelheid_productie_l?: number;
};

function sumVasteKostenByType(rows: VasteKostenRow[], kostensoort: "direct" | "indirect") {
  const directRows = rows.filter((row) => {
    const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
    return normalized.includes("direct") && !normalized.includes("indirect");
  });
  const indirectRows = rows.filter((row) => String(row.kostensoort ?? "").trim().toLowerCase().includes("indirect"));

  const directBase = directRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
  const indirectBase = indirectRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);

  const directOut = directRows.reduce((sum, row) => {
    const amount = Number(row.bedrag_per_jaar ?? 0);
    const pct = clampPct(row.herverdeel_pct);
    return sum + (amount * pct) / 100;
  }, 0);

  const indirectOut = indirectRows.reduce((sum, row) => {
    const amount = Number(row.bedrag_per_jaar ?? 0);
    const pct = clampPct(row.herverdeel_pct);
    return sum + (amount * pct) / 100;
  }, 0);

  const directAfter = directBase - directOut + indirectOut;
  const indirectAfter = indirectBase - indirectOut + directOut;

  return kostensoort === "indirect" ? indirectAfter : directAfter;
}

export function vasteKostenPerLiter(params: {
  year: number;
  productieYear: ProductieYear | null | undefined;
  vasteKostenRows: VasteKostenRow[];
  kostensoort: "direct" | "indirect";
  delerType: "productie" | "inkoop";
}): number {
  const { productieYear, vasteKostenRows, kostensoort, delerType } = params;
  const totaleVasteKosten = sumVasteKostenByType(vasteKostenRows, kostensoort);
  if (totaleVasteKosten <= 0) return 0;

  const deler =
    delerType === "inkoop"
      ? Number(productieYear?.hoeveelheid_inkoop_l ?? 0)
      : Number(productieYear?.hoeveelheid_productie_l ?? 0);

  if (!Number.isFinite(deler) || deler <= 0) return 0;
  return totaleVasteKosten / deler;
}
