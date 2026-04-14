"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";

import { usePageShellWizardSidebar } from "@/components/PageShell";
import { API_BASE_URL } from "@/lib/api";
import { vasteKostenPerLiter } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeResultaatSnapshot,
  type ResultaatSnapshot,
  type SummaryProductRow
} from "@/lib/kostprijsSnapshotEngine";

type GenericRecord = Record<string, unknown>;

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type BerekeningProcessType = "Eigen productie" | "Inkoop";

type BerekeningenWizardProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onBackToLanding?: () => void;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onFinish?: () => void;
};

type PendingDeleteDialog = {
  title: string;
  body: string;
  onConfirm: () => void;
};

type ProductUnitOption = {
  id: string;
  label: string;
  litersPerUnit: number;
  source: GenericRecord;
};

type SelectedInkoopProduct = {
  product: GenericRecord;
  prijsPerEenheid: number;
};

type EnrichedFactuurRegel = {
  regel: GenericRecord;
  extraKostenPerRegel: number;
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const text = String(value).trim();
  if (!text) return null;

  // Browser locale can produce `6,6` in `<input type="number">` (NL locale).
  const normalized = text.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumberFromInput(value: string): number | null {
  if (!String(value ?? "").trim()) return null;
  return parseOptionalNumber(value);
}

function syncPrimaryInkoopFactuur(row: GenericRecord) {
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
    factuurregels: cloneRecord(topLevelFactuurregels)
  };

  (invoer.inkoop as GenericRecord) = {
    ...inkoop,
    factuurregels: topLevelFactuurregels,
    facturen
  };
  row.invoer = invoer;
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneRecord(raw);
  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.jaar = Number(row.jaar ?? (row.basisgegevens as GenericRecord | undefined)?.jaar ?? new Date().getFullYear());
  row.versie_nummer = Number(row.versie_nummer ?? 0);
  row.type = String(row.type ?? "");
  row.kostprijs = Number(row.kostprijs ?? 0);
  row.brontype = String(row.brontype ?? "stam");
  row.bron_id = String(row.bron_id ?? "");
  row.effectief_vanaf = String(row.effectief_vanaf ?? "");
  row.is_actief = Boolean(row.is_actief ?? false);
  row.aangemaakt_op = String(row.aangemaakt_op ?? row.created_at ?? "");
  row.aangepast_op = String(row.aangepast_op ?? row.updated_at ?? "");
  row.record_type = String(row.record_type ?? "kostprijsberekening");
  row.calculation_variant = String(row.calculation_variant ?? "origineel");
  row.last_completed_step = Number(row.last_completed_step ?? 1);

  const basisgegevens =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};
  row.basisgegevens = {
    jaar: Number(basisgegevens.jaar ?? new Date().getFullYear()),
    biernaam: String(basisgegevens.biernaam ?? ""),
    stijl: String(basisgegevens.stijl ?? ""),
    alcoholpercentage: parseOptionalNumber(basisgegevens.alcoholpercentage) ?? 0,
    belastingsoort: String(basisgegevens.belastingsoort ?? "Accijns"),
    tarief_accijns: String(basisgegevens.tarief_accijns ?? "Hoog"),
    btw_tarief: String(basisgegevens.btw_tarief ?? "21%")
  };

  const soort =
    typeof row.soort_berekening === "object" && row.soort_berekening !== null
      ? (row.soort_berekening as GenericRecord)
      : {};
  row.soort_berekening = {
    type: String(soort.type ?? "Eigen productie")
  };

  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const ingredienten =
    typeof invoer.ingredienten === "object" && invoer.ingredienten !== null
      ? (invoer.ingredienten as GenericRecord)
      : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};

  row.invoer = {
    ingredienten: {
      regels: Array.isArray(ingredienten.regels) ? ingredienten.regels : [],
      notities: String(ingredienten.notities ?? "")
    },
    inkoop: {
      regels: Array.isArray(inkoop.regels) ? inkoop.regels : [],
      factuurregels: Array.isArray(inkoop.factuurregels) ? inkoop.factuurregels : [],
      factuurnummer: String(inkoop.factuurnummer ?? ""),
      factuurdatum: String(inkoop.factuurdatum ?? ""),
      notities: String(inkoop.notities ?? ""),
      verzendkosten: Number(inkoop.verzendkosten ?? 0),
      overige_kosten: Number(inkoop.overige_kosten ?? 0),
      facturen: Array.isArray(inkoop.facturen) ? inkoop.facturen : []
    }
  };

  row.bier_snapshot =
    typeof row.bier_snapshot === "object" && row.bier_snapshot !== null ? row.bier_snapshot : {};
  row.resultaat_snapshot =
    typeof row.resultaat_snapshot === "object" && row.resultaat_snapshot !== null
      ? row.resultaat_snapshot
      : {};

  syncPrimaryInkoopFactuur(row);

  return row;
}

function createEmptyBerekening(): GenericRecord {
  return normalizeBerekening({
    id: createId(),
    bier_id: "",
    jaar: 0,
    versie_nummer: 0,
    type: "productie",
    kostprijs: 0,
    brontype: "stam",
    bron_id: "",
    effectief_vanaf: "",
    is_actief: false,
    record_type: "kostprijsberekening",
    calculation_variant: "origineel",
    bron_berekening_id: "",
    hercalculatie_reden: "",
    hercalculatie_notitie: "",
    hercalculatie_timestamp: "",
    hercalculatie_basis: {
      ingredienten_regels: []
    },
    status: "concept",
    basisgegevens: {},
    soort_berekening: {
      type: "Eigen productie"
    },
    invoer: {},
    bier_snapshot: {},
    resultaat_snapshot: {},
    jaarovergang: {
      bron_berekening_id: "",
      bron_jaar: 0,
      doel_jaar: 0,
      aangemaakt_via: "",
      created_at: ""
    },
    last_completed_step: 1,
    created_at: "",
    updated_at: "",
    aangemaakt_op: "",
    aangepast_op: "",
    finalized_at: ""
  });
}

