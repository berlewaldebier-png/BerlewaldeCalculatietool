"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePageShellHeader } from "@/components/PageShell";
import { WizardSteps } from "@/components/WizardSteps";
import { API_BASE_URL } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiClient";
import {
  activateKostprijsversie,
  activateKostprijsversieProducts,
  saveKostprijsversie,
  loadDouanoProductMappings,
  loadArticles,
  loadBomLines,
  loadSkus,
  saveSkuClassification,
  tryReadApiDetail,
} from "@/components/berekeningen/berekeningenWizardIo";
import { vasteKostenPerLiter } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeResultaatSnapshot,
  type ResultaatSnapshot,
  type SummaryProductRow
} from "@/lib/kostprijsSnapshotEngine";
import {
  cloneRecord,
  createId,
  parseOptionalNumber,
  parseOptionalNumberFromInput,
  syncPrimaryInkoopFactuur,
  unwrapDatasetListPayload,
} from "@/components/berekeningen/berekeningenWizardUtils";
import {
  buildResultaatSnapshotFromWizard,
  validateCurrentBeforePersistFromWizard,
} from "@/components/berekeningen/berekeningenWizardDerivations";
import { CurrencyInput, TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";
import {
  formatCurrencyDisplay,
  formatDecimalValue,
  roundValue,
  toSummaryValue,
} from "@/components/berekeningen/berekeningenWizardFormatting";
import { BasisStep } from "@/components/berekeningen/steps/BasisStep";
import { TypeStep } from "@/components/berekeningen/steps/TypeStep";
import { ClassificatieStep } from "@/components/berekeningen/steps/ClassificatieStep";
import { SummaryStep } from "@/components/berekeningen/steps/SummaryStep";
import { makeBeerSkuLabel, normalizeUnitLabel } from "@/lib/skuLabels";
import { InkoopInputStep } from "@/components/berekeningen/steps/InkoopInputStep";
import { FacturenStep } from "@/components/berekeningen/steps/FacturenStep";
import { EigenProductieInputStep } from "@/components/berekeningen/steps/EigenProductieInputStep";
import { SellableVariantsStep, type CostProductCandidate } from "@/components/berekeningen/steps/SellableVariantsStep";
import { KoppelenStep } from "@/components/berekeningen/steps/KoppelenStep";
import {
  buildWizardSteps,
  calculateEigenProductieKostenRecept,
  calculateEigenProductiePrijsPerEenheid,
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  calculateVariabeleKostenPerLiter,
  createEmptyBerekening,
  expandSelectedInkoopProductsToBasisproducten,
  getBerekeningProcessType,
  getDirecteVasteKostenPerLiter,
  getFactuurRegelAfvulkostenFust,
  getFactuurRegelLiters,
  getIngredientType,
  getInkoopFactuurregels,
  getProductDisplayName,
  getProductUnitLabel,
  getProductUnitOptions,
  getSelectedInkoopProducts,
  getSelectedInkoopProductRows,
  getYearProduction,
  hasMeaningfulFacturen,
  isFustOption,
  normalizeBerekening
} from "@/components/berekeningen/berekeningenWizardLegacyHelpers";

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
  skus?: GenericRecord[];
  bieren?: GenericRecord[];
  articles?: GenericRecord[];
  bomLines?: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  mode?: "standard" | "invoice-version";
  viewOnly?: boolean;
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
const BIEREN_API = `/api/data/bieren`;

function emptyInkoopFactuur() {
  const id = createId();
  return {
    id,
    factuurnummer: "",
    factuurdatum: "",
    lotnummer: "",
    verzendkosten: 0,
    overige_kosten: 0,
    factuurregels: [
      {
        id: createId(),
        aantal: 0,
        eenheid: "",
        liters: 0,
        subfactuurbedrag: 0,
        afvulkosten_fust: null,
      },
    ],
  };
}

function isInvoiceVersionSource(row: GenericRecord) {
  const status = String((row as any)?.status ?? "").trim().toLowerCase();
  const processType = String((((row as any)?.soort_berekening as GenericRecord | undefined)?.type ?? "")).trim();
  return status === "definitief" && processType === "Inkoop";
}

function createInvoiceVersionDraftFromSource(source: GenericRecord) {
  const nowIso = new Date().toISOString();
  const next = cloneRecord(source);
  const factuur = emptyInkoopFactuur();
  next.id = createId();
  next.status = "concept";
  next.is_actief = false;
  next.effectief_vanaf = "";
  next.brontype = "factuur";
  next.calculation_variant = "factuur";
  next.bron_berekening_id = String((source as any)?.id ?? "");
  next.bron_id = String(factuur.id ?? "");
  next.versie_nummer = Number((source as any)?.versie_nummer ?? 0) || 0;
  next.created_at = nowIso;
  next.updated_at = nowIso;
  next.aangemaakt_op = nowIso;
  next.aangepast_op = nowIso;
  next.finalized_at = "";
  next.resultaat_snapshot = {};
  next.invoer = {
    ...(((next as any).invoer as GenericRecord | undefined) ?? {}),
    inkoop: {
      factuurnummer: "",
      factuurdatum: "",
      lotnummer: "",
      verzendkosten: 0,
      overige_kosten: 0,
      factuurregels: cloneRecord(factuur.factuurregels),
      facturen: [factuur],
    },
  };
  next.soort_berekening = {
    ...(((next as any).soort_berekening as GenericRecord | undefined) ?? {}),
    type: "Inkoop",
  };
  return normalizeBerekening(next);
}

function createEmptyInvoiceVersionDraft() {
  const nowIso = new Date().toISOString();
  const next = createEmptyBerekening();
  const factuur = emptyInkoopFactuur();
  next.status = "concept";
  next.brontype = "factuur";
  next.calculation_variant = "factuur";
  next.bron_berekening_id = "";
  next.bron_id = String(factuur.id ?? "");
  next.created_at = nowIso;
  next.updated_at = nowIso;
  next.aangemaakt_op = nowIso;
  next.aangepast_op = nowIso;
  next.soort_berekening = { type: "Inkoop" };
  next.invoer = {
    inkoop: {
      factuurnummer: "",
      factuurdatum: "",
      lotnummer: "",
      verzendkosten: 0,
      overige_kosten: 0,
      factuurregels: cloneRecord(factuur.factuurregels),
      facturen: [factuur],
    },
  };
  return normalizeBerekening(next);
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

async function readResponseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body || "{}");
    const detail = parsed?.detail ?? parsed;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const message = String(detail.message ?? detail.detail ?? "").trim();
      const reasons = Array.isArray(detail.reasons)
        ? detail.reasons.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
        : [];
      if (message || reasons.length > 0) return [message, ...reasons].filter(Boolean).join("\n");
    }
  } catch {
    // Fall through to plain response body.
  }
  return body || response.statusText || "Onbekende fout.";
}

