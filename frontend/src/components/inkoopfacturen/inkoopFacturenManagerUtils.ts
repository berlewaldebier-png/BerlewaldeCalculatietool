"use client";

import { cloneValue, createId, normalizeFactuur, normalizeFactuurRegel } from "@/components/inkoopfacturen/inkoopFacturenUtils";

export type GenericRecord = Record<string, unknown>;

export function inferSkuType(
  row: GenericRecord,
  basisgegevens: GenericRecord
): "bier" | "artikel" | "dienst" {
  const explicit = String((basisgegevens as any)?.sku_type ?? "").trim().toLowerCase();
  if (explicit === "bier" || explicit === "artikel" || explicit === "dienst") {
    return explicit;
  }
  const hasBierId = String(row.bier_id ?? "").trim() !== "";
  if (hasBierId) return "bier";
  const uom = String((basisgegevens as any)?.uom ?? "").trim().toLowerCase();
  if (uom === "uur") return "dienst";
  return "artikel";
}

export function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneValue(raw);
  const basisgegevens =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};
  const soort =
    typeof row.soort_berekening === "object" && row.soort_berekening !== null
      ? (row.soort_berekening as GenericRecord)
      : {};
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};

  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.jaar = Number(row.jaar ?? (basisgegevens as any).jaar ?? 0);
  row.versie_nummer = Number(row.versie_nummer ?? 0);
  row.brontype = String(row.brontype ?? "stam");
  row.bron_id = String(row.bron_id ?? "");
  row.bron_berekening_id = String(row.bron_berekening_id ?? "");
  row.is_actief = Boolean(row.is_actief ?? false);
  row.effectief_vanaf = String(row.effectief_vanaf ?? "");
  const skuType = inferSkuType(row, basisgegevens);
  row.basisgegevens = {
    jaar: Number((basisgegevens as any).jaar ?? 0),
    sku_type: skuType,
    uom: String((basisgegevens as any).uom ?? (skuType === "dienst" ? "uur" : "stuk")),
    biernaam: String((basisgegevens as any).biernaam ?? ""),
    stijl: String((basisgegevens as any).stijl ?? "")
  };
  row.soort_berekening = {
    type: String((soort as any).type ?? "")
  };
  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen: Array.isArray((inkoop as any).facturen)
        ? ((inkoop as any).facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
        : [],
      factuurnummer: String((inkoop as any).factuurnummer ?? ""),
      factuurdatum: String((inkoop as any).factuurdatum ?? ""),
      verzendkosten: Number((inkoop as any).verzendkosten ?? 0),
      overige_kosten: Number((inkoop as any).overige_kosten ?? 0),
      factuurregels: Array.isArray((inkoop as any).factuurregels)
        ? ((inkoop as any).factuurregels as GenericRecord[]).map((regel) => normalizeFactuurRegel(regel))
        : []
    }
  };
  return row;
}
