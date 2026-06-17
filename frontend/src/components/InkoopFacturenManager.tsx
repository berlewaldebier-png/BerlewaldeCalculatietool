"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import { reconcileDatasetItems } from "@/lib/datasetItems";
import {
  cloneValue,
  normalizeFactuur,
  normalizeFactuurRegel,
} from "@/components/inkoopfacturen/inkoopFacturenUtils";
import { TrashIcon } from "@/components/inkoopfacturen/InkoopFacturenParts";
import { InkoopFactuurEditor } from "@/components/inkoopfacturen/InkoopFactuurEditor";
import { SellableVariantsStep, type CostProductCandidate } from "@/components/berekeningen/steps/SellableVariantsStep";
import { KoppelenStep } from "@/components/berekeningen/steps/KoppelenStep";
import { WizardSteps } from "@/components/WizardSteps";
import {
  loadArticles,
  loadBomLines,
  loadDouanoProductMappings,
  loadSkus,
  type DouanoProductMapping,
} from "@/components/berekeningen/berekeningenWizardIo";
import { makeBeerSkuLabel, normalizeUnitLabel } from "@/lib/skuLabels";
import {
  inferSkuType,
  normalizeBerekening,
  type GenericRecord,
} from "@/components/inkoopfacturen/inkoopFacturenManagerUtils";
import {
  calculateInkoopExtraKostenPerRegel,
  calculateInkoopPrijsPerEenheid,
  calculateInkoopPrijsPerLiter,
  createFactuurVersieFromSource,
  formatCurrency,
  formatCurrencyDisplay,
  formatDecimalValue,
  getFactuurRegelAfvulkostenFust,
  getFactuurRegelLiters,
  getFactuurTotals,
  getProductUnitOptions,
  getRecordYear,
  getInkoopFacturen,
  isConceptFactuurVersie,
  isDraftValid,
  isInkoopRecord,
  roundValue,
  sanitizeFacturen,
  setInkoopFacturen,
  type PendingAction,
} from "@/components/inkoopfacturen/inkoopFacturenManagerDerivations";

type InkoopFacturenManagerProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

