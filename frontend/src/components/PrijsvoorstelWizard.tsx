"use client";

import { useEffect, useMemo, useState } from "react";

import { usePageShellWizardSidebar } from "@/components/PageShell";
import UitgangspuntenStep from "@/components/UitgangspuntenStep";
import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type PrijsvoorstelWizardProps = {
  initialRows: GenericRecord[];
  yearOptions: number[];
  bieren: GenericRecord[];
  berekeningen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onBackToLanding?: () => void;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onFinish?: () => void;
};

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type SelectOption = {
  value: string;
  label: string;
};

type KanaalKey = "zakelijk" | "retail" | "horeca" | "slijterij";

type ProductDefinition = {
  id: string;
  key: string;
  label: string;
  kind: "basis" | "samengesteld";
};

type ProductSnapshotRow = {
  bierKey: string;
  biernaam: string;
  productId: string;
  productType: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  litersPerProduct: number;
  costPerPiece: number;
  sourcePackaging: string;
  derivedFromProductId?: string;
  derivedFromProductType?: "basis" | "samengesteld";
  derivedFromProductKey?: string;
  derivedFromPackaging?: string;
  derivedFromAantal?: number;
};

type LitersDisplayRow = {
  id: string;
  bierKey: string;
  biernaam: string;
  included: boolean;
  productId?: string;
  productType?: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  liters: number;
  kortingPct: number;
  kostprijsPerLiter: number;
  adviesprijzen: Record<string, number>;
  basisprijs: number;
  verkoopprijs: number;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
};

type ProductDisplayRow = {
  id: string;
  bierKey: string;
  biernaam: string;
  included: boolean;
  productId: string;
  productType: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  aantal: number;
  kortingPct: number;
  kostprijsPerStuk: number;
  adviesprijzen: Record<string, number>;
  basisprijs: number;
  verkoopprijs: number;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
  kanaalMargePct: number;
};

const KANAAL_OPTIONS = [
  { value: "zakelijk", label: "Zakelijk" },
  { value: "retail", label: "Retail" },
  { value: "horeca", label: "Horeca" },
  { value: "slijterij", label: "Slijterij" }
];

const LITERS_BASIS_OPTIONS = [
  {
    value: "een_bier",
    label: "Een bier",
    description: "Gebruik de hoogste bekende kostprijs van een geselecteerd bier."
  },
  {
    value: "meerdere_bieren",
    label: "Meerdere bieren",
    description: "Vergelijk meerdere bieren naast elkaar op basis van literkostprijs."
  },
  {
    value: "hoogste_kostprijs",
    label: "Hoogste kostprijs algemeen",
    description: "Gebruik de hoogste bekende kostprijs van alle definitieve bieren in dit jaar."
  }
];

const steps: StepDefinition[] = [
  {
    id: "basis",
    label: "Basisgegevens",
    description: "Vul de basisinformatie van het prijsvoorstel in."
  },
  {
    id: "uitgangspunten",
    label: "Uitgangspunten",
    description: "Kies voorsteltype, litersbasis en het referentiekanaal."
  },
  {
    id: "offerte",
    label: "Offerte",
    description: "Stel het voorstel samen op basis van liters of producten."
  },
  {
    id: "samenvatting",
    label: "Samenvatting",
    description: "Controleer de commerciële uitkomst en rond het prijsvoorstel af."
  }
];

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeStrategyKey(value: unknown) {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return "";
  }
  const pipeIndex = normalized.indexOf("|");
  return pipeIndex >= 0 ? normalized.slice(pipeIndex + 1) : normalized;
}

function getCompositeProductRef(productType: string, productId: string, productKey: string) {
  if (productId) {
    return `${productType}|${productId}`;
  }
  return productKey;
}

function getStoredProductRef(row: GenericRecord) {
  return getCompositeProductRef(
    String(row.product_type ?? ""),
    String(row.product_id ?? ""),
    String(row.product_key ?? "")
  );
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function formatEuro(value: unknown) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(toNumber(value, 0));
}

function formatNumber(value: unknown, digits = 2) {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(toNumber(value, 0));
}

function formatPercentage(value: unknown) {
  return `${formatNumber(value, 1)}%`;
}

function isIncluded(value: unknown) {
  return value !== false;
}

function getSnapshotPackagingLabel(row: GenericRecord) {
  return String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? "");
}

function getSnapshotProductCost(row: GenericRecord) {
  const explicitCost = Number(row.kostprijs ?? Number.NaN);
  if (Number.isFinite(explicitCost)) {
    return explicitCost;
  }

  return (
    toNumber(row.primaire_kosten ?? row.variabele_kosten, 0) +
    toNumber(row.verpakkingskosten, 0) +
    toNumber(row.vaste_kosten ?? row.vaste_directe_kosten, 0) +
    toNumber(row.accijns, 0)
  );
}

function pickLatestKnownProductRows(rows: GenericRecord[], targetYear: number) {
  const byId = new Map<string, GenericRecord>();

  [...rows]
    .filter((row) => Number(row.jaar ?? 0) <= targetYear)
    .sort((left, right) => Number(right.jaar ?? 0) - Number(left.jaar ?? 0))
    .forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    });

  if (byId.size > 0) {
    return [...byId.values()];
  }

  const fallback = new Map<string, GenericRecord>();
  [...rows]
    .sort((left, right) => Number(right.jaar ?? 0) - Number(left.jaar ?? 0))
    .forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !fallback.has(id)) {
        fallback.set(id, row);
      }
    });

  return [...fallback.values()];
}

function calculatePriceFromMargin(cost: number, marginPct: number) {
  if (marginPct >= 100) {
    return cost;
  }
  return cost / (1 - marginPct / 100);
}

function calculateMarginPercentage(revenue: number, costs: number) {
  if (revenue <= 0) {
    return 0;
  }
  return ((revenue - costs) / revenue) * 100;
}

function normalizePrijsvoorstel(raw: GenericRecord): GenericRecord {
  return {
    ...cloneRecord(raw),
    id: String(raw.id ?? createId()),
    offertenummer: String(raw.offertenummer ?? ""),
    status: String(raw.status ?? "concept"),
    klantnaam: String(raw.klantnaam ?? ""),
    contactpersoon: String(raw.contactpersoon ?? ""),
    referentie: String(raw.referentie ?? ""),
    datum_text: String(raw.datum_text ?? ""),
    verloopt_op: String(raw.verloopt_op ?? ""),
    opmerking: String(raw.opmerking ?? ""),
    jaar: Number(raw.jaar ?? new Date().getFullYear()),
    voorsteltype: String(raw.voorsteltype ?? "Op basis van producten"),
    liters_basis: String(raw.liters_basis ?? "een_bier"),
    kanaal: String(raw.kanaal ?? "horeca"),
    bier_key: String(raw.bier_key ?? ""),
    product_bier_keys: Array.isArray(raw.product_bier_keys)
      ? raw.product_bier_keys.map((value) => String(value ?? ""))
      : [],
    deleted_product_pairs: Array.isArray(raw.deleted_product_pairs) ? raw.deleted_product_pairs : [],
    staffels: Array.isArray(raw.staffels) ? raw.staffels : [],
    product_rows: Array.isArray(raw.product_rows) ? raw.product_rows : [],
    beer_rows: Array.isArray(raw.beer_rows) ? raw.beer_rows : [],
    last_step: Number(raw.last_step ?? 1),
    finalized_at: String(raw.finalized_at ?? "")
  };
}

function createEmptyPrijsvoorstel(): GenericRecord {
  return normalizePrijsvoorstel({
    id: createId(),
    offertenummer: "",
    status: "concept",
    klantnaam: "",
    contactpersoon: "",
    referentie: "",
    datum_text: "",
    verloopt_op: "",
    opmerking: "",
    jaar: new Date().getFullYear(),
    voorsteltype: "Op basis van producten",
    liters_basis: "een_bier",
    kanaal: "horeca",
    bier_key: "",
    product_bier_keys: [],
    deleted_product_pairs: [],
    staffels: [],
    product_rows: [],
    beer_rows: [],
    last_step: 1,
    finalized_at: ""
  });
}

