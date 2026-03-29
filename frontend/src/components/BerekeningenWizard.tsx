"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type BerekeningenWizardProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
};

type SummaryProductRow = {
  biernaam: string;
  soort: string;
  verpakkingseenheid: string;
  primaire_kosten: string | number;
  verpakkingskosten: string | number;
  vaste_kosten: string | number;
  accijns: string | number;
  kostprijs: string | number;
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

type ResultaatSnapshot = {
  integrale_kostprijs_per_liter: number | null;
  variabele_kosten_per_liter: number | null;
  directe_vaste_kosten_per_liter: number | null;
  producten: {
    basisproducten: SummaryProductRow[];
    samengestelde_producten: SummaryProductRow[];
  };
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneRecord(raw);
  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
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
    alcoholpercentage: Number(basisgegevens.alcoholpercentage ?? 0),
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

  return row;
}

function createEmptyBerekening(): GenericRecord {
  return normalizeBerekening({
    id: createId(),
    bier_id: "",
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
    finalized_at: ""
  });
}

function hasMeaningfulFacturen(row: GenericRecord) {
  const inkoop = ((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const factuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];

  if (factuurregels.length > 0) {
    return true;
  }

  return facturen.some((factuur) => {
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

function getSteps(row: GenericRecord): StepDefinition[] {
  const type = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const meaningfulFacturen = type === "Inkoop" && hasMeaningfulFacturen(row);

  const steps: StepDefinition[] = [
    { id: "basis", label: "Basisgegevens", description: "Jaar, bier en fiscale basis" },
    { id: "type", label: "Soort berekening", description: "Kies de berekeningsroute" },
    {
      id: "input",
      label: meaningfulFacturen ? "Initiële kostprijs" : "Berekening",
      description: type === "Inkoop" ? "Factuurinvoer en bronkosten" : "Ingrediënten en recept"
    }
  ];

  if (meaningfulFacturen) {
    steps.push({ id: "facturen", label: "Facturen", description: "Meerdere facturen en regels" });
  }

  steps.push({ id: "summary", label: "Samenvatting", description: "Snapshot en productuitkomst" });
  return steps;
}

function getIngredientType(row: GenericRecord) {
  return String(row["ingrediënt"] ?? row["ingredient"] ?? row["ingrediÃ«nt"] ?? "Overig");
}

function getProductDisplayName(row: GenericRecord) {
  return String(row.verpakking ?? row.omschrijving ?? "").trim();
}

function getProductUnitOptions(
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
): ProductUnitOption[] {
  const basis = basisproducten
    .filter((row) => Number(row.jaar ?? 0) === year)
    .map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.inhoud_per_eenheid_liter ?? 0),
      source: row
    }));

  const samengesteld = samengesteldeProducten
    .filter((row) => Number(row.jaar ?? 0) === year)
    .map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.totale_inhoud_liter ?? 0),
      source: row
    }));

  return [...basis, ...samengesteld].sort((left, right) => left.label.localeCompare(right.label));
}

function toSummaryValue(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "-";
}

function roundValue(value: number, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getYearProduction(year: number, productie: Record<string, GenericRecord>) {
  return (productie[String(year)] as GenericRecord | undefined) ?? {};
}

function getFactuurRegelLiters(
  regel: GenericRecord,
  year: number,
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  const aantal = Number(regel.aantal ?? 0);
  const eenheidId = String(regel.eenheid ?? "").trim();
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten);
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
  samengesteldeProducten: GenericRecord[]
) {
  const liters = getFactuurRegelLiters(regel, year, basisproducten, samengesteldeProducten);
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
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten);
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

function sumVasteKostenByType(rows: GenericRecord[], kostensoort: "direct" | "indirect") {
  return rows
    .filter((row) => {
      const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
      if (kostensoort === "indirect") {
        return normalized.includes("indirect");
      }
      return normalized.includes("direct") && !normalized.includes("indirect");
    })
    .reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
}

