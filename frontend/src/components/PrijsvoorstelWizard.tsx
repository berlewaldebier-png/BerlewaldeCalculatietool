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
  channels: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
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

type ChannelOption = {
  value: string;
  label: string;
  defaultMarginPct: number;
};

const DEFAULT_CHANNEL_OPTIONS: ChannelOption[] = [
  { value: "horeca", label: "Horeca", defaultMarginPct: 50 },
  { value: "retail", label: "Supermarkt", defaultMarginPct: 30 },
  { value: "slijterij", label: "Slijterij", defaultMarginPct: 40 },
  { value: "zakelijk", label: "Speciaalzaak", defaultMarginPct: 45 }
];

type ProductDefinition = {
  id: string;
  key: string;
  label: string;
  kind: "basis" | "samengesteld";
};

type ProductSnapshotRow = {
  bierKey: string;
  biernaam: string;
  kostprijsversieId: string;
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
  kostprijsversieId: string;
  included: boolean;
  productId?: string;
  productType?: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  liters: number;
  kortingPct: number;
  kostprijsPerLiter: number;
  offerPrijs: number;
  sellInPrijs: number;
  sellInMargePct: number;
  offerByChannel: Record<string, number>;
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
  kostprijsversieId: string;
  included: boolean;
  productId: string;
  productType: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  aantal: number;
  kortingPct: number;
  kostprijsPerStuk: number;
  offerPrijs: number;
  sellInPrijs: number;
  sellInMargePct: number;
  offerByChannel: Record<string, number>;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
};

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
    description: "Gebruik de hoogste bekende kostprijs van alle actieve kostprijsversies in dit jaar."
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

const wizardSteps: StepDefinition[] = [
  ...steps.slice(0, 3),
  {
    id: "samenvatting",
    label: "Samenvatting",
    description: "Controleer kostprijs en verkoopprijzen voor het gekozen kanaal."
  },
  {
    id: "afronden",
    label: "Afronden",
    description: "Voeg een opmerking toe, vraag een concept-PDF op en rond het voorstel definitief af."
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
  return "";
}

function getStoredProductRef(row: GenericRecord) {
  return getCompositeProductRef(
    String(row.product_type ?? ""),
    String(row.product_id ?? ""),
    ""
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

function getEnrichedInkoopFactuurregels(berekening: GenericRecord) {
  const inkoop = (((berekening.invoer as GenericRecord | undefined)?.inkoop as GenericRecord | undefined) ??
    {}) as GenericRecord;
  const topLevelFactuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const factuurRegelsUitFacturen = facturen.flatMap((factuur) => {
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (toNumber(factuur.verzendkosten, 0) + toNumber(factuur.overige_kosten, 0)) / regels.length
        : 0;
    return regels.map((regel) => ({ regel, extraKostenPerRegel: extraPerRegel }));
  });

  if (factuurRegelsUitFacturen.length > 0) {
    return factuurRegelsUitFacturen;
  }

  const topLevelExtraPerRegel =
    topLevelFactuurregels.length > 0
      ? (toNumber(inkoop.verzendkosten, 0) + toNumber(inkoop.overige_kosten, 0)) /
        topLevelFactuurregels.length
      : 0;

  return topLevelFactuurregels.map((regel) => ({
    regel,
    extraKostenPerRegel: topLevelExtraPerRegel
  }));
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
  const rowsWithYear = rows.filter((row) => {
    const yearValue = Number(row.jaar ?? 0);
    return Number.isFinite(yearValue) && yearValue > 0;
  });

  if (rowsWithYear.length === 0) {
    const byId = new Map<string, GenericRecord>();
    rows.forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    });
    return [...byId.values()];
  }

  const byId = new Map<string, GenericRecord>();

  [...rowsWithYear]
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
  [...rowsWithYear]
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
  const normalizeProductRows = Array.isArray(raw.product_rows)
    ? (raw.product_rows as GenericRecord[]).map((row) => ({
        ...row,
        kostprijsversie_id: String(row.kostprijsversie_id ?? ""),
        included: isIncluded(row.included),
        cost_at_quote: toNumber(row.cost_at_quote, 0),
        sales_price_at_quote: toNumber(row.sales_price_at_quote, 0),
        revenue_at_quote: toNumber(row.revenue_at_quote, 0),
        margin_at_quote: toNumber(row.margin_at_quote, 0),
        target_margin_pct_at_quote: toNumber(row.target_margin_pct_at_quote, 0),
        channel_at_quote: String(row.channel_at_quote ?? ""),
        verpakking_label: String(row.verpakking_label ?? "")
      }))
    : [];
  const normalizeBeerRows = Array.isArray(raw.beer_rows)
    ? (raw.beer_rows as GenericRecord[]).map((row) => ({
        ...row,
        kostprijsversie_id: String(row.kostprijsversie_id ?? ""),
        included: isIncluded(row.included),
        cost_at_quote: toNumber(row.cost_at_quote, 0),
        sales_price_at_quote: toNumber(row.sales_price_at_quote, 0),
        revenue_at_quote: toNumber(row.revenue_at_quote, 0),
        margin_at_quote: toNumber(row.margin_at_quote, 0),
        target_margin_pct_at_quote: toNumber(row.target_margin_pct_at_quote, 0),
        channel_at_quote: String(row.channel_at_quote ?? ""),
        verpakking_label: String(row.verpakking_label ?? "")
      }))
    : [];

  const nowYear = new Date().getFullYear();
  const rawYear = toNumber(raw.jaar, 0);
  const jaar = rawYear > 0 ? rawYear : nowYear;
  const kanaal = normalizeKey(raw.kanaal) || "horeca";
  const pricingChannel = normalizeKey(raw.pricing_channel) || kanaal;

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
    jaar,
    voorsteltype: String(raw.voorsteltype ?? "Op basis van producten"),
    offer_level: String(raw.offer_level ?? "samengesteld"),
    liters_basis: String(raw.liters_basis ?? "een_bier"),
    kanaal,
    pricing_channel: pricingChannel,
    selected_kanalen: Array.isArray(raw.selected_kanalen)
      ? raw.selected_kanalen.map((value) => normalizeKey(value)).filter(Boolean)
      : [],
    reference_channels: Array.isArray(raw.reference_channels)
      ? raw.reference_channels.map((value) => normalizeKey(value)).filter(Boolean)
      : [],
    bier_id: String(raw.bier_id ?? ""),
    selected_bier_ids: Array.isArray(raw.selected_bier_ids)
      ? raw.selected_bier_ids.map((value) => String(value ?? ""))
      : [],
    kostprijsversie_ids: Array.isArray(raw.kostprijsversie_ids)
      ? raw.kostprijsversie_ids.map((value) => String(value ?? "")).filter(Boolean)
      : [],
    deleted_product_refs: Array.isArray(raw.deleted_product_refs) ? raw.deleted_product_refs : [],
    staffels: Array.isArray(raw.staffels) ? raw.staffels : [],
    product_rows: normalizeProductRows,
    beer_rows: normalizeBeerRows,
    last_step: Number(raw.last_step ?? 1),
    finalized_at: String(raw.finalized_at ?? "")
  };
}