function hasMeaningfulFacturen(row: GenericRecord) {
  const inkoop = ((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const gekoppeldeFacturen = facturen.slice(1);

  return gekoppeldeFacturen.some((factuur) => {
    const regels = Array.isArray(factuur.factuurregels)
      ? (factuur.factuurregels as GenericRecord[])
      : [];
    return (
      regels.length > 0 ||
      String(factuur.factuurnummer ?? "").trim() !== "" ||
      String(factuur.factuurdatum ?? "").trim() !== "" ||
      Number(factuur.verzendkosten ?? 0) > 0 ||
      Number(factuur.overige_kosten ?? 0) > 0
    );
  });
}

function getBerekeningProcessType(row: GenericRecord): BerekeningProcessType {
  const rawType = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  return rawType === "Inkoop" ? "Inkoop" : "Eigen productie";
}

function buildWizardSteps(row: GenericRecord): StepDefinition[] {
  const processType = getBerekeningProcessType(row);
  const meaningfulFacturen = processType === "Inkoop" && hasMeaningfulFacturen(row);

  const steps: StepDefinition[] =
    processType === "Inkoop"
      ? [
          {
            id: "basis",
            label: "Basisgegevens",
            description: "Kies bier, jaar en fiscale uitgangspunten"
          },
          {
            id: "type",
            label: "Soort berekening",
            description: "Bevestig dat deze flow op inkoop is gebaseerd"
          },
          {
            id: "input",
            label: "Inkoopfactuur",
            description: "Selecteer producten, aantallen en bronkosten"
          }
        ]
      : [
          {
            id: "basis",
            label: "Basisgegevens",
            description: "Kies bier, jaar en fiscale uitgangspunten"
          },
          {
            id: "type",
            label: "Soort berekening",
            description: "Bevestig dat deze flow op eigen productie draait"
          },
          {
            id: "input",
            label: "Recept",
            description: "Werk recept, ingredienten en opbrengst uit"
          }
        ];

  if (meaningfulFacturen) {
    steps.push({
      id: "facturen",
      label: "Gekoppelde facturen",
      description: "Verdeel extra kosten over facturen en regels"
    });
  }

  steps.push({
    id: "summary",
    label: "Samenvatting",
    description:
      processType === "Inkoop"
        ? "Controleer inkoop, accijns en kostprijs per verpakking"
        : "Controleer ingredienten, verpakking en kostprijs per verpakking"
  });

  return steps;
}

function getLegacySteps(row: GenericRecord): StepDefinition[] {
  const type = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const meaningfulFacturen = type === "Inkoop" && hasMeaningfulFacturen(row);

  const steps: StepDefinition[] = [
    { id: "basis", label: "Basisgegevens", description: "Jaar, bier en fiscale basis" },
    { id: "type", label: "Soort berekening", description: "Kies de berekeningsroute" },
    {
      id: "input",
      label: meaningfulFacturen ? "Initiële kostprijs" : "Berekening",
      description: type === "Inkoop" ? "Factuurinvoer en bronkosten" : "Ingredienten en recept"
    }
  ];

  if (meaningfulFacturen) {
    steps.push({ id: "facturen", label: "Facturen", description: "Meerdere facturen en regels" });
  }

  steps.push({ id: "summary", label: "Samenvatting", description: "Snapshot en productuitkomst" });
  return steps;
}

function getIngredientType(row: GenericRecord) {
  return String(row["ingredient"] ?? "Overig");
}

function getProductDisplayName(row: GenericRecord) {
  return String(row.verpakking ?? row.omschrijving ?? "").trim();
}

function getProductUnitLabel(
  unitId: string,
  options: ProductUnitOption[]
) {
  return options.find((option) => option.id === unitId)?.label ?? "";
}

function getProductUnitOptions(
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[],
  fallbackRow?: GenericRecord
): ProductUnitOption[] {
  const basis = basisproducten
    .map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.inhoud_per_eenheid_liter ?? 0),
      source: row
    }));

  const samengesteld = samengesteldeProducten
    .map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.totale_inhoud_liter ?? 0),
      source: row
    }));

  const fallbackProducten =
    typeof fallbackRow?.resultaat_snapshot === "object" && fallbackRow.resultaat_snapshot !== null
      ? (((fallbackRow.resultaat_snapshot as GenericRecord).producten as GenericRecord) ?? {})
      : {};
  const fallbackBasis = Array.isArray(fallbackProducten.basisproducten)
    ? (fallbackProducten.basisproducten as GenericRecord[])
    : [];
  const fallbackSamengesteld = Array.isArray(fallbackProducten.samengestelde_producten)
    ? (fallbackProducten.samengestelde_producten as GenericRecord[])
    : [];

  const fallbackOptions: ProductUnitOption[] =
    basis.length === 0 && samengesteld.length === 0
      ? [
          ...fallbackBasis.map((row) => ({
            id: String(
              row.product_id ?? row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""
            ),
            label: String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""),
            litersPerUnit: Number(row.liters_per_product ?? row.inhoud_per_eenheid_liter ?? 0),
            source: {
              ...row,
              id: String(
                row.product_id ?? row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""
              ),
              omschrijving: String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""),
              inhoud_per_eenheid_liter: Number(
                row.liters_per_product ?? row.inhoud_per_eenheid_liter ?? 0
              )
            }
          })),
          ...fallbackSamengesteld.map((row) => ({
            id: String(
              row.product_id ?? row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""
            ),
            label: String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""),
            litersPerUnit: Number(row.liters_per_product ?? row.totale_inhoud_liter ?? 0),
            source: {
              ...row,
              id: String(
                row.product_id ?? row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""
              ),
              omschrijving: String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? ""),
              totale_inhoud_liter: Number(
                row.liters_per_product ?? row.totale_inhoud_liter ?? 0
              )
            }
          }))
        ]
      : [];

  return [...basis, ...samengesteld, ...fallbackOptions]
    .filter((option, index, options) => option.id && options.findIndex((item) => item.id === option.id) === index)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function toSummaryValue(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "-";
}

function roundValue(value: number, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatDecimalValue(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }

  return roundValue(value, decimals).toFixed(decimals);
}

function formatCurrencyDisplay(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  return `\u20AC ${roundValue(numericValue, 2).toFixed(2)}`;
}

function getYearProduction(year: number, productie: Record<string, GenericRecord>) {
  return (productie[String(year)] as GenericRecord | undefined) ?? {};
}

function getFactuurRegelLiters(
  regel: GenericRecord,
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[],
  fallbackRow?: GenericRecord
) {
  const aantal = Number(regel.aantal ?? 0);
  const eenheidId = String(regel.eenheid ?? "").trim();
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten, fallbackRow);
  const match = options.find((option) => option.id === eenheidId);

  if (match && aantal > 0) {
    return roundValue(aantal * match.litersPerUnit);
  }

  return Number(regel.liters ?? 0);
}

function calculateEigenProductiePrijsPerEenheid(regel: GenericRecord) {
  const prijs = Number(regel.prijs ?? 0);
  const hoeveelheid = Number(regel.hoeveelheid ?? 0);
  if (hoeveelheid <= 0) {
    return 0;
  }
  return prijs / hoeveelheid;
}

function calculateEigenProductieKostenRecept(regel: GenericRecord) {
  return calculateEigenProductiePrijsPerEenheid(regel) * Number(regel.benodigd_in_recept ?? 0);
}

function calculateInkoopExtraKostenPerRegel(
  inkoop: GenericRecord,
  regelCount: number
) {
  if (regelCount <= 0) {
    return 0;
  }
  return (Number(inkoop.verzendkosten ?? 0) + Number(inkoop.overige_kosten ?? 0)) / regelCount;
}

function calculateInkoopPrijsPerEenheid(
  regel: GenericRecord,
  extraKostenPerRegel: number
) {
  const aantal = Number(regel.aantal ?? 0);
  if (aantal <= 0) {
    return 0;
  }
  return (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel) / aantal;
}

function calculateInkoopPrijsPerLiter(
  regel: GenericRecord,
  extraKostenPerRegel: number,
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[],
  fallbackRow?: GenericRecord
) {
  const liters = getFactuurRegelLiters(
    regel,
    year,
    basisproducten,
    samengesteldeProducten,
    fallbackRow
  );
  if (liters <= 0) {
    return 0;
  }
  return (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel) / liters;
}

