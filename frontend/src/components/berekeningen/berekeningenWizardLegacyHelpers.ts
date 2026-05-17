import {
  cloneRecord,
  createId,
  parseOptionalNumber,
  syncPrimaryInkoopFactuur
} from "@/components/berekeningen/berekeningenWizardUtils";
import { roundValue } from "@/components/berekeningen/berekeningenWizardFormatting";
import { API_BASE_URL } from "@/lib/api";
type GenericRecord = Record<string, unknown>;

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type BerekeningProcessType = "Eigen productie" | "Inkoop";
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export type BerekeningenWizardPersistResult = {
  id: string;
  year: number;
  status: string;
};

type BerekeningenWizardProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onBackToLanding?: () => void;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onPersisted?: (result: BerekeningenWizardPersistResult) => void;
  onFinish?: () => void;
};

type PendingDeleteDialog = {
  title: string;
  body: string;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
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

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneRecord(raw);
  row.id = String(row.id ?? createId());
  row.bier_id = String(row.bier_id ?? "");
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
  const normalizedSkuType = (String(basisgegevens.sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const normalizedUomRaw = String(basisgegevens.uom ?? "").trim();
  const normalizedUom =
    normalizedUomRaw ||
    (normalizedSkuType === "dienst" ? "uur" : normalizedSkuType === "artikel" ? "stuk" : "");
  row.basisgegevens = {
    ...basisgegevens,
    jaar: Number(basisgegevens.jaar ?? new Date().getFullYear()),
    sku_type: normalizedSkuType,
    uom: normalizedUom,
    biernaam: String(basisgegevens.biernaam ?? ""),
    stijl: String(basisgegevens.stijl ?? ""),
    alcoholpercentage: parseOptionalNumber(basisgegevens.alcoholpercentage) ?? 0,
    belastingsoort: String(basisgegevens.belastingsoort ?? "Accijns"),
    tarief_accijns: String(basisgegevens.tarief_accijns ?? "Hoog"),
    btw_tarief: String(basisgegevens.btw_tarief ?? "21%"),
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
  const basis = (row.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String(basis.sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  if (subjectType !== "bier") {
    return "Inkoop";
  }
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
    id: "classificeren",
    label: "Classificeren",
    description: "Koppel productgroep, alcoholcategorie en verpakkingstype"
  });

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

function isFustOption(option: ProductUnitOption | undefined | null) {
  if (!option) return false;
  const source = option.source ?? {};
  const haystack = [
    option.label,
    (source as any)?.omschrijving,
    (source as any)?.verpakking,
    (source as any)?.verpakkingstype,
    (source as any)?.pack_type
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  return haystack.includes("fust");
}

function getFactuurRegelAfvulkostenFust(regel: GenericRecord) {
  return Number(regel.afvulkosten_fust ?? 0);
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
  return (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel + getFactuurRegelAfvulkostenFust(regel)) / aantal;
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
  return (
    Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel + getFactuurRegelAfvulkostenFust(regel)
  ) / liters;
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
      aantal > 0
        ? (Number(regel.subfactuurbedrag ?? 0) + extraKostenPerRegel + getFactuurRegelAfvulkostenFust(regel)) /
          aantal
        : 0;
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
      (sum, item) =>
        sum +
        Number(item.regel.subfactuurbedrag ?? 0) +
        item.extraKostenPerRegel +
        getFactuurRegelAfvulkostenFust(item.regel),
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




export {
  normalizeBerekening,
  createEmptyBerekening,
  hasMeaningfulFacturen,
  getBerekeningProcessType,
  buildWizardSteps,
  getLegacySteps,
  getIngredientType,
  getProductDisplayName,
  getProductUnitLabel,
  isFustOption,
  getFactuurRegelAfvulkostenFust,
  getProductUnitOptions,
  getYearProduction,
  getFactuurRegelLiters,
  calculateEigenProductiePrijsPerEenheid,
  calculateEigenProductieKostenRecept,
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  getSelectedInkoopProductRows,
  getInkoopFactuurregels,
  getSelectedInkoopProducts,
  expandSelectedInkoopProductsToBasisproducten,
  getDirecteVasteKostenPerLiter,
  calculateVariabeleKostenPerLiter
};

export type {
  GenericRecord,
  StepDefinition,
  BerekeningProcessType,
  BerekeningSubjectType,
  ProductUnitOption,
  SelectedInkoopProduct,
  EnrichedFactuurRegel
};