export function BerekeningenWizard({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  skus,
  bieren,
  articles,
  bomLines,
  productie,
  vasteKosten,
  tarievenHeffingen,
  packagingComponentPrices,
  kostprijsproductactiveringen,
  productgroepen,
  alcoholcategorieen,
  verpakkingstypen,
  initialSelectedId,
  startWithNew = false,
  mode = "standard",
  viewOnly = false,
  onBackToLanding,
  onRowsChange,
  onPersisted,
  onFinish
}: BerekeningenWizardProps) {
  const [localSkus, setLocalSkus] = useState<GenericRecord[]>(Array.isArray(skus) ? (skus as GenericRecord[]) : []);
  const [localArticles, setLocalArticles] = useState<GenericRecord[]>(Array.isArray(articles) ? (articles as GenericRecord[]) : []);
  const [localBomLines, setLocalBomLines] = useState<GenericRecord[]>(Array.isArray(bomLines) ? (bomLines as GenericRecord[]) : []);
  const [localBieren, setLocalBieren] = useState<GenericRecord[]>(Array.isArray(bieren) ? (bieren as GenericRecord[]) : []);
  const [douanoMappings, setDouanoMappings] = useState<Array<{ sku_id?: unknown; douano_product_id?: unknown }>>([]);

  const mappedSkuIds = useMemo(() => {
    const out = new Set<string>();
    (Array.isArray(douanoMappings) ? douanoMappings : []).forEach((row: any) => {
      const sid = String(row?.sku_id ?? "").trim();
      if (sid) out.add(sid);
    });
    return out;
  }, [douanoMappings]);

  const douanoMappingBySkuId = useMemo(() => {
    const out = new Map<string, any>();
    (Array.isArray(douanoMappings) ? douanoMappings : []).forEach((row: any) => {
      const sid = String(row?.sku_id ?? "").trim();
      if (!sid) return;
      const prev = out.get(sid);
      const nextUpdated = String(row?.updated_at ?? "").trim();
      const prevUpdated = String(prev?.updated_at ?? "").trim();
      if (!prev) {
        out.set(sid, row);
        return;
      }
      if (nextUpdated && (!prevUpdated || nextUpdated > prevUpdated)) {
        out.set(sid, row);
      }
    });
    return out;
  }, [douanoMappings]);
  useEffect(() => {
    setLocalSkus(Array.isArray(skus) ? (skus as GenericRecord[]) : []);
  }, [skus]);

  useEffect(() => {
    setLocalArticles(Array.isArray(articles) ? (articles as GenericRecord[]) : []);
  }, [articles]);

  useEffect(() => {
    setLocalBomLines(Array.isArray(bomLines) ? (bomLines as GenericRecord[]) : []);
  }, [bomLines]);

  useEffect(() => {
    setLocalBieren(Array.isArray(bieren) ? (bieren as GenericRecord[]) : []);
  }, [bieren]);

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
    const skusById = new Map(
      (Array.isArray(localSkus) ? localSkus : [])
        .map((row) => [String((row as any)?.id ?? ""), row] as const)
        .filter(([id]) => Boolean(id))
    );

    const normalizedRows = initialRows.map((row) => {
      const normalized = normalizeBerekening(row);
      const basis = (normalized.basisgegevens as GenericRecord) ?? {};
      const skuId = String((basis as any).sku_id ?? "").trim();
      if (skuId) {
        const sku = skusById.get(skuId) as any;
        if (sku) {
          (normalized.basisgegevens as GenericRecord) = {
            ...(normalized.basisgegevens as GenericRecord),
            product_group: String(sku.product_group ?? (basis as any).product_group ?? "").trim(),
            alcohol_category: String(sku.alcohol_category ?? (basis as any).alcohol_category ?? "").trim(),
            packaging_type: String(sku.packaging_type ?? (basis as any).packaging_type ?? "").trim(),
          };
        }
      }
      return normalized;
    });

    if (mode === "invoice-version") {
      const sourceRows = normalizedRows.filter(isInvoiceVersionSource);
      const source = initialSelectedId
        ? sourceRows.find((row) => String(row.id) === String(initialSelectedId))
        : null;
      if (!source) {
        const empty = createEmptyInvoiceVersionDraft();
        return {
          rows: [empty, ...normalizedRows],
          selectedId: String(empty.id),
        };
      }
      const draft = createInvoiceVersionDraftFromSource(source);
      return {
        rows: [draft, ...normalizedRows],
        selectedId: String(draft.id),
      };
    }

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
  }, [defaultProductieJaar, initialRows, initialSelectedId, mode, productieJaren.length, startWithNew, localSkus]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const rowsRef = useRef<GenericRecord[]>(initialState.rows);
  const [selectedId, setSelectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteDialog | null>(null);
  const [persistedIds, setPersistedIds] = useState<string[]>(
    startWithNew || mode === "invoice-version" ? [] : initialRows.map((row) => String((row as GenericRecord)?.id ?? "")).filter(Boolean)
  );
  const resetKeyRef = useRef(`${mode}:${startWithNew ? "new" : "existing"}:${initialSelectedId ?? ""}`);

  useEffect(() => {
    const resetKey = `${mode}:${startWithNew ? "new" : "existing"}:${initialSelectedId ?? ""}`;
    if (resetKeyRef.current === resetKey) return;
    if (!startWithNew && mode !== "invoice-version") {
      resetKeyRef.current = resetKey;
      return;
    }
    resetKeyRef.current = resetKey;
    setRows(initialState.rows);
    rowsRef.current = initialState.rows;
    setSelectedId(initialState.selectedId);
    setActiveStepIndex(0);
    setStatus("");
    setStatusTone(null);
    setPersistedIds([]);
  }, [initialSelectedId, initialState.rows, initialState.selectedId, mode, startWithNew]);

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
  const isEditingExisting = mode !== "invoice-version" && (!startWithNew || persistedIds.includes(effectiveSelectedId));
  const processType = getBerekeningProcessType(current);
  const stepsBase = buildWizardSteps(current);
  const isInvoiceVersionMode = mode === "invoice-version";
  const invoiceSourceRows = useMemo(
    () => rows.filter((row) => String(row.id ?? "") !== String(current.id ?? "") && isInvoiceVersionSource(row)),
    [current.id, rows]
  );
  const invoiceSourceId = String((current as any)?.bron_berekening_id ?? "").trim();
  const invoiceSourceMissing = isInvoiceVersionMode && !invoiceSourceId;

  const enabledFormatIdsForUi = useMemo(() => {
    const value = (current as any)?.enabled_format_ids;
    if (!Array.isArray(value)) return null;
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }, [current]);

  const shouldShowClassificeren = useMemo(() => {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const skuType = String((basis as any).sku_type ?? "bier").trim().toLowerCase();

    const relevantSkuIds: string[] = [];
    if (skuType !== "bier") {
      const skuId = String((basis as any).sku_id ?? "").trim();
      if (skuId) relevantSkuIds.push(skuId);
      return relevantSkuIds.some((sid) => mappedSkuIds.has(sid));
    }

    const biernaam = String((basis as any).biernaam ?? "").trim();
    const beerIdFromRow = String((current as any)?.bier_id ?? "").trim();
    const beerId =
      beerIdFromRow ||
      (() => {
        if (!biernaam) return "";
        const match = (Array.isArray(bieren) ? bieren : []).find((row: any) => {
          const name = String(row?.biernaam ?? row?.naam ?? "").trim();
          return name && name.toLowerCase() === biernaam.toLowerCase();
        }) as any;
        return match ? String(match.id ?? "").trim() : "";
      })();

    if (!beerId) return false;

    const skuByBeerFormat = new Map<string, any>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((row: any) => {
      const sid = String(row?.id ?? "").trim();
      const bid = String(row?.beer_id ?? "").trim();
      const fid = String(row?.format_article_id ?? "").trim();
      if (sid && bid && fid) skuByBeerFormat.set(`${bid}|${fid}`, row);
    });

    const snapshot = buildResultaatSnapshot(current);
    const orderedRows = [
      ...(((snapshot as any)?.producten?.basisproducten as any[]) ?? []),
      ...(((snapshot as any)?.producten?.samengestelde_producten as any[]) ?? []),
    ] as any[];
    const seen = new Set<string>();
    for (const row of orderedRows) {
      const formatId = String(row?.product_id ?? "").trim();
      if (!formatId || seen.has(formatId)) continue;
      seen.add(formatId);
      const skuRow = skuByBeerFormat.get(`${beerId}|${formatId}`) as any;
      const skuId = String(skuRow?.id ?? "").trim();
      if (skuId) relevantSkuIds.push(skuId);
    }
    return relevantSkuIds.some((sid) => mappedSkuIds.has(sid));
  }, [bieren, current, localSkus, mappedSkuIds]);

  const steps = useMemo(() => {
    if (shouldShowClassificeren) return stepsBase;
    return stepsBase.filter((step) => String((step as any)?.id ?? "") !== "classificeren");
  }, [shouldShowClassificeren, stepsBase]);

  useEffect(() => {
    // Keep active index within bounds when steps are conditionally removed.
    setActiveStepIndex((idx) => Math.min(Math.max(0, idx), Math.max(0, steps.length - 1)));
  }, [steps.length]);

  const currentIndex = Math.min(activeStepIndex, steps.length - 1);
  const currentStep = steps[currentIndex] ?? steps[0];
  const isCurrentDefinitive = String(current.status ?? "").trim().toLowerCase() === "definitief";
  const isCurrentReferencedByActivation = useMemo(
    () =>
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).some(
        (row) => String((row as any)?.kostprijsversie_id ?? "") === String(current.id ?? "")
      ),
    [current.id, kostprijsproductactiveringen]
  );
  const canDeleteCurrent = isEditingExisting && !isCurrentDefinitive && !isCurrentReferencedByActivation;
  const pageHeader = useMemo(
    () => ({
      title: String((current.basisgegevens as GenericRecord)?.biernaam ?? "").trim() || "Nieuwe kostprijsberekening",
      subtitle:
        processType === "Inkoop"
          ? "Werk de inkoopkostprijs stap voor stap uit, inclusief producten, facturen en samenvatting."
          : "Werk de kostprijs stap voor stap uit vanuit recept, ingredienten en verpakkingen."
    }),
    [current.basisgegevens, processType]
  );

  usePageShellHeader(pageHeader);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    async function refreshMappings() {
      try {
        const mappings = await loadDouanoProductMappings(10000);
        if (!cancelled) setDouanoMappings(Array.isArray(mappings) ? (mappings as any) : []);
      } catch {
        if (!cancelled) setDouanoMappings([]);
      }
    }

    void refreshMappings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshDouanoMappings() {
    try {
      const mappings = await loadDouanoProductMappings(10000);
      setDouanoMappings(Array.isArray(mappings) ? (mappings as any) : []);
    } catch {
      setDouanoMappings([]);
    }
  }

  function requestDelete(
    title: string,
    body: string,
    onConfirm: () => void,
    options?: Pick<PendingDeleteDialog, "confirmLabel" | "cancelLabel" | "hideCancel">
  ) {
    setPendingDelete({ title, body, onConfirm, ...options });
  }

  function buildResultaatSnapshot(row: GenericRecord): ResultaatSnapshot {
    return buildResultaatSnapshotFromWizard({
      row,
      productie,
      vasteKosten,
      tarievenHeffingen: Array.isArray(tarievenHeffingen) ? (tarievenHeffingen as any[]) : [],
      packagingComponentPrices: Array.isArray(packagingComponentPrices) ? (packagingComponentPrices as any[]) : [],
      basisproducten: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
      samengesteldeProducten: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
      getYearProduction,
      getProductDisplayName,
      calculateVariabeleKostenPerLiter,
      getSelectedInkoopProducts,
      expandSelectedInkoopProductsToBasisproducten,
    });
  }

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    const sourceRows = rowsRef.current.length > 0 ? rowsRef.current : rows;
    const nextRows = sourceRows.map((row) => {
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
    setRows(nextRows);
  }

  async function refreshLocalProductModel() {
    const [latestSkus, latestArticles, latestBomLines] = await Promise.all([loadSkus(), loadArticles(), loadBomLines()]);
    setLocalSkus(Array.isArray(latestSkus) ? (latestSkus as GenericRecord[]) : []);
    setLocalArticles(Array.isArray(latestArticles) ? (latestArticles as GenericRecord[]) : []);
    setLocalBomLines(Array.isArray(latestBomLines) ? (latestBomLines as GenericRecord[]) : []);
  }

  function getCurrentTargetRow() {
    const sourceRows = rowsRef.current;
    const currentId = String(current.id ?? "");
    return sourceRows.find((row) => String(row.id ?? "") === currentId) ?? null;
  }

  function findBeerStyleRow(styleName: string, rows = localBieren) {
    const wanted = styleName.trim().toLowerCase();
    if (!wanted) return null;
    return (Array.isArray(rows) ? rows : []).find((row: any) => {
      const names = [
        row?.stijl,
        row?.biernaam,
        row?.naam,
        row?.name,
      ].map((value) => String(value ?? "").trim().toLowerCase());
      return names.includes(wanted);
    }) as GenericRecord | null;
  }

  function findBeerIdentityRow(beerName: string, alcoholpercentage: number | null, rows = localBieren) {
    const wantedName = beerName.trim().toLowerCase();
    if (!wantedName) return null;
    return (Array.isArray(rows) ? rows : []).find((row: any) => {
      const names = [row?.biernaam, row?.naam, row?.name].map((value) => String(value ?? "").trim().toLowerCase());
      if (!names.includes(wantedName)) return false;
      if (alcoholpercentage === null) return true;
      const rowAlcohol = parseOptionalNumber(row?.alcoholpercentage);
      return rowAlcohol === null || Math.abs(rowAlcohol - alcoholpercentage) < 0.0001;
    }) as GenericRecord | null;
  }

  function buildBeerStylePayload(styleName: string, existing?: GenericRecord | null) {
    const target = getCurrentTargetRow();
    const basis = ((target?.basisgegevens as GenericRecord) ?? (current.basisgegevens as GenericRecord) ?? {}) as GenericRecord;
    const beerName = String((basis as any).biernaam ?? "").trim();
    const alcoholpercentage = parseOptionalNumber((basis as any).alcoholpercentage);
    if (!beerName) {
      throw new Error("Vul eerst de biernaam in voordat je een stijl opslaat.");
    }
    if (alcoholpercentage === null) {
      throw new Error("Vul eerst een geldig alcoholpercentage in voordat je een stijl opslaat.");
    }
    const style = String(styleName ?? "").trim();
    if (!style) {
      throw new Error("Stijlnaam ontbreekt.");
    }
    const id = String((existing as any)?.id ?? "").trim() || createId();
    return {
      ...(existing ?? {}),
      id,
      biernaam: beerName,
      naam: beerName,
      name: beerName,
      stijl: style,
      alcoholpercentage,
      belastingsoort: String((basis as any).belastingsoort ?? "Accijns"),
      tarief_accijns: String((basis as any).tarief_accijns ?? "Hoog"),
      btw_tarief: String((basis as any).btw_tarief ?? "21%"),
      actief: true,
      active: true,
      updated_at: new Date().toISOString(),
      created_at: String((existing as any)?.created_at ?? "") || new Date().toISOString(),
    };
  }

  async function saveBierenRows(rows: GenericRecord[]) {
    const response = await fetch(BIEREN_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = String((payload as any)?.detail ?? "Bierstamdata opslaan mislukt.");
      throw new Error(detail);
    }
  }

  function prepareStyleForCurrent() {
    const sourceRows = rowsRef.current;
    const currentId = String(current.id ?? "");
    const target = sourceRows.find((row) => String(row.id ?? "") === currentId);
    if (!target) return null;

    const basis = (target.basisgegevens as GenericRecord) ?? {};
    const skuType = String((basis as any).sku_type ?? "bier").trim().toLowerCase();
    if (skuType !== "bier") return null;

    const styleName = String((basis as any).stijl ?? "").trim();
    if (!styleName) return null;

    const existingBeerId = String((basis as any).bier_id ?? (target as any).bier_id ?? "").trim();
    const alcoholpercentage = parseOptionalNumber((basis as any).alcoholpercentage);
    const beerName = String((basis as any).biernaam ?? "").trim();
    const existingById = existingBeerId
      ? ((Array.isArray(localBieren) ? localBieren : []).find((row: any) => String(row?.id ?? "").trim() === existingBeerId) as GenericRecord | null)
      : null;
    const existing = existingById ?? findBeerIdentityRow(beerName, alcoholpercentage);
    const styleRecord = buildBeerStylePayload(styleName, existing);
    const beerId = String((styleRecord as any).id ?? "").trim();

    if (existingBeerId && existingById) {
      (target as any).bier_id = existingBeerId;
      (target.basisgegevens as GenericRecord) = {
        ...basis,
        stijl: styleName,
        bier_id: existingBeerId,
      };
      rowsRef.current = sourceRows.map((row) => (String(row.id ?? "") === currentId ? target : row));
      setRows(rowsRef.current);
    }
    const nextBieren = existing
      ? localBieren.map((row: any) => (String(row?.id ?? "").trim() === beerId ? styleRecord : row))
      : [...localBieren, styleRecord];

    (target as any).bier_id = beerId;
    (target.basisgegevens as GenericRecord) = {
      ...basis,
      stijl: styleName,
      bier_id: beerId,
    };
    rowsRef.current = sourceRows.map((row) => (String(row.id ?? "") === currentId ? target : row));
    setRows(rowsRef.current);
    return { nextBieren };
  }

  async function persistPreparedStyle(prepared: { nextBieren: GenericRecord[] } | null) {
    if (!prepared) return;
    await saveBierenRows(prepared.nextBieren);
    setLocalBieren(prepared.nextBieren);
  }

  async function createStyleFromCombobox(name: string): Promise<{ id: string; name: string }> {
    const styleName = String(name ?? "").trim();
    if (!styleName) throw new Error("Stijlnaam ontbreekt.");
    const target = getCurrentTargetRow();
    const basis = ((target?.basisgegevens as GenericRecord) ?? (current.basisgegevens as GenericRecord) ?? {}) as GenericRecord;
    const beerName = String((basis as any).biernaam ?? "").trim();
    const alcoholpercentage = parseOptionalNumber((basis as any).alcoholpercentage);
    const existing = findBeerIdentityRow(beerName, alcoholpercentage);
    const styleRecord = buildBeerStylePayload(styleName, existing);
    const beerId = String((styleRecord as any).id ?? "").trim();
    const nextBieren = existing
      ? localBieren.map((row: any) => (String(row?.id ?? "").trim() === beerId ? styleRecord : row))
      : [...localBieren, styleRecord];
    await saveBierenRows(nextBieren);
    setLocalBieren(nextBieren);
    return { id: beerId, name: String((styleRecord as any).stijl ?? styleName).trim() };
  }

  async function handleSave() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const preparedStyle = prepareStyleForCurrent();
      const nextCurrent = cloneRecord(current);
      syncPrimaryInkoopFactuur(nextCurrent);
      nextCurrent.bier_snapshot = cloneRecord((nextCurrent.basisgegevens as GenericRecord) ?? {});
      nextCurrent.resultaat_snapshot = buildResultaatSnapshot(nextCurrent);
      nextCurrent.updated_at = new Date().toISOString();
      nextCurrent.aangepast_op = nextCurrent.updated_at;
      const saved = await saveKostprijsversie(nextCurrent);
      await persistPreparedStyle(preparedStyle);
      const savedId = String(saved.id ?? "");
      const hadCurrent = rowsRef.current.some((row) => String(row.id ?? "") === savedId);
      const nextRows = hadCurrent
        ? rowsRef.current.map((row) => (String(row.id ?? "") === savedId ? saved : row))
        : [...rowsRef.current, saved];
      rowsRef.current = nextRows;
      setRows(nextRows);
      setPersistedIds((currentIds) =>
        currentIds.includes(String(current.id ?? "")) ? currentIds : [...currentIds, String(current.id ?? "")]
      );
      onRowsChange?.(nextRows);
      onPersisted?.({
        id: String(current.id ?? ""),
        year: Number(((current.basisgegevens as GenericRecord)?.jaar ?? current.jaar ?? 0) || 0),
        status: String(current.status ?? "concept")
      });
      setStatus("Kostprijsversies opgeslagen.");
      setStatusTone("success");
      return true;
    } catch (error) {
      const detail = tryReadApiDetail(error) || String((error as any)?.message ?? "");
      setStatus(detail ? `Opslaan mislukt: ${detail}` : "Opslaan mislukt.");
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
      const validationError = validateCurrentBeforePersist();
      if (validationError) {
        setStatus(validationError);
        setStatusTone("error");
        return false;
      }
      const basis = (current.basisgegevens as GenericRecord) ?? {};
      const biernaam = String(basis.biernaam ?? "").trim();
      const alcoholpercentage = parseOptionalNumber(basis.alcoholpercentage);
      if (biernaam && alcoholpercentage === null) {
        setStatus("Alcoholpercentage is verplicht en moet een geldig getal zijn voordat je kunt afronden.");
        setStatusTone("error");
        return false;
      }
      const sellableCoverage = buildSellableSkuOverview();
      const missingSkuCount = sellableCoverage.filter((row) => row.missingSku).length;
      const unmappedSkuCount = sellableCoverage.filter((row) => !row.missingSku && !row.mapped).length;
      if (missingSkuCount > 0 || unmappedSkuCount > 0) {
        setStatus(
          `Afronden geblokkeerd: ${missingSkuCount} kostprijsproduct(en) missen nog een SKU en ${unmappedSkuCount} SKU('s) missen nog een Douano-koppeling. Controleer stap 5 en stap 6.`
        );
        setStatusTone("error");
        return false;
      }
      const preparedStyle = prepareStyleForCurrent();
      const firstTimeProductIds = buildFirstTimeActivationProductIds();

      const nowIso = new Date().toISOString();
      const nextCurrent = cloneRecord(current);
      syncPrimaryInkoopFactuur(nextCurrent);
      nextCurrent.status = "definitief";
      nextCurrent.finalized_at = nowIso;
      nextCurrent.updated_at = nowIso;
      nextCurrent.aangepast_op = nowIso;
      nextCurrent.bier_snapshot = cloneRecord((nextCurrent.basisgegevens as GenericRecord) ?? {});
      nextCurrent.resultaat_snapshot = buildResultaatSnapshot(nextCurrent);
      const saved = await saveKostprijsversie(nextCurrent);
      await persistPreparedStyle(preparedStyle);
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, {
        cache: "no-store"
      });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? rowsRef.current
        : rowsRef.current.map((row) => (String(row.id ?? "") === String(saved.id ?? "") ? saved : row));
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      setPersistedIds((currentIds) =>
        currentIds.includes(String(current.id ?? "")) ? currentIds : [...currentIds, String(current.id ?? "")]
      );
      onRowsChange?.(refreshedRows);
      onPersisted?.({
        id: String(current.id ?? ""),
        year: Number(((current.basisgegevens as GenericRecord)?.jaar ?? current.jaar ?? 0) || 0),
        status: "definitief"
      });

      if (firstTimeProductIds.length > 0) {
        try {
          await activateKostprijsversieProducts(String(current.id ?? ""), firstTimeProductIds);
          onRowsChange?.(refreshedRows);
        } catch (error) {
          const detail = tryReadApiDetail(error);
          setStatus(
            detail
              ? `Afronden gelukt, maar nieuwe artikelen automatisch activeren mislukt: ${detail}`
              : "Afronden gelukt, maar nieuwe artikelen automatisch activeren mislukt."
          );
          setStatusTone("error");
          return false;
        }
      }

	      // Validate & stage classification. For bier: classify per format during concept, then persist to SKUs after activation.
	      const skuType = String((basis as any).sku_type ?? "bier").trim().toLowerCase();
        // Always validate against the latest Beheer > Productkoppeling state (SSOT), so edits there
        // are reflected immediately without requiring a full page refresh.
        const mappingsForValidation = await (async () => {
          try {
            return await loadDouanoProductMappings(10000);
          } catch {
            return Array.isArray(douanoMappings) ? (douanoMappings as any[]) : [];
          }
        })();
        const mappingBySkuIdForValidation = (() => {
          const out = new Map<string, any>();
          (Array.isArray(mappingsForValidation) ? mappingsForValidation : []).forEach((row: any) => {
            const sid = String(row?.sku_id ?? "").trim();
            if (!sid) return;
            const prev = out.get(sid);
            const nextUpdated = String(row?.updated_at ?? "").trim();
            const prevUpdated = String(prev?.updated_at ?? "").trim();
            if (!prev) {
              out.set(sid, row);
              return;
            }
            if (nextUpdated && (!prevUpdated || nextUpdated > prevUpdated)) {
              out.set(sid, row);
            }
          });
          return out;
        })();
      const validateClassification = (productGroup: string, packagingType: string, required: boolean) => {
        if (!required) return true;
        if (!productGroup) {
          setStatus("Productgroep is verplicht (Classificeren).");
          setStatusTone("error");
          return false;
        }
	        if ((productGroup === "drank" || productGroup === "giftset") && !packagingType) {
	          setStatus("Verpakkingstype is verplicht voor Drank/Giftset (Classificeren).");
	          setStatusTone("error");
	          return false;
	        }
	        return true;
	      };

	      const pendingSkuClassifications: Array<{ skuId: string; payload: any }> = [];
	      const pendingBeerFormatClassifications: Array<{
	        formatId: string;
	        productGroup: string;
	        alcoholCategory: string;
	        packagingType: string;
	      }> = [];

      if (skuType !== "bier") {
        const skuId = String((basis as any).sku_id ?? "").trim();
        if (skuId && mappedSkuIds.has(skuId)) {
          // Source of truth: Beheer > Productkoppeling (douano product mappings).
          // The wizard should not introduce a second write-source; it only blocks finalize when a mapped SKU
          // is missing mandatory classification.
          const mapping = mappingBySkuIdForValidation.get(skuId) ?? {};
          const productGroup = String((mapping as any)?.product_group ?? "").trim();
          const packagingType = String((mapping as any)?.packaging_type ?? "").trim();
          if (!validateClassification(productGroup, packagingType, true)) return false;
        }
	      }
      // Persist classification only when a SKU is coupled in Beheer > Productkoppeling.
      // Productkoppeling is the source of truth for ERP classification; unmapped SKUs are intentionally skipped.
      for (const entry of pendingSkuClassifications) {
        const skuId = String(entry.skuId ?? "").trim();
        if (!mappedSkuIds.has(skuId)) continue;
        const pg = String(entry?.payload?.product_group ?? "").trim();
        const pt = String(entry?.payload?.packaging_type ?? "").trim();
        if (!validateClassification(pg, pt, true)) return false;
        await saveSkuClassification(entry.skuId, entry.payload);
      }

	      if (pendingBeerFormatClassifications.length > 0) {
	        const basis = (current.basisgegevens as GenericRecord) ?? {};
	        const biernaam = String((basis as any).biernaam ?? "").trim();
	        const beerIdFromRow = String((current as any)?.bier_id ?? "").trim();
	        const beerId =
	          beerIdFromRow ||
	          (() => {
	            if (!biernaam) return "";
	            const match = (Array.isArray(bieren) ? bieren : []).find((row: any) => {
	              const name = String(row?.biernaam ?? row?.naam ?? "").trim();
	              return name && name.toLowerCase() === biernaam.toLowerCase();
	            }) as any;
	            return match ? String(match.id ?? "").trim() : "";
	          })();

	        const latestSkus = await loadSkus();
	        await refreshLocalProductModel();
	        const skuByBeerFormat = new Map<string, any>();
	        (Array.isArray(latestSkus) ? latestSkus : []).forEach((row: any) => {
	          const sid = String(row?.id ?? "").trim();
	          const bid = String(row?.beer_id ?? "").trim();
	          const fid = String(row?.format_article_id ?? "").trim();
	          if (sid && bid && fid) skuByBeerFormat.set(`${bid}|${fid}`, row);
	        });

        let missing = 0;
        for (const item of pendingBeerFormatClassifications) {
          const skuRow = beerId ? (skuByBeerFormat.get(`${beerId}|${item.formatId}`) as any) : null;
          const skuId = String(skuRow?.id ?? "").trim();
          if (!skuId) {
            missing += 1;
            continue;
          }
          if (!mappedSkuIds.has(skuId)) continue;
          if (!validateClassification(item.productGroup, item.packagingType, true)) return false;
          await saveSkuClassification(skuId, {
            product_group: item.productGroup,
            alcohol_category: item.alcoholCategory,
            packaging_type: item.packagingType,
          });
        }
        if (missing > 0) {
          setStatus(`Kostprijsversie definitief + actief, maar classificatie kon niet worden opgeslagen voor ${missing} SKU(s).`);
          setStatusTone("error");
          return true;
	        }
	      }

	      setStatus("Kostprijsversie definitief opgeslagen. Nieuwe artikelen worden automatisch actief; bestaande artikelen krijgen een nieuwe kandidaatversie.");
	      setStatusTone("success");
	      return true;
    } catch (error) {
      const detail = tryReadApiDetail(error) || String((error as any)?.message ?? "");
      setStatus(detail ? `Afronden mislukt: ${detail}` : "Afronden mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  const validateCurrentBeforePersist = () =>
    validateCurrentBeforePersistFromWizard({
      current,
      basisproducten: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
      samengesteldeProducten: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
      getProductUnitOptions,
      isFustOption,
    });

  function selectInvoiceSource(sourceId: string) {
    const source = rows.find((row) => String(row.id ?? "") === String(sourceId));
    if (!source) return;
    const draft = createInvoiceVersionDraftFromSource(source);
    const nextRows = [draft, ...rows.filter((row) => String(row.id ?? "") !== String(current.id ?? ""))];
    rowsRef.current = nextRows;
    setRows(nextRows);
    setSelectedId(String(draft.id ?? ""));
    setActiveStepIndex(0);
    setStatus("");
    setStatusTone(null);
  }

  function renderInvoiceBasisStep() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Bronkostprijs</div>
          <div className="module-card-text">
            Selecteer de bestaande kostprijs waarvoor je een nieuwe inkoopfactuurversie maakt. De stamgegevens blijven hier bewust read-only.
          </div>
          <div className="wizard-form-grid" style={{ marginTop: 12 }}>
            <label className="nested-field">
              <span>Bestaande kostprijs</span>
              <select
                className="dataset-input"
                value={invoiceSourceId}
                onChange={(event) => selectInvoiceSource(event.target.value)}
              >
                {invoiceSourceRows.length === 0 ? (
                  <option value="">Geen definitieve inkoopkostprijzen beschikbaar</option>
                ) : null}
                {invoiceSourceRows.map((row) => {
                  const rowBasis = ((row as any)?.basisgegevens ?? {}) as GenericRecord;
                  const name = String((rowBasis as any)?.biernaam ?? "Onbekend").trim();
                  const year = Number((rowBasis as any)?.jaar ?? (row as any)?.jaar ?? 0) || "";
                  const source = String((row as any)?.bron_label ?? (row as any)?.omschrijving ?? "").trim();
                  return (
                    <option key={String(row.id ?? "")} value={String(row.id ?? "")}>
                      {`${name}${year ? ` (${year})` : ""}${source ? ` - ${source}` : ""}`}
                    </option>
                  );
                })}
              </select>
            </label>
            {[
              ["Biernaam", (basis as any).biernaam],
              ["Stijl", (basis as any).stijl],
              ["Jaar", (basis as any).jaar],
              ["Alcoholpercentage", (basis as any).alcoholpercentage],
              ["Belastingsoort", (basis as any).belastingsoort],
              ["Tarief accijns", (basis as any).tarief_accijns],
            ].map(([label, value]) => (
              <label key={String(label)} className="nested-field">
                <span>{String(label)}</span>
                <input className="dataset-input" type="text" value={String(value ?? "")} readOnly />
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderInvoiceTypeStep() {
    return (
      <div className="wizard-choice-grid">
        <div className="wizard-choice-card active" aria-disabled="true">
          <div className="wizard-choice-title">Inkoop</div>
          <div className="wizard-choice-text">
            Deze factuurversie gebruikt dezelfde inkoopflow als Nieuwe kostprijsberekening. De berekeningssoort kan hier niet wijzigen.
          </div>
        </div>
      </div>
    );
  }

  async function handleDeleteCurrent() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/meta/delete-kostprijs-concept?kostprijs_id=${encodeURIComponent(String(current.id))}&dry_run=false`,
        { method: "POST" }
      );
      if (!response.ok) {
        const message = await readResponseError(response);
        throw new Error(message || "Verwijderen mislukt.");
      }
      const payload = rowsRef.current.filter((row) => String(row.id) !== String(current.id));
      rowsRef.current = payload;
      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Berekening verwijderd.");
      setStatusTone("success");
      onBackToLanding?.();
    } catch (error) {
      let message = error instanceof Error ? error.message : "";
      const detail = tryReadApiDetail(error);
      if (detail) message = detail;
      setStatus(message || "Verwijderen mislukt.");
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  function promptEffectiveFromDate(year: number): string {
    const fallback = `${year}-01-01`;
    if (typeof window === "undefined") return fallback;
    const input = window.prompt("Per welke datum moet deze kostprijs ingaan? (YYYY-MM-DD)", fallback);
    const value = String(input ?? fallback).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  }

  async function handleActivate() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);
    try {
      const enabled = (current as any)?.enabled_format_ids;
      if (Array.isArray(enabled) && enabled.map((v: any) => String(v ?? "").trim()).filter(Boolean).length === 0) {
        setStatus("Selecteer minimaal 1 afvuleenheid in Samenvatting voordat je activeert.");
        setStatusTone("error");
        return false;
      }
      const statusValue = String((current as any)?.status ?? "").trim().toLowerCase();
      if (statusValue !== "definitief") {
        setStatus(`Activeren kan alleen voor definitieve kostprijzen (status is '${statusValue || "onbekend"}').`);
        setStatusTone("error");
        return false;
      }
      const year =
        Number((current as any)?.jaar ?? (current as any)?.basisgegevens?.jaar ?? 0) || new Date().getFullYear();
      const effectiveFrom = promptEffectiveFromDate(year);
      await activateKostprijsversie(String(current.id ?? ""), effectiveFrom);
      const refreshedResponse = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshedResponse.ok
        ? unwrapDatasetListPayload(await refreshedResponse.json()) ?? rowsRef.current
        : rowsRef.current;
      rowsRef.current = refreshedRows;
      setRows(refreshedRows);
      onRowsChange?.(refreshedRows);
      setStatus("Kostprijsversie geactiveerd.");
      setStatusTone("success");
      return true;
    } catch (error) {
      const detail = tryReadApiDetail(error);
      setStatus(detail ? `Activeren mislukt: ${detail}` : "Activeren mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function renderBasisStep() {
    if (isInvoiceVersionMode) return renderInvoiceBasisStep();
    return (
      <BasisStep
        current={current}
        productieJaren={productieJaren}
        bieren={localBieren}
        onCreateStyle={createStyleFromCombobox}
        updateCurrent={updateCurrent}
      />
    );
  }

  function renderTypeStep() {
    if (isInvoiceVersionMode) return renderInvoiceTypeStep();
    return <TypeStep current={current} updateCurrent={updateCurrent} setActiveStepIndex={setActiveStepIndex} />;
  }

  function renderClassificatieStep() {
    const skuType = String(((current.basisgegevens as GenericRecord) as any)?.sku_type ?? "bier").toLowerCase();
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const biernaam = String((basis as any).biernaam ?? "").trim();
    const beerIdFromRow = String((current as any)?.bier_id ?? "").trim();
    const beerId =
      beerIdFromRow ||
      (() => {
        if (!biernaam) return "";
        const match = (Array.isArray(bieren) ? bieren : []).find((row: any) => {
          const name = String(row?.biernaam ?? row?.naam ?? "").trim();
          return name && name.toLowerCase() === biernaam.toLowerCase();
        }) as any;
        return match ? String(match.id ?? "").trim() : "";
      })();
	    const skuByBeerFormat = new Map<string, any>();
	    (Array.isArray(localSkus) ? localSkus : []).forEach((row: any) => {
	      const sid = String(row?.id ?? "").trim();
	      const bid = String(row?.beer_id ?? "").trim();
	      const fid = String(row?.format_article_id ?? "").trim();
	      if (sid && bid && fid) {
	        skuByBeerFormat.set(`${bid}|${fid}`, row);
	      }
	    });

	    const year = Number((basis as any).jaar ?? 0) || 0;
	    const soort = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();

	    const targets =
	      skuType !== "bier"
	        ? (() => {
	            const skuId = String(((current.basisgegevens as any)?.sku_id ?? "")).trim();
	            if (!skuId) return [];
	            const skuRow = (Array.isArray(localSkus) ? localSkus : []).find((row: any) => String(row?.id ?? "").trim() === skuId) as any;
	            const label = skuRow ? String(skuRow?.label ?? skuRow?.name ?? skuId) : skuId;
	            const mapping = douanoMappingBySkuId.get(skuId) as any;
	            return [
	              {
	                id: skuId,
	                kind: "sku",
	                label,
	                current_product_group: String(mapping?.product_group ?? skuRow?.product_group ?? "").trim(),
	                current_alcohol_category: String(mapping?.alcohol_category ?? skuRow?.alcohol_category ?? "").trim(),
	                current_packaging_type: String(mapping?.packaging_type ?? skuRow?.packaging_type ?? "").trim(),
	              },
	            ];
	          })()
	        : (() => {
	            const snapshot = buildResultaatSnapshot(current);
	            const orderedRows = [
	              ...(((snapshot as any)?.producten?.basisproducten as any[]) ?? []),
	              ...(((snapshot as any)?.producten?.samengestelde_producten as any[]) ?? []),
	            ] as any[];
	            const seen = new Set<string>();
	            const out: any[] = [];
	            for (const row of orderedRows) {
	              const formatId = String(row?.product_id ?? "").trim();
	              if (!formatId || seen.has(formatId)) continue;
	              seen.add(formatId);
	              const verpakkingseenheid = normalizeUnitLabel(String(row?.verpakkingseenheid ?? "").trim() || formatId);
	              const label = makeBeerSkuLabel(biernaam, verpakkingseenheid);
	              const skuRow = beerId ? (skuByBeerFormat.get(`${beerId}|${formatId}`) as any) : null;
	              const skuId = String(skuRow?.id ?? "").trim();
	              const mapping = skuId ? (douanoMappingBySkuId.get(skuId) as any) : null;
	              out.push({
	                id: formatId,
	                kind: "format",
	                label,
	                current_product_group: String(mapping?.product_group ?? skuRow?.product_group ?? "").trim(),
	                current_alcohol_category: String(mapping?.alcohol_category ?? skuRow?.alcohol_category ?? "").trim(),
	                current_packaging_type: String(mapping?.packaging_type ?? skuRow?.packaging_type ?? "").trim(),
	              });
	            }
	            return out;
	          })();

	    return (
	      <ClassificatieStep
	        current={current}
	        productgroepen={productgroepen}
	        alcoholcategorieen={alcoholcategorieen}
	        verpakkingstypen={verpakkingstypen}
	        targets={targets}
	        updateCurrent={updateCurrent}
	      />
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
    return (
      <EigenProductieInputStep
        current={current}
        rows={rows}
        productie={productie}
        updateCurrent={updateCurrent}
        requestDelete={requestDelete}
        createId={createId}
        getIngredientType={getIngredientType}
        getYearProduction={getYearProduction}
        calculateEigenProductieKostenRecept={calculateEigenProductieKostenRecept}
        calculateEigenProductiePrijsPerEenheid={calculateEigenProductiePrijsPerEenheid}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
      />
    );
  }

  function renderInkoopInput() {
    return (
      <InkoopInputStep
        current={current}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        updateCurrent={updateCurrent}
        requestDelete={requestDelete}
        getProductUnitOptions={getProductUnitOptions}
        getFactuurRegelLiters={getFactuurRegelLiters}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        calculateInkoopExtraKostenPerRegel={calculateInkoopExtraKostenPerRegel}
        calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
        calculateInkoopPrijsPerLiter={calculateInkoopPrijsPerLiter}
        getFactuurRegelAfvulkostenFust={getFactuurRegelAfvulkostenFust}
      />
    );
  }

  function renderFacturenStep() {
    return (
      <FacturenStep
        current={current}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        getProductUnitOptions={getProductUnitOptions}
        getProductUnitLabel={getProductUnitLabel}
        getFactuurRegelLiters={getFactuurRegelLiters}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
        calculateInkoopPrijsPerLiter={calculateInkoopPrijsPerLiter}
      />
    );
  }

  function renderSellableVariantsStep() {
    return (
      <SellableVariantsStep
        current={current}
        skus={Array.isArray(localSkus) ? localSkus : []}
        articles={Array.isArray(localArticles) ? localArticles : []}
        bomLines={Array.isArray(localBomLines) ? localBomLines : []}
        verpakkingstypen={Array.isArray(verpakkingstypen) ? verpakkingstypen : []}
        costProductRows={buildCostProductCandidates()}
        onRefreshSkus={async () => {
          if (isInvoiceVersionMode) {
            const saved = await handleSave();
            if (!saved) return;
          }
          await refreshLocalProductModel();
        }}
        onEnableProductId={(productId) => {
          const id = String(productId ?? "").trim();
          if (!id) return;
          updateCurrent((draft) => {
            const currentEnabled = Array.isArray((draft as any).enabled_format_ids)
              ? ((draft as any).enabled_format_ids as unknown[]).map((value) => String(value ?? "").trim()).filter(Boolean)
              : [];
            if (!currentEnabled.includes(id)) {
              (draft as any).enabled_format_ids = [...currentEnabled, id];
            }
          });
        }}
      />
    );
  }

  function renderKoppelenStep() {
    return (
      <KoppelenStep
        current={current}
        skus={Array.isArray(localSkus) ? localSkus : []}
        articles={Array.isArray(localArticles) ? localArticles : []}
        costProductRows={buildCostProductCandidates()}
        douanoMappings={Array.isArray(douanoMappings) ? douanoMappings : []}
        onRefreshMappings={refreshDouanoMappings}
        focusUnlinkedOnly={isInvoiceVersionMode}
      />
    );
  }

  function buildCostProductCandidates(): CostProductCandidate[] {
    const snapshot = buildResultaatSnapshot(current);
    const rows = [
      ...(((snapshot as any)?.producten?.basisproducten as any[]) ?? []),
      ...(((snapshot as any)?.producten?.samengestelde_producten as any[]) ?? []),
    ];

    const basisById = new Map<string, any>();
    (Array.isArray(basisproducten) ? basisproducten : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) basisById.set(id, row);
    });
    const samengesteldById = new Map<string, any>();
    (Array.isArray(samengesteldeProducten) ? samengesteldeProducten : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) samengesteldById.set(id, row);
    });
    const articleById = new Map<string, any>();
    (Array.isArray(localArticles) ? localArticles : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) articleById.set(id, row);
    });

    const seen = new Set<string>();
    const out: CostProductCandidate[] = [];
    for (const row of rows) {
      const productId = String(row?.product_id ?? "").trim();
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      const productType = String(row?.product_type ?? "").trim().toLowerCase();
      const basisProduct = basisById.get(productId);
      const samengesteldProduct = samengesteldById.get(productId);
      const article = articleById.get(productId);
      const liters =
        Number((row as any)?.liters_per_product ?? 0) ||
        Number(basisProduct?.inhoud_per_eenheid_liter ?? 0) ||
        Number(samengesteldProduct?.totale_inhoud_liter ?? 0) ||
        Number(article?.content_liter ?? 0) ||
        0;
      const unitLabel =
        String(row?.verpakkingseenheid ?? row?.verpakking ?? "").trim() ||
        String(basisProduct?.omschrijving ?? samengesteldProduct?.omschrijving ?? article?.name ?? productId).trim();
      const beerName = String(row?.biernaam ?? (current.basisgegevens as GenericRecord)?.biernaam ?? "").trim();
      const sellableLabel = makeBeerSkuLabel(beerName, unitLabel);
      out.push({
        id: `${productType || "product"}-${productId}`,
        productId,
        productType,
        label: sellableLabel,
        liters: Number.isFinite(liters) ? liters : 0,
        kindLabel: productType === "samengesteld" ? "Samengesteld" : "Basisproduct",
      });
    }
    return out;
  }

  function buildSellableSkuOverview() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const beerId = String((current as any)?.bier_id ?? (basis as any)?.bier_id ?? "").trim();
    const articleById = new Map<string, any>();
    (Array.isArray(localArticles) ? localArticles : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) articleById.set(id, row);
    });
    const mappingBySkuId = new Map<string, any>();
    (Array.isArray(douanoMappings) ? douanoMappings : []).forEach((row: any) => {
      const skuId = String(row?.sku_id ?? "").trim();
      if (skuId) mappingBySkuId.set(skuId, row);
    });

    const skuByFormatId = new Map<string, any>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((sku: any) => {
      const skuBeerId = String(sku?.beer_id ?? "").trim();
      const formatId = String(sku?.format_article_id ?? "").trim();
      const kind = String(sku?.kind ?? "").trim().toLowerCase();
      if (beerId && skuBeerId === beerId && kind === "beer_format" && formatId) {
        skuByFormatId.set(formatId, sku);
      }
    });

    const seenSkuIds = new Set<string>();
    const rows: Array<{
      id: string;
      label: string;
      mapped: boolean;
      missingSku: boolean;
      douanoProductId: string;
      source: string;
      productId: string;
    }> = [];

    buildCostProductCandidates().forEach((candidate) => {
      const sku = skuByFormatId.get(candidate.productId);
      if (!sku) {
        rows.push({
          id: `missing-${candidate.id}`,
          label: candidate.label,
          mapped: false,
          missingSku: true,
          douanoProductId: "",
          source: candidate.kindLabel,
          productId: candidate.productId,
        });
        return;
      }
      const skuId = String(sku?.id ?? "").trim();
      if (skuId) seenSkuIds.add(skuId);
      const mapping = mappingBySkuId.get(skuId);
      const displayLabel = makeBeerSkuLabel(String((current.basisgegevens as GenericRecord)?.biernaam ?? ""), String(sku?.name ?? "").trim() || candidate.label);
      rows.push({
        id: skuId,
        label: displayLabel,
        mapped: Boolean(mapping),
        missingSku: false,
        douanoProductId: String(mapping?.douano_product_id ?? "").trim(),
        source: candidate.kindLabel,
        productId: candidate.productId,
      });
    });

    const extraRows = (Array.isArray(localSkus) ? localSkus : [])
      .filter((sku: any) => {
        const skuBeerId = String(sku?.beer_id ?? "").trim();
        if (!beerId || skuBeerId !== beerId) return false;
        const skuId = String(sku?.id ?? "").trim();
        if (skuId && seenSkuIds.has(skuId)) return false;
        const kind = String(sku?.kind ?? "").trim().toLowerCase();
        return kind === "beer_format" || kind === "article";
      })
      .map((sku: any) => {
        const articleId = String(sku?.article_id || sku?.format_article_id || "").trim();
        const article = articleId ? articleById.get(articleId) : null;
        const label =
          String(sku?.name ?? "").trim() ||
          String(article?.name ?? article?.omschrijving ?? "").trim() ||
          String(sku?.id ?? "").trim();
        const displayLabel = makeBeerSkuLabel(String((basis as any)?.biernaam ?? ""), label);
        const mapping = mappingBySkuId.get(String(sku?.id ?? "").trim());
        return {
          id: String(sku?.id ?? "").trim(),
          label: displayLabel,
          mapped: Boolean(mapping),
          missingSku: false,
          douanoProductId: String(mapping?.douano_product_id ?? "").trim(),
          source: "Variant",
          productId: articleId,
        };
      })
      .filter((row) => row.id);

    return [...rows, ...extraRows].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }

  function buildFirstTimeActivationProductIds() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const beerId = String((current as any)?.bier_id ?? (basis as any)?.bier_id ?? "").trim();
    const year = Number((current as any)?.jaar ?? (basis as any)?.jaar ?? 0) || 0;
    if (!beerId || year <= 0) return [];

    const skuByFormatId = new Map<string, any>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((sku: any) => {
      const skuBeerId = String(sku?.beer_id ?? "").trim();
      const formatId = String(sku?.format_article_id ?? "").trim();
      const kind = String(sku?.kind ?? "").trim().toLowerCase();
      if (skuBeerId === beerId && kind === "beer_format" && formatId) {
        skuByFormatId.set(formatId, sku);
      }
    });

    const activeSkuIds = new Set(
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [])
        .filter((row: any) => Number(row?.jaar ?? 0) === year)
        .map((row: any) => String(row?.sku_id ?? "").trim())
        .filter(Boolean)
    );

    const out: string[] = [];
    const seen = new Set<string>();
    buildCostProductCandidates().forEach((candidate) => {
      const productId = String(candidate.productId ?? "").trim();
      if (!productId || seen.has(productId)) return;
      const sku = skuByFormatId.get(productId);
      const skuId = String(sku?.id ?? "").trim();
      if (!skuId || activeSkuIds.has(skuId)) return;
      seen.add(productId);
      out.push(productId);
    });

    buildSellableSkuOverview().forEach((row) => {
      const skuId = String((row as any)?.id ?? "").trim();
      const productId = String((row as any)?.productId ?? "").trim();
      if (!skuId || !productId || seen.has(productId)) return;
      if (activeSkuIds.has(skuId)) return;
      seen.add(productId);
      out.push(productId);
    });

    return out;
  }

  function asNumber(value: unknown, fallback = 0) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function cleanFinalUnitLabel(label: unknown, beerName: unknown) {
    const raw = normalizeUnitLabel(label);
    const beer = String(beerName ?? "").trim();
    if (!raw || !beer) return raw || "-";
    const escaped = beer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return raw
      .replace(new RegExp(`^${escaped}\\s*[-–—:]?\\s*`, "i"), "")
      .replace(/\s{2,}/g, " ")
      .trim() || raw;
  }

  function summaryOverheadValue(row: any) {
    const explicit = row?.vaste_kosten;
    if (explicit !== undefined && explicit !== null && explicit !== "") return asNumber(explicit, 0);
    return asNumber(row?.manufacturing_overhead, 0) + asNumber(row?.business_overhead, 0);
  }

  function buildFormatVisibilityLinks() {
    const snapshot = buildResultaatSnapshot(current);
    const basisRows = ((snapshot as any)?.producten?.basisproducten as any[]) ?? [];
    const compRows = ((snapshot as any)?.producten?.samengestelde_producten as any[]) ?? [];
    const allFormatIds = [
      ...basisRows.map((r) => String(r?.product_id ?? "").trim()),
      ...compRows.map((r) => String(r?.product_id ?? "").trim()),
    ].filter(Boolean);

    const compositeToBase = new Map<string, string>();
    const baseToComposite = new Map<string, { id: string; score: number }[]>();
    (Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : []).forEach((row: any) => {
      const compositeId = String(row?.id ?? "").trim();
      if (!compositeId) return;
      const basisList = Array.isArray(row?.basisproducten) ? row.basisproducten : [];
      let bestBaseId = "";
      let bestScore = -1;
      for (const item of basisList) {
        const basisId = String(item?.basisproduct_id ?? "").trim();
        if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) continue;
        const score = Number(item?.aantal ?? 0) || 0;
        if (score > bestScore) {
          bestScore = score;
          bestBaseId = basisId;
        }
      }
      if (!bestBaseId) return;
      compositeToBase.set(compositeId, bestBaseId);
      const current = baseToComposite.get(bestBaseId) ?? [];
      current.push({ id: compositeId, score: bestScore });
      baseToComposite.set(bestBaseId, current);
    });

    const baseToPrimaryComposite = new Map<string, string>();
    for (const [baseId, items] of baseToComposite.entries()) {
      const sorted = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.id).localeCompare(String(b.id)));
      if (sorted[0]?.id) baseToPrimaryComposite.set(baseId, sorted[0].id);
    }

    return { allFormatIds, compositeToBase, baseToPrimaryComposite };
  }

  function applyVisibilityToggle(ids: string[], enabled: boolean, fallbackIds: string[] = []) {
    const links = buildFormatVisibilityLinks();
    const currentEnabled = enabledFormatIdsForUi ?? [...links.allFormatIds, ...fallbackIds];
    const next = new Set(currentEnabled);
    const apply = (id: string) => {
      if (!id) return;
      if (enabled) next.add(id);
      else next.delete(id);
    };

    ids.forEach((id) => {
      apply(id);
      const baseId = links.compositeToBase.get(id);
      if (baseId) apply(baseId);
      const compositeId = links.baseToPrimaryComposite.get(id);
      if (compositeId) apply(compositeId);
    });

    updateCurrent((draft) => {
      (draft as any).enabled_format_ids = Array.from(next);
    });
  }

  function buildVariantCostRows() {
    const basis = (current.basisgegevens as GenericRecord) ?? {};
    const beerId = String((current as any)?.bier_id ?? (basis as any)?.bier_id ?? "").trim();
    const beerName = String((basis as any)?.biernaam ?? "").trim();
    const year = asNumber((basis as any)?.jaar, new Date().getFullYear());
    const soort = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim() || "Eigen productie";
    if (!beerId) return [];

    const snapshot = buildResultaatSnapshot(current);
    const summaryByProductId = new Map<string, SummaryProductRow>();
    ([...((snapshot as any)?.producten?.basisproducten ?? []), ...((snapshot as any)?.producten?.samengestelde_producten ?? [])] as SummaryProductRow[])
      .forEach((row) => {
        const productId = String((row as any)?.product_id ?? "").trim();
        if (productId) summaryByProductId.set(productId, row);
      });

    const articleById = new Map<string, any>();
    (Array.isArray(localArticles) ? localArticles : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) articleById.set(id, row);
    });

    const skuById = new Map<string, any>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((row: any) => {
      const id = String(row?.id ?? "").trim();
      if (id) skuById.set(id, row);
    });

    const packagingPriceByComponent = new Map<string, number>();
    (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row: any) => {
      const componentId = String(row?.verpakkingsonderdeel_id ?? row?.packaging_component_id ?? "").trim();
      const rowYear = asNumber(row?.jaar, 0);
      if (!componentId || rowYear !== year) return;
      packagingPriceByComponent.set(componentId, asNumber(row?.prijs_per_stuk, 0));
    });

    const rows = (Array.isArray(localSkus) ? localSkus : [])
      .filter((sku: any) => {
        const kind = String(sku?.kind ?? "").trim().toLowerCase();
        const skuBeerId = String(sku?.beer_id ?? "").trim();
        return kind === "article" && skuBeerId === beerId;
      })
      .map((sku: any) => {
        const articleId = String(sku?.article_id ?? "").trim();
        const article = articleId ? articleById.get(articleId) : null;
        const lines = (Array.isArray(localBomLines) ? localBomLines : []).filter(
          (line: any) => String(line?.parent_article_id ?? "").trim() === articleId
        );
        const componentLines = lines.filter((line: any) => String(line?.component_sku_id ?? "").trim());
        const packagingLines = lines.filter((line: any) => {
          return String(line?.component_article_id ?? "").trim() && !String(line?.component_sku_id ?? "").trim();
        });

        let primary = 0;
        let overhead = 0;
        let excise = 0;
        let liters = asNumber(article?.content_liter ?? sku?.content_liter, 0);
        const linkedFormatIds = new Set<string>();

        componentLines.forEach((line: any) => {
          const qty = asNumber(line?.qty ?? line?.quantity, 1);
          const componentSku = skuById.get(String(line?.component_sku_id ?? "").trim());
          const productId = String(componentSku?.format_article_id ?? componentSku?.article_id ?? "").trim();
          if (productId) linkedFormatIds.add(productId);
          const summary = productId ? summaryByProductId.get(productId) : null;
          primary += asNumber((summary as any)?.primaire_kosten, 0) * qty;
          overhead += summaryOverheadValue(summary) * qty;
          excise += asNumber((summary as any)?.accijns, 0) * qty;
          if (!liters) {
            const componentArticle = articleById.get(productId);
            liters += asNumber(componentArticle?.content_liter ?? componentSku?.content_liter, 0) * qty;
          }
        });

        const packaging = packagingLines.reduce((sum, line: any) => {
          const componentId = String(line?.component_article_id ?? "").trim();
          const qty = asNumber(line?.qty ?? line?.quantity, 1);
          const componentArticle = articleById.get(componentId);
          const unitPrice =
            packagingPriceByComponent.get(componentId) ??
            asNumber(componentArticle?.prijs_per_stuk ?? componentArticle?.manual_rate_ex ?? componentArticle?.kostprijs ?? 0, 0);
          return sum + unitPrice * qty;
        }, 0);

        const label =
          String(sku?.name ?? "").trim() ||
          String(article?.name ?? article?.omschrijving ?? "").trim() ||
          String(sku?.id ?? "").trim();
        const unit = cleanFinalUnitLabel(
          String(article?.name ?? article?.omschrijving ?? sku?.packaging_type ?? label).trim(),
          beerName
        );
        return {
          id: String(sku?.id ?? articleId ?? label),
          biernaam: beerName,
          soort,
          verpakkingseenheid: unit,
          primaire_kosten: primary,
          verpakkingskosten: packaging,
          vaste_kosten: overhead,
          accijns: excise,
          kostprijs: primary + packaging + overhead + excise,
          liters,
          visibilityIds: [articleId, ...Array.from(linkedFormatIds)].filter(Boolean),
        };
      })
      .filter((row) => row.id);

    return rows.sort((a, b) => a.verpakkingseenheid.localeCompare(b.verpakkingseenheid, "nl-NL"));
  }

  function renderSummaryStep() {
    const snapshot = buildResultaatSnapshot(current);
    const basisRows = ((snapshot as any)?.producten?.basisproducten as any[]) ?? [];
    const compRows = ((snapshot as any)?.producten?.samengestelde_producten as any[]) ?? [];
    const allFormatIds = [
      ...basisRows.map((r) => String(r?.product_id ?? "").trim()),
      ...compRows.map((r) => String(r?.product_id ?? "").trim()),
    ].filter(Boolean);

    // Build deterministic mapping composite->basis and basis->composite from stamdata.
    const compositeToBase = new Map<string, string>();
    const baseToComposite = new Map<string, { id: string; score: number }[]>();
    (Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : []).forEach((row: any) => {
      const compositeId = String(row?.id ?? "").trim();
      if (!compositeId) return;
      const basisList = Array.isArray(row?.basisproducten) ? row.basisproducten : [];
      let bestBaseId = "";
      let bestScore = -1;
      for (const item of basisList) {
        const basisId = String(item?.basisproduct_id ?? "").trim();
        if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) continue;
        const score = Number(item?.aantal ?? 0) || 0;
        if (score > bestScore) {
          bestScore = score;
          bestBaseId = basisId;
        }
      }
      if (!bestBaseId) return;
      compositeToBase.set(compositeId, bestBaseId);
      const current = baseToComposite.get(bestBaseId) ?? [];
      current.push({ id: compositeId, score: bestScore });
      baseToComposite.set(bestBaseId, current);
    });
    const baseToPrimaryComposite = new Map<string, string>();
    for (const [baseId, items] of baseToComposite.entries()) {
      const sorted = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.id).localeCompare(String(b.id)));
      if (sorted[0]?.id) baseToPrimaryComposite.set(baseId, sorted[0].id);
    }

    const toggleFormat = (formatId: string, enabled: boolean) => {
      const fallbackAll = allFormatIds;
      const currentEnabled = enabledFormatIdsForUi ?? fallbackAll;
      const next = new Set(currentEnabled);
      const apply = (id: string) => {
        if (!id) return;
        if (enabled) next.add(id);
        else next.delete(id);
      };

      apply(formatId);
      // Linked toggles: samengesteld ↔ basis (when relation exists).
      const baseId = compositeToBase.get(formatId);
      if (baseId) apply(baseId);
      const compositeId = baseToPrimaryComposite.get(formatId);
      if (compositeId) apply(compositeId);

      updateCurrent((draft) => {
        (draft as any).enabled_format_ids = Array.from(next);
      });
    };

    return (
      <SummaryStep
        current={current}
        buildResultaatSnapshot={buildResultaatSnapshot}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        enabledFormatIds={enabledFormatIdsForUi ?? allFormatIds}
        onToggleFormat={toggleFormat}
      />
    );
  }

  function renderFinalSummaryStep() {
    const skuOverview = buildSellableSkuOverview();
    const variantCostRows = buildVariantCostRows();
    const variantVisibilityFallbackIds = variantCostRows.flatMap((row) => row.visibilityIds ?? []);
    const firstTimeProductIds = new Set(buildFirstTimeActivationProductIds());
    const finalizedInvoiceVersion =
      isInvoiceVersionMode && String((current as any)?.status ?? "").trim().toLowerCase() === "definitief";
    const mappedCount = skuOverview.filter((row) => row.mapped).length;
    const missingSkuCount = skuOverview.filter((row) => row.missingSku).length;
    const unmappedCount = skuOverview.filter((row) => !row.missingSku && !row.mapped).length;
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Eindcontrole</div>
          <div className="module-card-text">
            Controleer hieronder de kostprijs, aangemaakte verkoopbare varianten en Douano-koppelingen voordat je afrondt.
          </div>
          <div className="stats-grid wizard-stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="stat-label">Verkoopbare SKU's</div>
              <div className="stat-value small">{skuOverview.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Gekoppeld</div>
              <div className="stat-value small">{mappedCount} / {skuOverview.length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Ontbreekt</div>
              <div className="stat-value small">{missingSkuCount + unmappedCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Status</div>
              <div className="stat-value small">{missingSkuCount === 0 && unmappedCount === 0 && skuOverview.length > 0 ? "Compleet" : "Controle nodig"}</div>
            </div>
          </div>
        </div>

        {renderSummaryStep()}

        {variantCostRows.length > 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-title">Kostprijs verkoopbare varianten</div>
            <div className="module-card-text">
              Afgeleide varianten uit stap 5, berekend vanuit de basis-SKU plus eventuele verpakkingscomponenten.
            </div>
            <div className="data-table" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Zichtbaar</th>
                    <th>Biernaam</th>
                    <th>Soort</th>
                    <th>Verpakkingseenheid</th>
                    <th>Inkoop</th>
                    <th>Verpakkingskosten</th>
                    <th>Overhead (ABC)</th>
                    <th>Accijns</th>
                    <th>Kostprijs</th>
                  </tr>
                </thead>
                <tbody>
                  {variantCostRows.map((row) => {
                    const visibilityIds = (row.visibilityIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean);
                    const isEnabled = enabledFormatIdsForUi
                      ? visibilityIds.length > 0 && visibilityIds.every((id) => enabledFormatIdsForUi.includes(id))
                      : true;
                    return (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className={`visibility-toggle-button ${isEnabled ? "is-included" : "is-excluded"}`}
                            disabled={visibilityIds.length === 0}
                            title={
                              isEnabled
                                ? "Wordt geactiveerd en is zichtbaar/selecteerbaar in o.a. offertes."
                                : "Krijgt geen kostprijs en is niet selecteerbaar in o.a. offertes."
                            }
                            onClick={() => {
                              applyVisibilityToggle(visibilityIds, !isEnabled, variantVisibilityFallbackIds);
                            }}
                          >
                            <span className="visibility-toggle-icon">
                              {isEnabled ? <EyeIcon /> : <EyeOffIcon />}
                            </span>
                          </button>
                        </td>
                        <td>{row.biernaam || "-"}</td>
                        <td>{row.soort || "-"}</td>
                        <td>{row.verpakkingseenheid || "-"}</td>
                        <td>{formatCurrencyDisplay(row.primaire_kosten)}</td>
                        <td>{formatCurrencyDisplay(row.verpakkingskosten)}</td>
                        <td>{formatCurrencyDisplay(row.vaste_kosten)}</td>
                        <td>{formatCurrencyDisplay(row.accijns)}</td>
                        <td>{formatCurrencyDisplay(row.kostprijs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="module-card compact-card">
          <div className="module-card-title">Verkoopbare varianten en koppelingen</div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Bron</th>
                  <th>Douano product</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {skuOverview.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dataset-empty">
                      Nog geen verkoopbare SKU's aangemaakt.
                    </td>
                  </tr>
                ) : null}
                {skuOverview.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.label}</td>
                    <td>{row.source}</td>
                    <td>{row.douanoProductId || "-"}</td>
                    <td>
                      {row.missingSku ? (
                        <span className="status-pill status-warning">maak SKU in stap 5</span>
                      ) : !row.mapped ? (
                        <span className="status-pill status-warning">koppel in stap 6</span>
                      ) : isInvoiceVersionMode && firstTimeProductIds.has(String((row as any).productId ?? "")) ? (
                        <span className="status-pill status-warning">{finalizedInvoiceVersion ? "actief" : "nieuw, wordt actief"}</span>
                      ) : isInvoiceVersionMode ? (
                        <span className="status-pill status-ok">{finalizedInvoiceVersion ? "versie opgeslagen" : "wordt versie"}</span>
                      ) : row.mapped ? (
                        <span className="status-pill status-ok">gekoppeld</span>
                      ) : (
                        <span className="status-pill status-warning">controle nodig</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "type") return renderTypeStep();
    if (currentStep.id === "classificeren") return renderClassificatieStep();
    if (currentStep.id === "input") {
      const type = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
      return type === "Inkoop" ? renderInkoopInput() : renderEigenProductieInputModern();
    }
    if (currentStep.id === "facturen") return renderFacturenStep();
    if (currentStep.id === "kostprijs") return renderSummaryStep();
    if (currentStep.id === "varianten") return renderSellableVariantsStep();
    if (currentStep.id === "koppelen") return renderKoppelenStep();
    return renderFinalSummaryStep();
  }

  const headerBiernaam = String((current.basisgegevens as GenericRecord).biernaam ?? "").trim();
  const headerTitle = headerBiernaam || (isInvoiceVersionMode ? "Nieuwe inkoopfactuur" : "Nieuwe kostprijsberekening");
  const headerYear = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0)) || 0;
  const headerType = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const headerStatus = String(current.status ?? "concept");
  const headerActive = Boolean(current.is_actief);
  return (
    <div className="cpq-root">
      <div className="cpq-frame">
        <div className="cpq-topbar">
          <div>
            <div className="cpq-kicker">Kostprijswizard</div>
            <h1 className="cpq-title">{headerTitle}</h1>
          </div>
          <div className="cpq-topbar-actions">
            {onBackToLanding ? (
              <button type="button" className="editor-button editor-button-secondary" onClick={onBackToLanding}>
                Terug
              </button>
            ) : null}
            {isEditingExisting ? (
              <button
                type="button"
                className="icon-button-table"
                aria-label="Kostprijs verwijderen"
                aria-disabled={!canDeleteCurrent || isSaving}
                title={
                  !canDeleteCurrent
                    ? isCurrentDefinitive
                      ? "Definitieve kostprijsversies kun je niet verwijderen."
                      : "Deze kostprijsversie wordt nog gebruikt en kun je daarom niet verwijderen."
                    : "Verwijderen"
                }
                disabled={isSaving}
                onClick={() => {
                  if (!canDeleteCurrent) {
                    requestDelete(
                      "Kostprijs verwijderen niet mogelijk",
                      isCurrentDefinitive
                        ? "Definitieve kostprijsversies kun je niet verwijderen. Activeer een andere versie of maak een nieuwe conceptversie."
                        : "Deze kostprijsversie wordt nog gebruikt (bijv. door product-activaties) en kun je daarom niet verwijderen.",
                      () => {},
                      { confirmLabel: "Ok", hideCancel: true }
                    );
                    return;
                  }

                  requestDelete(
                    "Kostprijs verwijderen",
                    `Weet je zeker dat je de kostprijs voor ${String(
                      (current.basisgegevens as GenericRecord)?.biernaam ?? "dit bier"
                    )} wilt verwijderen? Dit kan alleen bij conceptversies.`,
                    () => {
                      void handleDeleteCurrent();
                    }
                  );
                }}
              >
                <TrashIcon />
              </button>
            ) : null}
            <span className="pill">
              {headerStatus}
              {headerActive ? " | actief" : ""}
            </span>
          </div>
        </div>

        <div className="cpq-grid cpq-grid-two">
          <aside className="cpq-left">
              <WizardSteps
                title="Stappen"
              steps={steps.map((step, index) => ({
                id: step.id,
                title: step.label,
                description: step.description,
                disabled: invoiceSourceMissing && index > 0,
              }))}
              activeIndex={currentIndex}
              onSelect={(index) => {
                if (invoiceSourceMissing && index > 0) return;
                setActiveStepIndex(index);
              }}
            />

          </aside>

          <main className="cpq-main">
            <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
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
                    {!viewOnly ? (
                      <>
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={handleSave}
                          disabled={invoiceSourceMissing || isSaving}
                        >
                          Opslaan
                        </button>
                        <button
                          type="button"
                          className="editor-button"
                          onClick={async () => {
                            if (invoiceSourceMissing) {
                              setStatus("Selecteer eerst een bestaande actieve kostprijs.");
                              setStatusTone("error");
                              return;
                            }
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
                      </>
                    ) : (
                      <button type="button" className="editor-button" onClick={onBackToLanding}>
                        Sluiten
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {status ? (
              <div className={`editor-status wizard-inline-status${statusTone ? ` ${statusTone}` : ""}`}>{status}</div>
            ) : null}
          </main>

        </div>

        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
              <div className="confirm-modal-title" id="confirm-title">
                {pendingDelete.title}
              </div>
              <div className="confirm-modal-text">{pendingDelete.body}</div>
              <div className="confirm-modal-actions">
                {!pendingDelete.hideCancel ? (
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setPendingDelete(null)}
                  >
                    {pendingDelete.cancelLabel ?? "Annuleren"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingDelete.onConfirm();
                    setPendingDelete(null);
                  }}
                >
                  {pendingDelete.confirmLabel ?? "Verwijderen"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