function getDateInputValue(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function addDays(dateText: string, days: number) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function PrijsvoorstelWizard({
  initialRows,
  yearOptions,
  bieren,
  berekeningen,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  initialSelectedId,
  startWithNew = false,
  onBackToLanding,
  onRowsChange,
  onFinish
}: PrijsvoorstelWizardProps) {
  const initialState = useMemo(() => {
    const normalizedRows = initialRows.map((row) => normalizePrijsvoorstel(row));

    if (startWithNew || normalizedRows.length === 0) {
      const next = createEmptyPrijsvoorstel();
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
      selectedId: String(matchedRow?.id ?? normalizedRows[0]?.id ?? createEmptyPrijsvoorstel().id)
    };
  }, [initialRows, initialSelectedId, startWithNew]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const [selectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);

  const current =
    rows.find((row) => String(row.id) === selectedId) ?? rows[0] ?? createEmptyPrijsvoorstel();
  const isEditingExisting = !startWithNew;
  const currentStep = steps[activeStepIndex] ?? steps[0];
  const currentYear = Number(current.jaar ?? new Date().getFullYear());
  const currentKanaal = String(current.kanaal ?? "horeca") as KanaalKey;
  const isLitersMode = String(current.voorsteltype ?? "") === "Op basis van liters";
  const litersBasis = String(current.liters_basis ?? "een_bier");

  const bierNameMap = useMemo(() => {
    const fromMaster = new Map<string, string>();
    for (const bier of bieren) {
      fromMaster.set(String(bier.id ?? ""), String(bier.biernaam ?? ""));
    }
    for (const berekening of berekeningen) {
      const bierId = String(berekening.bier_id ?? "");
      const biernaam = String((berekening.basisgegevens as GenericRecord | undefined)?.biernaam ?? "");
      if (bierId && biernaam && !fromMaster.has(bierId)) {
        fromMaster.set(bierId, biernaam);
      }
    }
    return fromMaster;
  }, [bieren, berekeningen]);

  const productDefinitionMap = useMemo(() => {
    const map = new Map<string, ProductDefinition>();
    for (const row of pickLatestKnownProductRows(basisproducten, currentYear)) {
      const id = String(row.id ?? "");
      const key = `basis|${normalizeKey(row.omschrijving)}`;
      const definition = {
        id,
        key,
        label: String(row.omschrijving ?? ""),
        kind: "basis"
      } satisfies ProductDefinition;
      if (id) {
        map.set(`id|${id}`, definition);
      }
      map.set(key, definition);
    }
    for (const row of pickLatestKnownProductRows(samengesteldeProducten, currentYear)) {
      const id = String(row.id ?? "");
      const key = `samengesteld|${normalizeKey(row.omschrijving)}`;
      const definition = {
        id,
        key,
        label: String(row.omschrijving ?? ""),
        kind: "samengesteld"
      } satisfies ProductDefinition;
      if (id) {
        map.set(`id|${id}`, definition);
      }
      map.set(key, definition);
    }
    return map;
  }, [basisproducten, samengesteldeProducten, currentYear]);

  const definitiveBerekeningen = useMemo(
    () => berekeningen.filter((record) => normalizeKey(record.status) === "definitief"),
    [berekeningen]
  );

  const definitiveBerekeningenCurrentYear = useMemo(
    () =>
      berekeningen.filter((record) => {
        const statusValue = normalizeKey(record.status);
        const jaar = Number((record.basisgegevens as GenericRecord | undefined)?.jaar ?? 0);
        return statusValue === "definitief" && jaar === currentYear;
      }),
    [berekeningen, currentYear]
  );

  const definitiveBerekeningenHistoryWindow = useMemo(() => {
    const minimumYear = currentYear - 1;
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    return definitiveBerekeningen.filter((record) => {
      const jaar = Number((record.basisgegevens as GenericRecord | undefined)?.jaar ?? 0);
      if (jaar < minimumYear) {
        return false;
      }

      const knownAt = String(record.finalized_at ?? record.updated_at ?? "");
      if (!knownAt) {
        return true;
      }

      const parsed = new Date(knownAt);
      return !Number.isNaN(parsed.getTime()) && parsed <= today;
    });
  }, [currentYear, definitiveBerekeningen]);

  const bierOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    return definitiveBerekeningenCurrentYear
      .map((record) => {
        const bierKey = String(record.bier_id ?? "");
        if (!bierKey || seen.has(bierKey)) {
          return null;
        }
        seen.add(bierKey);
        const biernaam =
          normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
          bierNameMap.get(bierKey) ||
          bierKey;
        return { value: bierKey, label: biernaam };
      })
      .filter((value): value is SelectOption => value !== null)
      .sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
  }, [bierNameMap, definitiveBerekeningenCurrentYear]);

  const verkoopstrategieWindow = useMemo(
    () => verkoopprijzen.filter((row) => Number(row.jaar ?? 0) <= currentYear),
    [verkoopprijzen, currentYear]
  );

  function getLatestBerekeningForBier(bierKey: string) {
    const currentYearMatches = definitiveBerekeningenCurrentYear.filter(
      (record) => String(record.bier_id ?? "") === bierKey
    );
    const fallbackMatches = definitiveBerekeningenHistoryWindow.filter(
      (record) => String(record.bier_id ?? "") === bierKey
    );

    return (currentYearMatches.length > 0 ? currentYearMatches : fallbackMatches)
      .sort((left, right) =>
        String(right.finalized_at ?? right.updated_at ?? "").localeCompare(
          String(left.finalized_at ?? left.updated_at ?? "")
        )
      )[0];
  }

  function getBerekeningTypeForBier(bierKey: string) {
    const berekening = getLatestBerekeningForBier(bierKey);
    return normalizeKey((berekening?.soort_berekening as GenericRecord | undefined)?.type);
  }

  function sortLatestStrategy(left: GenericRecord, right: GenericRecord) {
    const yearDiff = Number(right.jaar ?? 0) - Number(left.jaar ?? 0);
    if (yearDiff !== 0) {
      return yearDiff;
    }

    return String(right.updated_at ?? right.created_at ?? "").localeCompare(
      String(left.updated_at ?? left.created_at ?? "")
    );
  }

  function extractKanaalMarges(record?: GenericRecord | null) {
    const kanaalmarges = (record?.kanaalmarges as GenericRecord | undefined) ?? {};

    return {
      zakelijk: toNumber(kanaalmarges.zakelijk, 0),
      retail: toNumber(kanaalmarges.retail, 0),
      horeca: toNumber(kanaalmarges.horeca, 0),
      slijterij: toNumber(kanaalmarges.slijterij, 0)
    };
  }

  function extractKanaalprijzen(record?: GenericRecord | null) {
    const kanaalprijzen = (record?.kanaalprijzen as GenericRecord | undefined) ?? {};

    return {
      zakelijk: toNumber(kanaalprijzen.zakelijk, Number.NaN),
      retail: toNumber(kanaalprijzen.retail, Number.NaN),
      horeca: toNumber(kanaalprijzen.horeca, Number.NaN),
      slijterij: toNumber(kanaalprijzen.slijterij, Number.NaN)
    };
  }

  function getEffectiveVerkoopstrategieForProduct(
    bierKey: string,
    productId: string,
    productType: string,
    productKey: string,
    verpakking: string
  ) {
    const normalizedPackaging = normalizeKey(verpakking);
    const normalizedProductKey = normalizeKey(productKey);
    const normalizedProductLabel = normalizeStrategyKey(productKey);
    const productStrategy = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_product") {
          return false;
        }
        if (String(record.bier_key ?? "") !== bierKey) {
          return false;
        }
        if (productId) {
          return (
            String(record.product_id ?? "") === productId &&
            (!productType || String(record.product_type ?? "") === productType) &&
            normalizeKey(record.strategie_type) === "uitzondering"
          );
        }
        if (String(record.product_key ?? "") !== productKey) {
          return false;
        }
        return normalizeKey(record.strategie_type) === "uitzondering";
      })
      .sort(sortLatestStrategy)[0];

    if (productStrategy) {
      return productStrategy;
    }

    const verpakkingStrategy = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_verpakking") {
          return false;
        }
        if (productId && String(record.product_id ?? "") === productId) {
          return !productType || String(record.product_type ?? "") === productType;
        }
        const recordPackagingKey = normalizeKey(record.verpakking_key);
        const recordPackaging = normalizeKey(record.verpakking);
        const recordPackagingLabel = normalizeStrategyKey(record.verpakking_key ?? record.verpakking);

        return !!(
          (normalizedProductKey && recordPackagingKey === normalizedProductKey) ||
          (normalizedPackaging && recordPackaging === normalizedPackaging) ||
          (normalizedPackaging && recordPackagingLabel === normalizedPackaging) ||
          (normalizedProductLabel && recordPackagingLabel === normalizedProductLabel)
        );
      })
      .sort(sortLatestStrategy)[0];

    if (verpakkingStrategy) {
      return verpakkingStrategy;
    }

    return verkoopstrategieWindow
      .filter((record) => String(record.record_type ?? "") === "jaarstrategie")
      .sort(sortLatestStrategy)[0];
  }

  function getKanaalMarges(
    bierKey: string,
    productId: string,
    productType: string,
    productKey: string,
    verpakking: string
  ) {
    return extractKanaalMarges(
      getEffectiveVerkoopstrategieForProduct(bierKey, productId, productType, productKey, verpakking)
    );
  }

  function getHighestCostForBier(bierKey: string) {
    return definitiveBerekeningenHistoryWindow.reduce<{
      cost: number;
      bronjaar: number;
      biernaam: string;
    }>(
      (currentHighest, record) => {
        if (String(record.bier_id ?? "") !== bierKey) {
          return currentHighest;
        }
        const cost = toNumber(
          (record.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
          0
        );
        if (cost > currentHighest.cost) {
          return {
            cost,
            bronjaar: Number((record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear),
            biernaam:
              normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              bierNameMap.get(bierKey) ||
              bierKey
          };
        }
        return currentHighest;
      },
      { cost: 0, bronjaar: currentYear, biernaam: bierNameMap.get(bierKey) || bierKey }
    );
  }

  function getHighestCostOverall() {
    return definitiveBerekeningenHistoryWindow.reduce<{
      cost: number;
      bierKey: string;
      biernaam: string;
      bronjaar: number;
    }>(
      (currentHighest, record) => {
        const bierKey = String(record.bier_id ?? "");
        const cost = toNumber(
          (record.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
          0
        );
        if (cost > currentHighest.cost) {
          return {
            cost,
            bierKey,
            biernaam:
              normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              bierNameMap.get(bierKey) ||
              bierKey,
            bronjaar: Number((record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear)
          };
        }
        return currentHighest;
      },
      { cost: 0, bierKey: "", biernaam: "-", bronjaar: currentYear }
    );
  }

  function getHighestLiterRowsForBier(bierKey: string) {
    const highestByPackaging = new Map<string, ProductSnapshotRow>();

    for (const record of definitiveBerekeningenHistoryWindow) {
      if (String(record.bier_id ?? "") !== bierKey) {
        continue;
      }

      for (const snapshotRow of getSnapshotProductRowsForBier(String(record.bier_id ?? ""))) {
        if (snapshotRow.litersPerProduct <= 0) {
          continue;
        }

        const packagingKey = normalizeKey(snapshotRow.verpakking);
        if (!packagingKey) {
          continue;
        }

        const current = highestByPackaging.get(packagingKey);
        const currentCostPerLiter =
          current && current.litersPerProduct > 0 ? current.costPerPiece / current.litersPerProduct : 0;
        const nextCostPerLiter = snapshotRow.costPerPiece / snapshotRow.litersPerProduct;

        if (!current || nextCostPerLiter > currentCostPerLiter) {
          highestByPackaging.set(packagingKey, snapshotRow);
        }
      }
    }

    return [...highestByPackaging.values()];
  }

  function getSnapshotProductRowsForBier(bierKey: string): ProductSnapshotRow[] {
    const berekening = getLatestBerekeningForBier(bierKey);
    if (!berekening) {
      return [];
    }

    const biernaam =
      normalizeText((berekening.basisgegevens as GenericRecord | undefined)?.biernaam) ||
      bierNameMap.get(bierKey) ||
      bierKey;
    const producten =
      (berekening.resultaat_snapshot as GenericRecord | undefined)?.producten as GenericRecord | undefined;
    const basisRows = Array.isArray(producten?.basisproducten)
      ? (producten?.basisproducten as GenericRecord[])
      : [];
    const samengesteldRows = Array.isArray(producten?.samengestelde_producten)
      ? (producten?.samengestelde_producten as GenericRecord[])
      : [];
    const basisById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const samengesteldById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );
    const resolveProductDefinition = (
      productId: string,
      productType: string,
      verpakking: string
    ): ProductDefinition | undefined => {
      if (productId) {
        const byId = productDefinitionMap.get(`id|${productId}`);
        if (byId) {
          return byId;
        }
      }

      if (productType) {
        const byTypedPackaging = productDefinitionMap.get(`${productType}|${normalizeKey(verpakking)}`);
        if (byTypedPackaging) {
          return byTypedPackaging;
        }
      }

      return (
        productDefinitionMap.get(`basis|${normalizeKey(verpakking)}`) ??
        productDefinitionMap.get(`samengesteld|${normalizeKey(verpakking)}`)
      );
    };

    const snapshotRows = [...basisRows, ...samengesteldRows].map((row) => {
      const verpakking = getSnapshotPackagingLabel(row);
      const rowId = String(row.id ?? "");
      const explicitSource = basisById.get(rowId) ?? samengesteldById.get(rowId);
      const definitionByPackaging = resolveProductDefinition(
        rowId || String(explicitSource?.id ?? ""),
        basisById.has(rowId) ? "basis" : samengesteldById.has(rowId) ? "samengesteld" : "",
        verpakking
      );
      const explicitKind = definitionByPackaging?.kind ?? "samengesteld";
      return {
        bierKey,
        biernaam,
        productId: definitionByPackaging?.id ?? "",
        productType: explicitKind,
        productKey: `${explicitKind}|${normalizeKey(verpakking)}`,
        verpakking,
        litersPerProduct: firstPositiveNumber(
          row.liters_per_product,
          row.totale_inhoud_liter,
          row.inhoud_per_eenheid_liter,
          explicitSource?.totale_inhoud_liter,
          explicitSource?.inhoud_per_eenheid_liter
        ),
        costPerPiece: getSnapshotProductCost(row),
        sourcePackaging: verpakking
      };
    });

    if (getBerekeningTypeForBier(bierKey) === "inkoop") {
      const historicalSnapshotByPackaging = new Map<string, ProductSnapshotRow>();
      for (const record of definitiveBerekeningenHistoryWindow) {
        if (String(record.bier_id ?? "") !== bierKey) {
          continue;
        }
        if (normalizeKey((record.soort_berekening as GenericRecord | undefined)?.type) !== "inkoop") {
          continue;
        }

        const historicalProducten =
          (record.resultaat_snapshot as GenericRecord | undefined)?.producten as GenericRecord | undefined;
        const historicalBasisRows = Array.isArray(historicalProducten?.basisproducten)
          ? (historicalProducten.basisproducten as GenericRecord[])
          : [];
        const historicalSamengesteldeRows = Array.isArray(historicalProducten?.samengestelde_producten)
          ? (historicalProducten.samengestelde_producten as GenericRecord[])
          : [];

        for (const row of [...historicalBasisRows, ...historicalSamengesteldeRows]) {
          const verpakking = getSnapshotPackagingLabel(row);
          const packagingKey = normalizeKey(verpakking);
          if (!packagingKey) {
            continue;
          }

          const rowId = String(row.id ?? "");
          const explicitSource = basisById.get(rowId) ?? samengesteldById.get(rowId);
          const definition = resolveProductDefinition(
            rowId || String(explicitSource?.id ?? ""),
            basisById.has(rowId) ? "basis" : samengesteldById.has(rowId) ? "samengesteld" : "",
            verpakking
          );

          const candidate: ProductSnapshotRow = {
            bierKey,
            biernaam,
            productId: definition?.id ?? "",
            productType: definition?.kind ?? "samengesteld",
            productKey: definition?.key ?? `samengesteld|${packagingKey}`,
            verpakking,
            litersPerProduct: firstPositiveNumber(
              row.liters_per_product,
              row.totale_inhoud_liter,
              row.inhoud_per_eenheid_liter,
              explicitSource?.totale_inhoud_liter,
              explicitSource?.inhoud_per_eenheid_liter,
              definition?.kind === "samengesteld"
                ? samengesteldById.get(definition.id ?? "")?.totale_inhoud_liter
                : basisById.get(definition?.id ?? "")?.inhoud_per_eenheid_liter
            ),
            costPerPiece: getSnapshotProductCost(row),
            sourcePackaging: verpakking
          };

          const current = historicalSnapshotByPackaging.get(packagingKey);
          if (!current || candidate.costPerPiece > current.costPerPiece) {
            historicalSnapshotByPackaging.set(packagingKey, candidate);
          }
        }
      }

      const snapshotByPackaging = new Map<string, ProductSnapshotRow>(
        snapshotRows.map((row) => [normalizeKey(row.verpakking), row])
      );
      const facturen =
        (((berekening.invoer as GenericRecord | undefined)?.inkoop as GenericRecord | undefined)
          ?.facturen as GenericRecord[] | undefined) ?? [];
      const factuurRegels = facturen.flatMap((factuur) =>
        Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : []
      );

      const seenUnitIds = new Set<string>();
      const resultRows = new Map<string, ProductSnapshotRow>();

      factuurRegels
        .map((regel) => String(regel.eenheid ?? ""))
        .filter((unitId) => {
          if (!unitId || seenUnitIds.has(unitId)) {
            return false;
          }
          seenUnitIds.add(unitId);
          return true;
        })
        .flatMap((unitId) => {
          const basis = basisById.get(unitId);
          const samengesteld = samengesteldById.get(unitId);
          const source = basis ?? samengesteld;
          if (!source) {
            return [];
          }
          const kind = basis ? "basis" : "samengesteld";
          const verpakking = String(source.omschrijving ?? "");
          const snapshot =
            historicalSnapshotByPackaging.get(normalizeKey(verpakking)) ??
            snapshotByPackaging.get(normalizeKey(verpakking));
          const rows: ProductSnapshotRow[] = [];

          rows.push({
            bierKey,
            biernaam,
            productId: String(source.id ?? ""),
            productType: kind,
            productKey: `${kind}|${normalizeKey(verpakking)}`,
            verpakking,
            litersPerProduct: firstPositiveNumber(
              snapshot?.litersPerProduct,
              source.inhoud_per_eenheid_liter,
              source.totale_inhoud_liter
            ),
            costPerPiece: snapshot?.costPerPiece ?? 0,
            sourcePackaging: snapshot?.sourcePackaging ?? verpakking
          });

          if (!basis && Array.isArray(source.basisproducten)) {
            for (const basisRow of source.basisproducten as GenericRecord[]) {
              const basisProductId = String(basisRow.basisproduct_id ?? "");
              const basisVerpakking = String(basisRow.omschrijving ?? "");
              if (basisProductId.startsWith("verpakkingsonderdeel:")) {
                continue;
              }
              if (normalizeKey(basisVerpakking) === normalizeKey(verpakking)) {
                continue;
              }
              const basisSnapshot =
                historicalSnapshotByPackaging.get(normalizeKey(basisVerpakking)) ??
                snapshotByPackaging.get(normalizeKey(basisVerpakking));
              rows.push({
                bierKey,
                biernaam,
                productId: basisProductId,
                productType: "basis",
                productKey: `basis|${normalizeKey(basisVerpakking)}`,
                verpakking: basisVerpakking,
                litersPerProduct: firstPositiveNumber(
                  basisSnapshot?.litersPerProduct,
                  basisRow.inhoud_per_eenheid_liter
                ),
                costPerPiece: basisSnapshot?.costPerPiece ?? 0,
                sourcePackaging: basisSnapshot?.sourcePackaging ?? basisVerpakking,
                derivedFromProductId: String(source.id ?? ""),
                derivedFromProductType: kind,
                derivedFromProductKey: `${kind}|${normalizeKey(verpakking)}`,
                derivedFromPackaging: verpakking,
                derivedFromAantal: toNumber(basisRow.aantal, 0)
              });
            }
          }

          return rows;
        })
        .forEach((row) => {
          if (!resultRows.has(row.productKey)) {
            resultRows.set(row.productKey, row);
          }
        });

      return [...resultRows.values()];
    }

    const snapshotMap = new Map<string, ProductSnapshotRow>(
      snapshotRows.map((row) => [normalizeKey(row.verpakking), row])
    );
    const allKnownProducts = [
      ...basisproducten
        .filter((row) => Number(row.jaar ?? 0) === currentYear)
        .map((row) => ({
          id: String(row.id ?? ""),
          key: `basis|${normalizeKey(row.omschrijving)}`,
          kind: "basis" as const,
          verpakking: String(row.omschrijving ?? ""),
          litersPerProduct: toNumber(row.inhoud_per_eenheid_liter, 0)
        })),
      ...samengesteldeProducten
        .filter((row) => Number(row.jaar ?? 0) === currentYear)
        .map((row) => ({
          id: String(row.id ?? ""),
          key: `samengesteld|${normalizeKey(row.omschrijving)}`,
          kind: "samengesteld" as const,
          verpakking: String(row.omschrijving ?? ""),
          litersPerProduct: toNumber(row.totale_inhoud_liter, 0)
        }))
    ];
    const uniqueProductsByPackaging = new Map<
      string,
      { id: string; key: string; kind: "basis" | "samengesteld"; verpakking: string; litersPerProduct: number }
    >();
    for (const product of allKnownProducts) {
      const packagingKey = normalizeKey(product.verpakking);
      const current = uniqueProductsByPackaging.get(packagingKey);
      if (!current) {
        uniqueProductsByPackaging.set(packagingKey, product);
        continue;
      }

      const currentIsBasis = current.key.startsWith("basis|");
      const nextIsBasis = product.key.startsWith("basis|");
      if (!currentIsBasis && nextIsBasis) {
        uniqueProductsByPackaging.set(packagingKey, product);
      }
    }

    return [...uniqueProductsByPackaging.values()].map((product) => {
      const existing = snapshotMap.get(normalizeKey(product.verpakking));
      return {
        bierKey,
        biernaam,
        productId: existing?.productId ?? product.id,
        productType: existing?.productType ?? product.kind,
        productKey: product.key,
        verpakking: product.verpakking,
        litersPerProduct: firstPositiveNumber(existing?.litersPerProduct, product.litersPerProduct),
        costPerPiece:
          existing?.costPerPiece ??
          toNumber(
            (berekening.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
            0
          ) * product.litersPerProduct,
        sourcePackaging: existing?.sourcePackaging ?? product.verpakking
      };
    });
  }

  function buildChannelPrices(
    cost: number,
    bierKey: string,
    productId: string,
    productType: string,
    productKey: string,
    verpakking: string
  ) {
    const strategy = getEffectiveVerkoopstrategieForProduct(
      bierKey,
      productId,
      productType,
      productKey,
      verpakking
    );
    const marges = extractKanaalMarges(strategy);
    const explicitPrices = extractKanaalprijzen(strategy);

    const fallbackPrice = (channel: keyof typeof marges, explicitPrice: number) =>
      Number.isFinite(explicitPrice) && explicitPrice > 0
        ? explicitPrice
        : calculatePriceFromMargin(cost, marges[channel]);

    return {
      zakelijk: fallbackPrice("zakelijk", explicitPrices.zakelijk),
      retail: fallbackPrice("retail", explicitPrices.retail),
      horeca: fallbackPrice("horeca", explicitPrices.horeca),
      slijterij: fallbackPrice("slijterij", explicitPrices.slijterij)
    };
  }

  function syncBeerRowsForSingleBeer(bierKey: string, existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return getSnapshotProductRowsForBier(bierKey).map((snapshotRow) => {
      const existing = existingMap.get(
        getCompositeProductRef(snapshotRow.productType, snapshotRow.productId, snapshotRow.productKey)
      );
      return {
        id: String(existing?.id ?? createId()),
        product_id: snapshotRow.productId,
        product_type: snapshotRow.productType,
        bier_key: bierKey,
        product_key: snapshotRow.productKey,
        verpakking_label: snapshotRow.verpakking,
        liters: toNumber(existing?.liters, 0),
        korting_pct: toNumber(existing?.korting_pct, 0),
        included: isIncluded(existing?.included)
      };
    });
  }

  function syncBeerRowsFromProductRows(
    bierKey: string,
    productRows: GenericRecord[],
    existingRows: GenericRecord[]
  ) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return productRows
      .filter((row) => String(row.bier_key ?? "") === bierKey)
      .map((row) => {
        const productId = String(row.product_id ?? "");
        const productType = String(row.product_type ?? "");
        const productKey = String(row.product_key ?? "");
        const compositeRef = getCompositeProductRef(productType, productId, productKey);
        const existing = existingMap.get(compositeRef);
        const verpakkingLabel =
          String(row.verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${productId}`)?.label ||
          productDefinitionMap.get(productKey)?.label ||
          "";

        return {
          id: String(existing?.id ?? createId()),
          bier_key: bierKey,
          product_id: productId,
          product_type: productType,
          product_key: productKey,
          verpakking_label: verpakkingLabel,
          liters: toNumber(existing?.liters, 0),
          korting_pct: toNumber(existing?.korting_pct, toNumber(row.korting_pct, 0)),
          included: isIncluded(existing?.included)
        };
      });
  }

  function syncBeerRowsForMultipleBieren(selectedBeerKeys: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [String(row.bier_key ?? ""), row])
    );

    return selectedBeerKeys.map((bierKey) => {
      const existing = existingMap.get(bierKey);
      return {
        id: String(existing?.id ?? createId()),
        bier_key: bierKey,
        product_key: "",
        liters: toNumber(existing?.liters, 0),
        korting_pct: toNumber(existing?.korting_pct, 0),
        included: isIncluded(existing?.included)
      };
    });
  }

  function syncHighestOverallRows(existingRows: GenericRecord[]) {
    const first = existingRows[0] ?? {};
    return [
      {
        id: String(first.id ?? createId()),
        bier_key: "",
        product_key: "",
        liters: toNumber(first.liters, 0),
        korting_pct: toNumber(first.korting_pct, 0),
        included: isIncluded(first.included)
      }
    ];
  }

  function syncProductRowsForBieren(selectedBeerKeys: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [`${row.bier_key}|${getStoredProductRef(row)}`, row])
    );

    return selectedBeerKeys.flatMap((bierKey) =>
      getSnapshotProductRowsForBier(bierKey).map((snapshotRow) => {
        const rows: GenericRecord[] = [];
        const compositeKey = `${bierKey}|${getCompositeProductRef(
          snapshotRow.productType,
          snapshotRow.productId,
          snapshotRow.productKey
        )}`;
        const existing = existingMap.get(compositeKey);

        rows.push({
          id: String(existing?.id ?? createId()),
          product_id: snapshotRow.productId,
          product_type: snapshotRow.productType,
          bier_key: bierKey,
          product_key: snapshotRow.productKey,
          verpakking_label: snapshotRow.verpakking,
          aantal: toNumber(existing?.aantal, 0),
          korting_pct: toNumber(existing?.korting_pct, 0),
          included: isIncluded(existing?.included)
        });
        return rows[0];
      })
    );
  }

  const litersDisplayRows = useMemo<LitersDisplayRow[]>(() => {
    const currentBeerRows = Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : [];

    if (!isLitersMode) {
      return [];
    }

    if (litersBasis === "een_bier") {
      const bierKey = String(current.bier_key ?? "");
      const sourceRows = bierKey
        ? (() => {
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(bierKey, currentProductRows, currentBeerRows);
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierKey, currentBeerRows);
          })()
        : currentBeerRows;

      return sourceRows.map((row) => {
        const bierKey = String(row.bier_key ?? current.bier_key ?? "");
        const rowProductKey = String(row.product_key ?? "");
        const rowProductId = String(row.product_id ?? "");
        const snapshots = getHighestLiterRowsForBier(bierKey);
        const snapshot = snapshots.find(
          (item) =>
            (rowProductId && item.productId === rowProductId) ||
            item.productKey === rowProductKey ||
            normalizeKey(item.verpakking) ===
              normalizeKey(String((row as GenericRecord).verpakking_label ?? ""))
        );
        const kostprijsPerLiter =
          snapshot && snapshot.litersPerProduct > 0 ? snapshot.costPerPiece / snapshot.litersPerProduct : 0;
        const verpakking =
          snapshot?.verpakking ||
          String((row as GenericRecord).verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${rowProductId}`)?.label ||
          productDefinitionMap.get(rowProductKey)?.label ||
          "-";
        const kortingPct = toNumber(row.korting_pct, 0);
        const adviesprijzen = buildChannelPrices(
          kostprijsPerLiter,
          bierKey,
          snapshot?.productId ?? rowProductId,
          snapshot?.productType ??
            (String(row.product_type ?? "") as "basis" | "samengesteld" | ""),
          rowProductKey,
          verpakking
        );
        const basisprijs = adviesprijzen[currentKanaal] ?? 0;
        const verkoopprijs = basisprijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const omzet = liters * verkoopprijs;
        const kosten = liters * kostprijsPerLiter;
        const kortingEur = liters * Math.max(0, basisprijs - verkoopprijs);
        const margeEur = omzet - kosten;
        return {
          id: String(row.id ?? ""),
          bierKey,
          biernaam: bierNameMap.get(bierKey) || "-",
          included: isIncluded(row.included),
          productId: snapshot?.productId ?? rowProductId,
          productType:
            snapshot?.productType ??
            (String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
              ? (String(row.product_type ?? "") as "basis" | "samengesteld")
              : "basis"),
          productKey: snapshot?.productKey ?? rowProductKey,
          verpakking,
          liters,
          kortingPct,
          kostprijsPerLiter,
          adviesprijzen,
          basisprijs,
          verkoopprijs,
          omzet,
          kosten,
          kortingEur,
          margeEur,
          margePct: calculateMarginPercentage(omzet, kosten)
        };
      });
    }

    if (litersBasis === "meerdere_bieren") {
      return currentBeerRows.map((row) => {
        const bierKey = String(row.bier_key ?? "");
        const highest = getHighestCostForBier(bierKey);
        const kortingPct = toNumber(row.korting_pct, 0);
        const adviesprijzen = buildChannelPrices(highest.cost, bierKey, "", "", "", "liter");
        const basisprijs = adviesprijzen[currentKanaal] ?? 0;
        const verkoopprijs = basisprijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const omzet = liters * verkoopprijs;
        const kosten = liters * highest.cost;
        const kortingEur = liters * Math.max(0, basisprijs - verkoopprijs);
        const margeEur = omzet - kosten;
        return {
          id: String(row.id ?? ""),
          bierKey,
          biernaam: highest.biernaam,
          included: isIncluded(row.included),
          productKey: "",
          verpakking: "Literregel",
          liters,
          kortingPct,
          kostprijsPerLiter: highest.cost,
          adviesprijzen,
          basisprijs,
          verkoopprijs,
          omzet,
          kosten,
          kortingEur,
          margeEur,
          margePct: calculateMarginPercentage(omzet, kosten)
        };
      });
    }

    const overall = getHighestCostOverall();
    return currentBeerRows.map((row) => {
      const kortingPct = toNumber(row.korting_pct, 0);
      const adviesprijzen = buildChannelPrices(overall.cost, overall.bierKey, "", "", "", "liter");
      const basisprijs = adviesprijzen[currentKanaal] ?? 0;
      const verkoopprijs = basisprijs * Math.max(0, 1 - kortingPct / 100);
      const liters = toNumber(row.liters, 0);
      const omzet = liters * verkoopprijs;
      const kosten = liters * overall.cost;
      const kortingEur = liters * Math.max(0, basisprijs - verkoopprijs);
      const margeEur = omzet - kosten;
      return {
        id: String(row.id ?? ""),
        bierKey: overall.bierKey,
        biernaam: overall.biernaam,
        included: isIncluded(row.included),
        productKey: "",
        verpakking: "Algemene literregel",
        liters,
        kortingPct,
        kostprijsPerLiter: overall.cost,
        adviesprijzen,
        basisprijs,
        verkoopprijs,
        omzet,
        kosten,
        kortingEur,
        margeEur,
        margePct: calculateMarginPercentage(omzet, kosten)
      };
    });
  }, [
    current.beer_rows,
    current.bier_key,
    bierNameMap,
    currentKanaal,
    isLitersMode,
    litersBasis,
    verkoopstrategieWindow
  ]);

  const litersTotals = useMemo(
    () =>
      litersDisplayRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [litersDisplayRows]
  );

  const productDisplayRows = useMemo<ProductDisplayRow[]>(() => {
    const currentProductRows = Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : [];

    return currentProductRows.map((row) => {
      const bierKey = String(row.bier_key ?? "");
      const snapshotRowsForBier = getSnapshotProductRowsForBier(bierKey);
      const rowProductKey = String(row.product_key ?? "");
      const explicitLabel = String(row.verpakking_label ?? "");
      const rowProductId = String(row.product_id ?? "");
      const rowProductType =
        String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
          ? (String(row.product_type ?? "") as "basis" | "samengesteld")
          : "";
      const rowLabel =
        explicitLabel ||
        productDefinitionMap.get(`id|${rowProductId}`)?.label ||
        productDefinitionMap.get(rowProductKey)?.label ||
        rowProductKey.split("|")[1] ||
        rowProductKey;
      const snapshot = snapshotRowsForBier.find(
        (item) =>
          (rowProductId && item.productId === rowProductId) ||
          item.productKey === rowProductKey ||
          normalizeKey(item.verpakking) === normalizeKey(rowLabel) ||
          normalizeKey(item.sourcePackaging) === normalizeKey(rowLabel)
      );
      const definition =
        (rowProductId ? productDefinitionMap.get(`id|${rowProductId}`) : undefined) ??
        productDefinitionMap.get(String(row.product_key ?? ""));
      const verpakking = snapshot?.verpakking ?? definition?.label ?? "-";
      const kostprijsPerStuk = snapshot?.costPerPiece ?? 0;
      let adviesprijzen = buildChannelPrices(
        kostprijsPerStuk,
        bierKey,
        snapshot?.productId ?? rowProductId,
        snapshot?.productType ?? rowProductType,
        rowProductKey,
        verpakking
      );
      let kanaalMargePct =
        getKanaalMarges(
          bierKey,
          snapshot?.productId ?? rowProductId,
          snapshot?.productType ?? rowProductType,
          rowProductKey,
          verpakking
        )[
          currentKanaal as keyof ReturnType<typeof extractKanaalMarges>
        ] ?? 0;

      const hasDirectStrategyPricing =
        Object.values(adviesprijzen).some((value) => value > 0) || kanaalMargePct > 0;

      if (
        !hasDirectStrategyPricing &&
        snapshot?.derivedFromProductKey &&
        snapshot.derivedFromPackaging &&
        toNumber(snapshot.derivedFromAantal, 0) > 0
      ) {
        const parentSnapshot = snapshotRowsForBier.find(
          (item) =>
            item.productKey === snapshot.derivedFromProductKey ||
            normalizeKey(item.verpakking) === normalizeKey(snapshot.derivedFromPackaging)
        );

        if (parentSnapshot) {
          const parentPrices = buildChannelPrices(
            parentSnapshot.costPerPiece,
            bierKey,
            parentSnapshot.productId,
            parentSnapshot.productType,
            parentSnapshot.productKey,
            parentSnapshot.verpakking
          );
          const divisor = toNumber(snapshot.derivedFromAantal, 0);
          adviesprijzen = {
            zakelijk: parentPrices.zakelijk / divisor,
            retail: parentPrices.retail / divisor,
            horeca: parentPrices.horeca / divisor,
            slijterij: parentPrices.slijterij / divisor
          };
          kanaalMargePct =
            getKanaalMarges(
              bierKey,
              parentSnapshot.productId,
              parentSnapshot.productType,
              parentSnapshot.productKey,
              parentSnapshot.verpakking
            )[
              currentKanaal as keyof ReturnType<typeof extractKanaalMarges>
            ] ?? 0;
        }
      }

      const basisprijs = adviesprijzen[currentKanaal] ?? 0;
      const kortingPct = toNumber(row.korting_pct, 0);
      const aantal = toNumber(row.aantal, 0);
      const verkoopprijs = basisprijs * Math.max(0, 1 - kortingPct / 100);
      const omzet = aantal * verkoopprijs;
      const kosten = aantal * kostprijsPerStuk;
      const kortingEur = aantal * Math.max(0, basisprijs - verkoopprijs);
      const margeEur = omzet - kosten;
      return {
        id: String(row.id ?? ""),
        bierKey,
        biernaam: bierNameMap.get(bierKey) || "-",
        included: isIncluded(row.included),
        productId: snapshot?.productId ?? rowProductId,
        productType: snapshot?.productType ?? (rowProductType || "basis"),
        productKey: String(row.product_key ?? ""),
        verpakking,
        aantal,
        kortingPct,
        kostprijsPerStuk,
        adviesprijzen,
        basisprijs,
        verkoopprijs,
        omzet,
        kosten,
        kortingEur,
        margeEur,
        margePct: calculateMarginPercentage(omzet, kosten),
        kanaalMargePct
      };
    });
  }, [current.product_rows, bierNameMap, currentKanaal, productDefinitionMap, verkoopstrategieWindow]);

  const productTotals = useMemo(
    () =>
      productDisplayRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [productDisplayRows]
  );

  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps,
      activeIndex: activeStepIndex,
      onStepSelect: setActiveStepIndex
    }),
    [activeStepIndex]
  );

  usePageShellWizardSidebar(wizardSidebar);

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (String(row.id) !== String(current.id)) {
          return row;
        }
        const next = cloneRecord(row);
        updater(next);
        next.last_step = activeStepIndex + 1;
        return next;
      })
    );
  }

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  async function handleSave() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);

    try {
      const payload = rows.map((row) => {
        const next = cloneRecord(row);
        if (String(next.id ?? "").trim() === "") {
          next.id = createId();
        }
        return next;
      });

      const response = await fetch(`${API_BASE_URL}/data/prijsvoorstellen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Prijsvoorstel opgeslagen.");
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

  async function handleDeleteCurrent() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);

    try {
      const payload = rows.filter((row) => String(row.id) !== String(current.id));
      const response = await fetch(`${API_BASE_URL}/data/prijsvoorstellen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Verwijderen mislukt");
      }

      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Prijsvoorstel verwijderd.");
      setStatusTone("success");
      onBackToLanding?.();
    } catch {
      setStatus("Verwijderen mislukt.");
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSingleBeerChange(bierKey: string) {
    updateCurrent((draft) => {
      draft.bier_key = bierKey;
      draft.product_bier_keys = bierKey ? [bierKey] : [];
      draft.beer_rows = bierKey
        ? syncBeerRowsForSingleBeer(
            bierKey,
            Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
          )
        : [];
    });
  }

  function handleBeerMultiSelection(selectedBeerKeys: string[]) {
    updateCurrent((draft) => {
      draft.product_bier_keys = selectedBeerKeys;
      draft.bier_key = selectedBeerKeys[0] ?? "";

      if (String(draft.voorsteltype ?? "") === "Op basis van producten") {
        draft.product_rows = syncProductRowsForBieren(
          selectedBeerKeys,
          Array.isArray(draft.product_rows) ? (draft.product_rows as GenericRecord[]) : []
        );
      } else {
        draft.beer_rows = syncBeerRowsForMultipleBieren(
          selectedBeerKeys,
          Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
        );
      }
    });
  }

  function handleHighestOverallSetup() {
    updateCurrent((draft) => {
      draft.bier_key = "";
      draft.product_bier_keys = [];
      draft.beer_rows = syncHighestOverallRows(
        Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
      );
    });
  }

  function updateBeerRow(
    rowId: string,
    field: "liters" | "korting_pct" | "included",
    value: number | boolean
  ) {
    updateCurrent((draft) => {
      const nextRows = Array.isArray(draft.beer_rows) ? [...(draft.beer_rows as GenericRecord[])] : [];
      const index = nextRows.findIndex((row) => String(row.id ?? "") === rowId);
      if (index < 0) {
        return;
      }
      nextRows[index] = { ...nextRows[index], [field]: value };
      draft.beer_rows = nextRows;
    });
  }

  function updateProductRow(
    rowId: string,
    field: "aantal" | "korting_pct" | "included",
    value: number | boolean
  ) {
    updateCurrent((draft) => {
      const nextRows = Array.isArray(draft.product_rows) ? [...(draft.product_rows as GenericRecord[])] : [];
      const index = nextRows.findIndex((row) => String(row.id ?? "") === rowId);
      if (index < 0) {
        return;
      }
      nextRows[index] = { ...nextRows[index], [field]: value };
      draft.product_rows = nextRows;
    });
  }

  useEffect(() => {
    const selectedBeerKeys = Array.isArray(current.product_bier_keys)
      ? (current.product_bier_keys as string[]).filter(Boolean)
      : [];

    if (!isLitersMode) {
      const desiredRows = selectedBeerKeys.length
        ? syncProductRowsForBieren(
            selectedBeerKeys,
            Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []
          )
        : [];

      const currentSignature = JSON.stringify(
        (Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []).map((row) => ({
          bier_key: String(row.bier_key ?? ""),
          product_key: String(row.product_key ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_key: String(row.bier_key ?? ""),
          product_key: String(row.product_key ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.product_rows = desiredRows;
        });
      }
      return;
    }

    if (litersBasis === "een_bier") {
      const bierKey = String(current.bier_key ?? "");
      const desiredRows = bierKey
        ? (() => {
            const currentBeerRows = Array.isArray(current.beer_rows)
              ? (current.beer_rows as GenericRecord[])
              : [];
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(
              bierKey,
              currentProductRows,
              currentBeerRows
            );
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierKey, currentBeerRows);
          })()
        : [];
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_key: String(row.bier_key ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? ""),
          product_key: String(row.product_key ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_key: String(row.bier_key ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? ""),
          product_key: String(row.product_key ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.product_bier_keys = bierKey ? [bierKey] : [];
          draft.beer_rows = desiredRows;
        });
      }
      return;
    }

    if (litersBasis === "meerdere_bieren") {
      const desiredRows = syncBeerRowsForMultipleBieren(
        selectedBeerKeys,
        Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []
      );
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_key: String(row.bier_key ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_key: String(row.bier_key ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.beer_rows = desiredRows;
        });
      }
      return;
    }

    const desiredRows = syncHighestOverallRows(
      Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []
    );
    const currentSignature = JSON.stringify(
      (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
        bier_key: String(row.bier_key ?? ""),
        product_key: String(row.product_key ?? "")
      }))
    );
    const desiredSignature = JSON.stringify(
      desiredRows.map((row) => ({
        bier_key: String(row.bier_key ?? ""),
        product_key: String(row.product_key ?? "")
      }))
    );

    if (currentSignature !== desiredSignature) {
      updateCurrent((draft) => {
        draft.beer_rows = desiredRows;
      });
    }
  }, [
    current.bier_key,
    current.beer_rows,
    current.product_bier_keys,
    current.product_rows,
    currentYear,
    isLitersMode,
    litersBasis
  ]);

  function renderBasisStep() {
    const offerteDatum = getDateInputValue(current.datum_text);
    const verloopOp = getDateInputValue(current.verloopt_op);

    return (
      <div className="wizard-form-grid">
        <label className="nested-field">
          <span>Klantnaam</span>
          <input
            className="dataset-input"
            value={String(current.klantnaam ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.klantnaam = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Status</span>
          <input
            className="dataset-input"
            value={String(current.status ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.status = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Offertenummer</span>
          <input
            className="dataset-input"
            value={String(current.offertenummer ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.offertenummer = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Offertedatum</span>
          <input
            className="dataset-input"
            type="date"
            value={offerteDatum}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.datum_text = event.target.value;
                const huidigeVerlooptOp = normalizeText(draft.verloopt_op);
                if (!huidigeVerlooptOp || huidigeVerlooptOp === verloopOp) {
                  draft.verloopt_op = event.target.value ? addDays(event.target.value, 30) : "";
                }
              })
            }
          />
        </label>
        <label className="nested-field">
          <span>Verloopt op</span>
          <input
            className="dataset-input"
            type="date"
            value={verloopOp || (offerteDatum ? addDays(offerteDatum, 30) : "")}
            onChange={(event) => updateCurrent((draft) => void (draft.verloopt_op = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Jaar</span>
          <select
            className="dataset-input"
            value={String(current.jaar ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.jaar = Number(event.target.value || new Date().getFullYear());
                draft.bier_key = "";
                draft.product_bier_keys = [];
                draft.product_rows = [];
                draft.beer_rows = [];
              })
            }
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label className="nested-field">
          <span>Contactpersoon</span>
          <input
            className="dataset-input"
            value={String(current.contactpersoon ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => void (draft.contactpersoon = event.target.value))
            }
          />
        </label>
        <label className="nested-field">
          <span>Referentie</span>
          <input
            className="dataset-input"
            value={String(current.referentie ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.referentie = event.target.value))}
          />
        </label>
      </div>
    );
  }

  function renderUitgangspuntenStep() {
    return (
      <UitgangspuntenStep
        row={current}
        kanaalOptions={KANAAL_OPTIONS}
        litersBasisOptions={LITERS_BASIS_OPTIONS}
        onChange={updateCurrent}
      />
    );
  }

  function renderBeerSelectionList(
    selectedValues: string[],
    onToggle: (nextValues: string[]) => void
  ) {
    return (
      <SearchableMultiSelect
        label="Bieren"
        options={bierOptions}
        selectedValues={selectedValues}
        onChange={onToggle}
      />
    );
  }

  function renderIncludeToggle(
    included: boolean,
    onToggle: () => void,
    label: string
  ) {
    return (
      <button
        type="button"
        className={`visibility-toggle-button ${included ? "is-included" : "is-excluded"}`}
        onClick={onToggle}
        aria-label={label}
        title={label}
      >
        {included ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="visibility-toggle-icon">
            <path
              d="M2.2 12s3.6-6 9.8-6 9.8 6 9.8 6-3.6 6-9.8 6-9.8-6-9.8-6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="visibility-toggle-icon">
            <path
              d="M2.2 12s3.6-6 9.8-6c2.2 0 4.1.7 5.6 1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M21.8 12s-3.6 6-9.8 6c-2.2 0-4.1-.7-5.6-1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 4 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    );
  }

  function renderLitersOfferte() {
    const selectedBeerKeys = Array.isArray(current.product_bier_keys)
      ? (current.product_bier_keys as string[]).filter(Boolean)
      : [];
    const kanaalLabel =
      KANAAL_OPTIONS.find((option) => option.value === currentKanaal)?.label ?? currentKanaal;
    const totalMargePct = calculateMarginPercentage(litersTotals.omzet, litersTotals.kosten);

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Selectie</div>
          <div className="module-card-text">
            Kies hieronder het bier of de bieren waarop deze liters-offerte moet worden gebaseerd.
          </div>

          {litersBasis === "een_bier" ? (
            <div className="wizard-form-grid prijs-uitgangspunten-form-grid">
              <label className="nested-field">
                <span>Bier</span>
                <select
                  className="dataset-input"
                  value={String(current.bier_key ?? "")}
                  onChange={(event) => handleSingleBeerChange(event.target.value)}
                >
                  <option value="">Kies een bier...</option>
                  {bierOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : litersBasis === "meerdere_bieren" ? (
            renderBeerSelectionList(selectedBeerKeys, handleBeerMultiSelection)
          ) : (
            <div className="editor-actions-group">
              <span className="muted">
                Gebruik de hoogste bekende kostprijs van alle definitieve bieren in {currentYear}.
              </span>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={handleHighestOverallSetup}
              >
                Literregel opbouwen
              </button>
            </div>
          )}
        </div>

        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">Kanaal</div>
            <div className="stat-value small">{kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(litersTotals.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(litersTotals.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(litersTotals.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(litersTotals.margeEur)} ({formatPercentage(totalMargePct)})
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Liters</th>
                <th>Korting %</th>
                <th>Kost prijs / L</th>
                <th>Verkoop prijs / L</th>
                <th>Omzet</th>
                <th>Kosten</th>
                <th>Korting €</th>
                <th>Winst</th>
                <th>Onze marge</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {litersDisplayRows.map((row) => (
                <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(row.liters)}
                      onChange={(event) =>
                        updateBeerRow(row.id, "liters", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.1"
                      value={String(row.kortingPct)}
                      onChange={(event) =>
                        updateBeerRow(row.id, "korting_pct", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerLiter)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.verkoopprijs)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.omzet)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kosten)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kortingEur)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.margeEur)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatPercentage(row.margePct)}</div></td>
                  <td>
                    {renderIncludeToggle(
                      row.included,
                      () => updateBeerRow(row.id, "included", !row.included),
                      row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                    )}
                  </td>
                </tr>
              ))}
              {litersDisplayRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="prijs-empty-cell">
                    Kies eerst een bier of zet een literscenario klaar om de offerte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderProductOfferte() {
    const selectedBeerKeys = Array.isArray(current.product_bier_keys)
      ? (current.product_bier_keys as string[]).filter(Boolean)
      : [];
    const kanaalLabel =
      KANAAL_OPTIONS.find((option) => option.value === currentKanaal)?.label ?? currentKanaal;
    const totalMargePct = calculateMarginPercentage(productTotals.omzet, productTotals.kosten);

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Bieren voor dit voorstel</div>
          <div className="module-card-text">
            Kies één of meer definitieve bieren. De app haalt daarna automatisch de gekoppelde
            producten en kostprijzen op uit de bekende kostprijsberekeningen.
          </div>
          {renderBeerSelectionList(selectedBeerKeys, handleBeerMultiSelection)}
        </div>

        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">Kanaal</div>
            <div className="stat-value small">{kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(productTotals.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(productTotals.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(productTotals.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(productTotals.margeEur)} ({formatPercentage(totalMargePct)})
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Aantal</th>
                <th>Korting %</th>
                <th>Kostprijs / stuk</th>
                <th>Verkoopprijs / stuk</th>
                <th>Omzet</th>
                <th>Kosten</th>
                <th>Korting €</th>
                <th>Winst</th>
                <th>Onze marge</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {productDisplayRows.map((row) => (
                <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="1"
                      value={String(row.aantal)}
                      onChange={(event) =>
                        updateProductRow(row.id, "aantal", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.1"
                      value={String(row.kortingPct)}
                      onChange={(event) =>
                        updateProductRow(row.id, "korting_pct", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerStuk)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.verkoopprijs)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.omzet)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kosten)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kortingEur)}</div></td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.margeEur)}</div></td>
                  <td>
                    <div className="dataset-input dataset-input-readonly">
                      {formatPercentage(row.margePct)}
                    </div>
                  </td>
                  <td>
                    {renderIncludeToggle(
                      row.included,
                      () => updateProductRow(row.id, "included", !row.included),
                      row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                    )}
                  </td>
                </tr>
              ))}
              {productDisplayRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="prijs-empty-cell">
                    Kies eerst een of meer bieren om de productofferte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderOfferteStep() {
    return isLitersMode ? renderLitersOfferte() : renderProductOfferte();
  }

  function renderSummaryTable() {
    if (isLitersMode) {
      return (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Verpakking</th>
                <th>Liters</th>
                <th>Inkoopprijs / L</th>
                <th>Adviesprijs zakelijk</th>
                <th>Adviesprijs retail</th>
                <th>Adviesprijs horeca</th>
                <th>Adviesprijs slijterij</th>
              </tr>
            </thead>
            <tbody>
              {litersDisplayRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>{formatNumber(row.liters)}</td>
                  <td>{formatEuro(row.kostprijsPerLiter)}</td>
                  <td>{formatEuro(row.adviesprijzen.zakelijk)}</td>
                  <td>{formatEuro(row.adviesprijzen.retail)}</td>
                  <td>{formatEuro(row.adviesprijzen.horeca)}</td>
                  <td>{formatEuro(row.adviesprijzen.slijterij)}</td>
                </tr>
              ))}
              {litersDisplayRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="prijs-empty-cell">Nog geen liters-offerte opgebouwd.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table wizard-table-compact">
          <thead>
            <tr>
              <th>Bier</th>
              <th>Product</th>
              <th>Aantal</th>
              <th>Kostprijs / stuk</th>
              <th>Adviesprijs zakelijk</th>
              <th>Adviesprijs retail</th>
              <th>Adviesprijs horeca</th>
              <th>Adviesprijs slijterij</th>
            </tr>
          </thead>
          <tbody>
            {productDisplayRows.map((row) => (
              <tr key={row.id}>
                <td>{row.biernaam}</td>
                <td>{row.verpakking}</td>
                <td>{formatNumber(row.aantal, 0)}</td>
                <td>{formatEuro(row.kostprijsPerStuk)}</td>
                <td>{formatEuro(row.adviesprijzen.zakelijk)}</td>
                <td>{formatEuro(row.adviesprijzen.retail)}</td>
                <td>{formatEuro(row.adviesprijzen.horeca)}</td>
                <td>{formatEuro(row.adviesprijzen.slijterij)}</td>
              </tr>
            ))}
            {productDisplayRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="prijs-empty-cell">Nog geen productofferte opgebouwd.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSamenvattingStep() {
    const gekozenKanaal = KANAAL_OPTIONS.find((option) => option.value === currentKanaal)?.label ?? currentKanaal;

    return (
      <div className="wizard-stack">
        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">Voorsteltype</div>
            <div className="stat-value small">{String(current.voorsteltype || "-")}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Verkoopjaar</div>
            <div className="stat-value small">{currentYear}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Referentiekanaal</div>
            <div className="stat-value small">{gekozenKanaal}</div>
          </div>
        </div>

        <div className="module-card compact-card">
          <div className="module-card-title">Commerciële samenvatting</div>
          <div className="module-card-text">
            Hieronder zie je de kostprijzen en de afgeleide adviesprijzen per kanaal op basis van
            de huidige kostprijsberekeningen en verkoopstrategie van {currentYear}.
          </div>
        </div>

        {renderSummaryTable()}
      </div>
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "uitgangspunten") return renderUitgangspuntenStep();
    if (currentStep.id === "offerte") return renderOfferteStep();
    return renderSamenvattingStep();
  }

  return (
    <section className="content-card wizard-main-card">
      <div className="wizard-main-header">
        <div>
          <h2 className="wizard-main-title">
            {String(current.offertenummer || current.klantnaam || "Nieuw prijsvoorstel")}
          </h2>
          <div className="page-text">
            Bouw het prijsvoorstel op vanuit basisgegevens, uitgangspunten, offerte-opbouw en een
            commerciële samenvatting per kanaal.
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
              aria-label="Prijsvoorstel verwijderen"
              title="Verwijderen"
              disabled={isSaving}
              onClick={() =>
                requestDelete(
                  "Prijsvoorstel verwijderen",
                  `Weet je zeker dat je het prijsvoorstel voor ${String(
                    current.klantnaam || current.offertenummer || "dit voorstel"
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
          <span className="pill">{String(current.status ?? "concept")}</span>
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div>
              <div className="wizard-step-title">
                Stap {activeStepIndex + 1}: {currentStep.label}
              </div>
              <div className="wizard-step-description">{currentStep.description}</div>
            </div>
          </div>

          <div className="wizard-step-body">{renderStepContent()}</div>

          <div className="editor-actions wizard-footer-actions">
            <div className="editor-actions-group">
              {activeStepIndex > 0 ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setActiveStepIndex(Math.max(0, activeStepIndex - 1))}
                >
                  Vorige
                </button>
              ) : null}
            </div>
            <div className="editor-actions-group">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  void handleSave();
                }}
              >
                Opslaan
              </button>
              <button
                type="button"
                className="editor-button"
                disabled={isSaving}
                onClick={async () => {
                  if (currentStep.id === "samenvatting") {
                    const saved = await handleSave();
                    if (saved) {
                      onFinish?.();
                    }
                    return;
                  }

                  setActiveStepIndex(Math.min(steps.length - 1, activeStepIndex + 1));
                }}
              >
                {isSaving ? "Opslaan..." : currentStep.id === "samenvatting" ? "Afronden" : "Volgende"}
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
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-prijsvoorstel-title">
            <div className="confirm-modal-title" id="confirm-prijsvoorstel-title">
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

function SearchableMultiSelect({
  label,
  options,
  selectedValues,
  onChange
}: {
  label: string;
  options: SelectOption[];
  selectedValues: string[];
  onChange: (nextValues: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [options, query]
  );

  const selectedLabels = selectedValues
    .map((value) => options.find((item) => item.value === value)?.label ?? value)
    .filter(Boolean);

  return (
    <div className="prijs-multiselect">
      <div className="nested-field">
        <span>{label}</span>
        <button
          type="button"
          className={`prijs-multiselect-trigger${isOpen ? " open" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
        >
          <span className="prijs-multiselect-trigger-text">
            {selectedLabels.length > 0
              ? `${selectedLabels.length} bier${selectedLabels.length === 1 ? "" : "en"} geselecteerd`
              : "Kies een of meer bieren"}
          </span>
          <span className="prijs-multiselect-trigger-icon">{isOpen ? "−" : "+"}</span>
        </button>
      </div>

      {selectedValues.length > 0 ? (
        <div className="prijs-multiselect-chips">
          {selectedValues.map((value) => {
            const option = options.find((item) => item.value === value);
            return (
              <button
                key={value}
                type="button"
                className="prijs-multiselect-chip"
                onClick={() => onChange(selectedValues.filter((item) => item !== value))}
              >
                {option?.label ?? value} ×
              </button>
            );
          })}
        </div>
      ) : null}

      {isOpen ? (
        <div className="prijs-multiselect-dropdown">
          <div className="prijs-multiselect-header">
            <input
              className="dataset-input"
              type="text"
              value={query}
              placeholder="Zoek bier..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="prijs-selector-list prijs-selector-list-dropdown">
            {filteredOptions.map((option) => {
              const checked = selectedValues.includes(option.value);
              return (
                <label key={option.value} className="prijs-selector-row">
                  <span className="prijs-checkbox-line">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const nextValues = checked
                          ? selectedValues.filter((value) => value !== option.value)
                          : [...selectedValues, option.value];
                        onChange(nextValues);
                      }}
                    />
                    <span>{option.label}</span>
                  </span>
                </label>
              );
            })}
            {filteredOptions.length === 0 ? (
              <div className="prijs-empty-cell">Geen bieren gevonden voor deze zoekterm.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