function getVasteKostenPerLiter(
  year: number,
  productie: Record<string, GenericRecord>,
  vasteKosten: Record<string, GenericRecord[]>,
  kostensoort: "direct" | "indirect",
  delerType: "productie" | "inkoop"
) {
  const rows = Array.isArray(vasteKosten[String(year)]) ? vasteKosten[String(year)] : [];
  const totaleVasteKosten = sumVasteKostenByType(rows, kostensoort);
  if (totaleVasteKosten <= 0) {
    return 0;
  }

  const productieGegevens = getYearProduction(year, productie);
  const deler =
    delerType === "inkoop"
      ? Number(productieGegevens.hoeveelheid_inkoop_l ?? 0)
      : Number(productieGegevens.hoeveelheid_productie_l ?? 0);

  if (deler <= 0) {
    return 0;
  }

  return totaleVasteKosten / deler;
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
  const options = getProductUnitOptions(year, basisproducten, samengesteldeProducten);
  const optionMap = new Map(options.map((option) => [option.id, option.source]));
  const grouped = new Map<string, { product: GenericRecord; totaalBedrag: number; totaalAantal: number }>();

  for (const { regel, extraKostenPerRegel } of enrichedRegels) {
    const eenheidId = String(regel.eenheid ?? "").trim();
    const product = optionMap.get(eenheidId);
    if (!product) {
      continue;
    }

    const bestaand = grouped.get(eenheidId) ?? {
      product,
      totaalBedrag: 0,
      totaalAantal: 0
    };
    bestaand.totaalBedrag += Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel;
    bestaand.totaalAantal += Number(regel.aantal ?? 0);
    grouped.set(eenheidId, bestaand);
  }

  return [...grouped.values()].map((entry) => ({
    product: entry.product,
    prijsPerEenheid: entry.totaalAantal > 0 ? entry.totaalBedrag / entry.totaalAantal : 0
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
        sum + getFactuurRegelLiters(item.regel, year, basisproducten, samengesteldeProducten),
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

function calculateAccijnsPerProduct(
  litersPerProduct: number,
  basisgegevens: GenericRecord,
  tarievenHeffingen: GenericRecord[],
  year: number
) {
  const tarieven = tarievenHeffingen.find((row) => Number(row.jaar ?? 0) === year) ?? {};
  const belastingsoort = String(basisgegevens.belastingsoort ?? "").trim().toLowerCase();
  const alcoholpercentage = Number(basisgegevens.alcoholpercentage ?? 0) / 100;
  const tariefAccijns = String(basisgegevens.tarief_accijns ?? "").trim().toLowerCase();

  if (belastingsoort === "verbruiksbelasting") {
    return Number(tarieven.verbruikersbelasting ?? 0) * (litersPerProduct / 100);
  }

  const tarief =
    tariefAccijns === "laag" ? Number(tarieven.tarief_laag ?? 0) : Number(tarieven.tarief_hoog ?? 0);
  return tarief * alcoholpercentage * litersPerProduct;
}

function buildSummaryRows(
  sourceRows: (GenericRecord | SelectedInkoopProduct)[],
  biernaam: string,
  soort: string,
  primaireKostenPerLiter: number,
  vasteKostenPerLiter: number,
  basisgegevens: GenericRecord,
  tarievenHeffingen: GenericRecord[],
  year: number,
  includePackagingCosts: boolean
): SummaryProductRow[] {
  return sourceRows.map((row) => {
    const isSelectedInkoopProduct = "product" in (row as SelectedInkoopProduct);
    const sourceRow = isSelectedInkoopProduct
      ? (row as SelectedInkoopProduct).product
      : (row as GenericRecord);
    const label = getProductDisplayName(sourceRow);
    const liters =
      Number(
        sourceRow.totale_inhoud_liter ??
          sourceRow.inhoud_per_eenheid_liter ??
          sourceRow.liters_per_product ??
          0
      ) || 0;
    const verpakkingskosten = Number(
      sourceRow.totale_verpakkingskosten ?? sourceRow.verpakkingskosten ?? 0
    );
    const accijns = calculateAccijnsPerProduct(liters, basisgegevens, tarievenHeffingen, year);
    const primaireKosten = isSelectedInkoopProduct
      ? (row as SelectedInkoopProduct).prijsPerEenheid
      : primaireKostenPerLiter * liters;
    const vasteKosten = vasteKostenPerLiter * liters;
    const packaging = includePackagingCosts ? verpakkingskosten : 0;

    return {
      biernaam,
      soort,
      verpakkingseenheid: label || "-",
      primaire_kosten: roundValue(primaireKosten),
      verpakkingskosten: roundValue(packaging),
      vaste_kosten: roundValue(vasteKosten),
      accijns: roundValue(accijns),
      kostprijs: roundValue(primaireKosten + packaging + vasteKosten + accijns)
    };
  });
}

export function BerekeningenWizard({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  productie,
  vasteKosten,
  tarievenHeffingen
}: BerekeningenWizardProps) {
  const normalizedRows = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState<GenericRecord[]>(normalizedRows);
  const [selectedId, setSelectedId] = useState<string>(
    String(normalizedRows[0]?.id ?? createEmptyBerekening().id)
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const current =
    rows.find((row) => String(row.id) === selectedId) ?? rows[0] ?? createEmptyBerekening();
  const steps = getSteps(current);
  const currentIndex = Math.min(activeStepIndex, steps.length - 1);
  const currentStep = steps[currentIndex] ?? steps[0];

  function buildResultaatSnapshot(row: GenericRecord): ResultaatSnapshot {
    const basisgegevens = (row.basisgegevens as GenericRecord) ?? {};
    const jaar = Number(basisgegevens.jaar ?? 0);
    const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
    const biernaam = String(basisgegevens.biernaam ?? "");
    const variabeleKostenPerLiter =
      calculateVariabeleKostenPerLiter(row, jaar, productie, basisproducten, samengesteldeProducten) ?? 0;
    const vasteKostenPerLiter =
      soort === "Inkoop"
        ? getVasteKostenPerLiter(jaar, productie, vasteKosten, "indirect", "inkoop")
        : getVasteKostenPerLiter(jaar, productie, vasteKosten, "direct", "productie");
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

    const basisproductenRows = buildSummaryRows(
      basisproductenVanJaar,
      biernaam,
      soort,
      variabeleKostenPerLiter,
      vasteKostenPerLiter,
      basisgegevens,
      tarievenHeffingen,
      jaar,
      soort !== "Inkoop"
    );
    const samengesteldeRows = buildSummaryRows(
      samengesteldeVanJaar,
      biernaam,
      soort,
      variabeleKostenPerLiter,
      vasteKostenPerLiter,
      basisgegevens,
      tarievenHeffingen,
      jaar,
      soort !== "Inkoop"
    );

    return {
      integrale_kostprijs_per_liter: roundValue(variabeleKostenPerLiter + vasteKostenPerLiter),
      variabele_kosten_per_liter: roundValue(variabeleKostenPerLiter),
      directe_vaste_kosten_per_liter: roundValue(vasteKostenPerLiter),
      producten: {
        basisproducten: basisproductenRows,
        samengestelde_producten: samengesteldeRows
      }
    };
  }

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (String(row.id) !== String(current.id)) {
          return row;
        }
        const next = cloneRecord(row);
        updater(next);
        next.updated_at = new Date().toISOString();
        return next;
      })
    );
  }

  function addBerekening() {
    const next = createEmptyBerekening();
    setRows((currentRows) => [next, ...currentRows]);
    setSelectedId(String(next.id));
    setActiveStepIndex(0);
    setStatus("");
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);
    try {
      const payload = rows.map((row) => {
        const next = cloneRecord(row);
        next.bier_snapshot = cloneRecord((row.basisgegevens as GenericRecord) ?? {});
        next.resultaat_snapshot = buildResultaatSnapshot(row);
        return next;
      });
      const response = await fetch(`${API_BASE_URL}/data/berekeningen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }
      setRows(payload);
      setStatus("Berekeningen opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  function renderBasisStep() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    return (
      <div className="wizard-form-grid">
        {[
          ["Biernaam", "biernaam", "text"],
          ["Jaar", "jaar", "number"],
          ["Stijl", "stijl", "text"],
          ["Alcoholpercentage", "alcoholpercentage", "number"],
          ["Belastingsoort", "belastingsoort", "text"],
          ["Tarief accijns", "tarief_accijns", "text"],
          ["BTW-tarief", "btw_tarief", "text"]
        ].map(([label, key, type]) => (
          <label key={key} className="nested-field">
            <span>{label}</span>
            <input
              className="dataset-input"
              type={type}
              step={type === "number" ? "any" : undefined}
              value={String(basis[key] ?? "")}
              onChange={(event) =>
                updateCurrent((draft) => {
                  (draft.basisgegevens as GenericRecord)[key] =
                    type === "number"
                      ? event.target.value === ""
                        ? null
                        : Number(event.target.value)
                      : event.target.value;
                })
              }
            />
          </label>
        ))}
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
          ["Eigen productie", "Gebruik ingrediënten en receptregels als basis voor de kostprijs."],
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

  function renderEigenProductieInput() {
    const ingredienten =
      ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
        []);
    return (
      <div className="wizard-stack">
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
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
                              regels[index]["ingrediënt"] = nextValue;
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
                    Nog geen ingrediëntregels. Voeg hieronder een regel toe.
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
                  "ingrediënt": "Overig",
                  omschrijving: "",
                  hoeveelheid: 0,
                  eenheid: "KG",
                  prijs: 0,
                  benodigd_in_recept: 0
                });
              })
            }
          >
            Ingrediënt toevoegen
          </button>
        </div>
      </div>
    );
  }

  function renderEigenProductieInputModern() {
    const ingredienten =
      ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
        []);
    return (
      <div className="wizard-stack">
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Omschrijving</th>
                <th>Hoeveelheid</th>
                <th>Eenheid</th>
                <th>Prijs</th>
                <th>Prijs per eenheid</th>
                <th>Benodigd in recept</th>
                <th>Kosten recept</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {ingredienten.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  <td>
                    <input
                      className="dataset-input"
                      type="text"
                      value={getIngredientType(regel)}
                      onChange={(event) =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                              .regels as GenericRecord[]) ?? []);
                          regels[index]["ingrediënt"] = event.target.value;
                          regels[index]["ingredient"] = event.target.value;
                        })
                      }
                    />
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
                    <input
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
                      value={String(roundValue(calculateEigenProductiePrijsPerEenheid(regel)))}
                      readOnly
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
                    <input
                      className="dataset-input"
                      type="number"
                      step="any"
                      value={String(roundValue(calculateEigenProductieKostenRecept(regel)))}
                      readOnly
                    />
                  </td>
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
                  <td className="dataset-empty" colSpan={9}>
                    Nog geen ingrediëntregels. Voeg hieronder een regel toe.
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
                  "ingrediënt": "Overig",
                  omschrijving: "",
                  hoeveelheid: 0,
                  eenheid: "KG",
                  prijs: 0,
                  benodigd_in_recept: 0
                });
              })
            }
          >
            Ingrediënt toevoegen
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
    const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten);
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
              <input
                className="dataset-input"
                type={key === "verzendkosten" || key === "overige_kosten" ? "number" : "text"}
                step={key === "verzendkosten" || key === "overige_kosten" ? "any" : undefined}
                value={String(inkoop[key] ?? "")}
                onChange={(event) =>
                  updateCurrent((draft) => {
                    ((draft.invoer as GenericRecord).inkoop as GenericRecord)[key] =
                      key === "verzendkosten" || key === "overige_kosten"
                        ? event.target.value === ""
                          ? null
                          : Number(event.target.value)
                        : event.target.value;
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Aantal</th>
                <th>Extra kosten</th>
                <th>Prijs per eenheid</th>
                <th>Prijs per liter</th>
                <th>Liters</th>
                <th>Subfactuurbedrag</th>
                <th>Eenheid</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {factuurregels.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  {[
                    ["aantal", String(regel.aantal ?? "")],
                    ["extra_kosten", String(roundValue(extraKostenPerRegel))],
                    ["prijs_per_eenheid", String(roundValue(calculateInkoopPrijsPerEenheid(regel, extraKostenPerRegel)))],
                    [
                      "prijs_per_liter",
                      String(
                        roundValue(
                          calculateInkoopPrijsPerLiter(
                            regel,
                            extraKostenPerRegel,
                            jaar,
                            basisproducten,
                            samengesteldeProducten
                          )
                        )
                      )
                    ],
                    [
                      "liters",
                      String(getFactuurRegelLiters(regel, jaar, basisproducten, samengesteldeProducten) ?? "")
                    ],
                    ["subfactuurbedrag", String(regel.subfactuurbedrag ?? "")]
                  ].map(([key, value]) => (
                    <td key={key}>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={value}
                        readOnly={key === "liters" || key === "extra_kosten" || key === "prijs_per_eenheid" || key === "prijs_per_liter"}
                        onChange={(event) =>
                          updateCurrent((draft) => {
                            const regels =
                              ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                                .factuurregels as GenericRecord[]) ?? []);
                            if (key === "aantal" || key === "subfactuurbedrag") {
                              regels[index][key] = event.target.value === "" ? null : Number(event.target.value);
                              regels[index].liters = getFactuurRegelLiters(
                                regels[index],
                                jaar,
                                basisproducten,
                                samengesteldeProducten
                              );
                            }
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <select
                      className="dataset-input"
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
                            samengesteldeProducten
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
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() =>
                        updateCurrent((draft) => {
                          const regels =
                            ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                              .factuurregels as GenericRecord[]) ?? []);
                          regels.splice(index, 1);
                        })
                      }
                    >
                      Verwijderen
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
    return (
      <div className="nested-editor-list">
        {facturen.map((factuur, index) => (
          <article key={String(factuur.id ?? index)} className="nested-editor-card">
            <div className="nested-editor-card-header">
              <div>
                <div className="nested-editor-card-title">
                  Factuur {String(factuur.factuurnummer ?? index + 1)}
                </div>
                <div className="nested-editor-card-meta">
                  Datum {String(factuur.factuurdatum ?? "-")}
                </div>
              </div>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() =>
                  updateCurrent((draft) => {
                    const allFacturen =
                      ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                        .facturen as GenericRecord[]) ?? []);
                    allFacturen.splice(index, 1);
                  })
                }
              >
                Verwijderen
              </button>
            </div>
            <label className="nested-field">
              <span>Factuurregels</span>
              <textarea
                className="json-editor nested-json-editor"
                value={JSON.stringify(
                  Array.isArray(factuur.factuurregels) ? factuur.factuurregels : [],
                  null,
                  2
                )}
                onChange={(event) => {
                  try {
                    const parsed = JSON.parse(event.target.value);
                    updateCurrent((draft) => {
                      const allFacturen =
                        ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                          .facturen as GenericRecord[]) ?? []);
                      allFacturen[index].factuurregels = parsed;
                    });
                    setStatus("");
                  } catch {
                    setStatus("JSON ongeldig in factuurregels.");
                  }
                }}
              />
            </label>
          </article>
        ))}
        <div className="editor-actions">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              updateCurrent((draft) => {
                const allFacturen =
                  ((((draft.invoer as GenericRecord).inkoop as GenericRecord)
                    .facturen as GenericRecord[]) ?? []);
                allFacturen.push({
                  id: createId(),
                  factuurnummer: "",
                  factuurdatum: "",
                  verzendkosten: 0,
                  overige_kosten: 0,
                  factuurregels: []
                });
              })
            }
          >
            Factuur toevoegen
          </button>
        </div>
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
                    <th>{soort === "Inkoop" ? "Inkoop" : "Ingrediënten"}</th>
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
                        Nog geen producten gevonden voor {jaar}.
                      </td>
                    </tr>
                  ) : null}
                  {records.map((row, index) => (
                    <tr key={`${String(row.verpakkingseenheid ?? index)}-${index}`}>
                      <td>{String(row.biernaam ?? "-")}</td>
                      <td>{String(row.soort ?? "-")}</td>
                      <td>{String(row.verpakkingseenheid ?? "-")}</td>
                      <td>{String(row.primaire_kosten ?? "-")}</td>
                      <td>{String(row.verpakkingskosten ?? "-")}</td>
                      <td>{String(row.vaste_kosten ?? "-")}</td>
                      <td>{String(row.accijns ?? "-")}</td>
                      <td>{String(row.kostprijs ?? "-")}</td>
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
    <div className="wizard-page-grid">
      <section className="content-card wizard-overview-card">
        <div className="module-card-header">
          <div className="module-card-title">Berekeningen</div>
          <div className="module-card-text">
            Kies een bestaande berekening of start een nieuwe conceptberekening.
          </div>
        </div>
        <div className="editor-actions">
          <div className="editor-actions-group">
            <button type="button" className="editor-button" onClick={addBerekening}>
              Nieuwe berekening
            </button>
          </div>
          <div className="editor-actions-group">
            {status ? <span className="editor-status">{status}</span> : null}
          </div>
        </div>
        <div className="wizard-record-list">
          {rows.map((row) => {
            const basis = (row.basisgegevens as GenericRecord) ?? {};
            const type = (row.soort_berekening as GenericRecord) ?? {};
            return (
              <button
                type="button"
                key={String(row.id)}
                className={`wizard-record-card${String(row.id) === String(current.id) ? " active" : ""}`}
                onClick={() => {
                  setSelectedId(String(row.id));
                  setActiveStepIndex(0);
                }}
              >
                <div className="wizard-record-title">{String(basis.biernaam ?? "Nieuwe berekening")}</div>
                <div className="wizard-record-meta">
                  {String(basis.jaar ?? "-")} | {String(type.type ?? "-")} | {String(row.status ?? "-")}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="content-card wizard-main-card">
        <div className="wizard-main-header">
          <div>
            <h2 className="wizard-main-title">
              {String((current.basisgegevens as GenericRecord).biernaam ?? "Nieuwe berekening")}
            </h2>
            <div className="page-text">
              Werk de kostprijs stap voor stap uit. De rekenlogica blijft uit de bestaande Python-laag komen.
            </div>
          </div>
          <span className="pill">{String(current.status ?? "concept")}</span>
        </div>

        <div className="wizard-shell">
          <aside className="wizard-steps-panel">
            {steps.map((step, index) => (
              <button
                type="button"
                key={step.id}
                className={`wizard-step-link${index === currentIndex ? " active" : ""}`}
                onClick={() => setActiveStepIndex(index)}
              >
                <span className="wizard-step-number">{index + 1}</span>
                <span className="wizard-step-copy">
                  <span className="wizard-step-label">{step.label}</span>
                  <span className="wizard-step-text">{step.description}</span>
                </span>
              </button>
            ))}
          </aside>

          <div className="wizard-step-card">
            <div className="module-card-header">
              <div className="module-card-title">{currentStep.label}</div>
              <div className="module-card-text">{currentStep.description}</div>
            </div>
            {renderStepContent()}
          </div>
        </div>

        <div className="editor-actions wizard-footer-actions">
          <div className="editor-actions-group">
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => setActiveStepIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
            >
              Vorige
            </button>
          </div>
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={handleSave}>
              Opslaan
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => setActiveStepIndex(Math.min(steps.length - 1, currentIndex + 1))}
              disabled={currentIndex >= steps.length - 1 || isSaving}
            >
              {isSaving ? "Opslaan..." : currentIndex >= steps.length - 2 ? "Afronden" : "Volgende"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