function createEmptyPrijsvoorstel(defaultYear?: number): GenericRecord {
  const fallbackYear = Number.isFinite(Number(defaultYear)) && Number(defaultYear) > 0
    ? Number(defaultYear)
    : new Date().getFullYear();
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
    jaar: fallbackYear,
    voorsteltype: "Op basis van producten",
    offer_level: "samengesteld",
    liters_basis: "een_bier",
    kanaal: "horeca",
    pricing_channel: "horeca",
    selected_kanalen: [],
    reference_channels: [],
    bier_id: "",
    selected_bier_ids: [],
    kostprijsversie_ids: [],
    deleted_product_refs: [],
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
  channels,
  kostprijsproductactiveringen,
  basisproducten,
  samengesteldeProducten,
  initialSelectedId,
  startWithNew = false,
  onBackToLanding,
  onRowsChange,
  onFinish
}: PrijsvoorstelWizardProps) {
  const defaultYearOption = useMemo(() => {
    const years = Array.isArray(yearOptions) ? yearOptions : [];
    const first = Number(years[0] ?? 0);
    return Number.isFinite(first) && first > 0 ? first : new Date().getFullYear();
  }, [yearOptions]);

  const emptyPrijsvoorstel = useMemo(() => createEmptyPrijsvoorstel(defaultYearOption), [defaultYearOption]);

  const initialState = useMemo(() => {
    const normalizedRows = initialRows.map((row) => normalizePrijsvoorstel(row));

    if (startWithNew || normalizedRows.length === 0) {
      const next = createEmptyPrijsvoorstel(defaultYearOption);
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
      selectedId: String(matchedRow?.id ?? normalizedRows[0]?.id ?? emptyPrijsvoorstel.id)
    };
  }, [defaultYearOption, emptyPrijsvoorstel.id, initialRows, initialSelectedId, startWithNew]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const [selectedId, setSelectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);

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
    rows.find((row) => String(row.id) === effectiveSelectedId) ?? rows[0] ?? emptyPrijsvoorstel;
  const isEditingExisting = !startWithNew;
  const channelOptions = useMemo<ChannelOption[]>(
    () => {
      const byCode = new Map(DEFAULT_CHANNEL_OPTIONS.map((option) => [option.value, option]));
      (Array.isArray(channels) ? channels : []).forEach((row) => {
        const value = String(row.code ?? row.id ?? "").trim().toLowerCase();
        if (!value || value === "particulier") return;
        byCode.set(value, {
          value,
          label: String(row.naam ?? row.code ?? "").trim() || value,
          defaultMarginPct: toNumber(row.default_marge_pct, byCode.get(value)?.defaultMarginPct ?? 50)
        });
      });
      return [...byCode.values()].sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
    },
    [channels]
  );
  const defaultKanaal = channelOptions[0]?.value ?? "horeca";
  const currentStep = wizardSteps[activeStepIndex] ?? wizardSteps[0];
  const currentYear = (() => {
    const parsed = toNumber(current.jaar, 0);
    return parsed > 0 ? parsed : new Date().getFullYear();
  })();
  const pricingChannel = normalizeKey(current.pricing_channel) || normalizeKey(current.kanaal) || defaultKanaal;
  const legacySelectedKanaalValues = Array.from(
    new Set(
      (Array.isArray(current.selected_kanalen) ? (current.selected_kanalen as string[]) : [])
        .map((value) => normalizeKey(value))
        .filter(Boolean)
    )
  );
  const effectiveSelectedKanaalValues =
    legacySelectedKanaalValues.length > 0 ? legacySelectedKanaalValues : [pricingChannel || defaultKanaal];
  const currentKanaal = effectiveSelectedKanaalValues[0] ?? defaultKanaal;
  const isMultiKanaalMode = effectiveSelectedKanaalValues.length > 1;
  const isLitersMode = String(current.voorsteltype ?? "") === "Op basis van liters";
  const offerLevel = String(current.offer_level ?? "samengesteld");
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

  const channelOptionMap = useMemo(
    () => new Map(channelOptions.map((option) => [option.value, option])),
    [channelOptions]
  );
  const selectedChannelOptions = useMemo(
    () => effectiveSelectedKanaalValues.map((value) => channelOptionMap.get(value)).filter((value): value is ChannelOption => Boolean(value)),
    [channelOptionMap, effectiveSelectedKanaalValues]
  );

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

  const definitieveKostprijsversies = useMemo(
    () => berekeningen.filter((record) => normalizeKey(record.status) === "definitief"),
    [berekeningen]
  );

  const definitieveKostprijsversiesCurrentYear = useMemo(
    () =>
      definitieveKostprijsversies.filter((record) => {
        const jaar = Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? 0);
        return jaar === currentYear;
      }),
    [definitieveKostprijsversies, currentYear]
  );

  const kostprijsproductActiveringenCurrentYear = useMemo(
    () =>
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).filter((row) => {
        const jaar = Number(row.jaar ?? 0);
        return jaar === currentYear;
      }),
    [kostprijsproductactiveringen, currentYear]
  );

  const actieveKostprijsversieIdsCurrentYear = useMemo(() => {
    const ids = new Set<string>();
    for (const row of kostprijsproductActiveringenCurrentYear) {
      const id = String(row.kostprijsversie_id ?? "");
      if (id) {
        ids.add(id);
      }
    }
    if (ids.size === 0) {
      for (const record of definitieveKostprijsversiesCurrentYear) {
        if (Boolean(record.is_actief)) {
          ids.add(String(record.id ?? ""));
        }
      }
    }
    if (ids.size === 0) {
      const latestByBeer = new Map<string, GenericRecord>();
      for (const record of [...definitieveKostprijsversiesCurrentYear].sort((left, right) =>
        String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
          String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
        )
      )) {
        const bierId = String(record.bier_id ?? "");
        if (!bierId || latestByBeer.has(bierId)) {
          continue;
        }
        latestByBeer.set(bierId, record);
      }
      for (const record of latestByBeer.values()) {
        ids.add(String(record.id ?? ""));
      }
    }
    return ids;
  }, [kostprijsproductActiveringenCurrentYear, definitieveKostprijsversiesCurrentYear]);

  const actieveKostprijsversiesCurrentYear = useMemo(
    () =>
      definitieveKostprijsversiesCurrentYear.filter((record) =>
        actieveKostprijsversieIdsCurrentYear.has(String(record.id ?? ""))
      ),
    [actieveKostprijsversieIdsCurrentYear, definitieveKostprijsversiesCurrentYear]
  );

  const bierOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const options = actieveKostprijsversiesCurrentYear
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

    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const currentBeerId = String(current.bier_id ?? "");
    for (const bierId of [currentBeerId, ...selectedBeerIds]) {
      if (!bierId || seen.has(bierId)) {
        continue;
      }
      options.push({
        value: bierId,
        label: bierNameMap.get(bierId) || bierId
      });
      seen.add(bierId);
    }

    return options.sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
  }, [actieveKostprijsversiesCurrentYear, bierNameMap, current.bier_id, current.selected_bier_ids]);

  const verkoopstrategieWindow = useMemo(
    () => verkoopprijzen.filter((row) => Number(row.jaar ?? 0) <= currentYear),
    [verkoopprijzen, currentYear]
  );

  function getKostprijsversieById(kostprijsversieId: string) {
    return berekeningen.find((record) => String(record.id ?? "") === String(kostprijsversieId ?? ""));
  }

  function getActiveProductActivation(bierId: string, productId: string) {
    const matches = kostprijsproductActiveringenCurrentYear.filter(
      (row) =>
        String(row.bier_id ?? "") === String(bierId ?? "") &&
        String(row.product_id ?? "") === String(productId ?? "")
    );
    if (matches.length === 0) {
      return null;
    }
    return [...matches].sort((left, right) =>
      String(right.effectief_vanaf ?? right.updated_at ?? "").localeCompare(
        String(left.effectief_vanaf ?? left.updated_at ?? "")
      )
    )[0];
  }

  function getActiveKostprijsversieForBier(bierId: string) {
    const activationVersionIds = kostprijsproductActiveringenCurrentYear
      .filter((row) => String(row.bier_id ?? "") === bierId)
      .map((row) => String(row.kostprijsversie_id ?? ""))
      .filter(Boolean);
    if (activationVersionIds.length > 0) {
      const activationSet = new Set(activationVersionIds);
      return definitieveKostprijsversies
        .filter((record) => activationSet.has(String(record.id ?? "")))
        .sort((left, right) =>
          String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
            String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
          )
        )[0];
    }
    return actieveKostprijsversiesCurrentYear
      .filter((record) => String(record.bier_id ?? "") === bierId)
      .sort((left, right) =>
        String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
          String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
        )
      )[0];
  }

  function getEffectiveKostprijsversieForBier(bierId: string, kostprijsversieId?: string) {
    if (kostprijsversieId) {
      const fixed = getKostprijsversieById(kostprijsversieId);
      if (fixed) {
        return fixed;
      }
    }
    return getActiveKostprijsversieForBier(bierId);
  }

  function getEffectiveKostprijsversieForProduct(
    bierId: string,
    productId: string,
    fallbackKostprijsversieId?: string
  ) {
    if (fallbackKostprijsversieId) {
      const fixed = getKostprijsversieById(fallbackKostprijsversieId);
      if (fixed) {
        return fixed;
      }
    }
    const activation = getActiveProductActivation(bierId, productId);
    if (activation) {
      const activeVersion = getKostprijsversieById(String(activation.kostprijsversie_id ?? ""));
      if (activeVersion) {
        return activeVersion;
      }
    }
    return getActiveKostprijsversieForBier(bierId);
  }

  function getBerekeningTypeForBier(bierId: string) {
    const berekening = getActiveKostprijsversieForBier(bierId);
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

  function getChannelDefaultMargin(channelCode: string) {
    return channelOptionMap.get(channelCode)?.defaultMarginPct ?? 0;
  }

  function getSellInMarginForChannel(record: GenericRecord | null | undefined, channelCode: string) {
    const sellInMargins = (record?.sell_in_margins as GenericRecord | undefined) ?? {};
    const directValue = sellInMargins[channelCode];
    return directValue === undefined || directValue === null || directValue === ""
      ? getChannelDefaultMargin(channelCode)
      : toNumber(directValue, getChannelDefaultMargin(channelCode));
  }

  function getSellInPriceOverrideForChannel(record: GenericRecord | null | undefined, channelCode: string) {
    const sellInPrices = (record?.sell_in_prices as GenericRecord | undefined) ?? {};
    const directValue = sellInPrices[channelCode];
    return directValue === undefined || directValue === null || directValue === "" ? Number.NaN : toNumber(directValue, Number.NaN);
  }

  function getEffectiveVerkoopstrategieForProduct(
    bierId: string,
    productId: string,
    productType: string,
    verpakking: string
  ) {
    const normalizedPackaging = normalizeKey(verpakking);
    const bierProductStrategies = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_product") {
          return false;
        }
        if (String(record.bier_id ?? "") !== bierId) {
          return false;
        }
        const strategyType = normalizeKey(record.strategie_type);
        return strategyType === "override" || strategyType === "uitzondering" || strategyType === "";
      })
      .sort(sortLatestStrategy);

    if (productId) {
      const exactBierProductStrategy = bierProductStrategies.find(
        (record) =>
          String(record.product_id ?? "") === productId &&
          (!productType || String(record.product_type ?? "") === productType)
      );
      if (exactBierProductStrategy) {
        return exactBierProductStrategy;
      }

      const bierProductIdStrategy = bierProductStrategies.find(
        (record) => String(record.product_id ?? "") === productId
      );
      if (bierProductIdStrategy) {
        return bierProductIdStrategy;
      }
    }

    if (normalizedPackaging) {
      const bierPackagingStrategy = bierProductStrategies.find(
        (record) => normalizeKey(record.verpakking) === normalizedPackaging
      );
      if (bierPackagingStrategy) {
        return bierPackagingStrategy;
      }
    }

    const productStrategies = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_verpakking") {
          return false;
        }
        return true;
      })
      .sort(sortLatestStrategy);

    if (productId) {
      const exactProductStrategy = productStrategies.find(
        (record) =>
          String(record.product_id ?? "") === productId &&
          (!productType || String(record.product_type ?? "") === productType)
      );
      if (exactProductStrategy) {
        return exactProductStrategy;
      }

      const productIdStrategy = productStrategies.find(
        (record) => String(record.product_id ?? "") === productId
      );
      if (productIdStrategy) {
        return productIdStrategy;
      }
    }

    if (normalizedPackaging) {
      const packagingStrategy = productStrategies.find(
        (record) => normalizeKey(record.verpakking) === normalizedPackaging
      );
      if (packagingStrategy) {
        return packagingStrategy;
      }
    }

    return verkoopstrategieWindow
      .filter((record) => String(record.record_type ?? "") === "jaarstrategie")
      .sort(sortLatestStrategy)[0];
  }

  function getHighestCostForBier(bierId: string) {
    return actieveKostprijsversiesCurrentYear.reduce<{
      cost: number;
      bronjaar: number;
      biernaam: string;
      kostprijsversieId: string;
    }>(
      (currentHighest, record) => {
        if (String(record.bier_id ?? "") !== bierId) {
          return currentHighest;
        }
        const cost = toNumber(
          (record.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
          0
        );
        if (cost > currentHighest.cost) {
          return {
            cost,
            bronjaar: Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear),
            biernaam:
              normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              bierNameMap.get(bierId) ||
              bierId,
            kostprijsversieId: String(record.id ?? "")
          };
        }
        return currentHighest;
      },
      { cost: 0, bronjaar: currentYear, biernaam: bierNameMap.get(bierId) || bierId, kostprijsversieId: "" }
    );
  }

  function getHighestCostOverall() {
    return actieveKostprijsversiesCurrentYear.reduce<{
      cost: number;
      bierKey: string;
      biernaam: string;
      bronjaar: number;
      kostprijsversieId: string;
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
            bronjaar: Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear),
            kostprijsversieId: String(record.id ?? "")
          };
        }
        return currentHighest;
      },
      { cost: 0, bierKey: "", biernaam: "-", bronjaar: currentYear, kostprijsversieId: "" }
    );
  }

  function getHighestLiterRowsForBier(bierId: string) {
    const highestByPackaging = new Map<string, ProductSnapshotRow>();

    for (const record of actieveKostprijsversiesCurrentYear) {
      if (String(record.bier_id ?? "") !== bierId) {
        continue;
      }

      for (const snapshotRow of getSnapshotProductRowsForBier(String(record.bier_id ?? ""), String(record.id ?? ""))) {
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

  function getSnapshotProductRowsFromBerekening(
    bierId: string,
    berekening: GenericRecord
  ): ProductSnapshotRow[] {
    const biernaam =
      normalizeText((berekening.basisgegevens as GenericRecord | undefined)?.biernaam) ||
      bierNameMap.get(bierId) ||
      bierId;
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
    const invoicePriceByUnitId = new Map<
      string,
      { costPerPiece: number; litersPerProduct: number; sourcePackaging: string }
    >();
    for (const { regel, extraKostenPerRegel } of getEnrichedInkoopFactuurregels(berekening)) {
      const unitId = String(regel.eenheid ?? "").trim();
      if (!unitId) {
        continue;
      }
      const source = basisById.get(unitId) ?? samengesteldById.get(unitId);
      if (!source) {
        continue;
      }
      const aantal = toNumber(regel.aantal, 0);
      const costPerPiece =
        aantal > 0 ? (toNumber(regel.subfactuurbedrag, 0) + extraKostenPerRegel) / aantal : 0;
      if (costPerPiece <= 0) {
        continue;
      }
      const litersPerProduct = firstPositiveNumber(
        regel.liters && aantal > 0 ? toNumber(regel.liters, 0) / aantal : 0,
        source.inhoud_per_eenheid_liter,
        source.totale_inhoud_liter
      );
      const current = invoicePriceByUnitId.get(unitId);
      if (!current || costPerPiece > current.costPerPiece) {
        invoicePriceByUnitId.set(unitId, {
          costPerPiece,
          litersPerProduct,
          sourcePackaging: String(source.omschrijving ?? "")
        });
      }
    }
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
      // Normalized snapshot rows may carry both a stable row id and the actual product_id.
      // For resolving definitions and matching activations we always want the real product id.
      const productIdFromRow = String((row as any).product_id ?? (row as any).productId ?? row.id ?? "");
      const explicitSource = basisById.get(productIdFromRow) ?? samengesteldById.get(productIdFromRow);
      const definitionByPackaging = resolveProductDefinition(
        productIdFromRow || String(explicitSource?.id ?? ""),
        basisById.has(productIdFromRow) ? "basis" : samengesteldById.has(productIdFromRow) ? "samengesteld" : "",
        verpakking
      );
      const explicitKind: "basis" | "samengesteld" =
        definitionByPackaging?.kind === "basis"
          ? "basis"
          : definitionByPackaging?.kind === "samengesteld"
            ? "samengesteld"
            : normalizeKey((row as any).product_type) === "basis"
              ? "basis"
              : "samengesteld";
      return {
        bierKey: bierId,
        biernaam,
        kostprijsversieId: String(berekening.id ?? ""),
        productId: definitionByPackaging?.id ?? productIdFromRow ?? "",
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

    if (getBerekeningTypeForBier(bierId) === "inkoop") {
      const historicalSnapshotByPackaging = new Map<string, ProductSnapshotRow>();
      for (const record of [berekening]) {

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
            bierKey: bierId,
            biernaam,
            kostprijsversieId: String(record.id ?? ""),
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
      const factuurRegels = getEnrichedInkoopFactuurregels(berekening).map(({ regel }) => regel);
      if (factuurRegels.length === 0) {
        // Year-over-year activated cost versions (and some manual inkoop calculations) can be definitive without
        // any factuurregels yet. In that case we still want the UI to show the snapshot build-up.
        return snapshotRows;
      }

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
          const invoicePrice = invoicePriceByUnitId.get(unitId);
          const snapshot =
            historicalSnapshotByPackaging.get(normalizeKey(verpakking)) ??
            snapshotByPackaging.get(normalizeKey(verpakking));
          const rows: ProductSnapshotRow[] = [];

          rows.push({
            bierKey: bierId,
            biernaam,
            kostprijsversieId: String(berekening.id ?? ""),
            productId: String(source.id ?? ""),
            productType: kind,
            productKey: `${kind}|${normalizeKey(verpakking)}`,
            verpakking,
            litersPerProduct: firstPositiveNumber(
              snapshot?.litersPerProduct,
              invoicePrice?.litersPerProduct,
              source.inhoud_per_eenheid_liter,
              source.totale_inhoud_liter
            ),
            costPerPiece: snapshot?.costPerPiece ?? invoicePrice?.costPerPiece ?? 0,
            sourcePackaging:
              snapshot?.sourcePackaging ?? invoicePrice?.sourcePackaging ?? verpakking
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
                bierKey: bierId,
                biernaam,
                kostprijsversieId: String(berekening.id ?? ""),
                productId: basisProductId,
                productType: "basis",
                productKey: `basis|${normalizeKey(basisVerpakking)}`,
                verpakking: basisVerpakking,
                litersPerProduct: firstPositiveNumber(
                  basisSnapshot?.litersPerProduct,
                  basisRow.inhoud_per_eenheid_liter
                ),
                costPerPiece:
                  basisSnapshot?.costPerPiece ??
                  (invoicePrice?.costPerPiece && toNumber(basisRow.aantal, 0) > 0
                    ? invoicePrice.costPerPiece / toNumber(basisRow.aantal, 0)
                    : 0),
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

      if (resultRows.size === 0) {
        return snapshotRows;
      }
      return [...resultRows.values()];
    }

    const snapshotMap = new Map<string, ProductSnapshotRow>(
      snapshotRows.map((row) => [normalizeKey(row.verpakking), row])
    );
    const allKnownProducts = [
      ...pickLatestKnownProductRows(basisproducten, currentYear).map((row) => ({
          id: String(row.id ?? ""),
          key: `basis|${normalizeKey(row.omschrijving)}`,
          kind: "basis" as const,
          verpakking: String(row.omschrijving ?? ""),
          litersPerProduct: toNumber(row.inhoud_per_eenheid_liter, 0)
        })),
      ...pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => ({
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
        bierKey: bierId,
        biernaam,
        kostprijsversieId: String(berekening.id ?? ""),
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

  function getSnapshotProductRowsForBier(bierId: string, fixedKostprijsversieId = ""): ProductSnapshotRow[] {
    if (fixedKostprijsversieId) {
      const fixed = getEffectiveKostprijsversieForBier(bierId, fixedKostprijsversieId);
      return fixed ? getSnapshotProductRowsFromBerekening(bierId, fixed) : [];
    }

    const activeProductActivations = kostprijsproductActiveringenCurrentYear.filter(
      (row) => String(row.bier_id ?? "") === String(bierId ?? "")
    );
    if (activeProductActivations.length === 0) {
      const fallback = getActiveKostprijsversieForBier(bierId);
      return fallback ? getSnapshotProductRowsFromBerekening(bierId, fallback) : [];
    }

    const basisById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );
    const samengesteldById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );

    const rowsByProductKey = new Map<string, ProductSnapshotRow>();
    for (const activation of activeProductActivations) {
      const productId = String(activation.product_id ?? "");
      const activationType =
        normalizeKey(activation.product_type) === "samengesteld" ? "samengesteld" : "basis";
      const version = getEffectiveKostprijsversieForProduct(
        bierId,
        productId,
        String(activation.kostprijsversie_id ?? "")
      );
      if (!version) {
        continue;
      }
      const versionRows = getSnapshotProductRowsFromBerekening(bierId, version);
      const matchingRow =
        versionRows.find((row) => String(row.productId ?? "") === productId) ??
        versionRows.find((row) => normalizeKey(row.verpakking) === normalizeKey(String(activation.verpakking ?? "")));
      if (matchingRow) {
        rowsByProductKey.set(matchingRow.productKey, matchingRow);
        continue;
      }

      // If the kostprijsversie snapshot / factuurregels are incomplete, fall back to the master product definitions.
      // We do not "hide" the issue; we ensure activations remain the source of truth for visible products.
      const source =
        (activationType === "basis" ? basisById.get(productId) : samengesteldById.get(productId)) ??
        basisById.get(productId) ??
        samengesteldById.get(productId);
      if (!source) {
        continue;
      }
      const verpakking = String(source.omschrijving ?? "") || productId;
      const litersPerProduct = firstPositiveNumber(
        source.inhoud_per_eenheid_liter,
        source.totale_inhoud_liter
      );
      const costPerLiter = toNumber(
        (version.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
        0
      );
      const costPerPiece = litersPerProduct > 0 ? costPerLiter * litersPerProduct : 0;
      const productKey = `${activationType}|${normalizeKey(verpakking)}`;
      rowsByProductKey.set(productKey, {
        bierKey: bierId,
        biernaam:
          normalizeText((version.basisgegevens as GenericRecord | undefined)?.biernaam) ||
          bierNameMap.get(bierId) ||
          bierId,
        kostprijsversieId: String(version.id ?? ""),
        productId,
        productType: activationType,
        productKey,
        verpakking,
        litersPerProduct,
        costPerPiece,
        sourcePackaging: verpakking
      });
    }

    return [...rowsByProductKey.values()];
  }

  function buildPricingForChannel(
    cost: number,
    bierId: string,
    productId: string,
    productType: string,
    verpakking: string,
    channelCode: string
  ) {
    const strategy = getEffectiveVerkoopstrategieForProduct(
      bierId,
      productId,
      productType,
      verpakking
    );
    const sellInMarginPct = getSellInMarginForChannel(strategy, channelCode);
    const explicitSellInPrice = getSellInPriceOverrideForChannel(strategy, channelCode);
    const sellInPrice =
      Number.isFinite(explicitSellInPrice) && explicitSellInPrice > 0
        ? explicitSellInPrice
        : calculatePriceFromMargin(cost, sellInMarginPct);
    const offerPrice = sellInPrice;

    return { sellInMarginPct, sellInPrice, offerPrice };
  }

  const currentKanaalLabel = channelOptionMap.get(currentKanaal)?.label ?? currentKanaal;
  const selectedKanaalLabels = selectedChannelOptions.map((option) => option.label).join(", ");
  const costPriceLabel = "Kostprijs";
  const offerPriceLabel = "Verkoopprijs";
  const discountAmountLabel = "Korting";

  function syncBeerRowsForSingleBeer(bierId: string, existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return getSnapshotProductRowsForBier(bierId).map((snapshotRow) => {
      const existing = existingMap.get(
        getCompositeProductRef(snapshotRow.productType, snapshotRow.productId, snapshotRow.productKey)
      );
      return {
        id: String(existing?.id ?? createId()),
        product_id: snapshotRow.productId,
        product_type: snapshotRow.productType,
        bier_id: bierId,
        kostprijsversie_id: String(existing?.kostprijsversie_id ?? snapshotRow.kostprijsversieId ?? ""),
        verpakking_label: snapshotRow.verpakking,
        liters: toNumber(existing?.liters, 0),
        korting_pct: toNumber(existing?.korting_pct, 0),
        included: isIncluded(existing?.included)
      };
    });
  }

  function syncBeerRowsFromProductRows(
    bierId: string,
    productRows: GenericRecord[],
    existingRows: GenericRecord[]
  ) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return productRows
      .filter((row) => String(row.bier_id ?? "") === bierId)
      .map((row) => {
        const productId = String(row.product_id ?? "");
        const productType = String(row.product_type ?? "");
        const compositeRef = getCompositeProductRef(productType, productId, "");
        const existing = existingMap.get(compositeRef);
        const verpakkingLabel =
          String(row.verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${productId}`)?.label ||
          "";

        return {
          id: String(existing?.id ?? createId()),
          bier_id: bierId,
          product_id: productId,
          product_type: productType,
          kostprijsversie_id: String(existing?.kostprijsversie_id ?? row.kostprijsversie_id ?? ""),
          verpakking_label: verpakkingLabel,
          liters: toNumber(existing?.liters, 0),
          korting_pct: toNumber(existing?.korting_pct, toNumber(row.korting_pct, 0)),
          included: isIncluded(existing?.included)
        };
      });
  }

  function syncBeerRowsForMultipleBieren(selectedBeerIds: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [String(row.bier_id ?? ""), row])
    );

    return selectedBeerIds.map((bierId) => {
      const existing = existingMap.get(bierId);
      return {
        id: String(existing?.id ?? createId()),
        bier_id: bierId,
        kostprijsversie_id: String(existing?.kostprijsversie_id ?? getActiveKostprijsversieForBier(bierId)?.id ?? ""),
        product_id: "",
        product_type: "",
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
        bier_id: "",
        kostprijsversie_id: String(first.kostprijsversie_id ?? ""),
        product_id: "",
        product_type: "",
        liters: toNumber(first.liters, 0),
        korting_pct: toNumber(first.korting_pct, 0),
        included: isIncluded(first.included)
      }
    ];
  }

  function syncProductRowsForBieren(selectedBeerIds: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [`${row.bier_id}|${getStoredProductRef(row)}`, row])
    );

    return selectedBeerIds.flatMap((bierId) =>
      getSnapshotProductRowsForBier(bierId).map((snapshotRow) => {
        const rows: GenericRecord[] = [];
        const compositeKey = `${bierId}|${getCompositeProductRef(
          snapshotRow.productType,
          snapshotRow.productId,
          snapshotRow.productKey
        )}`;
        const existing = existingMap.get(compositeKey);

        rows.push({
          id: String(existing?.id ?? createId()),
          product_id: snapshotRow.productId,
          product_type: snapshotRow.productType,
          bier_id: bierId,
          kostprijsversie_id: String(existing?.kostprijsversie_id ?? snapshotRow.kostprijsversieId ?? ""),
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
      const bierId = String(current.bier_id ?? "");
      const sourceRows = bierId
        ? (() => {
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(bierId, currentProductRows, currentBeerRows);
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierId, currentBeerRows);
          })()
        : currentBeerRows;

      return sourceRows.map((row) => {
        const bierId = String(row.bier_id ?? current.bier_id ?? "");
        const kostprijsversieId = String(row.kostprijsversie_id ?? "");
        const rowProductId = String(row.product_id ?? "");
        const snapshots = kostprijsversieId
          ? getSnapshotProductRowsForBier(bierId, kostprijsversieId)
          : getHighestLiterRowsForBier(bierId);
        const snapshot = snapshots.find(
          (item) =>
            (rowProductId && item.productId === rowProductId) ||
            normalizeKey(item.verpakking) ===
              normalizeKey(String((row as GenericRecord).verpakking_label ?? ""))
        );
        const kostprijsPerLiter =
          snapshot && snapshot.litersPerProduct > 0 ? snapshot.costPerPiece / snapshot.litersPerProduct : 0;
        const verpakking =
          snapshot?.verpakking ||
          String((row as GenericRecord).verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${rowProductId}`)?.label ||
          "-";
        const kortingPct = toNumber(row.korting_pct, 0);
        const pricingByChannel = Object.fromEntries(
          selectedChannelOptions.map((option) => [
            option.value,
            buildPricingForChannel(
              kostprijsPerLiter,
              bierId,
              snapshot?.productId ?? rowProductId,
              snapshot?.productType ??
                (String(row.product_type ?? "") as "basis" | "samengesteld" | ""),
              verpakking,
              option.value
            )
          ])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
        const pricing = pricingByChannel[currentKanaal];
        const offerPrijs = pricing.offerPrice;
        const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const omzet = liters * verkoopprijs;
        const kosten = liters * kostprijsPerLiter;
        const kortingEur = liters * Math.max(0, offerPrijs - verkoopprijs);
        const margeEur = omzet - kosten;
        return {
          id: String(row.id ?? ""),
          bierKey: bierId,
          biernaam: bierNameMap.get(bierId) || "-",
          kostprijsversieId: snapshot?.kostprijsversieId ?? kostprijsversieId,
          included: isIncluded(row.included),
          productId: snapshot?.productId ?? rowProductId,
          productType:
            snapshot?.productType ??
            (String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
              ? (String(row.product_type ?? "") as "basis" | "samengesteld")
              : "basis"),
          productKey: snapshot?.productKey ?? "",
          verpakking,
          liters,
          kortingPct,
          kostprijsPerLiter,
          offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
          offerPrijs,
          sellInPrijs: pricing.sellInPrice,
          sellInMargePct: pricing.sellInMarginPct,
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
        const bierId = String(row.bier_id ?? "");
        const fixedVersion = String(row.kostprijsversie_id ?? "");
        const highest = fixedVersion
          ? {
              ...getHighestCostForBier(bierId),
              cost: toNumber(
                (getKostprijsversieById(fixedVersion)?.resultaat_snapshot as GenericRecord | undefined)
                  ?.integrale_kostprijs_per_liter,
                0
              ),
              kostprijsversieId: fixedVersion
            }
          : getHighestCostForBier(bierId);
        const kortingPct = toNumber(row.korting_pct, 0);
        const pricingByChannel = Object.fromEntries(
          selectedChannelOptions.map((option) => [option.value, buildPricingForChannel(highest.cost, bierId, "", "", "liter", option.value)])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
        const pricing = pricingByChannel[currentKanaal];
        const offerPrijs = pricing.offerPrice;
        const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const omzet = liters * verkoopprijs;
        const kosten = liters * highest.cost;
        const kortingEur = liters * Math.max(0, offerPrijs - verkoopprijs);
        const margeEur = omzet - kosten;
        return {
          id: String(row.id ?? ""),
          bierKey: bierId,
          biernaam: highest.biernaam,
          kostprijsversieId: highest.kostprijsversieId,
          included: isIncluded(row.included),
          productKey: "",
          verpakking: "Literregel",
          liters,
          kortingPct,
          kostprijsPerLiter: highest.cost,
          offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
          offerPrijs,
          sellInPrijs: pricing.sellInPrice,
          sellInMargePct: pricing.sellInMarginPct,
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
      const fixedVersion = String(row.kostprijsversie_id ?? "");
      const effectiveOverall = fixedVersion
        ? {
            ...overall,
            cost: toNumber(
              (getKostprijsversieById(fixedVersion)?.resultaat_snapshot as GenericRecord | undefined)
                ?.integrale_kostprijs_per_liter,
              0
            ),
            bierKey: String(getKostprijsversieById(fixedVersion)?.bier_id ?? overall.bierKey),
            biernaam:
              normalizeText((getKostprijsversieById(fixedVersion)?.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              overall.biernaam,
            kostprijsversieId: fixedVersion
          }
        : overall;
      const kortingPct = toNumber(row.korting_pct, 0);
      const pricingByChannel = Object.fromEntries(
        selectedChannelOptions.map((option) => [option.value, buildPricingForChannel(effectiveOverall.cost, effectiveOverall.bierKey, "", "", "liter", option.value)])
      ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
      const pricing = pricingByChannel[currentKanaal];
      const offerPrijs = pricing.offerPrice;
      const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
      const liters = toNumber(row.liters, 0);
      const omzet = liters * verkoopprijs;
      const kosten = liters * effectiveOverall.cost;
      const kortingEur = liters * Math.max(0, offerPrijs - verkoopprijs);
      const margeEur = omzet - kosten;
      return {
          id: String(row.id ?? ""),
        bierKey: effectiveOverall.bierKey,
        biernaam: effectiveOverall.biernaam,
        kostprijsversieId: effectiveOverall.kostprijsversieId,
          included: isIncluded(row.included),
        productKey: "",
        verpakking: "Algemene literregel",
        liters,
        kortingPct,
        kostprijsPerLiter: effectiveOverall.cost,
        offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
        offerPrijs,
        sellInPrijs: pricing.sellInPrice,
        sellInMargePct: pricing.sellInMarginPct,
        omzet,
        kosten,
        kortingEur,
        margeEur,
        margePct: calculateMarginPercentage(omzet, kosten)
      };
    });
  }, [
    current.beer_rows,
    current.bier_id,
    bierNameMap,
    currentKanaal,
    selectedChannelOptions,
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

  const offerteLitersRows = useMemo(() => {
    if (offerLevel === "basis") {
      const basisRows = litersDisplayRows.filter((row) => row.productType === "basis");
      return basisRows.length > 0 ? basisRows : litersDisplayRows;
    }
    const compositeRows = litersDisplayRows.filter((row) => row.productType === "samengesteld");
    return compositeRows.length > 0 ? compositeRows : litersDisplayRows;
  }, [offerLevel, litersDisplayRows]);

  const offerteLitersTotals = useMemo(
    () =>
      offerteLitersRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [offerteLitersRows]
  );

  const derivedBasisLitersRows = useMemo(() => {
    if (!isLitersMode || offerLevel !== "samengesteld") {
      return [];
    }
    return litersDisplayRows.filter((row) => row.productType === "basis");
  }, [isLitersMode, offerLevel, litersDisplayRows]);

  const productDisplayRows = useMemo<ProductDisplayRow[]>(() => {
    const currentProductRows = Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : [];

    return currentProductRows.map((row) => {
      const bierId = String(row.bier_id ?? "");
      const fixedKostprijsversieId = String(row.kostprijsversie_id ?? "");
      const snapshotRowsForBier = getSnapshotProductRowsForBier(bierId, fixedKostprijsversieId);
      const explicitLabel = String(row.verpakking_label ?? "");
      const rowProductId = String(row.product_id ?? "");
      const rowProductType =
        String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
          ? (String(row.product_type ?? "") as "basis" | "samengesteld")
          : "";
      const rowLabel =
        explicitLabel ||
        productDefinitionMap.get(`id|${rowProductId}`)?.label ||
        rowProductId;
      const snapshot = snapshotRowsForBier.find(
        (item) =>
          (rowProductId && item.productId === rowProductId) ||
          normalizeKey(item.verpakking) === normalizeKey(rowLabel) ||
          normalizeKey(item.sourcePackaging) === normalizeKey(rowLabel)
      );
      const definition = rowProductId ? productDefinitionMap.get(`id|${rowProductId}`) : undefined;
      const verpakking = snapshot?.verpakking ?? definition?.label ?? "-";
      const kostprijsPerStuk = snapshot?.costPerPiece ?? 0;
      const buildPricingSet = (
        targetCost: number,
        targetProductId: string,
        targetProductType: "basis" | "samengesteld" | "",
        targetPackaging: string
      ) =>
        Object.fromEntries(
          selectedChannelOptions.map((option) => [
            option.value,
            buildPricingForChannel(
              targetCost,
              bierId,
              targetProductId,
              targetProductType,
              targetPackaging,
              option.value
            )
          ])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;

      let pricingByChannel = buildPricingSet(
        kostprijsPerStuk,
        snapshot?.productId ?? rowProductId,
        snapshot?.productType ?? rowProductType,
        verpakking
      );
      let pricing = pricingByChannel[currentKanaal];
      const hasDirectStrategyPricing = pricing.sellInPrice > 0 || pricing.sellInMarginPct > 0;

      if (
        !hasDirectStrategyPricing &&
        snapshot?.derivedFromProductKey &&
        snapshot.derivedFromPackaging &&
        toNumber(snapshot.derivedFromAantal, 0) > 0
      ) {
        const parentSnapshot = snapshotRowsForBier.find(
          (item) =>
            item.productId === snapshot.derivedFromProductId ||
            normalizeKey(item.verpakking) === normalizeKey(snapshot.derivedFromPackaging)
        );

        if (parentSnapshot) {
          const divisor = toNumber(snapshot.derivedFromAantal, 0);
          const parentPricingByChannel = buildPricingSet(
            parentSnapshot.costPerPiece,
            parentSnapshot.productId,
            parentSnapshot.productType,
            parentSnapshot.verpakking
          );
          pricingByChannel = Object.fromEntries(
            selectedChannelOptions.map((option) => {
              const channelPricing = parentPricingByChannel[option.value];
              return [
                option.value,
                {
                  sellInMarginPct: channelPricing.sellInMarginPct,
                  sellInPrice: channelPricing.sellInPrice / divisor,
                  offerPrice: channelPricing.offerPrice / divisor
                }
              ];
            })
          ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
          pricing = pricingByChannel[currentKanaal];
        }
      }

      const offerPrijs = pricing.offerPrice;
      const kortingPct = toNumber(row.korting_pct, 0);
      const aantal = toNumber(row.aantal, 0);
      const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
      const omzet = aantal * verkoopprijs;
      const kosten = aantal * kostprijsPerStuk;
      const kortingEur = aantal * Math.max(0, offerPrijs - verkoopprijs);
      const margeEur = omzet - kosten;
      return {
        id: String(row.id ?? ""),
        bierKey: bierId,
        biernaam: bierNameMap.get(bierId) || "-",
        kostprijsversieId: snapshot?.kostprijsversieId ?? fixedKostprijsversieId,
        included: isIncluded(row.included),
        productId: snapshot?.productId ?? rowProductId,
        productType: snapshot?.productType ?? (rowProductType || "basis"),
        productKey: snapshot?.productKey ?? "",
        verpakking,
        aantal,
        kortingPct,
        kostprijsPerStuk,
        offerPrijs,
        sellInPrijs: pricing.sellInPrice,
        sellInMargePct: pricing.sellInMarginPct,
        offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
        omzet,
        kosten,
        kortingEur,
        margeEur,
        margePct: calculateMarginPercentage(omzet, kosten)
      };
    });
  }, [current.product_rows, bierNameMap, currentKanaal, productDefinitionMap, selectedChannelOptions, verkoopstrategieWindow]);

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

  const offerteProductRows = useMemo(() => {
    if (offerLevel === "basis") {
      return productDisplayRows.filter((row) => row.productType === "basis");
    }
    const compositeRows = productDisplayRows.filter((row) => row.productType === "samengesteld");
    if (compositeRows.length === 0) {
      return productDisplayRows;
    }

    // When offering "samengestelde producten", we still want to show standalone basisproducten
    // (e.g. fusten) in the main table, while keeping derived basisproducten under the derived section.
    const compositeDefinitions = new Map(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const derivedBaseIds = new Set<string>();
    for (const row of compositeRows) {
      const composite = compositeDefinitions.get(row.productId);
      const components = Array.isArray(composite?.basisproducten) ? (composite?.basisproducten as GenericRecord[]) : [];
      for (const component of components) {
        const basisId = String(component.basisproduct_id ?? "");
        if (basisId && !basisId.startsWith("verpakkingsonderdeel:")) {
          derivedBaseIds.add(basisId);
        }
      }
    }

    return productDisplayRows.filter((row) => {
      if (row.productType === "samengesteld") {
        return true;
      }
      if (row.productType === "basis") {
        return !derivedBaseIds.has(row.productId);
      }
      return false;
    });
  }, [offerLevel, productDisplayRows]);

  const offerteProductTotals = useMemo(
    () =>
      offerteProductRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [offerteProductRows]
  );

  const derivedBasisRows = useMemo(() => {
    if (isLitersMode || offerLevel !== "samengesteld") {
      return [];
    }

    const compositeDefinitions = new Map(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const baseLabels = new Map(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [String(row.id ?? ""), String(row.omschrijving ?? "")])
    );

    return offerteProductRows.flatMap((row) => {
      const composite = compositeDefinitions.get(row.productId);
      const components = Array.isArray(composite?.basisproducten) ? (composite?.basisproducten as GenericRecord[]) : [];
      return components
        .filter((component) => {
          const basisId = String(component.basisproduct_id ?? "");
          return Boolean(basisId) && !basisId.startsWith("verpakkingsonderdeel:");
        })
        .map((component) => {
          const basisId = String(component.basisproduct_id ?? "");
          const factor = Math.max(1, toNumber(component.aantal, 1));
          return {
            id: `${row.id}-${basisId}`,
            biernaam: row.biernaam,
            product: baseLabels.get(basisId) ?? basisId,
            aantal: row.aantal * factor,
            offerPrijs: row.offerPrijs / factor,
            sellInPrijs: row.sellInPrijs / factor
          };
        });
    });
  }, [basisproducten, currentYear, isLitersMode, offerLevel, offerteProductRows, samengesteldeProducten]);

  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps: wizardSteps,
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

  function withFrozenPricing(row: GenericRecord): GenericRecord {
    if (String(row.id ?? "") !== String(current.id)) {
      return row;
    }

    const next = cloneRecord(row);
    const productDisplayMap = new Map(productDisplayRows.map((item) => [item.id, item]));
    const litersDisplayMap = new Map(litersDisplayRows.map((item) => [item.id, item]));

    next.product_rows = (Array.isArray(next.product_rows) ? (next.product_rows as GenericRecord[]) : []).map(
      (item) => {
        const display = productDisplayMap.get(String(item.id ?? ""));
        if (!display) {
          return item;
        }
        return {
          ...item,
          included: display.included,
          kostprijsversie_id: display.kostprijsversieId,
          cost_at_quote: display.kostprijsPerStuk,
          sales_price_at_quote: display.offerPrijs,
          revenue_at_quote: display.omzet,
          margin_at_quote: display.margeEur,
          target_margin_pct_at_quote: display.sellInMargePct,
          channel_at_quote: currentKanaal,
          verpakking_label: display.verpakking
        };
      }
    );

    next.beer_rows = (Array.isArray(next.beer_rows) ? (next.beer_rows as GenericRecord[]) : []).map((item) => {
      const display = litersDisplayMap.get(String(item.id ?? ""));
      if (!display) {
        return item;
      }
      return {
        ...item,
        included: display.included,
        kostprijsversie_id: display.kostprijsversieId,
        cost_at_quote: display.kostprijsPerLiter,
        sales_price_at_quote: display.offerPrijs,
        revenue_at_quote: display.omzet,
        margin_at_quote: display.margeEur,
        target_margin_pct_at_quote: display.sellInMargePct,
        channel_at_quote: currentKanaal,
        verpakking_label: display.verpakking
      };
    });

    next.kostprijsversie_ids = [
      ...new Set(
        [
          ...(Array.isArray(next.product_rows) ? (next.product_rows as GenericRecord[]).map((item) => String(item.kostprijsversie_id ?? "")) : []),
          ...(Array.isArray(next.beer_rows) ? (next.beer_rows as GenericRecord[]).map((item) => String(item.kostprijsversie_id ?? "")) : [])
        ].filter(Boolean)
      )
    ];

    return next;
  }

  async function handleSave(finalize = false) {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);

    try {
      const payload = rows.map((row) => {
        const next = cloneRecord(row);
        if (String(next.id ?? "").trim() === "") {
          next.id = createId();
        }
        const frozen = withFrozenPricing(next);
        if (String(frozen.id ?? "") === String(current.id)) {
          frozen.status = finalize ? "definitief" : "concept";
          frozen.finalized_at = finalize ? new Date().toISOString() : "";
        }
        return frozen;
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
      setStatus(finalize ? "Prijsvoorstel definitief gemaakt." : "Prijsvoorstel opgeslagen.");
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

  function handleSingleBeerChange(bierId: string) {
    updateCurrent((draft) => {
      draft.bier_id = bierId;
      draft.selected_bier_ids = bierId ? [bierId] : [];
      draft.beer_rows = bierId
        ? syncBeerRowsForSingleBeer(
            bierId,
            Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
          )
        : [];
    });
  }

  function handleBeerMultiSelection(selectedBeerIds: string[]) {
    updateCurrent((draft) => {
      draft.selected_bier_ids = selectedBeerIds;
      draft.bier_id = selectedBeerIds[0] ?? "";

      if (String(draft.voorsteltype ?? "") === "Op basis van producten") {
        draft.product_rows = syncProductRowsForBieren(
          selectedBeerIds,
          Array.isArray(draft.product_rows) ? (draft.product_rows as GenericRecord[]) : []
        );
      } else {
        draft.beer_rows = syncBeerRowsForMultipleBieren(
          selectedBeerIds,
          Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
        );
      }
    });
  }

  function handleHighestOverallSetup() {
    updateCurrent((draft) => {
      draft.bier_id = "";
      draft.selected_bier_ids = [];
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
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];

    if (!isLitersMode) {
      const desiredRows = selectedBeerIds.length
        ? syncProductRowsForBieren(
            selectedBeerIds,
            Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []
          )
        : [];

      const currentSignature = JSON.stringify(
        (Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
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
      const bierId = String(current.bier_id ?? "");
      const desiredRows = bierId
        ? (() => {
            const currentBeerRows = Array.isArray(current.beer_rows)
              ? (current.beer_rows as GenericRecord[])
              : [];
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(
              bierId,
              currentProductRows,
              currentBeerRows
            );
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierId, currentBeerRows);
          })()
        : [];
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.selected_bier_ids = bierId ? [bierId] : [];
          draft.beer_rows = desiredRows;
        });
      }
      return;
    }

    if (litersBasis === "meerdere_bieren") {
      const desiredRows = syncBeerRowsForMultipleBieren(
        selectedBeerIds,
        Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []
      );
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? "")
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
        bier_id: String(row.bier_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? "")
      }))
    );
    const desiredSignature = JSON.stringify(
      desiredRows.map((row) => ({
        bier_id: String(row.bier_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? "")
      }))
    );

    if (currentSignature !== desiredSignature) {
      updateCurrent((draft) => {
        draft.beer_rows = desiredRows;
      });
    }
  }, [
    current.bier_id,
    current.beer_rows,
    current.selected_bier_ids,
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
                draft.bier_id = "";
                draft.selected_bier_ids = [];
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
        kanaalOptions={channelOptions}
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
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const kanaalLabel = currentKanaalLabel;
    const totalMargePct = calculateMarginPercentage(offerteLitersTotals.omzet, offerteLitersTotals.kosten);

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
                  value={String(current.bier_id ?? "")}
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
            renderBeerSelectionList(selectedBeerIds, handleBeerMultiSelection)
          ) : (
            <div className="editor-actions-group">
              <span className="muted">
                Gebruik de hoogste bekende kostprijs van alle actieve kostprijsversies in {currentYear}.
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
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{isMultiKanaalMode ? selectedKanaalLabels : kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(offerteLitersTotals.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(offerteLitersTotals.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(offerteLitersTotals.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(offerteLitersTotals.margeEur)} ({formatPercentage(totalMargePct)})
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
                <th>{costPriceLabel}</th>
                {isMultiKanaalMode
                  ? selectedChannelOptions.map((option) => (
                      <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                    ))
                  : <th>{offerPriceLabel}</th>}
                {!isMultiKanaalMode ? (
                  <>
                    <th>Omzet</th>
                    <th>Kosten</th>
                    <th>{discountAmountLabel}</th>
                    <th>Winst</th>
                    <th>Onze marge</th>
                  </>
                ) : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offerteLitersRows.map((row) => (
                <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.01"
                      style={{ minWidth: "8.5rem" }}
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
                      style={{ minWidth: "8rem" }}
                      value={String(row.kortingPct)}
                      onChange={(event) =>
                        updateBeerRow(row.id, "korting_pct", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerLiter)}</div></td>
                  {isMultiKanaalMode
                    ? selectedChannelOptions.map((option) => (
                        <td key={`${option.value}-offer`}>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(row.offerByChannel[option.value] ?? 0)}
                          </div>
                        </td>
                      ))
                    : (
                      <>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.offerPrijs)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.omzet)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kosten)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kortingEur)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.margeEur)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatPercentage(row.margePct)}</div></td>
                      </>
                    )}
                  <td>
                    {renderIncludeToggle(
                      row.included,
                      () => updateBeerRow(row.id, "included", !row.included),
                      row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                    )}
                  </td>
                </tr>
              ))}
              {offerteLitersRows.length === 0 ? (
                <tr>
                  <td colSpan={isMultiKanaalMode ? 6 + selectedChannelOptions.length : 12} className="prijs-empty-cell">
                    Kies eerst een bier of zet een literscenario klaar om de offerte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {offerLevel === "samengesteld" && derivedBasisLitersRows.length > 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-title">Afgeleide basisproducten</div>
            <div className="module-card-text">
              Deze basisproducten volgen readonly het samengestelde product en tellen niet mee in omzet of winst.
            </div>
            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Bier</th>
                    <th>Basisproduct</th>
                    <th>Liters</th>
                    <th>{offerPriceLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedBasisLitersRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.biernaam}</td>
                      <td>{row.verpakking}</td>
                      <td>{formatNumber(row.liters)}</td>
                      <td>{formatEuro(row.offerPrijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProductOfferte() {
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const kanaalLabel = currentKanaalLabel;
    const totalMargePct = calculateMarginPercentage(offerteProductTotals.omzet, offerteProductTotals.kosten);

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Bieren voor dit voorstel</div>
          <div className="module-card-text">
            Kies één of meer bieren met een actieve kostprijsversie. De app haalt daarna automatisch de gekoppelde
            producten en kostprijzen op uit de actieve kostprijsversies.
          </div>
          {renderBeerSelectionList(selectedBeerIds, handleBeerMultiSelection)}
        </div>

        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{isMultiKanaalMode ? selectedKanaalLabels : kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(offerteProductTotals.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(offerteProductTotals.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(offerteProductTotals.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(offerteProductTotals.margeEur)} ({formatPercentage(totalMargePct)})
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
                <th>{costPriceLabel}</th>
                {isMultiKanaalMode
                  ? selectedChannelOptions.map((option) => (
                      <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                    ))
                  : <th>{offerPriceLabel}</th>}
                {!isMultiKanaalMode ? (
                  <>
                    <th>Omzet</th>
                    <th>Kosten</th>
                    <th>{discountAmountLabel}</th>
                    <th>Winst</th>
                    <th>Onze marge</th>
                  </>
                ) : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offerteProductRows.map((row) => (
                <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="1"
                      style={{ minWidth: "8rem" }}
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
                      style={{ minWidth: "8rem" }}
                      value={String(row.kortingPct)}
                      onChange={(event) =>
                        updateProductRow(row.id, "korting_pct", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerStuk)}</div></td>
                  {isMultiKanaalMode
                    ? selectedChannelOptions.map((option) => (
                        <td key={`${option.value}-offer`}>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(row.offerByChannel[option.value] ?? 0)}
                          </div>
                        </td>
                      ))
                    : (
                      <>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.offerPrijs)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.omzet)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kosten)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kortingEur)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.margeEur)}</div></td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatPercentage(row.margePct)}
                          </div>
                        </td>
                      </>
                    )}
                  <td>
                    {renderIncludeToggle(
                      row.included,
                      () => updateProductRow(row.id, "included", !row.included),
                      row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                    )}
                  </td>
                </tr>
              ))}
              {offerteProductRows.length === 0 ? (
                <tr>
                  <td colSpan={isMultiKanaalMode ? 6 + selectedChannelOptions.length : 12} className="prijs-empty-cell">
                    Kies eerst een of meer bieren om de productofferte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {offerLevel === "samengesteld" && derivedBasisRows.length > 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-title">Afgeleide basisproducten</div>
            <div className="module-card-text">
              Deze basisproducten volgen readonly het samengestelde product en tellen niet mee in omzet of winst.
            </div>
            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Bier</th>
                    <th>Basisproduct</th>
                    <th>Aantal</th>
                    <th>{offerPriceLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedBasisRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.biernaam}</td>
                      <td>{row.product}</td>
                      <td>{formatNumber(row.aantal, 0)}</td>
                      <td>{formatEuro(row.offerPrijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderOfferteStep() {
    return (
      <div className="wizard-stack">
        {isLitersMode ? renderLitersOfferte() : renderProductOfferte()}
      </div>
    );
  }

  function renderSummaryTable() {
    if (isLitersMode) {
      if (isMultiKanaalMode) {
        return (
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Bier</th>
                  <th>Verpakking</th>
                  <th>Liters</th>
                  <th>{costPriceLabel}</th>
                  {selectedChannelOptions.map((option) => (
                    <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offerteLitersRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.biernaam}</td>
                    <td>{row.verpakking}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td>{formatEuro(row.kostprijsPerLiter)}</td>
                    {selectedChannelOptions.map((option) => (
                      <td key={`${row.id}-${option.value}-offer`}>{formatEuro(row.offerByChannel[option.value] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
                {offerteLitersRows.length === 0 ? (
                  <tr>
                    <td colSpan={4 + selectedChannelOptions.length} className="prijs-empty-cell">Nog geen liters-offerte opgebouwd.</td>
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
                <th>Verpakking</th>
                <th>Liters</th>
                <th>{costPriceLabel}</th>
                <th>{offerPriceLabel} {currentKanaalLabel}</th>
              </tr>
            </thead>
            <tbody>
              {offerteLitersRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>{formatNumber(row.liters)}</td>
                  <td>{formatEuro(row.kostprijsPerLiter)}</td>
                  <td>{formatEuro(row.offerPrijs)}</td>
                </tr>
              ))}
              {offerteLitersRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="prijs-empty-cell">Nog geen liters-offerte opgebouwd.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      );
    }

    if (isMultiKanaalMode) {
      return (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Aantal</th>
                <th>{costPriceLabel}</th>
                {selectedChannelOptions.map((option) => (
                  <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offerteProductRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>{formatNumber(row.aantal, 0)}</td>
                  <td>{formatEuro(row.kostprijsPerStuk)}</td>
                  {selectedChannelOptions.map((option) => (
                    <td key={`${row.id}-${option.value}-offer`}>{formatEuro(row.offerByChannel[option.value] ?? 0)}</td>
                  ))}
                </tr>
              ))}
              {offerteProductRows.length === 0 ? (
                <tr>
                  <td colSpan={4 + selectedChannelOptions.length} className="prijs-empty-cell">Nog geen productofferte opgebouwd.</td>
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
              <th>{costPriceLabel}</th>
              <th>{offerPriceLabel} {currentKanaalLabel}</th>
            </tr>
          </thead>
          <tbody>
            {offerteProductRows.map((row) => (
              <tr key={row.id}>
                <td>{row.biernaam}</td>
                <td>{row.verpakking}</td>
                <td>{formatNumber(row.aantal, 0)}</td>
                <td>{formatEuro(row.kostprijsPerStuk)}</td>
                <td>{formatEuro(row.offerPrijs)}</td>
              </tr>
            ))}
            {offerteProductRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="prijs-empty-cell">Nog geen productofferte opgebouwd.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSamenvattingStep() {
    const gekozenKanaal = currentKanaalLabel;

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
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{gekozenKanaal}</div>
          </div>
        </div>

        <div className="module-card compact-card">
          <div className="module-card-title">Commerciële samenvatting</div>
          <div className="module-card-text">
            Hieronder zie je de kostprijzen en de afgeleide verkoopprijzen per gekozen kanaal
            op basis van de actieve kostprijsversies en verkoopstrategie van {currentYear}.
          </div>
        </div>

        {renderSummaryTable()}
      </div>
    );
  }

  function handleConceptPdf() {
    if (typeof window === "undefined") {
      return;
    }
    const pdfChannelHeaders = isMultiKanaalMode
      ? selectedChannelOptions.map((option) => `<th>${offerPriceLabel} ${option.label}</th>`).join("")
      : `<th>${offerPriceLabel}</th>`;
    const tableRows = (isLitersMode ? litersDisplayRows : productDisplayRows)
      .filter((row) => row.included)
      .map((row) =>
        `<tr>
          <td>${row.biernaam}</td>
          <td>${row.verpakking}</td>
          <td>${isLitersMode ? formatNumber((row as LitersDisplayRow).liters) : formatNumber((row as ProductDisplayRow).aantal, 0)}</td>
          <td>${isLitersMode ? formatEuro((row as LitersDisplayRow).kostprijsPerLiter) : formatEuro((row as ProductDisplayRow).kostprijsPerStuk)}</td>
          ${
            isMultiKanaalMode
              ? selectedChannelOptions.map((option) => `<td>${formatEuro(row.offerByChannel[option.value] ?? 0)}</td>`).join("")
              : `<td>${formatEuro(row.offerPrijs)}</td>`
          }
        </tr>`
      )
      .join("");
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>Conceptofferte ${String(current.offertenummer || "")}</title><style>body{font-family:Segoe UI,sans-serif;padding:24px;color:#18223a}h1,h2{margin:0 0 12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d7e1f4;padding:10px;text-align:left}th{background:#f3f7ff}</style></head><body><h1>Conceptofferte</h1><p><strong>Klant:</strong> ${String(current.klantnaam || "-")}<br/><strong>${isMultiKanaalMode ? "Kanalen" : "Kanaal"}:</strong> ${isMultiKanaalMode ? selectedKanaalLabels : currentKanaalLabel}<br/><strong>Jaar:</strong> ${currentYear}</p><h2>Overzicht</h2><table><thead><tr><th>Bier</th><th>Product</th><th>${isLitersMode ? "Liters" : "Aantal"}</th><th>Kostprijs</th>${pdfChannelHeaders}</tr></thead><tbody>${tableRows || `<tr><td colspan="${isMultiKanaalMode ? 4 + selectedChannelOptions.length : 6}">Nog geen offertelijnen.</td></tr>`}</tbody></table><p style="margin-top:24px;"><strong>Opmerking:</strong><br/>${String(current.opmerking ?? "").replace(/\n/g, "<br/>") || "-"}</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function renderAfrondenStep() {
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Afronden</div>
          <div className="module-card-text">
            Voeg eventueel nog een opmerking toe en vraag daarna een concept-PDF op voordat je het prijsvoorstel definitief maakt.
          </div>
        </div>
        <label className="nested-field">
          <span>Opmerking</span>
          <textarea
            className="dataset-input"
            rows={6}
            value={String(current.opmerking ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.opmerking = event.target.value;
              })
            }
          />
        </label>
        <div className="editor-actions">
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={handleConceptPdf}>
              Concept-PDF
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "uitgangspunten") return renderUitgangspuntenStep();
    if (currentStep.id === "offerte") return renderOfferteStep();
    if (currentStep.id === "samenvatting") return renderSamenvattingStep();
    return renderAfrondenStep();
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
                  void handleSave(false);
                }}
              >
                Opslaan
              </button>
              <button
                type="button"
                className="editor-button"
                disabled={isSaving}
                onClick={async () => {
                  if (currentStep.id === "afronden") {
                    const saved = await handleSave(true);
                    if (saved) {
                      onFinish?.();
                    }
                    return;
                  }

                  setActiveStepIndex(Math.min(wizardSteps.length - 1, activeStepIndex + 1));
                }}
              >
                {isSaving ? "Opslaan..." : currentStep.id === "afronden" ? "Afronden" : "Volgende"}
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