type DraftMode = "new" | "edit";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function toDateInputValue(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const nlMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (nlMatch) {
    const day = nlMatch[1].padStart(2, "0");
    const month = nlMatch[2].padStart(2, "0");
    return `${nlMatch[3]}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summaryOverheadValue(row: any) {
  if (!row) return 0;
  const manufacturing = asNumber(row.manufacturing_overhead ?? row.productie_overhead, 0);
  const business = asNumber(row.business_overhead ?? row.vaste_kosten, 0);
  const total = asNumber(row.vaste_kosten, manufacturing + business);
  return total;
}

function cleanFinalUnitLabel(label: unknown, beerName: unknown) {
  const raw = String(label ?? "").trim();
  const beer = String(beerName ?? "").trim();
  if (!raw || !beer) return raw;
  return raw
    .replace(new RegExp(`^${beer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i"), "")
    .trim();
}

function productIdOf(row: GenericRecord | null | undefined) {
  return String((row as any)?.id ?? (row as any)?.product_id ?? "").trim();
}

function productUnitLabel(row: GenericRecord | null | undefined) {
  return normalizeUnitLabel(
    String(
      (row as any)?.omschrijving ??
        (row as any)?.verpakkingseenheid ??
        (row as any)?.verpakking ??
        (row as any)?.name ??
        (row as any)?.label ??
        ""
    )
  );
}

function productLiters(row: GenericRecord | null | undefined) {
  return asNumber(
    (row as any)?.inhoud_per_eenheid_liter ??
      (row as any)?.totale_inhoud_liter ??
      (row as any)?.liters_per_product ??
      (row as any)?.content_liter,
    0
  );
}

function productPackagingCost(row: GenericRecord | null | undefined) {
  return asNumber(
    (row as any)?.verpakkingskosten ??
      (row as any)?.verpakkingskosten_per_eenheid ??
      (row as any)?.totale_verpakkingskosten,
    0
  );
}

type SelectedInvoiceProduct = {
  product: GenericRecord;
  productId: string;
  pricePerUnit: number;
  productType: "basis" | "samengesteld";
};

type ImpactedBundleRow = {
  skuId: string;
  articleId: string;
  label: string;
  componentLabels: string[];
  affectedComponentLabels: string[];
  hasActiveCost: boolean;
};


export function InkoopFacturenManager({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  skus,
  articles,
  bomLines,
  verpakkingstypen,
  packagingComponentPrices,
}: InkoopFacturenManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState<GenericRecord[]>(initial);
  const [selectedBeerKey, setSelectedBeerKey] = useState("");
  const [draftFactuur, setDraftFactuur] = useState<GenericRecord | null>(null);
  const [draftMode, setDraftMode] = useState<DraftMode>("new");
  const [draftVersionId, setDraftVersionId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingNewTargetKey, setPendingNewTargetKey] = useState<string>("");
  const [showNewTargetPicker, setShowNewTargetPicker] = useState(false);
  const [draftSourceKey, setDraftSourceKey] = useState<string>("");
  const [wizardStep, setWizardStep] = useState(1);
  const [localSkus, setLocalSkus] = useState<GenericRecord[]>(Array.isArray(skus) ? skus : []);
  const [localArticles, setLocalArticles] = useState<GenericRecord[]>(Array.isArray(articles) ? articles : []);
  const [localBomLines, setLocalBomLines] = useState<GenericRecord[]>(Array.isArray(bomLines) ? bomLines : []);
  const [douanoMappings, setDouanoMappings] = useState<DouanoProductMapping[]>([]);
  const [draftResultaatSnapshot, setDraftResultaatSnapshot] = useState<GenericRecord | null>(null);

  const unitOptions = useMemo(
    () => getProductUnitOptions(basisproducten, samengesteldeProducten),
    [basisproducten, samengesteldeProducten]
  );
  const litersPerUnitById = useMemo(
    () => new Map(unitOptions.map((option) => [option.id, option.litersPerUnit])),
    [unitOptions]
  );

  const bierGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { key: string; biernaam: string; stijl: string; jaar: number; records: GenericRecord[] }
    >();

    rows
      .filter((row) => isInkoopRecord(row))
      .forEach((row) => {
        const basis = (row.basisgegevens as GenericRecord) ?? {};
        const skuType = inferSkuType(row, basis);
        const baseKey = String(row.bier_id ?? "").trim() || String(basis.biernaam ?? "").trim();
        const key = `${skuType}::${baseKey}::${getRecordYear(row)}`;
        const current = grouped.get(key);
        const next = current ?? {
          key,
          biernaam: String(basis.biernaam ?? "Onbekend item"),
          stijl: String(basis.stijl ?? ""),
          jaar: getRecordYear(row),
          records: []
        };
        next.records.push(normalizeBerekening(row));
        grouped.set(key, next);
      });

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort((left, right) =>
          String(right.aangepast_op ?? right.updated_at ?? "").localeCompare(
            String(left.aangepast_op ?? left.updated_at ?? "")
          )
        )
      }))
      .sort((left, right) => {
        const bierCompare = left.biernaam.localeCompare(right.biernaam, "nl-NL");
        if (bierCompare !== 0) {
          return bierCompare;
        }
        return right.jaar - left.jaar;
      });
  }, [rows]);

  const selectedGroup = bierGroups.find((group) => group.key === selectedBeerKey) ?? null;

  const selectedActiveRecord =
    selectedGroup?.records.find(
      (row) => String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
    ) ??
    selectedGroup?.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
    null;

  const editingRecord =
    draftMode === "edit" && draftVersionId
      ? rows.find((row) => String(row.id ?? "") === String(draftVersionId))
      : null;
  const editingStatus = String((editingRecord as any)?.status ?? "").toLowerCase();
  const canEditDraft = Boolean(draftFactuur) && editingStatus !== "definitief";
  const draftContextRecord = draftMode === "edit" ? editingRecord : selectedActiveRecord ?? null;
  const draftBasis = ((draftContextRecord as any)?.basisgegevens ?? {}) as GenericRecord;
  const draftBeerName = String(draftBasis.biernaam ?? selectedGroup?.biernaam ?? "").trim();
  const draftStyle = String(draftBasis.stijl ?? selectedGroup?.stijl ?? "").trim();
  const draftYear = draftContextRecord ? getRecordYear(draftContextRecord) : selectedGroup?.jaar ?? 0;

  const wizardSteps = [
    { id: 1, label: "Factuurdetails", text: "Kies bron en LOT" },
    { id: 2, label: "Factuurregels", text: "Selecteer afvuleenheden" },
    { id: 3, label: "Kostenverdeling", text: "Controleer toeslag per regel" },
    { id: 4, label: "Preview versies", text: "Nieuw versus actief" },
    { id: 5, label: "Verkoopbare SKU's", text: "Maak nieuwe SKU's" },
    { id: 6, label: "Koppelen", text: "Koppel Douano" },
    { id: 7, label: "Samenvatting", text: "Afronden" },
  ];

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function requestAction(next: PendingAction) {
    setPendingAction(next);
  }

  function getActiveRecordForGroup(group: { records: GenericRecord[] }) {
    return (
      group.records.find(
        (row) => String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
      ) ??
      group.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
      null
    );
  }

  function startNewFactuurWizard() {
    setDraftMode("new");
    setDraftVersionId("");
    setDraftSourceKey(selectedGroup?.key ?? "");
    setDraftFactuur(normalizeFactuur({ factuurregels: [normalizeFactuurRegel()] }));
    setWizardStep(1);
    setStatus("");
  }

  function startDraftForRecord(sourceRecord: GenericRecord | null, sourceKey?: string) {
    if (!sourceRecord) {
      return;
    }
    setDraftMode("new");
    setDraftVersionId("");
    setDraftSourceKey(String(sourceKey ?? selectedBeerKey ?? ""));
    setDraftFactuur(
      normalizeFactuur({
        factuurregels: [normalizeFactuurRegel()]
      })
    );
    setWizardStep(1);
    setStatus("");
  }

  function changeDraftTarget(groupKey: string) {
    const nextKey = String(groupKey ?? "");
    setSelectedBeerKey(nextKey);
    setDraftSourceKey(nextKey);
    setStatus("");
  }

  function openExistingFactuurVersie(record: GenericRecord) {
    const facturen = getInkoopFacturen(record);
    const primary = facturen[0] ?? normalizeFactuur({ factuurregels: [normalizeFactuurRegel()] });
    setDraftMode("edit");
    setDraftVersionId(String(record.id ?? ""));
    setDraftFactuur(normalizeFactuur(primary));
    setWizardStep(1);
    setStatus("");
  }

  function updateDraftField(key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    setDraftFactuur({
      ...draftFactuur,
      [key]: value
    });
  }

  function updateDraftRegel(rowId: string, key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.map((regel) => {
        if (String(regel.id) !== rowId) {
          return regel;
        }
        const nextRegel = { ...regel, [key]: value };
        const aantal = Number(nextRegel.aantal ?? 0);
        const litersPerUnit = litersPerUnitById.get(String(nextRegel.eenheid ?? "").trim()) ?? 0;
        if (litersPerUnit > 0 && aantal > 0) {
          nextRegel.liters = Number((aantal * litersPerUnit).toFixed(6));
        } else if (key === "eenheid" || key === "aantal") {
          nextRegel.liters = 0;
        }
        return nextRegel;
      })
    });
  }

  function updateDraftRegelPatch(rowId: string, patch: Record<string, unknown>) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.map((regel) => {
        if (String(regel.id) !== rowId) {
          return regel;
        }
        const nextRegel = { ...regel, ...patch };
        const aantal = Number(nextRegel.aantal ?? 0);
        const litersPerUnit = litersPerUnitById.get(String(nextRegel.eenheid ?? "").trim()) ?? 0;
        if (litersPerUnit > 0 && aantal > 0) {
          nextRegel.liters = Number((aantal * litersPerUnit).toFixed(6));
        } else if ("eenheid" in patch || "aantal" in patch) {
          nextRegel.liters = 0;
        }
        return nextRegel;
      })
    });
  }

  function addDraftRegel() {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: [...regels, normalizeFactuurRegel()]
    });
  }

  function removeDraftRegel(rowId: string) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.filter((regel) => String(regel.id) !== rowId)
    });
  }

  function cancelDraft() {
    setDraftFactuur(null);
    setDraftVersionId("");
    setDraftMode("new");
    setDraftSourceKey("");
    setWizardStep(1);
    setStatus("");
  }

  async function refreshLocalProductModel() {
    const [nextSkus, nextArticles, nextBomLines] = await Promise.all([
      loadSkus(),
      loadArticles(),
      loadBomLines(),
    ]);
    setLocalSkus(Array.isArray(nextSkus) ? nextSkus : []);
    setLocalArticles(Array.isArray(nextArticles) ? nextArticles : []);
    setLocalBomLines(Array.isArray(nextBomLines) ? nextBomLines : []);
  }

  async function refreshDouanoMappings() {
    try {
      const mappings = await loadDouanoProductMappings(10000);
      setDouanoMappings(Array.isArray(mappings) ? mappings : []);
    } catch {
      setDouanoMappings([]);
    }
  }

  useEffect(() => {
    void refreshDouanoMappings();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshDraftSnapshot() {
      if (!draftFactuur || !selectedActiveRecord) {
        setDraftResultaatSnapshot(null);
        return;
      }
      try {
        const draftRecord = createFactuurVersieFromSource(selectedActiveRecord, normalizeFactuur(draftFactuur));
        const snapshot = await computeInkoopSnapshotForRecord(normalizeBerekening(draftRecord));
        if (!cancelled) setDraftResultaatSnapshot(snapshot as GenericRecord);
      } catch {
        if (!cancelled) setDraftResultaatSnapshot(null);
      }
    }
    void refreshDraftSnapshot();
    return () => {
      cancelled = true;
    };
  }, [draftFactuur, selectedActiveRecord, basisproducten, samengesteldeProducten]);

  function unitLabelById(unitId: string) {
    return unitOptions.find((option) => option.id === unitId)?.label || unitId;
  }

  function buildSelectedInvoiceProducts(factuur: GenericRecord): SelectedInvoiceProduct[] {
    const basisById = new Set(
      basisproducten.map((row) => productIdOf(row)).filter(Boolean)
    );
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
        : 0;
    const grouped = new Map<string, SelectedInvoiceProduct>();

    regels.forEach((regel) => {
      const productId = String(regel.eenheid ?? "").trim();
      if (!productId) return;
      const option = unitOptions.find((candidate) => candidate.id === productId);
      const source = (option as any)?.source as GenericRecord | undefined;
      if (!source) return;
      const pricePerUnit = calculateInkoopPrijsPerEenheid(regel, extraPerRegel);
      const existing = grouped.get(productId);
      const productType: "basis" | "samengesteld" = basisById.has(productId) ? "basis" : "samengesteld";
      if (!existing || pricePerUnit > existing.pricePerUnit) {
        grouped.set(productId, {
          product: source,
          productId,
          pricePerUnit,
          productType,
        });
      }
    });

    return [...grouped.values()];
  }

  function expandSelectedInvoiceProducts(selectedProducts: SelectedInvoiceProduct[]) {
    const basisById = new Map(
      basisproducten
        .map((row) => [productIdOf(row), row] as const)
        .filter(([id]) => Boolean(id))
    );
    const expanded: SelectedInvoiceProduct[] = [];
    const seen = new Set<string>();

    selectedProducts.forEach((item) => {
      if (!item.productId || seen.has(item.productId)) return;
      expanded.push(item);
      seen.add(item.productId);

      const onderdelen = Array.isArray((item.product as any)?.basisproducten)
        ? ((item.product as any).basisproducten as GenericRecord[])
        : [];
      onderdelen.forEach((onderdeel) => {
        const basisId = String((onderdeel as any)?.basisproduct_id ?? "").trim();
        const basisproduct = basisById.get(basisId);
        const aantal = asNumber((onderdeel as any)?.aantal, 0);
        if (!basisproduct || !basisId || seen.has(basisId) || aantal <= 0) return;
        expanded.push({
          product: basisproduct,
          productId: basisId,
          productType: "basis",
          pricePerUnit: item.pricePerUnit / aantal,
        });
        seen.add(basisId);
      });
    });

    return expanded;
  }

  function buildDraftCostProductCandidates(): CostProductCandidate[] {
    if (!draftFactuur) return [];
    const seen = new Set<string>();
    const rows: CostProductCandidate[] = [];
    const selected = expandSelectedInvoiceProducts(buildSelectedInvoiceProducts(draftFactuur));

    selected.forEach((item) => {
      if (!item.productId || seen.has(item.productId)) return;
      seen.add(item.productId);
      const normalizedLabel = productUnitLabel(item.product) || item.productId;
      const liters = productLiters(item.product);
      rows.push({
        id: `invoice-${item.productId}`,
        productId: item.productId,
        productType: item.productType,
        label: makeBeerSkuLabel(draftBeerName, normalizedLabel),
        liters,
        kindLabel: item.productType === "basis" ? "Basisproduct" : "Samengesteld",
      });
    });
    return rows;
  }

  function buildImpactedBundleRows(): ImpactedBundleRow[] {
    if (!draftFactuur) return [];
    const selectedProducts = expandSelectedInvoiceProducts(buildSelectedInvoiceProducts(draftFactuur));
    const changedProductIds = new Set(selectedProducts.map((item) => item.productId).filter(Boolean));
    if (changedProductIds.size === 0) return [];

    const articleById = new Map<string, GenericRecord>();
    (Array.isArray(localArticles) ? localArticles : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) articleById.set(id, row);
    });

    const skuById = new Map<string, GenericRecord>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) skuById.set(id, row);
    });

    const changedSkuIds = new Set<string>();
    skuById.forEach((sku, skuId) => {
      const kind = String((sku as any)?.kind ?? "").trim().toLowerCase();
      const formatArticleId = String((sku as any)?.format_article_id ?? (sku as any)?.article_id ?? "").trim();
      const skuBeerId = String((sku as any)?.beer_id ?? "").trim();
      const recordBeerId = String((draftContextRecord as any)?.bier_id ?? "").trim();
      if (kind !== "beer_format") return;
      if (recordBeerId && skuBeerId && skuBeerId !== recordBeerId) return;
      if (formatArticleId && changedProductIds.has(formatArticleId)) {
        changedSkuIds.add(skuId);
      }
    });
    if (changedSkuIds.size === 0) return [];

    const activeBundleSkuIds = new Set<string>();
    rows.forEach((row) => {
      const statusValue = String((row as any)?.status ?? "").trim().toLowerCase();
      if (statusValue !== "definitief") return;
      const basis = ((row as any)?.basisgegevens ?? {}) as GenericRecord;
      const skuId = String((basis as any)?.sku_id ?? (row as any)?.sku_id ?? "").trim();
      const type = String((row as any)?.type ?? "").trim().toLowerCase();
      if (skuId && (type === "bundle" || type === "article")) {
        activeBundleSkuIds.add(skuId);
      }
    });

    const rowsByParentArticle = new Map<string, GenericRecord[]>();
    (Array.isArray(localBomLines) ? localBomLines : []).forEach((line) => {
      const parentArticleId = String((line as any)?.parent_article_id ?? "").trim();
      if (!parentArticleId) return;
      const list = rowsByParentArticle.get(parentArticleId) ?? [];
      list.push(line);
      rowsByParentArticle.set(parentArticleId, list);
    });

    const impacted = new Map<string, ImpactedBundleRow>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((sku) => {
      const skuId = String((sku as any)?.id ?? "").trim();
      const kind = String((sku as any)?.kind ?? "").trim().toLowerCase();
      const articleId = String((sku as any)?.article_id ?? "").trim();
      if (!skuId || kind !== "article" || !articleId) return;

      const article = articleById.get(articleId) ?? null;
      const productGroup = String(
        (sku as any)?.product_group ?? (article as any)?.product_group ?? ""
      ).trim().toLowerCase();
      if (productGroup && productGroup !== "giftset") return;

      const composition = rowsByParentArticle.get(articleId) ?? [];
      const componentSkuIds = composition
        .map((line) => String((line as any)?.component_sku_id ?? "").trim())
        .filter(Boolean);
      const affected = componentSkuIds.filter((componentSkuId) => changedSkuIds.has(componentSkuId));
      if (affected.length === 0) return;

      const componentLabels = componentSkuIds.map((componentSkuId) => {
        const componentSku = skuById.get(componentSkuId) ?? null;
        return String((componentSku as any)?.name ?? componentSkuId).trim();
      });
      const affectedComponentLabels = affected.map((componentSkuId) => {
        const componentSku = skuById.get(componentSkuId) ?? null;
        return String((componentSku as any)?.name ?? componentSkuId).trim();
      });
      const label =
        String((article as any)?.name ?? (article as any)?.omschrijving ?? "").trim() ||
        String((sku as any)?.name ?? "").trim() ||
        skuId;

      impacted.set(skuId, {
        skuId,
        articleId,
        label,
        componentLabels,
        affectedComponentLabels,
        hasActiveCost: activeBundleSkuIds.has(skuId),
      });
    });

    return [...impacted.values()].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }

  function buildWizardCurrentRecord() {
    const source = cloneValue(draftContextRecord ?? selectedActiveRecord ?? {});
    source.bier_id = String((draftContextRecord as any)?.bier_id ?? (selectedActiveRecord as any)?.bier_id ?? "");
    source.basisgegevens = {
      ...(((source as any).basisgegevens ?? {}) as GenericRecord),
      biernaam: draftBeerName,
      stijl: draftStyle,
      jaar: draftYear,
    };
    return source;
  }

  async function computeInkoopSnapshotForRecord(record: GenericRecord) {
    const year = getRecordYear(record);
    const basis = (record.basisgegevens as GenericRecord) ?? {};

    const [productieResp, vasteKostenResp, tarievenResp] = await Promise.all([
      fetch(`${API_BASE_URL}/data/productie`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/data/vaste-kosten`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/data/tarieven-heffingen`, { cache: "no-store" })
    ]);

    const productiePayload = productieResp.ok ? ((await productieResp.json()) as any) : {};
    const productie =
      productiePayload && typeof productiePayload === "object" && "data" in productiePayload
        ? (productiePayload.data as Record<string, GenericRecord>)
        : (productiePayload as Record<string, GenericRecord>);

    const vasteKostenPayload = vasteKostenResp.ok ? ((await vasteKostenResp.json()) as any) : {};
    const vasteKosten =
      vasteKostenPayload && typeof vasteKostenPayload === "object" && "data" in vasteKostenPayload
        ? (vasteKostenPayload.data as Record<string, GenericRecord[]>)
        : (vasteKostenPayload as Record<string, GenericRecord[]>);

    const tarievenPayload = tarievenResp.ok ? ((await tarievenResp.json()) as any) : [];
    const tarievenHeffingen = Array.isArray(tarievenPayload)
      ? (tarievenPayload as GenericRecord[])
      : Array.isArray(tarievenPayload?.data)
        ? (tarievenPayload.data as GenericRecord[])
        : [];

    const clampPct = (value: unknown) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.min(100, Math.max(0, parsed));
    };

    const rowsForYear = Array.isArray(vasteKosten[String(year)]) ? vasteKosten[String(year)] : [];
    const directRows = rowsForYear.filter((row) => {
      const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
      return normalized.includes("direct") && !normalized.includes("indirect");
    });
    const indirectRows = rowsForYear.filter((row) =>
      String(row.kostensoort ?? "").trim().toLowerCase().includes("indirect")
    );

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
    const indirectAfter = indirectBase - indirectOut + directOut;

    const productieGegevens = (productie[String(year)] as GenericRecord | undefined) ?? {};
    const deler = Number(productieGegevens.hoeveelheid_inkoop_l ?? 0);
    const vasteKostenPerLiter = deler > 0 ? indirectAfter / deler : 0;

    const facturen = getInkoopFacturen(record);
    const factuur = facturen[0] ?? normalizeFactuur();
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0)) / regels.length
        : 0;

    const totals = regels.reduce<{ liters: number; bedrag: number }>(
      (acc, regel) => {
        const liters = Number(regel.liters ?? 0);
        const bedrag = Number(regel.subfactuurbedrag ?? 0) + extraPerRegel + getFactuurRegelAfvulkostenFust(regel);
        return { liters: acc.liters + liters, bedrag: acc.bedrag + bedrag };
      },
      { liters: 0, bedrag: 0 }
    );
    const variabeleKostenPerLiter = totals.liters > 0 ? totals.bedrag / totals.liters : 0;

    const tarieven = tarievenHeffingen.find((row) => Number(row.jaar ?? 0) === year) ?? {};
    const belastingsoort = String(basis.belastingsoort ?? "").trim().toLowerCase();
    const alcoholpercentage = Number(basis.alcoholpercentage ?? 0) / 100;
    const tariefAccijns = String(basis.tarief_accijns ?? "").trim().toLowerCase();
    const tarief =
      tariefAccijns === "laag" ? Number((tarieven as any).tarief_laag ?? 0) : Number((tarieven as any).tarief_hoog ?? 0);

    const activeCostByProductId = new Map<string, GenericRecord>();
    const addActiveCost = (row: GenericRecord) => {
      const id = productIdOf(row);
      if (id && !activeCostByProductId.has(id)) {
        activeCostByProductId.set(id, row);
      }
    };
    if (Array.isArray((record as any)?.cost_lines)) {
      ((record as any).cost_lines as GenericRecord[]).forEach(addActiveCost);
    }
    const sourceSnapshot = (record as any)?.resultaat_snapshot as GenericRecord | undefined;
    const sourceBasisRows = Array.isArray((sourceSnapshot as any)?.producten?.basisproducten)
      ? ((sourceSnapshot as any).producten.basisproducten as GenericRecord[])
      : [];
    const sourceComposedRows = Array.isArray((sourceSnapshot as any)?.producten?.samengestelde_producten)
      ? ((sourceSnapshot as any).producten.samengestelde_producten as GenericRecord[])
      : [];
    [...sourceBasisRows, ...sourceComposedRows].forEach(addActiveCost);

    const selectedProducts = expandSelectedInvoiceProducts(buildSelectedInvoiceProducts(factuur));

    const computeExcise = (liters: number) => {
      if (belastingsoort === "verbruiksbelasting") {
        return Number((tarieven as any).verbruikersbelasting ?? 0) * (liters / 100);
      }
      return tarief * alcoholpercentage * liters;
    };

    const summaryRows = selectedProducts.map((item) => {
      const activeCost = activeCostByProductId.get(item.productId);
      const liters = productLiters(item.product);
      const verpakkingseenheid = productUnitLabel(item.product);
      const primary = item.pricePerUnit;
      const packaging = activeCost ? asNumber((activeCost as any)?.verpakkingskosten, 0) : productPackagingCost(item.product);
      const overhead = activeCost ? summaryOverheadValue(activeCost) : vasteKostenPerLiter * liters;
      const excise = activeCost ? asNumber((activeCost as any)?.accijns, 0) : computeExcise(liters);
      return {
        id: item.productId,
        product_id: item.productId,
        product_type: item.productType,
        verpakkingseenheid,
        liters_per_product: liters,
        primaire_kosten: primary,
        verpakkingskosten: packaging,
        vaste_kosten: overhead,
        accijns: excise,
        kostprijs: primary + packaging + overhead + excise
      } as GenericRecord;
    });

    const basisRows = summaryRows.filter((row) => String((row as any).product_type ?? "") === "basis");
    const samengesteldRows = summaryRows.filter((row) => String((row as any).product_type ?? "") === "samengesteld");

    return {
      integrale_kostprijs_per_liter: Number((variabeleKostenPerLiter + vasteKostenPerLiter).toFixed(6)),
      variabele_kosten_per_liter: Number(variabeleKostenPerLiter.toFixed(6)),
      directe_vaste_kosten_per_liter: Number(vasteKostenPerLiter.toFixed(6)),
      producten: {
        basisproducten: basisRows,
        samengestelde_producten: samengesteldRows
      }
    };
  }

  async function saveDraft() {
    if (!draftFactuur || !selectedActiveRecord) {
      return;
    }

    setStatus("");
    setIsSaving(true);
    try {
      const normalizedDraft = normalizeFactuur(draftFactuur);

      const groupRecords =
        selectedGroup?.records.filter((row) => String(row.brontype ?? "").toLowerCase() === "factuur") ??
        [];
      const maxVersion = groupRecords.reduce((max, row) => Math.max(max, Number(row.versie_nummer ?? 0) || 0), 0);

      const existingConceptForGroup =
        rows.find(
          (row) =>
            String(row.bier_id ?? "") === String(selectedActiveRecord.bier_id ?? "") &&
            getRecordYear(row) === getRecordYear(selectedActiveRecord) &&
            String(row.brontype ?? "").toLowerCase() === "factuur" &&
            isConceptFactuurVersie(row)
        ) ?? null;

      const nextVersion =
        (draftMode === "edit" && draftVersionId) || (existingConceptForGroup && !draftVersionId)
          ? (() => {
              const effectiveId = String(draftVersionId || existingConceptForGroup?.id || "");
              const existing =
                rows.find((row) => String(row.id ?? "") === effectiveId) ??
                (existingConceptForGroup && String(existingConceptForGroup.id ?? "") === effectiveId
                  ? existingConceptForGroup
                  : null);
              const updated = existing ? cloneValue(existing) : createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
              updated.id = effectiveId || String(updated.id ?? "");
              updated.status = "concept";
              updated.updated_at = new Date().toISOString();
              updated.aangepast_op = updated.updated_at;
              setInkoopFacturen(updated, [normalizedDraft]);
              return normalizeBerekening(updated);
            })()
          : (() => {
              const created = createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
              created.versie_nummer = maxVersion + 1;
              return normalizeBerekening(created);
            })();
      const cleanedRows = rows
        // Always drop the prior version when saving; we'll re-add the normalized `nextVersion`.
        .filter((row) => String(row.id ?? "") !== String(nextVersion.id ?? ""))
        .filter(
          (row) =>
            !(
              String(row.bier_id ?? "") === String(selectedActiveRecord.bier_id ?? "") &&
              getRecordYear(row) === getRecordYear(selectedActiveRecord) &&
              isConceptFactuurVersie(row) &&
              (draftMode !== "edit" || String(row.id ?? "") !== String(draftVersionId))
            )
        )
        .concat(nextVersion)
        .map((row) => normalizeBerekening(row))
        .filter((row) => !isConceptFactuurVersie(row) || sanitizeFacturen(getInkoopFacturen(row)).length > 0);

      await reconcileDatasetItems("kostprijsversies", cleanedRows);

      setRows(cleanedRows);
      setDraftMode("edit");
      setDraftVersionId(String(nextVersion.id ?? ""));
      setStatus("Factuurversie opgeslagen.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Opslaan mislukt: ${message}` : "Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function finalizeDraft() {
    if (!draftFactuur || !selectedActiveRecord) {
      return;
    }
    if (!isDraftValid(draftFactuur)) {
      setStatus("Vul eerst alle verplichte velden in voordat je afrondt.");
      return;
    }

    setStatus("");
    setIsSaving(true);
    try {
      const normalizedDraft = normalizeFactuur(draftFactuur);
      const nowIso = new Date().toISOString();

      async function readResponseError(response: Response): Promise<string> {
        try {
          const text = await response.text();
          if (!text) {
            return `HTTP ${response.status}`;
          }
          try {
            const parsed = JSON.parse(text) as any;
            const detail = typeof parsed?.detail === "string" ? parsed.detail : null;
            return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}: ${text}`;
          } catch {
            return `HTTP ${response.status}: ${text}`;
          }
        } catch {
          return `HTTP ${response.status}`;
        }
      }

      const base =
        draftMode === "edit" && draftVersionId
          ? rows.find((row) => String(row.id ?? "") === String(draftVersionId))
          : null;

      const groupRecords =
        selectedGroup?.records.filter((row) => String(row.brontype ?? "").toLowerCase() === "factuur") ??
        [];
      const maxVersion = groupRecords.reduce((max, row) => Math.max(max, Number(row.versie_nummer ?? 0) || 0), 0);

      const nextVersion = base ? cloneValue(base) : createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
      if (!base) {
        nextVersion.versie_nummer = maxVersion + 1;
      }
      nextVersion.status = "definitief";
      nextVersion.finalized_at = nowIso;
      nextVersion.updated_at = nowIso;
      nextVersion.aangepast_op = nowIso;
      nextVersion.effectief_vanaf = nowIso;
      setInkoopFacturen(nextVersion, [normalizedDraft]);
      nextVersion.resultaat_snapshot = await computeInkoopSnapshotForRecord(normalizeBerekening(nextVersion));

      const cleanedRows = rows
        .filter((row) => String(row.id ?? "") !== String(nextVersion.id ?? ""))
        .concat(normalizeBerekening(nextVersion))
        .map((row) => normalizeBerekening(row));

      await reconcileDatasetItems("kostprijsversies", cleanedRows);

      setRows(cleanedRows);
      setDraftFactuur(null);
      setDraftVersionId("");
      setDraftMode("new");
      setDraftSourceKey("");
      setStatus("Factuurversie afgerond als definitief.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Afronden mislukt: ${message}` : "Afronden mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteDraftVersion(versionId: string) {
    if (!versionId) return;

    setStatus("");
    setIsSaving(true);
    try {
      const cleanedRows = rows
        .filter((row) => String(row.id ?? "") !== String(versionId))
        .map((row) => normalizeBerekening(row));

      await reconcileDatasetItems("kostprijsversies", cleanedRows);

      setRows(cleanedRows);
      setDraftFactuur(null);
      setDraftVersionId("");
      setDraftMode("new");
      setDraftSourceKey("");
      setStatus("Conceptversie verwijderd.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(message ? `Verwijderen mislukt: ${message}` : "Verwijderen mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  function renderFactuurDetailsStep() {
    if (!draftFactuur) return null;
    const activeVersionLabel = selectedActiveRecord
      ? `v${Number((selectedActiveRecord as any).versie_nummer ?? 0) || 1} - ${String(
          (selectedActiveRecord as any).brontype ?? "kostprijs"
        )}${Boolean((selectedActiveRecord as any).is_actief) ? " - actief" : ""}`
      : "-";
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Basisgegevens</div>
          <div className="module-card-text">
            Kies voor welk bestaand bier je een nieuwe inkoopfactuur toevoegt. De actieve kostprijs wordt alleen als bron gelezen.
          </div>
          <label className="nested-field" style={{ marginTop: 12 }}>
            <span>Bier</span>
            <select
              className="dataset-input"
              value={selectedBeerKey}
              disabled={!canEditDraft || draftMode === "edit"}
              onChange={(event) => changeDraftTarget(event.target.value)}
            >
              <option value="">Selecteer bestaand bier...</option>
              {bierGroups.map((group) => (
                <option key={group.key} value={group.key}>
                  {`${group.biernaam} - ${group.jaar}${group.stijl ? ` - ${group.stijl}` : ""}`}
                </option>
              ))}
            </select>
          </label>
          {!selectedActiveRecord ? (
            <div className="inline-warning" style={{ marginTop: 12 }}>
              Selecteer eerst een bier met een actieve kostprijs voordat je factuurregels toevoegt.
            </div>
          ) : null}
          <div className="wizard-form-grid" style={{ marginTop: 12 }}>
            <label className="nested-field">
              <span>Bier</span>
              <input className="dataset-input dataset-input-readonly" value={draftBeerName || "-"} readOnly />
            </label>
            <label className="nested-field">
              <span>Stijl</span>
              <input className="dataset-input dataset-input-readonly" value={draftStyle || "-"} readOnly />
            </label>
            <label className="nested-field">
              <span>Jaar</span>
              <input className="dataset-input dataset-input-readonly" value={String(draftYear || "-")} readOnly />
            </label>
            <label className="nested-field">
              <span>Actieve bron</span>
              <input className="dataset-input dataset-input-readonly" value={activeVersionLabel} readOnly />
            </label>
          </div>
        </div>
        <div className="wizard-form-grid">
          <label className="nested-field">
            <span>Factuurnummer</span>
            <input
              className="dataset-input"
              value={String(draftFactuur.factuurnummer ?? "")}
              readOnly={!canEditDraft}
              onChange={(event) => updateDraftField("factuurnummer", event.target.value)}
            />
          </label>
          <label className="nested-field">
            <span>Factuurdatum</span>
            <input
              className="dataset-input"
              type="date"
              lang="nl-NL"
              value={toDateInputValue(draftFactuur.factuurdatum)}
              max={new Date().toISOString().slice(0, 10)}
              readOnly={!canEditDraft}
              onChange={(event) => updateDraftField("factuurdatum", event.target.value)}
            />
          </label>
          <label className="nested-field">
            <span>LOT-nummer</span>
            <input
              className="dataset-input"
              value={String(draftFactuur.lotnummer ?? "")}
              readOnly={!canEditDraft}
              onChange={(event) => updateDraftField("lotnummer", event.target.value)}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderFactuurEditorStep() {
    if (!draftFactuur) return null;
    return (
      <InkoopFactuurEditor
        subjectType={
          (String(((draftContextRecord as any)?.basisgegevens ?? {})?.sku_type ?? "bier").trim() || "bier") as any
        }
        uom={String(((draftContextRecord as any)?.basisgegevens ?? {})?.uom ?? "stuk")}
        uomValue={
          (String(((draftContextRecord as any)?.basisgegevens ?? {})?.sku_type ?? "bier").trim() || "bier") === "bier"
            ? "stuk"
            : String(
                (Array.isArray(draftFactuur.factuurregels) && (draftFactuur.factuurregels as GenericRecord[])[0])
                  ? String(((draftFactuur.factuurregels as GenericRecord[])[0] as any)?.eenheid ?? "stuk")
                  : "stuk"
              )
        }
        onChangeUomValue={(nextUom) => {
          const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
          regels.forEach((regel) => {
            updateDraftRegel(String(regel.id), "eenheid", nextUom);
            updateDraftRegel(String(regel.id), "liters", 0);
            updateDraftRegel(String(regel.id), "afvulkosten_fust", null);
          });
        }}
        year={draftContextRecord ? getRecordYear(draftContextRecord) : 0}
        inkoop={draftFactuur}
        factuurregels={Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : []}
        unitOptions={unitOptions}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        canEdit={canEditDraft}
        onChangeInkoopField={(key, value) => updateDraftField(key, value)}
        onChangeRegel={(index, patch) => {
          const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
          const regel = regels[index];
          if (!regel) return;
          updateDraftRegelPatch(String(regel.id), patch as Record<string, unknown>);
        }}
        onDeleteRegel={(index) => {
          const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
          const regel = regels[index];
          if (!regel) return;
          removeDraftRegel(String(regel.id));
        }}
        onAddRegel={(regel) => {
          const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
          setDraftFactuur({
            ...draftFactuur,
            factuurregels: [...regels, normalizeFactuurRegel(regel)],
          });
        }}
        requestDelete={(title, body, onConfirm) => requestDelete(title, body, onConfirm)}
        getFactuurRegelLiters={(regel) => getFactuurRegelLiters(regel, litersPerUnitById)}
        formatCurrencyDisplay={formatCurrencyDisplay}
        formatDecimalValue={formatDecimalValue}
        calculateInkoopExtraKostenPerRegel={calculateInkoopExtraKostenPerRegel}
        calculateInkoopPrijsPerEenheid={calculateInkoopPrijsPerEenheid}
        calculateInkoopPrijsPerLiter={(regel, extraPer) =>
          calculateInkoopPrijsPerLiter(regel, extraPer, litersPerUnitById)
        }
        getFactuurRegelAfvulkostenFust={getFactuurRegelAfvulkostenFust}
      />
    );
  }

  function renderKostenverdelingStep() {
    if (!draftFactuur) return null;
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel = calculateInkoopExtraKostenPerRegel(draftFactuur, regels.length);
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Kostenverdeling</div>
          <div className="module-card-text">
            Extra kosten worden nu gelijk verdeeld per factuurregel. Dit is dezelfde logica als de huidige inkoopfactuur.
          </div>
          <div className="stats-grid wizard-stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card"><div className="stat-label">Verzendkosten</div><div className="stat-value small">{formatCurrencyDisplay(draftFactuur.verzendkosten)}</div></div>
            <div className="stat-card"><div className="stat-label">Overige kosten</div><div className="stat-value small">{formatCurrencyDisplay(draftFactuur.overige_kosten)}</div></div>
            <div className="stat-card"><div className="stat-label">Regels</div><div className="stat-value small">{regels.length}</div></div>
            <div className="stat-card"><div className="stat-label">Extra per regel</div><div className="stat-value small">{formatCurrencyDisplay(extraPerRegel)}</div></div>
          </div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Eenheid</th>
                <th>Aantal</th>
                <th>Liters</th>
                <th>Factuurbedrag</th>
                <th>Extra kosten</th>
                <th>Prijs per eenheid</th>
              </tr>
            </thead>
            <tbody>
              {regels.map((regel, index) => (
                <tr key={String(regel.id ?? index)}>
                  <td>{unitLabelById(String(regel.eenheid ?? ""))}</td>
                  <td>{Number(regel.aantal ?? 0).toLocaleString("nl-NL")}</td>
                  <td>{formatDecimalValue(getFactuurRegelLiters(regel, litersPerUnitById), 2)}</td>
                  <td>{formatCurrencyDisplay(regel.subfactuurbedrag)}</td>
                  <td>{formatCurrencyDisplay(extraPerRegel)}</td>
                  <td>{formatCurrencyDisplay(calculateInkoopPrijsPerEenheid(regel, extraPerRegel))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderPreviewStep() {
    const candidates = buildDraftCostProductCandidates();
    const activeLines = Array.isArray((selectedActiveRecord as any)?.cost_lines) ? ((selectedActiveRecord as any).cost_lines as GenericRecord[]) : [];
    const impactedBundles = buildImpactedBundleRows();
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Preview kostprijsversies</div>
          <div className="module-card-text">
            Bestaande artikelen krijgen een kandidaatversie. Nieuwe afvuleenheden worden na afronden als nieuw actief artikel toegevoegd.
          </div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Type</th>
                <th>Liter</th>
                <th>Huidige kostprijs</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => {
                const active = activeLines.find((line) => String((line as any).product_id ?? "") === row.productId);
                return (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.label}</td>
                    <td>{row.kindLabel}</td>
                    <td>{row.liters ? row.liters.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}</td>
                    <td>{active ? formatCurrencyDisplay((active as any).kostprijs) : "-"}</td>
                    <td>
                      {active ? (
                        <span className="status-pill status-warning">nieuwe kandidaatversie</span>
                      ) : (
                        <span className="status-pill status-ok">nieuw actief artikel</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="module-card compact-card">
          <div className="module-card-title">Geraakte geschenkverpakkingen</div>
          <div className="module-card-text">
            Deze samengestelde artikelen gebruiken een SKU uit deze factuur. Herberekenen gebeurt via de artikelkostprijswizard, zodat de giftset een eigen kandidaatversie krijgt op basis van actuele componentkostprijzen.
          </div>
          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Geschenkverpakking</th>
                  <th>Geraakte component</th>
                  <th>Samenstelling</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {impactedBundles.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={5}>
                      Geen geschenkverpakkingen geraakt door deze factuurregels.
                    </td>
                  </tr>
                ) : null}
                {impactedBundles.map((row) => (
                  <tr key={row.skuId}>
                    <td style={{ fontWeight: 700 }}>{row.label}</td>
                    <td>{row.affectedComponentLabels.join(", ") || "-"}</td>
                    <td>{row.componentLabels.join(", ") || "-"}</td>
                    <td>
                      <span className={`status-pill ${row.hasActiveCost ? "status-warning" : "status-ok"}`}>
                        {row.hasActiveCost ? "herberekening nodig" : "eerste kostprijs nodig"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a
                        className="editor-button editor-button-secondary"
                        href={`/nieuwe-kostprijsberekening?mode=wizard-new&kind=article&sku_id=${encodeURIComponent(row.skuId)}`}
                      >
                        Herberekenen
                      </a>
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

  function buildDraftVariantCostRows() {
    const snapshot = draftResultaatSnapshot ?? {};
    const basis = (buildWizardCurrentRecord().basisgegevens as GenericRecord) ?? {};
    const beerId = String((buildWizardCurrentRecord() as any)?.bier_id ?? (basis as any)?.bier_id ?? "").trim();
    const beerName = String((basis as any)?.biernaam ?? "").trim();
    const year = asNumber((basis as any)?.jaar, new Date().getFullYear());
    if (!beerId) return [];

    const summaryByProductId = new Map<string, GenericRecord>();
    ([...(((snapshot as any)?.producten?.basisproducten ?? []) as GenericRecord[]), ...(((snapshot as any)?.producten?.samengestelde_producten ?? []) as GenericRecord[])])
      .forEach((row) => {
        const productId = String((row as any)?.product_id ?? "").trim();
        if (productId) summaryByProductId.set(productId, row);
      });

    const articleById = new Map<string, GenericRecord>();
    (Array.isArray(localArticles) ? localArticles : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) articleById.set(id, row);
    });

    const skuById = new Map<string, GenericRecord>();
    (Array.isArray(localSkus) ? localSkus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) skuById.set(id, row);
    });

    const packagingPriceByComponent = new Map<string, number>();
    (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row) => {
      const componentId = String((row as any)?.verpakkingsonderdeel_id ?? (row as any)?.packaging_component_id ?? "").trim();
      const rowYear = asNumber((row as any)?.jaar, 0);
      if (!componentId || rowYear !== year) return;
      packagingPriceByComponent.set(componentId, asNumber((row as any)?.prijs_per_stuk, 0));
    });

    return (Array.isArray(localSkus) ? localSkus : [])
      .filter((sku) => {
        const kind = String((sku as any)?.kind ?? "").trim().toLowerCase();
        const skuBeerId = String((sku as any)?.beer_id ?? "").trim();
        return kind === "article" && skuBeerId === beerId;
      })
      .map((sku) => {
        const articleId = String((sku as any)?.article_id ?? "").trim();
        const article = articleId ? articleById.get(articleId) : null;
        const lines = (Array.isArray(localBomLines) ? localBomLines : []).filter(
          (line) => String((line as any)?.parent_article_id ?? "").trim() === articleId
        );
        const componentLines = lines.filter((line) => String((line as any)?.component_sku_id ?? "").trim());
        const packagingLines = lines.filter(
          (line) =>
            String((line as any)?.component_article_id ?? "").trim() &&
            !String((line as any)?.component_sku_id ?? "").trim()
        );

        let primary = 0;
        let overhead = 0;
        let excise = 0;
        let liters = asNumber((article as any)?.content_liter ?? (sku as any)?.content_liter, 0);

        componentLines.forEach((line) => {
          const qty = asNumber((line as any)?.qty ?? (line as any)?.quantity, 1);
          const componentSku = skuById.get(String((line as any)?.component_sku_id ?? "").trim());
          const productId = String((componentSku as any)?.format_article_id ?? (componentSku as any)?.article_id ?? "").trim();
          const summary = productId ? summaryByProductId.get(productId) : null;
          primary += asNumber((summary as any)?.primaire_kosten, 0) * qty;
          overhead += summaryOverheadValue(summary) * qty;
          excise += asNumber((summary as any)?.accijns, 0) * qty;
          if (!liters) {
            const componentArticle = productId ? articleById.get(productId) : null;
            liters += asNumber((componentArticle as any)?.content_liter ?? (componentSku as any)?.content_liter, 0) * qty;
          }
        });

        const packaging = packagingLines.reduce((sum, line) => {
          const componentId = String((line as any)?.component_article_id ?? "").trim();
          const qty = asNumber((line as any)?.qty ?? (line as any)?.quantity, 1);
          const componentArticle = articleById.get(componentId);
          const unitPrice =
            packagingPriceByComponent.get(componentId) ??
            asNumber((componentArticle as any)?.prijs_per_stuk ?? (componentArticle as any)?.manual_rate_ex ?? (componentArticle as any)?.kostprijs, 0);
          return sum + unitPrice * qty;
        }, 0);

        const label =
          String((sku as any)?.name ?? "").trim() ||
          String((article as any)?.name ?? (article as any)?.omschrijving ?? "").trim() ||
          String((sku as any)?.id ?? "").trim();
        const unit = cleanFinalUnitLabel(
          String((article as any)?.name ?? (article as any)?.omschrijving ?? (sku as any)?.packaging_type ?? label).trim(),
          beerName
        );
        return {
          id: String((sku as any)?.id ?? articleId ?? label),
          biernaam: beerName,
          soort: "Inkoop",
          verpakkingseenheid: unit,
          primaire_kosten: primary,
          verpakkingskosten: packaging,
          vaste_kosten: overhead,
          accijns: excise,
          kostprijs: primary + packaging + overhead + excise,
          liters,
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => String(a.verpakkingseenheid).localeCompare(String(b.verpakkingseenheid), "nl-NL"));
  }

  function renderCostBuildTable(title: string, rows: GenericRecord[], emptyText: string, statusForRow?: (row: GenericRecord) => string) {
    return (
      <div className="module-card compact-card">
        <div className="module-card-title">{title}</div>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Biernaam</th>
                <th>Soort</th>
                <th>Verpakkingseenheid</th>
                <th>Inkoop</th>
                <th>Verpakkingskosten</th>
                <th>Overhead (ABC)</th>
                <th>Accijns</th>
                <th>Kostprijs</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={9}>{emptyText}</td>
                </tr>
              ) : null}
              {rows.map((row, index) => (
                <tr key={`${String((row as any)?.id ?? (row as any)?.product_id ?? index)}-${index}`}>
                  <td>{String((row as any)?.biernaam ?? draftBeerName ?? "-")}</td>
                  <td>{String((row as any)?.soort ?? "Inkoop")}</td>
                  <td>{cleanFinalUnitLabel((row as any)?.verpakkingseenheid, draftBeerName) || "-"}</td>
                  <td>{formatCurrencyDisplay((row as any)?.primaire_kosten)}</td>
                  <td>{formatCurrencyDisplay((row as any)?.verpakkingskosten)}</td>
                  <td>{formatCurrencyDisplay(summaryOverheadValue(row))}</td>
                  <td>{formatCurrencyDisplay((row as any)?.accijns)}</td>
                  <td>{formatCurrencyDisplay((row as any)?.kostprijs)}</td>
                  {(() => {
                    const status = statusForRow ? statusForRow(row) : "in berekening";
                    const statusClass = status.includes("kandidaat") ? "status-ok" : "status-warning";
                    return (
                      <td>
                        <span className={`status-pill ${statusForRow ? statusClass : "status-ok"}`}>
                          {status}
                        </span>
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderFinalSummaryStep() {
    const snapshot = draftResultaatSnapshot ?? {};
    const basisRows = (((snapshot as any)?.producten?.basisproducten ?? []) as GenericRecord[]);
    const composedRows = (((snapshot as any)?.producten?.samengestelde_producten ?? []) as GenericRecord[]);
    const variantRows = buildDraftVariantCostRows();
    const impactedBundles = buildImpactedBundleRows();
    const activeProductIds = new Set(
      (Array.isArray((selectedActiveRecord as any)?.cost_lines) ? ((selectedActiveRecord as any).cost_lines as GenericRecord[]) : [])
        .map((line) => String((line as any)?.product_id ?? "").trim())
        .filter(Boolean)
    );
    const skuOverview = buildDraftCostProductCandidates();
    const newCount = skuOverview.filter((row) => !activeProductIds.has(String(row.productId ?? ""))).length;
    const existingCount = skuOverview.length - newCount;

    const statusForProduct = (row: GenericRecord) => {
      const productId = String((row as any)?.product_id ?? (row as any)?.id ?? "").trim();
      return activeProductIds.has(productId) ? "nieuwe kandidaatversie" : "nieuw, klaar voor activatie";
    };

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Eindcontrole</div>
          <div className="module-card-text">
            Controleer hoe de kostprijs is opgebouwd voor bestaande artikelen, nieuwe artikelen en verkoopbare varianten.
          </div>
          <div className="stats-grid wizard-stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card"><div className="stat-label">Bestaande SKU's</div><div className="stat-value small">{existingCount}</div></div>
            <div className="stat-card"><div className="stat-label">Nieuwe SKU's</div><div className="stat-value small">{newCount}</div></div>
            <div className="stat-card"><div className="stat-label">Varianten</div><div className="stat-value small">{variantRows.length}</div></div>
            <div className="stat-card"><div className="stat-label">Giftsets geraakt</div><div className="stat-value small">{impactedBundles.length}</div></div>
            <div className="stat-card"><div className="stat-label">Status</div><div className="stat-value small">{draftResultaatSnapshot ? "Berekend" : "Nog geen berekening"}</div></div>
          </div>
        </div>

        {renderCostBuildTable("Basisproducten", basisRows, "Nog geen basisproducten in deze factuur.", statusForProduct)}
        {renderCostBuildTable("Samengestelde producten", composedRows, "Nog geen samengestelde producten in deze factuur.", statusForProduct)}
        {renderCostBuildTable("Kostprijs verkoopbare varianten", variantRows, "Nog geen verkoopbare varianten aangemaakt.", () => "nieuwe verkoopbare variant")}
        <div className="module-card compact-card">
          <div className="module-card-title">Geraakte geschenkverpakkingen</div>
          <div className="module-card-text">
            Dit zijn afgeleide artikelen. Afronden van deze factuur maakt geen automatische giftset-versie; herberekenen gebeurt bewust via de artikelkostprijswizard.
          </div>
          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Geschenkverpakking</th>
                  <th>Geraakte component</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {impactedBundles.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={3}>Geen geschenkverpakkingen geraakt.</td>
                  </tr>
                ) : null}
                {impactedBundles.map((row) => (
                  <tr key={row.skuId}>
                    <td style={{ fontWeight: 700 }}>{row.label}</td>
                    <td>{row.affectedComponentLabels.join(", ") || "-"}</td>
                    <td><span className="status-pill status-warning">herberekenen na afronden</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderWizardStepContent() {
    if (wizardStep === 1) return renderFactuurDetailsStep();
    if (wizardStep === 2) return renderFactuurEditorStep();
    if (wizardStep === 3) return renderKostenverdelingStep();
    if (wizardStep === 4) return renderPreviewStep();
    if (wizardStep === 5) {
      return (
        <SellableVariantsStep
          current={buildWizardCurrentRecord()}
          skus={localSkus}
          articles={localArticles}
          bomLines={localBomLines}
          verpakkingstypen={Array.isArray(verpakkingstypen) ? verpakkingstypen : []}
          costProductRows={buildDraftCostProductCandidates()}
          onRefreshSkus={refreshLocalProductModel}
          onEnableProductId={() => undefined}
        />
      );
    }
    if (wizardStep === 6) {
      return (
        <KoppelenStep
          current={buildWizardCurrentRecord()}
          skus={localSkus}
          articles={localArticles}
          costProductRows={buildDraftCostProductCandidates()}
          douanoMappings={douanoMappings}
          onRefreshMappings={refreshDouanoMappings}
          focusUnlinkedOnly
        />
      );
    }
    return renderFinalSummaryStep();
  }

  function renderDraftWizard() {
    if (!draftFactuur) return null;
    const activeIndex = Math.max(0, wizardStep - 1);
    const currentStep = wizardSteps[activeIndex] ?? wizardSteps[0];

    return (
      <div className="cpq-root">
        <div className="cpq-frame">
          <div className="cpq-topbar">
            <div>
              <div className="cpq-kicker">Inkoopfactuurwizard</div>
              <h1 className="cpq-title">
                {draftMode === "edit" ? "Factuurversie bewerken" : "Nieuwe inkoopfactuur"}
              </h1>
              {draftMode === "edit" && editingRecord ? (
                <div className="wizard-panel-text">
                  {`v${Number((editingRecord as any).versie_nummer ?? 0) || 1} - ${String((editingRecord as any).status ?? "")}`}
                </div>
              ) : null}
            </div>
            <div className="cpq-topbar-actions">
              <button type="button" className="editor-button editor-button-secondary" onClick={cancelDraft}>
                Terug
              </button>
              <span className="pill">{String(editingRecord?.status ?? "concept")}</span>
            </div>
          </div>

          <div className="cpq-grid cpq-grid-two">
            <aside className="cpq-left">
              <WizardSteps
                title="Stappen"
                steps={wizardSteps.map((step) => ({
                  id: String(step.id),
                  title: step.label,
                  description: step.text,
                  disabled: step.id > 1 && !selectedActiveRecord,
                }))}
                activeIndex={activeIndex}
                onSelect={(index) => {
                  if (index > 0 && !selectedActiveRecord) return;
                  setWizardStep(index + 1);
                }}
              />
            </aside>

            <main className="cpq-main">
              <div className="wizard-shell wizard-shell-single" style={{ marginTop: 0 }}>
                <div className="wizard-step-card wizard-step-stage-card">
                  <div className="wizard-step-header">
                    <div>
                      <div className="wizard-step-title">
                        Stap {activeIndex + 1}: {currentStep.label}
                      </div>
                      <div className="wizard-step-description">{currentStep.text}</div>
                    </div>
                  </div>

                  <div className="wizard-step-body">{renderWizardStepContent()}</div>

                  <div className="editor-actions wizard-footer-actions">
                    <div className="editor-actions-group">
                      {wizardStep > 1 ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => setWizardStep((current) => Math.max(1, current - 1))}
                        >
                          Vorige
                        </button>
                      ) : null}
                    </div>
                    <div className="editor-actions-group">
                      {status ? <span className="editor-status">{status}</span> : null}
                      {draftMode === "edit" && editingRecord && editingStatus === "concept" ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() =>
                            requestDelete(
                              "Conceptversie verwijderen",
                              "Weet je zeker dat je deze concept-factuurversie wilt verwijderen?",
                              () => deleteDraftVersion(String(editingRecord.id ?? ""))
                            )
                          }
                          disabled={isSaving}
                        >
                          Verwijderen
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={saveDraft}
                        disabled={isSaving || !selectedActiveRecord || !canEditDraft || !isDraftValid(draftFactuur)}
                      >
                        Opslaan
                      </button>
                      <button
                        type="button"
                        className="editor-button"
                        onClick={() => {
                          if (wizardStep < wizardSteps.length) {
                            setWizardStep((current) => Math.min(wizardSteps.length, current + 1));
                            return;
                          }
                          requestAction({
                            title: "Factuurversie afronden",
                            body: "Weet je zeker dat je deze factuurversie definitief wilt maken? Daarna kun je hem activeren als kostprijsbron.",
                            confirmLabel: "Afronden",
                            onConfirm: finalizeDraft,
                          });
                        }}
                        disabled={
                          isSaving ||
                          !selectedActiveRecord ||
                          (wizardStep === wizardSteps.length && (!canEditDraft || !isDraftValid(draftFactuur)))
                        }
                      >
                        {isSaving ? "Opslaan..." : wizardStep === wizardSteps.length ? "Afronden" : "Volgende"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Inkoopfacturen beheren</div>
        <div className="module-card-text">
          Kies een artikel om de onderliggende facturen te bekijken. Voeg daarna een nieuwe concept-factuurversie toe.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <section className="module-card proposal-hub-hero" style={{ marginBottom: 14 }}>
          <div className="proposal-hub-hero-copy">
            <div className="module-card-title">Nieuwe factuur toevoegen</div>
            <div className="module-card-text">
              Kies eerst waarvoor je de factuur toevoegt (bier, artikel of dienst) en vul daarna de factuurregels in.
            </div>
          </div>
          <div className="proposal-hub-hero-actions">
            <button
              type="button"
              className="cpq-button cpq-button-primary"
              onClick={startNewFactuurWizard}
              disabled={bierGroups.length === 0}
            >
              Nieuwe factuur toevoegen
            </button>
          </div>
        </section>

        <div className="wizard-step-card">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Inkoopitems</div>
            <div className="wizard-panel-text">{bierGroups.length} items zichtbaar</div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th>Datum actief</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bierGroups.length > 0 ? (
                  bierGroups.map((group) => {
                    const activeRecord = getActiveRecordForGroup(group);
                    const isSelected = group.key === (selectedGroup?.key ?? "");
                    const factuurRows = group.records.flatMap((record) =>
                      getInkoopFacturen(record).map((factuur) => ({
                        recordId: String(record.id ?? ""),
                        recordStatus: String(record.status ?? ""),
                        versie: `v${Number(record.versie_nummer ?? 0) || 1}`,
                        status: `${String(record.status ?? "")}${Boolean(record.is_actief) ? " · actief" : ""}`,
                        factuurnummer: String(factuur.factuurnummer ?? "").trim() || "-",
                        factuurdatum: String(factuur.factuurdatum ?? "").trim() || "-",
                        regels: getFactuurTotals(factuur).regels,
                        liters: getFactuurTotals(factuur).liters,
                        bedrag: getFactuurTotals(factuur).bedrag
                      }))
                    );

                    return (
                      <Fragment key={group.key}>
                        <tr
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedBeerKey(isSelected ? "" : group.key);
                            setStatus("");
                          }}
                        >
                          <td>
                            <strong>{group.biernaam}</strong>
                            <div className="wizard-panel-text">{`${group.jaar} · ${group.stijl || "-"}`}</div>
                          </td>
                          <td>{String(activeRecord?.effectief_vanaf ?? activeRecord?.finalized_at ?? "").slice(0, 10) || "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="editor-button editor-button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedBeerKey(group.key);
                                startDraftForRecord(activeRecord, group.key);
                              }}
                            >
                              +
                            </button>
                          </td>
                        </tr>
                        {isSelected ? (
                          <tr>
                            <td colSpan={3} style={{ background: "rgba(248, 251, 255, 0.9)" }}>
                              <div className="dataset-editor-scroll" style={{ marginTop: "0.2rem" }}>
                                <table className="dataset-editor-table wizard-table-compact">
                                  <thead>
                                    <tr>
                                      <th>Versie</th>
                                      <th>Status</th>
                                      <th>Factuurnummer</th>
                                      <th>Factuurdatum</th>
                                      <th>Regels</th>
                                      <th>Liters</th>
                                      <th>Bedrag</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {factuurRows.length > 0 ? (
                                      factuurRows.map((row, index) => (
                                        <tr
                                          key={`${row.versie}-${row.factuurnummer}-${index}`}
                                          style={{ cursor: "pointer" }}
                                          title="Open factuurversie"
                                          onClick={() => {
                                            const record = group.records.find(
                                              (item) =>
                                                String(item.id ?? "") === String((row as any).recordId ?? "")
                                            );
                                            if (!record) {
                                              return;
                                            }
                                            openExistingFactuurVersie(record);
                                          }}
                                        >
                                          <td>{row.versie}</td>
                                          <td>{row.status}</td>
                                          <td>{row.factuurnummer}</td>
                                          <td>{row.factuurdatum}</td>
                                          <td>{row.regels}</td>
                                          <td>{Number(row.liters).toLocaleString("nl-NL")}</td>
                                          <td>{formatCurrency(Number(row.bedrag))}</td>
                                          <td style={{ whiteSpace: "nowrap" }}>
                                            {String((row as any).recordStatus ?? "").toLowerCase() === "concept" ? (
                                              <button
                                                type="button"
                                                className="icon-button-table icon-button-neutral"
                                                aria-label="Verwijder conceptversie"
                                                title="Verwijder conceptversie"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  requestDelete(
                                                    "Conceptversie verwijderen",
                                                    "Weet je zeker dat je deze concept-factuurversie wilt verwijderen?",
                                                    () => deleteDraftVersion(String((row as any).recordId ?? ""))
                                                  );
                                                }}
                                              >
                                                ×
                                              </button>
                                            ) : null}
                                          </td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td className="dataset-empty" colSpan={8}>
                                          Nog geen facturen gevonden voor dit bier.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td className="dataset-empty" colSpan={3}>
                      Nog geen actieve inkoopversies gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {draftFactuur ? renderDraftWizard() : null}

        {false && draftFactuur ? (
          <div className="wizard-step-card">
            <div className="wizard-step-header">
              <div>
                <div className="wizard-step-title">
                  {draftMode === "edit"
                    ? "Bestaande factuurversie bewerken of afronden"
                    : "Nieuwe factuurversie"}
                </div>
                {draftMode === "edit" && editingRecord ? (
                  <div className="wizard-panel-text">
                    {`v${Number((editingRecord as any).versie_nummer ?? 0) || 1} · ${String((editingRecord as any).status ?? "")}`}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="wizard-layout">
              <aside className="wizard-steps" aria-label="Inkoopfactuur stappen">
                {wizardSteps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    className={`wizard-step-nav ${wizardStep === step.id ? "active" : ""} ${wizardStep > step.id ? "done" : ""}`}
                    onClick={() => setWizardStep(step.id)}
                  >
                    <span className="wizard-step-number">{wizardStep > step.id ? "✓" : step.id}</span>
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.text}</small>
                    </span>
                  </button>
                ))}
              </aside>
              <div className="wizard-content">
                {renderWizardStepContent()}
              </div>
            </div>

            <div className="editor-actions">
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setWizardStep((current) => Math.max(1, current - 1))}
                  disabled={wizardStep <= 1}
                >
                  Vorige
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => setWizardStep((current) => Math.min(wizardSteps.length, current + 1))}
                  disabled={wizardStep >= wizardSteps.length}
                >
                  Volgende
                </button>
              </div>
              <div className="editor-actions-group">
                {status ? <span className="editor-status">{status}</span> : null}
                {draftMode === "edit" && editingRecord && editingStatus === "concept" ? (
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() =>
                      requestDelete(
                        "Conceptversie verwijderen",
                        "Weet je zeker dat je deze concept-factuurversie wilt verwijderen?",
                        () => deleteDraftVersion(String(editingRecord!.id ?? ""))
                      )
                    }
                    disabled={isSaving}
                  >
                    Verwijderen
                  </button>
                ) : null}
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={cancelDraft}
                  disabled={isSaving}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={saveDraft}
                  disabled={isSaving || !canEditDraft || !isDraftValid(draftFactuur!)}
                >
                  {isSaving ? "Opslaan..." : "Opslaan"}
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() =>
                    requestAction({
                      title: "Factuurversie afronden",
                      body: "Weet je zeker dat je deze factuurversie definitief wilt maken? Daarna kun je hem activeren als kostprijsbron.",
                      confirmLabel: "Afronden",
                      onConfirm: finalizeDraft
                    })
                  }
                  disabled={isSaving || !canEditDraft || !isDraftValid(draftFactuur!)}
                >
                  Afronden
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {false ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-new-factuur-title">
              <div className="confirm-modal-title" id="confirm-new-factuur-title">
                Nieuwe factuur toevoegen
              </div>
              <div className="confirm-modal-text">
                Kies waarvoor je de factuur toevoegt. Daarna kun je de factuurregels invullen.
              </div>
              <label className="nested-field" style={{ marginTop: 10 }}>
                <span>Artikel</span>
                <select
                  className="dataset-input"
                  value={pendingNewTargetKey}
                  onChange={(event) => setPendingNewTargetKey(event.target.value)}
                >
                  {bierGroups.map((group) => (
                    <option key={group.key} value={group.key}>
                      {`${group.biernaam} · ${group.jaar}${group.stijl ? ` · ${group.stijl}` : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setShowNewTargetPicker(false)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    const key = String(pendingNewTargetKey || "");
                    const target = bierGroups.find((g) => g.key === key) ?? null;
                    const record = target ? getActiveRecordForGroup(target) : null;
                    if (target && record) {
                      setSelectedBeerKey(key);
                      setShowNewTargetPicker(false);
                      setStatus("");
                      startDraftForRecord(record, key);
                    } else {
                      setShowNewTargetPicker(false);
                      setStatus("Kies eerst een artikel om een factuur toe te voegen.");
                    }
                  }}
                >
                  Doorgaan
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-inkoopfacturen-title"
            >
              <div className="confirm-modal-title" id="confirm-inkoopfacturen-title">
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
        {pendingAction ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-inkoopfacturen-action-title"
            >
              <div className="confirm-modal-title" id="confirm-inkoopfacturen-action-title">
                {pendingAction.title}
              </div>
              <div className="confirm-modal-text">{pendingAction.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingAction(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingAction.onConfirm();
                    setPendingAction(null);
                  }}
                >
                  {pendingAction.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

