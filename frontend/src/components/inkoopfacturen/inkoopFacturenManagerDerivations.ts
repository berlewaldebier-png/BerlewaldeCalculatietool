import {
  cloneValue,
  createId,
  normalizeFactuur,
} from "@/components/inkoopfacturen/inkoopFacturenUtils";
import { normalizeBerekening, type GenericRecord } from "@/components/inkoopfacturen/inkoopFacturenManagerUtils";

export type PendingAction = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function isInkoopRecord(row: GenericRecord) {
  return String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() === "inkoop";
}

export function isMeaningfulFactuur(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  return (
    String(factuur.factuurnummer ?? "").trim() !== "" ||
    String(factuur.factuurdatum ?? "").trim() !== "" ||
    Number(factuur.verzendkosten ?? 0) > 0 ||
    Number(factuur.overige_kosten ?? 0) > 0 ||
    regels.some(
      (regel) =>
        Number(regel.aantal ?? 0) > 0 ||
        String(regel.eenheid ?? "").trim() !== "" ||
        Number(regel.liters ?? 0) > 0 ||
        Number(regel.subfactuurbedrag ?? 0) > 0
    )
  );
}

export function sanitizeFacturen(facturen: GenericRecord[]) {
  return facturen.map((factuur) => normalizeFactuur(factuur)).filter((factuur) => isMeaningfulFactuur(factuur));
}

export function isConceptFactuurVersie(row: GenericRecord) {
  return (
    String(row.status ?? "").toLowerCase() === "concept" &&
    String(row.brontype ?? "").toLowerCase() === "factuur"
  );
}

export function getRecordYear(row: GenericRecord) {
  return Number(row.jaar ?? ((row.basisgegevens as GenericRecord | undefined)?.jaar ?? 0));
}

export function setInkoopFacturen(row: GenericRecord, facturen: GenericRecord[]) {
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};
  const normalized = facturen.map((factuur) => normalizeFactuur(factuur));
  const primary = normalized[0] ?? normalizeFactuur();
  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen: normalized,
      factuurnummer: String(primary.factuurnummer ?? ""),
      factuurdatum: String(primary.factuurdatum ?? ""),
      verzendkosten: Number(primary.verzendkosten ?? 0),
      overige_kosten: Number(primary.overige_kosten ?? 0),
      factuurregels: Array.isArray(primary.factuurregels) ? primary.factuurregels : [],
    },
  };
}

export function getInkoopFacturen(row: GenericRecord) {
  const inkoop = (((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {}) as GenericRecord;
  return Array.isArray(inkoop.facturen)
    ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
    : [];
}

export function createFactuurVersieFromSource(source: GenericRecord, factuur: GenericRecord) {
  const nowIso = new Date().toISOString();
  const draft = cloneValue(source);
  draft.id = createId();
  draft.status = "concept";
  draft.is_actief = false;
  draft.effectief_vanaf = "";
  draft.versie_nummer = Number(draft.versie_nummer ?? 0) || 0;
  draft.brontype = "factuur";
  draft.calculation_variant = "factuur";
  draft.bron_id = String(factuur.id ?? "");
  draft.bron_berekening_id = String(source.id ?? "");
  draft.created_at = nowIso;
  draft.updated_at = nowIso;
  draft.aangemaakt_op = nowIso;
  draft.aangepast_op = nowIso;
  draft.finalized_at = "";
  draft.resultaat_snapshot = {};
  setInkoopFacturen(draft, [factuur]);
  return normalizeBerekening(draft);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value || 0);
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

export function getFactuurRegelAfvulkostenFust(regel: GenericRecord) {
  return Number((regel as any)?.afvulkosten_fust ?? 0);
}

export function calculateInkoopExtraKostenPerRegel(factuur: GenericRecord, regelCount: number) {
  if (regelCount <= 0) return 0;
  return (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regelCount;
}

export function calculateInkoopPrijsPerEenheid(regel: GenericRecord, extraKostenPerRegel: number) {
  const aantal = Number(regel.aantal ?? 0);
  if (aantal <= 0) return 0;
  return (
    (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel + getFactuurRegelAfvulkostenFust(regel)) /
    aantal
  );
}

export function getFactuurRegelLiters(regel: GenericRecord, litersPerUnitById: Map<string, number>) {
  const aantal = Number(regel.aantal ?? 0);
  const litersPerUnit = litersPerUnitById.get(String(regel.eenheid ?? "").trim()) ?? 0;
  if (litersPerUnit > 0 && aantal > 0) {
    return roundValue(aantal * litersPerUnit);
  }
  return Number(regel.liters ?? 0);
}

export function calculateInkoopPrijsPerLiter(
  regel: GenericRecord,
  extraKostenPerRegel: number,
  litersPerUnitById: Map<string, number>
) {
  const liters = getFactuurRegelLiters(regel, litersPerUnitById);
  if (liters <= 0) return 0;
  return (
    (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel + getFactuurRegelAfvulkostenFust(regel)) /
    liters
  );
}

export function getFactuurTotals(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  const liters = regels.reduce((sum, regel) => sum + Number(regel.liters ?? 0), 0);
  const bedrag =
    regels.reduce((sum, regel) => sum + Number(regel.subfactuurbedrag ?? 0), 0) +
    Number(factuur.verzendkosten ?? 0) +
    Number(factuur.overige_kosten ?? 0);
  return { liters, bedrag, regels: regels.length };
}

export function isDraftValid(factuur: GenericRecord) {
  if (String(factuur.factuurnummer ?? "").trim() === "") {
    return false;
  }
  if (String(factuur.factuurdatum ?? "").trim() === "") {
    return false;
  }
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  if (regels.length === 0) {
    return false;
  }
  return regels.every(
    (regel) =>
      Number(regel.aantal ?? 0) > 0 &&
      String(regel.eenheid ?? "").trim() !== "" &&
      Number(regel.liters ?? 0) > 0 &&
      Number(regel.subfactuurbedrag ?? 0) > 0
  );
}

export function getProductUnitOptions(basisproducten: GenericRecord[], samengesteldeProducten: GenericRecord[]) {
  return [
    ...basisproducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.inhoud_per_eenheid_liter ?? 0),
    })),
    ...samengesteldeProducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.totale_inhoud_liter ?? 0),
    })),
  ]
    .filter((option) => option.id && option.label)
    .sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
}