function getSelectedInkoopProductRows(
  row: GenericRecord,
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  const inkoop = ((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
  const topLevelFactuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const factuurRegelsUitFacturen = facturen.flatMap((factuur) =>
    Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : []
  );
  const regels = factuurRegelsUitFacturen.length > 0 ? factuurRegelsUitFacturen : topLevelFactuurregels;
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten, row);
  const optionMap = new Map(options.map((option) => [option.id, option.source]));
  const seen = new Set<string>();
  const selected: GenericRecord[] = [];

  for (const regel of regels) {
    const eenheidId = String(regel.eenheid ?? "").trim();
    if (!eenheidId || seen.has(eenheidId)) {
      continue;
    }

    const product = optionMap.get(eenheidId);
    if (!product) {
      continue;
    }

    seen.add(eenheidId);
    selected.push(product);
  }

  return selected;
}

function getInkoopFactuurregels(row: GenericRecord) {
  const inkoop = ((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
  const topLevelFactuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const factuurRegelsUitFacturen = facturen.flatMap((factuur) => {
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
        : 0;
    return regels.map((regel) => ({ regel, extraKostenPerRegel: extraPerRegel }));
  });

  const topLevelExtraPerRegel =
    topLevelFactuurregels.length > 0
      ? (Number(inkoop.verzendkosten ?? 0) + Number(inkoop.overige_kosten ?? 0)) / topLevelFactuurregels.length
      : 0;

  return factuurRegelsUitFacturen.length > 0
    ? factuurRegelsUitFacturen
    : topLevelFactuurregels.map((regel) => ({ regel, extraKostenPerRegel: topLevelExtraPerRegel }));
}

function getSelectedInkoopProducts(
  row: GenericRecord,
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
): SelectedInkoopProduct[] {
  const enrichedRegels = getInkoopFactuurregels(row);
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten, row);
  const optionMap = new Map(options.map((option) => [option.id, option.source]));
  const grouped = new Map<string, { product: GenericRecord; hoogstePrijsPerEenheid: number }>();

  for (const { regel, extraKostenPerRegel } of enrichedRegels) {
    const eenheidId = String(regel.eenheid ?? "").trim();
    const product = optionMap.get(eenheidId);
    if (!product) {
      continue;
    }

    const aantal = Number(regel.aantal ?? 0);
    const prijsPerEenheid =
      aantal > 0 ? (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel) / aantal : 0;
    const bestaand = grouped.get(eenheidId) ?? {
      product,
      hoogstePrijsPerEenheid: 0
    };
    bestaand.hoogstePrijsPerEenheid = Math.max(bestaand.hoogstePrijsPerEenheid, prijsPerEenheid);
    grouped.set(eenheidId, bestaand);
  }

  return [...grouped.values()].map((entry) => ({
    product: entry.product,
    prijsPerEenheid: entry.hoogstePrijsPerEenheid
  }));
}

function expandSelectedInkoopProductsToBasisproducten(
  selectedProducts: SelectedInkoopProduct[],
  basisproducten: GenericRecord[]
) {
  const basisLookup = new Map(basisproducten.map((product) => [String(product.id ?? ""), product]));
  const expanded: SelectedInkoopProduct[] = [];
  const seen = new Set<string>();

  for (const item of selectedProducts) {
    const productId = String((item.product as GenericRecord).id ?? "");
    if (!seen.has(productId)) {
      expanded.push(item);
      seen.add(productId);
    }

    const onderdelen = Array.isArray((item.product as GenericRecord).basisproducten)
      ? ((item.product as GenericRecord).basisproducten as GenericRecord[])
      : [];

    for (const onderdeel of onderdelen) {
      const basisId = String(onderdeel.basisproduct_id ?? "");
      const basisproduct = basisLookup.get(basisId);
      if (!basisproduct || seen.has(basisId)) {
        continue;
      }
      const aantal = Number(onderdeel.aantal ?? 0);

      expanded.push({
        product: basisproduct,
        prijsPerEenheid: aantal > 0 ? item.prijsPerEenheid / aantal : item.prijsPerEenheid
      });
      seen.add(basisId);
    }
  }

  return expanded;
}

function getDirecteVasteKostenPerLiter(
  year: number,
  soort: string,
  productie: Record<string, GenericRecord>,
  vasteKosten: Record<string, GenericRecord[]>
) {
  const rows = Array.isArray(vasteKosten[String(year)]) ? vasteKosten[String(year)] : [];
  const totaleVasteKosten = rows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
  if (totaleVasteKosten <= 0) {
    return 0;
  }

  const productieGegevens = getYearProduction(year, productie);
  const deler =
    soort === "Inkoop"
      ? Number(productieGegevens.hoeveelheid_inkoop_l ?? 0)
      : 0;

  if (deler <= 0) {
    return 0;
  }

  return totaleVasteKosten / deler;
}

function calculateVariabeleKostenPerLiter(
  row: GenericRecord,
  year: number,
  productie: Record<string, GenericRecord>,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();

  if (soort === "Inkoop") {
    const enrichedRegels = getInkoopFactuurregels(row);

    const totaleLiters = enrichedRegels.reduce(
      (sum, item) =>
        sum + getFactuurRegelLiters(item.regel, year, basisproducten, samengesteldeProducten, row),
      0
    );
    const totaleKosten = enrichedRegels.reduce(
      (sum, item) => sum + Number(item.regel.subfactuurbedrag ?? 0) + item.extraKostenPerRegel,
      0
    );

    if (totaleLiters <= 0) {
      return null;
    }

    return totaleKosten / totaleLiters;
  }

  const ingredienten =
    ((((row.invoer as GenericRecord)?.ingredienten as GenericRecord)?.regels as GenericRecord[]) ?? []);
  const batchGrootte = Number(getYearProduction(year, productie).batchgrootte_eigen_productie_l ?? 0);
  const totaleBatchkosten = ingredienten.reduce(
    (sum, regel) => sum + calculateEigenProductieKostenRecept(regel),
    0
  );

  if (batchGrootte <= 0) {
    return null;
  }

  return totaleBatchkosten / batchGrootte;
}


export function BerekeningenWizard({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  productie,
  vasteKosten,
  tarievenHeffingen,
  packagingComponentPrices,
  initialSelectedId,
  startWithNew = false,
  onBackToLanding,
  onRowsChange,
  onFinish
}: BerekeningenWizardProps) {
  const productieJaren = useMemo(
    () =>
      Object.keys(productie ?? {})
        .map((year) => Number(year))
        .filter((year) => Number.isFinite(year) && year > 0)
        .sort((a, b) => b - a),
    [productie]
  );
  const defaultProductieJaar = productieJaren[0] ?? new Date().getFullYear();

  const initialState = useMemo(() => {
    const normalizedRows = initialRows.map((row) => normalizeBerekening(row));

    if (startWithNew || normalizedRows.length === 0) {
      const next = createEmptyBerekening();
      // Default new calculations to a valid production year (keeps UI consistent with stamdata).
      if (productieJaren.length > 0) {
        (next.basisgegevens as GenericRecord).jaar = defaultProductieJaar;
      }
      return {
        rows: [next, ...normalizedRows],
        selectedId: String(next.id)
      };
    }

    const matchedRow = initialSelectedId
      ? normalizedRows.find((row) => String(row.id) === String(initialSelectedId))
      : normalizedRows[0];

    return {
      rows: normalizedRows,
      selectedId: String(matchedRow?.id ?? normalizedRows[0]?.id ?? createEmptyBerekening().id)
    };
  }, [defaultProductieJaar, initialRows, initialSelectedId, productieJaren.length, startWithNew]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const rowsRef = useRef<GenericRecord[]>(initialState.rows);
  const [selectedId, setSelectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteDialog | null>(null);

  const effectiveSelectedId = useMemo(() => {
    if (rows.some((row) => String(row.id) === String(selectedId))) {
      return String(selectedId);
    }
    return String(rows[0]?.id ?? "");
  }, [rows, selectedId]);

  useEffect(() => {
    if (effectiveSelectedId && effectiveSelectedId !== String(selectedId)) {
      setSelectedId(effectiveSelectedId);
    }
  }, [effectiveSelectedId, selectedId]);

  const current =
    rows.find((row) => String(row.id) === effectiveSelectedId) ?? rows[0] ?? createEmptyBerekening();
  const isEditingExisting = !startWithNew;
  const processType = getBerekeningProcessType(current);
  const steps = buildWizardSteps(current);
  const currentIndex = Math.min(activeStepIndex, steps.length - 1);
  const currentStep = steps[currentIndex] ?? steps[0];

  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps,
      activeIndex: currentIndex,
      onStepSelect: setActiveStepIndex
    }),
    [currentIndex, steps]
  );

  usePageShellWizardSidebar(wizardSidebar);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function buildResultaatSnapshot(row: GenericRecord): ResultaatSnapshot {
    const basisgegevens = (row.basisgegevens as GenericRecord) ?? {};
    const jaar = Number(basisgegevens.jaar ?? 0);
    const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
    const biernaam = String(basisgegevens.biernaam ?? "");
    const variabeleKostenPerLiter =
      calculateVariabeleKostenPerLiter(row, jaar, productie, basisproducten, samengesteldeProducten) ?? 0;
    const productieGegevens = getYearProduction(jaar, productie);
    const vasteKostenRows = Array.isArray(vasteKosten[String(jaar)]) ? vasteKosten[String(jaar)] : [];
    const fixedPerLiter =
      soort === "Inkoop"
        ? vasteKostenPerLiter({
            year: jaar,
            productieYear: productieGegevens as any,
            vasteKostenRows: vasteKostenRows as any,
            kostensoort: "indirect",
            delerType: "inkoop"
          })
        : vasteKostenPerLiter({
            year: jaar,
            productieYear: productieGegevens as any,
            vasteKostenRows: vasteKostenRows as any,
            kostensoort: "direct",
            delerType: "productie"
          });
    const geselecteerdeInkoopProducten =
      soort === "Inkoop"
        ? expandSelectedInkoopProductsToBasisproducten(
            getSelectedInkoopProducts(row, jaar, basisproducten, samengesteldeProducten),
            basisproducten
          )
        : [];
    const basisproductenVanJaar =
      soort === "Inkoop"
        ? geselecteerdeInkoopProducten.filter(
            (item) => Number(item.product.inhoud_per_eenheid_liter ?? 0) > 0
          )
        : basisproducten.filter((item) => Number(item.jaar ?? 0) === jaar);
    const samengesteldeVanJaar =
      soort === "Inkoop"
        ? geselecteerdeInkoopProducten.filter(
            (item) => Number(item.product.totale_inhoud_liter ?? 0) > 0
          )
        : samengesteldeProducten.filter((item) => Number(item.jaar ?? 0) === jaar);

    const tarievenRow =
      (Array.isArray(tarievenHeffingen)
        ? (tarievenHeffingen.find((r: any) => Number(r?.jaar ?? 0) === jaar) as any)
        : null) ?? null;

    const includePackagingCosts = soort !== "Inkoop";
    const calcType = soort.trim().toLowerCase() === "inkoop" ? "inkoop" : "eigen_productie";

    const packagingByProductId = new Map<string, number>();
    const litersByProductId = new Map<string, number>();

    const { packagingCost, litersPerUnit } = createPackagingResolvers({
      baseDefs: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
      compositeDefs: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
      packagingPrices: Array.isArray(packagingComponentPrices) ? (packagingComponentPrices as any[]) : []
    });

    function registerProduct(product: any, productType: "basis" | "samengesteld") {
      const id = String(product?.id ?? "");
      if (!id) return;
      const liters = includePackagingCosts ? litersPerUnit(id, productType, jaar) : 0;
      litersByProductId.set(id, Number.isFinite(liters) ? liters : 0);
      const packaging = includePackagingCosts ? packagingCost(id, productType, jaar) : 0;
      packagingByProductId.set(id, Number.isFinite(packaging) ? packaging : 0);
    }

    const basisInputs = basisproductenVanJaar.map((item: any) => {
      const isSelectedInkoopProduct = typeof item === "object" && item !== null && "product" in item;
      const product = isSelectedInkoopProduct ? (item as any).product : item;
      registerProduct(product, "basis");
      const liters = litersByProductId.get(String(product?.id ?? "")) ?? 0;
      const primaryCost = isSelectedInkoopProduct
        ? Number((item as any).prijsPerEenheid ?? 0)
        : variabeleKostenPerLiter * liters;
      return { product, primaryCost };
    });

    const samengInputs = samengesteldeVanJaar.map((item: any) => {
      const isSelectedInkoopProduct = typeof item === "object" && item !== null && "product" in item;
      const product = isSelectedInkoopProduct ? (item as any).product : item;
      registerProduct(product, "samengesteld");
      const liters = litersByProductId.get(String(product?.id ?? "")) ?? 0;
      const primaryCost = isSelectedInkoopProduct
        ? Number((item as any).prijsPerEenheid ?? 0)
        : variabeleKostenPerLiter * liters;
      return { product, primaryCost };
    });

    return computeResultaatSnapshot({
      biernaam,
      soortLabel: soort,
      year: jaar,
      calcType,
      variabeleKostenPerLiter,
      fixedCostPerLiter: fixedPerLiter,
      basisgegevens,
      bierSnapshot: basisgegevens,
      tarievenHeffingenRow: tarievenRow,
      basisRows: basisInputs,
      samengRows: samengInputs,
      includePackagingCosts,
      packagingCost: (productId) =>
        includePackagingCosts ? Number(packagingByProductId.get(String(productId)) ?? 0) : 0,
      litersPerUnit: (productId) => Number(litersByProductId.get(String(productId)) ?? 0),
      productLabel: (product: any) => getProductDisplayName(product)
    });
  }

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    setRows((currentRows) =>
      {
        const nextRows = currentRows.map((row) => {
        if (String(row.id) !== String(current.id)) {
          return row;
        }
        const next = cloneRecord(row);
        updater(next);
        syncPrimaryInkoopFactuur(next);
        next.updated_at = new Date().toISOString();
        return next;
      });
        rowsRef.current = nextRows;
        return nextRows;
      }
    );
  }

  async function handleSave() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const sourceRows = rowsRef.current;
      const payload = sourceRows.map((row) => {
        const next = cloneRecord(row);
        next.bier_snapshot = cloneRecord((row.basisgegevens as GenericRecord) ?? {});
        next.resultaat_snapshot = buildResultaatSnapshot(row);
        return next;
      });
      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, {
        cache: "no-store"
      });
      const refreshedRows = refreshedResponse.ok
        ? ((await refreshedResponse.json()) as GenericRecord[])
        : payload;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      onRowsChange?.(refreshedRows);
      setStatus("Kostprijsversies opgeslagen.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Opslaan mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinalize() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const basis = (current.basisgegevens as GenericRecord) ?? {};
      const biernaam = String(basis.biernaam ?? "").trim();
      const alcoholpercentage = parseOptionalNumber(basis.alcoholpercentage);
      if (biernaam && alcoholpercentage === null) {
        setStatus("Alcoholpercentage is verplicht en moet een geldig getal zijn voordat je kunt afronden.");
        setStatusTone("error");
        return false;
      }

      const nowIso = new Date().toISOString();
      const payload = rowsRef.current.map((row) => {
        const next = cloneRecord(row);
        if (String(next.id) === String(current.id)) {
          next.status = "definitief";
          next.finalized_at = nowIso;
          next.updated_at = nowIso;
        }
        next.bier_snapshot = cloneRecord((next.basisgegevens as GenericRecord) ?? {});
        next.resultaat_snapshot = buildResultaatSnapshot(next);
        return next;
      });
      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error("Afronden mislukt");
      }
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, {
        cache: "no-store"
      });
      const refreshedRows = refreshedResponse.ok
        ? ((await refreshedResponse.json()) as GenericRecord[])
        : payload;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      onRowsChange?.(refreshedRows);
      setStatus("Kostprijsversie definitief gemaakt.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Afronden mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteCurrent() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const payload = rowsRef.current.filter((row) => String(row.id) !== String(current.id));
      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let detail = "";
        try {
          const body = (await response.json()) as { detail?: string };
          detail = typeof body?.detail === "string" ? body.detail : "";
        } catch {
          detail = "";
        }
        throw new Error(detail || "Verwijderen mislukt");
      }
      rowsRef.current = payload;
      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Berekening verwijderd.");
      setStatusTone("success");
      onBackToLanding?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message || "Verwijderen mislukt.");
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivate() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const response = await fetch(`${KOSTPRIJSVERSIES_API}/${String(current.id ?? "")}/activate`, {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error("Activeren mislukt");
      }
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshedResponse.ok
        ? ((await refreshedResponse.json()) as GenericRecord[])
        : rowsRef.current;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      onRowsChange?.(refreshedRows);
      setStatus("Kostprijsversie geactiveerd.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Activeren mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function renderBasisStep() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const belastingsoort = String(basis.belastingsoort ?? "Accijns");
    return (
      <div className="wizard-form-grid">
        <label className="nested-field">
          <span>Biernaam</span>
          <input
            className="dataset-input"
            type="text"
            value={String(basis.biernaam ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).biernaam = event.target.value;
              })
            }
          />
        </label>

        <label className="nested-field">
          <span>Jaar</span>
          <select
            className="dataset-input"
            value={String(basis.jaar ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).jaar = Number(event.target.value);
              })
            }
          >
            <option value="" disabled>
              Kies productiejaar...
            </option>
            {productieJaren.map((year) => (
              <option key={year} value={String(year)}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label className="nested-field">
          <span>Stijl</span>
          <input
            className="dataset-input"
            type="text"
            value={String(basis.stijl ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).stijl = event.target.value;
              })
            }
          />
        </label>

        <label className="nested-field">
          <span>Alcoholpercentage</span>
          <input
            className="dataset-input"
            type="number"
            step="any"
            value={String(basis.alcoholpercentage ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).alcoholpercentage = parseOptionalNumberFromInput(
                  event.target.value
                );
              })
            }
          />
        </label>

        <label className="nested-field">
          <span>BTW-tarief</span>
          <input
            className="dataset-input"
            type="text"
            value={String(basis.btw_tarief ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).btw_tarief = event.target.value;
              })
            }
          />
        </label>
        <label className="nested-field">
          <span>Belastingsoort</span>
          <select
            className="dataset-input"
            value={belastingsoort}
            onChange={(event) =>
              updateCurrent((draft) => {
                const basisgegevens = draft.basisgegevens as GenericRecord;
                basisgegevens.belastingsoort = event.target.value;
                if (event.target.value === "Verbruiksbelasting") {
                  basisgegevens.tarief_accijns = "";
                } else if (String(basisgegevens.tarief_accijns ?? "").trim() === "") {
                  basisgegevens.tarief_accijns = "Hoog";
                }
              })
            }
          >
            <option value="Accijns">Accijns</option>
            <option value="Verbruiksbelasting">Verbruiksbelasting</option>
          </select>
        </label>
        {belastingsoort === "Accijns" ? (
          <label className="nested-field">
            <span>Tarief accijns</span>
            <select
              className="dataset-input"
              value={String(basis.tarief_accijns ?? "Hoog")}
              onChange={(event) =>
                updateCurrent((draft) => {
                  (draft.basisgegevens as GenericRecord).tarief_accijns = event.target.value;
                })
              }
            >
              <option value="Hoog">Hoog</option>
              <option value="Laag">Laag</option>
            </select>
          </label>
        ) : null}
        <label className="nested-field">
          <span>Status</span>
          <input
            className="dataset-input"
            value={String(current.status ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.status = event.target.value;
              })
            }
          />
        </label>
      </div>
    );
  }

  function renderTypeStep() {
    const type = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
    return (
      <div className="wizard-choice-grid">
        {[
          ["Eigen productie", "Gebruik ingredienten en receptregels als basis voor de kostprijs."],
          ["Inkoop", "Gebruik facturen, liters en bijkomende kosten als basis voor de kostprijs."]
        ].map(([option, text]) => (
          <button
            key={option}
            type="button"
            className={`wizard-choice-card${type === option ? " active" : ""}`}
            onClick={() => {
              updateCurrent((draft) => {
                (draft.soort_berekening as GenericRecord).type = option;
              });
              setActiveStepIndex(2);
            }}
          >
            <div className="wizard-choice-title">{option}</div>
            <div className="wizard-choice-text">{text}</div>
          </button>
        ))}
      </div>
    );
  }

  function renderLegacyEigenProductieInput() {
    const ingredienten =
      ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
        []);
    return (
      <div className="wizard-stack">
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Omschrijving</th>
                <th>Hoeveelheid</th>
                <th>Eenheid</th>
                <th>Prijs</th>
                <th>Benodigd in recept</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {ingredienten.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  {[
                    [getIngredientType(regel), "ingredient"],
                    [String(regel.omschrijving ?? ""), "omschrijving"],
                    [String(regel.hoeveelheid ?? ""), "hoeveelheid"],
                    [String(regel.eenheid ?? ""), "eenheid"],
                    [String(regel.prijs ?? ""), "prijs"],
                    [String(regel.benodigd_in_recept ?? ""), "benodigd_in_recept"]
                  ].map(([value, key], cellIndex) => (
                    <td key={`${key}-${cellIndex}`}>
                      <input
                        className="dataset-input"
                        type={
                          key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                            ? "number"
                            : "text"
                        }
                        step={
                          key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                            ? "any"
                            : undefined
                        }
                        value={value}
                        onChange={(event) =>
                          updateCurrent((draft) => {
                            const regels =
                              ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                                .regels as GenericRecord[]) ?? []);
                            const nextValue =
                              key === "hoeveelheid" || key === "prijs" || key === "benodigd_in_recept"
                                ? event.target.value === ""
                                  ? null
                                  : Number(event.target.value)
                                : event.target.value;
                            if (key === "ingredient") {
                              regels[index]["ingredient"] = nextValue;
                            } else {
                              regels[index][key] = nextValue;
                            }
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels.splice(index, 1);
                        })
                      }
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
              {ingredienten.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={7}>
                    Nog geen ingredientregels. Voeg hieronder een regel toe.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              updateCurrent((draft) => {
                const regels =
                  ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                    .regels as GenericRecord[]) ?? []);
                regels.push({
                  id: createId(),
                  ingredient: "Overig",
                  omschrijving: "",
                  hoeveelheid: 0,
                  eenheid: "KG",
                  prijs: 0,
                  benodigd_in_recept: 0
                });
              })
            }
          >
            Ingredient toevoegen
          </button>
        </div>
      </div>
    );
  }

  function renderEigenProductieInputModern() {
    const ingredienten =
      ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
        []);

    const ingredientOptions = (() => {
      const defaults = [
        "Overig",
        "Mout",
        "Hop",
        "Gist",
        "Suiker",
        "Water",
        "Kruiden",
        "Fruit",
        "Hulpstof"
      ];

      const seen = new Set<string>();
      const push = (value: unknown) => {
        const text = String(value ?? "").trim();
        if (!text) return;
        const normalized = text;
        if (seen.has(normalized)) return;
        seen.add(normalized);
      };

      defaults.forEach((value) => push(value));

      rows.forEach((row) => {
        const regels =
          ((((row.invoer as GenericRecord)?.ingredienten as GenericRecord)?.regels as GenericRecord[]) ?? []);
        regels.forEach((regel) => push(getIngredientType(regel)));
      });

      const items = Array.from(seen);
      const overig = items.find((v) => v.toLowerCase() === "overig");
      const rest = items
        .filter((v) => v.toLowerCase() !== "overig")
        .sort((a, b) => a.localeCompare(b, "nl-NL"));
      return overig ? [overig, ...rest] : rest;
    })();

    const year = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0) || 0);
    const batchGrootte = Number(getYearProduction(year, productie).batchgrootte_eigen_productie_l ?? 0);
    const leveranciersTotaal = ingredienten.reduce((sum, regel) => sum + Number(regel.prijs ?? 0), 0);
    const receptTotaal = ingredienten.reduce((sum, regel) => sum + calculateEigenProductieKostenRecept(regel), 0);
    const literPrijs = batchGrootte > 0 ? receptTotaal / batchGrootte : 0;
    const batchesPossible = ingredienten.reduce((minValue: number | null, regel) => {
      const verpakking = Number(regel.hoeveelheid ?? 0);
      const nodig = Number(regel.benodigd_in_recept ?? 0);
      if (!Number.isFinite(verpakking) || !Number.isFinite(nodig) || verpakking <= 0 || nodig <= 0) return minValue;
      const batches = verpakking / nodig;
      if (!Number.isFinite(batches) || batches <= 0) return minValue ?? 0;
      if (minValue === null) return batches;
      return Math.min(minValue, batches);
    }, null);
    const batchesLabel =
      batchesPossible === null
        ? "-"
        : formatDecimalValue(Math.max(0, batchesPossible), 2);
    const batchesNeedsAttention = (() => {
      if (batchesPossible === null) return false;
      if (!Number.isFinite(batchesPossible)) return false;
      // Highlight whenever it is not (approximately) an integer. This nudges the user to consider
      // optimizing recipe sizes/packaging so ingredients are used efficiently.
      const rounded = Math.round(batchesPossible);
      return Math.abs(batchesPossible - rounded) >= 0.01;
    })();

    return (
      <div className="wizard-stack">
        <div className="stats-grid wizard-stats-grid" style={{ marginBottom: 14 }}>
          <div className="stat-card">
            <div className="stat-label">Leveranciersprijzen</div>
            <div className="stat-value small">{formatCurrencyDisplay(leveranciersTotaal)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Receptkosten</div>
            <div className="stat-value small">{formatCurrencyDisplay(receptTotaal)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Batchgrootte (L)</div>
            <div className="stat-value small">{batchGrootte > 0 ? formatDecimalValue(batchGrootte, 2) : "-"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Literprijs</div>
            <div className="stat-value small">{batchGrootte > 0 ? formatCurrencyDisplay(literPrijs) : "-"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Batches mogelijk</div>
            <div className={`stat-value small${batchesNeedsAttention ? " warning" : ""}`}>{batchesLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ingredienten</div>
            <div className="stat-value small">{String(ingredienten.length)}</div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Omschrijving</th>
                <th>Inhoud verpakking</th>
                <th>Eenheid</th>
                <th>Leveranciersprijs</th>
                <th>Hoeveel in recept</th>
                <th>Prijs per eenheid</th>
                <th>Kosten recept</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ingredienten.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  <td>
                    <select
                      className="dataset-input wizard-unit-select"
                      value={getIngredientType(regel)}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index]["ingredient"] = event.target.value;
                        })
                      }
                    >
                      {(() => {
                        const currentValue = getIngredientType(regel);
                        const options = ingredientOptions.includes(currentValue)
                          ? ingredientOptions
                          : [currentValue, ...ingredientOptions];
                        return options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ));
                      })()}
                    </select>
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="text"
                      value={String(regel.omschrijving ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index].omschrijving = event.target.value;
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      step="any"
                      value={String(regel.hoeveelheid ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index].hoeveelheid = event.target.value === "" ? null : Number(event.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="text"
                      value={String(regel.eenheid ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index].eenheid = event.target.value;
                        })
                      }
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input"
                      type="number"
                      step="any"
                      value={String(regel.prijs ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index].prijs = event.target.value === "" ? null : Number(event.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      step="any"
                      value={String(regel.benodigd_in_recept ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index].benodigd_in_recept =
                            event.target.value === "" ? null : Number(event.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="any"
                      value={formatDecimalValue(calculateEigenProductiePrijsPerEenheid(regel))}
                      readOnly
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="any"
                      value={formatDecimalValue(calculateEigenProductieKostenRecept(regel))}
                      readOnly
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button-table"
                      aria-label="Ingredientregel verwijderen"
                      title="Verwijderen"
                      onClick={() =>
                        requestDelete("Ingredientregel verwijderen", "Weet je zeker dat je deze ingredientregel wilt verwijderen?", () =>
                          updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels.splice(index, 1);
                          })
                        )
                      }
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {ingredienten.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={9}>
                    Nog geen ingredientregels. Voeg hieronder een regel toe.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              updateCurrent((draft) => {
                const regels =
                  ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                    .regels as GenericRecord[]) ?? []);
                regels.push({
                  id: createId(),
                  ingredient: "Overig",
                  omschrijving: "",
                  hoeveelheid: 0,
                  eenheid: "KG",
                  prijs: 0,
                  benodigd_in_recept: 0
                });
              })
            }
          >
            Ingredient toevoegen
          </button>
        </div>
      </div>
    );
  }

  function renderInkoopInput() {
    const inkoop = ((current.invoer as GenericRecord).inkoop as GenericRecord) ?? {};
    const factuurregels = Array.isArray(inkoop.factuurregels)
      ? (inkoop.factuurregels as GenericRecord[])
      : [];
    const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0));
    const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten, current);
    const extraKostenPerRegel = calculateInkoopExtraKostenPerRegel(inkoop, factuurregels.length);
    return (
      <div className="wizard-stack">
        <div className="wizard-form-grid">
          {[
            ["Factuurnummer", "factuurnummer"],
            ["Factuurdatum", "factuurdatum"],
            ["Verzendkosten", "verzendkosten"],
            ["Overige kosten", "overige_kosten"]
          ].map(([label, key]) => (
            <label key={key} className="nested-field">
              <span>{label}</span>
              {key === "verzendkosten" || key === "overige_kosten" ? (
                <CurrencyInput
                  className="dataset-input"
                  type="number"
                  step="any"
                  value={String(inkoop[key] ?? "")}
                  onChange={(event) =>
                    updateCurrent((draft) => {
                      ((draft.invoer as GenericRecord).inkoop as GenericRecord)[key] =
                        event.target.value === "" ? null : Number(event.target.value);
                    })
                  }
                />
              ) : (
                <input
                  className="dataset-input"
                  type="text"
                  value={String(inkoop[key] ?? "")}
                  onChange={(event) =>
                    updateCurrent((draft) => {
                      ((draft.invoer as GenericRecord).inkoop as GenericRecord)[key] = event.target.value;
                    })
                  }
                />
              )}
            </label>
          ))}
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact wizard-table-fit">
            <thead>
              <tr>
                <th>Aantal</th>
                <th>Eenheid</th>
                <th>Factuurbedrag</th>
                <th>Liters</th>
                <th>Extra kosten</th>
                <th>Prijs per eenheid</th>
                <th>Prijs per liter</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {factuurregels.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      step="1"
                      value={String(regel.aantal ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                              .factuurregels as GenericRecord[]) ?? []);
                          regels[index].aantal = event.target.value === "" ? null : Number(event.target.value);
                          regels[index].liters = getFactuurRegelLiters(
                            regels[index],
                            jaar,
                            basisproducten,
                            samengesteldeProducten,
                            draft
                          );
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="dataset-input wizard-unit-select"
                      value={String(regel.eenheid ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                              .factuurregels as GenericRecord[]) ?? []);
                          regels[index].eenheid = event.target.value;
                          regels[index].liters = getFactuurRegelLiters(
                            regels[index],
                            jaar,
                            basisproducten,
                            samengesteldeProducten,
                            draft
                          );
                        })
                      }
                    >
                      <option value="">Selecteer verpakking</option>
                      {unitOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input"
                      type="number"
                      step="0.01"
                      value={String(regel.subfactuurbedrag ?? "")}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                              .factuurregels as GenericRecord[]) ?? []);
                          regels[index].subfactuurbedrag =
                            event.target.value === "" ? null : Number(event.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={formatDecimalValue(
                        getFactuurRegelLiters(
                          regel,
                          jaar,
                          basisproducten,
                          samengesteldeProducten,
                          current
                        ) ?? 0
                      )}
                      readOnly
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={formatDecimalValue(extraKostenPerRegel)}
                      readOnly
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={formatDecimalValue(calculateInkoopPrijsPerEenheid(regel, extraKostenPerRegel))}
                      readOnly
                    />
                  </td>
                  <td>
                    <CurrencyInput
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      step="0.01"
                      value={formatDecimalValue(
                        calculateInkoopPrijsPerLiter(
                          regel,
                          extraKostenPerRegel,
                          jaar,
                          basisproducten,
                          samengesteldeProducten,
                          current
                        )
                      )}
                      readOnly
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button-table"
                      aria-label="Factuurregel verwijderen"
                      title="Verwijderen"
                      onClick={() =>
                        requestDelete("Factuurregel verwijderen", "Weet je zeker dat je deze factuurregel wilt verwijderen?", () =>
                          updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                              .factuurregels as GenericRecord[]) ?? []);
                          regels.splice(index, 1);
                          })
                        )
                      }
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              updateCurrent((draft) => {
                const regels =
                  ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                    .factuurregels as GenericRecord[]) ?? []);
                regels.push({
                  id: createId(),
                  aantal: 0,
                  eenheid: "",
                  liters: 0,
                  subfactuurbedrag: 0
                });
              })
            }
          >
            Factuurregel toevoegen
          </button>
        </div>
      </div>
    );
  }

  function renderFacturenStep() {
    const inkoop = ((current.invoer as GenericRecord).inkoop as GenericRecord) ?? {};
    const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
    const gekoppeldeFacturen = facturen.slice(1);
    const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0));
    const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten, current);
    const gekoppeldeRegels = gekoppeldeFacturen.flatMap((factuur, factuurIndex) => {
      const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
      const extraKostenPerRegel =
        regels.length > 0
          ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
          : 0;

      return regels.map((regel, regelIndex) => ({
        factuurnummer: String(factuur.factuurnummer ?? `Factuur ${factuurIndex + 2}`),
        regel,
        regelIndex,
        extraKostenPerRegel
      }));
    });

    return (
      <div className="nested-editor-list">
        <div className="module-card compact-card">
          <div className="module-card-title">
            {gekoppeldeFacturen.length === 1 ? "Gekoppelde factuur" : "Gekoppelde facturen"}
          </div>
          <div className="module-card-text">
            Hier zie je alleen de extra facturen die zijn toegevoegd via Inkoopfacturen. De eerste
            factuur beheer je in de stap Inkoopfactuur.
          </div>
        </div>
        {gekoppeldeFacturen.length === 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-text">
              Nog geen extra facturen gekoppeld via Inkoopfacturen. De eerste factuur beheer je in
              de stap Inkoopfactuur.
            </div>
          </div>
        ) : null}
        {gekoppeldeRegels.length > 0 ? (
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table wizard-table-compact wizard-table-fit wizard-linked-facturen-table">
              <thead>
                <tr>
                  <th>Factuurnummer</th>
                  <th>Aantal</th>
                  <th>Eenheid</th>
                  <th>Factuurbedrag</th>
                  <th>Liters</th>
                  <th>Extra kosten</th>
                  <th>Prijs per eenheid</th>
                  <th>Prijs per liter</th>
                </tr>
              </thead>
              <tbody>
                {gekoppeldeRegels.map(({ factuurnummer, regel, regelIndex, extraKostenPerRegel }) => (
                  <tr key={`${factuurnummer}-${String(regel.id ?? regelIndex)}`}>
                    <td>{factuurnummer}</td>
                    <td>{formatDecimalValue(Number(regel.aantal ?? 0), 0)}</td>
                    <td>{getProductUnitLabel(String(regel.eenheid ?? ""), unitOptions) || "-"}</td>
                    <td>{formatCurrencyDisplay(Number(regel.subfactuurbedrag ?? 0))}</td>
                    <td>{formatDecimalValue(getFactuurRegelLiters(regel, jaar, basisproducten, samengesteldeProducten) ?? 0)}</td>
                    <td>{formatCurrencyDisplay(extraKostenPerRegel)}</td>
                    <td>{formatCurrencyDisplay(calculateInkoopPrijsPerEenheid(regel, extraKostenPerRegel))}</td>
                    <td>
                      {formatCurrencyDisplay(
                        calculateInkoopPrijsPerLiter(
                          regel,
                          extraKostenPerRegel,
                          jaar,
                          basisproducten,
                          samengesteldeProducten
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  function renderSummaryStep() {
    const snapshot = buildResultaatSnapshot(current);
    const basisproductenRows = snapshot.producten.basisproducten;
    const samengesteldeRows = snapshot.producten.samengestelde_producten;
    const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0));
    const soort = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();

    return (
      <div className="wizard-stack">
        <div className="stats-grid wizard-stats-grid">
          {(
            [
              ["Integrale kostprijs / L", snapshot.integrale_kostprijs_per_liter],
              ["Variabele kosten / L", snapshot.variabele_kosten_per_liter],
              [
                soort === "Inkoop" ? "Indirecte vaste kosten / L" : "Directe vaste kosten / L",
                snapshot.directe_vaste_kosten_per_liter
              ]
            ] as [string, unknown][]
          ).map(([label, value]) => (
            <div key={label} className="stat-card">
              <div className="stat-label">{label}</div>
              <div className="stat-value small">{String(value ?? "-")}</div>
            </div>
          ))}
        </div>
        {(
          [
            ["Basisproducten", basisproductenRows],
            ["Samengestelde producten", samengesteldeRows]
          ] as [string, SummaryProductRow[]][]
        ).map(([label, records]) => (
          <div key={label} className="module-card compact-card">
            <div className="module-card-title">{label}</div>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Biernaam</th>
                    <th>Soort</th>
                    <th>Verpakkingseenheid</th>
                    <th>{soort === "Inkoop" ? "Inkoop" : "Ingredienten"}</th>
                    <th>Verpakkingskosten</th>
                    <th>{soort === "Inkoop" ? "Indirecte kosten" : "Directe kosten"}</th>
                    <th>Accijns</th>
                    <th>Kostprijs</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td className="dataset-empty" colSpan={8}>
                        {soort === "Inkoop"
                          ? "Er zijn nog geen producten opgebouwd vanuit de huidige inkoopinvoer."
                          : "Er zijn nog geen producten opgebouwd vanuit het huidige recept en de verpakkingselectie."}
                      </td>
                    </tr>
                  ) : null}
                  {records.map((row, index) => (
                    <tr key={`${String(row.verpakkingseenheid ?? index)}-${index}`}>
                      <td>{String(row.biernaam ?? "-")}</td>
                      <td>{String(row.soort ?? "-")}</td>
                      <td>{String(row.verpakkingseenheid ?? "-")}</td>
                      <td>{formatCurrencyDisplay(row.primaire_kosten)}</td>
                      <td>{formatCurrencyDisplay(row.verpakkingskosten)}</td>
                      <td>{formatCurrencyDisplay(row.vaste_kosten)}</td>
                      <td>{formatCurrencyDisplay(row.accijns)}</td>
                      <td>{formatCurrencyDisplay(row.kostprijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "type") return renderTypeStep();
    if (currentStep.id === "input") {
      const type = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
      return type === "Inkoop" ? renderInkoopInput() : renderEigenProductieInputModern();
    }
    if (currentStep.id === "facturen") return renderFacturenStep();
    return renderSummaryStep();
  }

  return (
    <section className="content-card wizard-main-card">
        <div className="wizard-main-header">
          <div>
            <h2 className="wizard-main-title">
              {String((current.basisgegevens as GenericRecord).biernaam ?? "Nieuwe berekening")}
            </h2>
            <div className="page-text">
              {processType === "Inkoop"
                ? "Werk de inkoopkostprijs stap voor stap uit, inclusief producten, facturen en samenvatting."
                : "Werk de kostprijs stap voor stap uit vanuit recept, ingredienten en verpakkingen."}
            </div>
          </div>
          <div className="wizard-main-header-actions">
            {onBackToLanding ? (
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={onBackToLanding}
              >
                Terug
              </button>
            ) : null}
            {isEditingExisting ? (
              <button
                type="button"
                className="icon-button-table"
                aria-label="Kostprijs verwijderen"
                title="Verwijderen"
                disabled={isSaving}
                onClick={() =>
                  requestDelete(
                    "Kostprijs verwijderen",
                    `Weet je zeker dat je de kostprijs voor ${String(
                      (current.basisgegevens as GenericRecord)?.biernaam ?? "dit bier"
                    )} wilt verwijderen?`,
                    () => {
                      void handleDeleteCurrent();
                    }
                  )
                }
              >
                <TrashIcon />
              </button>
            ) : null}
            {String(current.status ?? "") === "definitief" && !Boolean(current.is_actief) ? (
              <button
                type="button"
                className="editor-button editor-button-secondary"
                disabled={isSaving}
                onClick={() => {
                  void handleActivate();
                }}
              >
                Activeer
              </button>
            ) : null}
            <span className="pill">
              {String(current.status ?? "concept")}
              {Boolean(current.is_actief) ? " | actief" : ""}
            </span>
          </div>
        </div>

        <div className="wizard-shell wizard-shell-single">
          <div className="wizard-step-card wizard-step-stage-card">
            <div className="wizard-step-header">
              <div>
                <div className="wizard-step-title">
                  Stap {currentIndex + 1}: {currentStep.label}
                </div>
                <div className="wizard-step-description">{currentStep.description}</div>
              </div>
            </div>

            <div className="wizard-step-body">{renderStepContent()}</div>

            <div className="editor-actions wizard-footer-actions">
              <div className="editor-actions-group">
                {currentIndex > 0 ? (
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setActiveStepIndex(Math.max(0, currentIndex - 1))}
                  >
                    Vorige
                  </button>
                ) : null}
              </div>
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={handleSave}
                >
                  Opslaan
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={async () => {
                    if (currentStep.id === "summary") {
                      const saved = await handleFinalize();
                      if (saved) {
                        onFinish?.();
                      }
                      return;
                    }

                    setActiveStepIndex(Math.min(steps.length - 1, currentIndex + 1));
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? "Opslaan..." : currentStep.id === "summary" ? "Afronden" : "Volgende"}
                </button>
              </div>
            </div>
          </div>
        </div>
        {status ? (
          <div className={`editor-status wizard-inline-status${statusTone ? ` ${statusTone}` : ""}`}>
            {status}
          </div>
        ) : null}
        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
              <div className="confirm-modal-title" id="confirm-title">
                {pendingDelete.title}
              </div>
              <div className="confirm-modal-text">{pendingDelete.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingDelete(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingDelete.onConfirm();
                    setPendingDelete(null);
                  }}
                >
                  Verwijderen
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </section>
  );
}

function CurrencyInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`currency-input-wrapper${props.readOnly ? " readonly" : ""}`}>
      <span className="currency-input-prefix">€</span>
      <input {...props} className={className} />
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
