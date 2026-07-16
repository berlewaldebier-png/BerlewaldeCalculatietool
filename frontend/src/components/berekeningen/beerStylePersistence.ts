import {
  cloneRecord,
  parseOptionalNumber,
} from "@/components/berekeningen/berekeningenWizardUtils";

type GenericRecord = Record<string, unknown>;

export type PreparedBeerStylePersistence = {
  beerRecord: GenericRecord;
  costRecord: GenericRecord;
  beerWasExisting: boolean;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function findBeerIdentityRow(
  beerName: string,
  alcoholpercentage: number | null,
  beers: GenericRecord[]
): GenericRecord | null {
  const wantedName = beerName.trim().toLowerCase();
  if (!wantedName) return null;
  return (
    beers.find((row) => {
      const names = [row.biernaam, row.naam, row.name].map((value) => text(value).toLowerCase());
      if (!names.includes(wantedName)) return false;
      if (alcoholpercentage === null) return true;
      const rowAlcohol = parseOptionalNumber(row.alcoholpercentage);
      return rowAlcohol === null || Math.abs(rowAlcohol - alcoholpercentage) < 0.0001;
    }) ?? null
  );
}

export function prepareBeerStylePersistence({
  costRecord,
  beers,
  createId,
  nowIso,
}: {
  costRecord: GenericRecord;
  beers: GenericRecord[];
  createId: () => string;
  nowIso: string;
}): PreparedBeerStylePersistence | null {
  const nextCostRecord = cloneRecord(costRecord);
  const basis = ((nextCostRecord.basisgegevens as GenericRecord) ?? {}) as GenericRecord;
  const skuType = text(basis.sku_type || "bier").toLowerCase();
  if (skuType !== "bier") return null;

  const style = text(basis.stijl);
  if (!style) return null;

  const beerName = text(basis.biernaam);
  const alcoholpercentage = parseOptionalNumber(basis.alcoholpercentage);
  if (!beerName) {
    throw new Error("Vul eerst de biernaam in voordat je een stijl opslaat.");
  }
  if (alcoholpercentage === null) {
    throw new Error("Vul eerst een geldig alcoholpercentage in voordat je een stijl opslaat.");
  }

  const sourceBeers = Array.isArray(beers) ? beers : [];
  const existingBeerId = text(basis.bier_id || nextCostRecord.bier_id);
  const existingById = existingBeerId
    ? sourceBeers.find((row) => text(row.id) === existingBeerId) ?? null
    : null;
  const existing = existingById ?? findBeerIdentityRow(beerName, alcoholpercentage, sourceBeers);
  const beerId = text(existing?.id) || existingBeerId || createId();

  const beerRecord: GenericRecord = {
    ...(existing ?? {}),
    id: beerId,
    biernaam: beerName,
    naam: beerName,
    name: beerName,
    stijl: style,
    alcoholpercentage,
    belastingsoort: text(basis.belastingsoort || "Accijns"),
    tarief_accijns: text(basis.tarief_accijns || "Hoog"),
    btw_tarief: text(basis.btw_tarief || "21%"),
    actief: true,
    active: true,
    updated_at: nowIso,
    created_at: text(existing?.created_at) || nowIso,
  };

  nextCostRecord.bier_id = beerId;
  nextCostRecord.basisgegevens = {
    ...basis,
    stijl: style,
    bier_id: beerId,
  };

  return {
    beerRecord,
    costRecord: nextCostRecord,
    beerWasExisting: Boolean(existing),
  };
}
