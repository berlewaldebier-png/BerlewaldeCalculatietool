"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";

import { API_BASE_URL } from "@/lib/api";
import { formatMoneyEUR } from "@/lib/formatters";

type GenericRecord = Record<string, any>;

type ImportItem = {
  movement_date?: string;
  transaction_number: string;
  sku_code: string;
  lot_number: string;
  product_name: string;
  company_name: string;
  quantity: number;
  match?: {
    status: "matched" | "unmatched";
    invoice?: boolean;
    order?: boolean;
    reasons?: string[];
  };
};

type ImportPayload = {
  summary?: Record<string, number>;
  items?: ImportItem[];
};

type OpeningLotImportItem = {
  supplier: string;
  lot_number: string;
  sku_code: string;
  product_name: string;
  source_date: string;
  quantity: number;
  purchase_price_input: number;
  excise_per_unit: number;
  purchase_price_includes_excise: boolean;
  status?: "ok" | "check";
  reasons?: string[];
};

type OpeningLotImportPayload = {
  summary?: Record<string, number>;
  items?: OpeningLotImportItem[];
};

type StockHistoryImport = {
  import_batch_id: string;
  source_filename: string;
  row_count: number;
  imported_at: string;
};

type ExternalLotItem = {
  lot_number: string;
  rows?: number;
  last_movement_date?: string;
  product_name?: string;
  sku_codes?: string[];
  douano_product_ids?: number[];
  style_ids?: string[];
  style_names?: string[];
  canonical_lots?: string[];
};

type InternalLotSku = {
  sku_id: string;
  sku_code?: string;
  label: string;
  name?: string;
  versions?: string[];
};

type InternalLotItem = {
  lot_number: string;
  versions?: string[];
  version_ids?: string[];
  years?: number[];
  sources?: string[];
  sku_count?: number;
  skus?: InternalLotSku[];
};

type InternalLotGroup = {
  style_id: string;
  style_name: string;
  lot_count: number;
  lots: InternalLotItem[];
};

type LotMatchStatus = "exact" | "mapped" | "near" | "selected" | "missing";
type ExternalLotCategory = "variant" | "gift" | "historic" | "unknown_product" | "unclassified";
type HistoricalSkuOption = {
  id: string;
  value: string;
  label: string;
  optionType: "sku" | "format";
  beer_id?: string;
  ref_id?: string;
};

const SUPPLIERS = ["Beerselect", "Groenlo", "Wentersch", "Eigen productie"];
const EXTERNAL_LOT_CATEGORY_META: Record<
  ExternalLotCategory,
  { label: string; tone: string; description: string; action: string }
> = {
  variant: {
    label: "Te koppelen LOT-variant",
    tone: "status-warning",
    description: "Douano LOT lijkt op een interne LOT, maar is niet exact gelijk. Koppel deze expliciet aan de hoofd-LOT.",
    action: "Koppel aan hoofd-LOT",
  },
  gift: {
    label: "Geschenkverpakking",
    tone: "status-warning",
    description: "Geschenksets krijgen een eigen Douano LOT, maar de kostprijs hoort uit de samenstelling te komen.",
    action: "Later oplossen via samenstelling",
  },
  historic: {
    label: "Historische LOT",
    tone: "status-warning",
    description: "Historische of leverancier-LOTs die straks als v0/historie aan een stijl of SKU gekoppeld kunnen worden.",
    action: "Later vastleggen als historie",
  },
  unknown_product: {
    label: "Onbekende SKU/productkoppeling",
    tone: "status-danger",
    description: "Douano LOT hoort bij een product dat nog niet aan een interne stijl/SKU gekoppeld is.",
    action: "Product/SKU beoordelen",
  },
  unclassified: {
    label: "Ongeclassificeerd",
    tone: "status-danger",
    description: "Deze externe LOT past nog niet in een bekende categorie.",
    action: "Handmatig beoordelen",
  },
};

function createRowId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createOpeningLotRow() {
  return {
    id: createRowId(),
    source_type: "opening_stock",
    source_ref: "Opening LOT",
    supplier: "Wentersch",
    lot_number: "",
    sku_id: "",
    sku_code: "",
    product_name: "",
    source_date: "2024-12-31",
    quantity: "",
    purchase_price_input: "",
    purchase_price_includes_excise: true,
    excise_per_unit: "",
    packaging_cost_per_unit: "",
    other_direct_cost_per_unit: "",
  };
}

function euro(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? formatMoneyEUR(num) : "-";
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text };
  }
}

function skuLabel(row: GenericRecord) {
  return String(row.name || row.label || row.id || "");
}

function toSkuOption(row: GenericRecord) {
  return {
    id: String(row.id || ""),
    label: skuLabel(row),
    sku_code: String(row.sku || row.code || row.external_sku || ""),
  };
}

function lotExactKey(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function lotNearKey(value: unknown) {
  return lotExactKey(value).replace(/O/g, "0");
}

function domId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function LotKostenWorkspace({
  skus,
  articles = [],
  year = new Date().getFullYear(),
}: {
  skus: GenericRecord[];
  articles?: GenericRecord[];
  year?: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPayload | null>(null);
  const [openingFile, setOpeningFile] = useState<File | null>(null);
  const [openingPreview, setOpeningPreview] = useState<OpeningLotImportPayload | null>(null);
  const [records, setRecords] = useState<GenericRecord[]>([]);
  const [stockImports, setStockImports] = useState<StockHistoryImport[]>([]);
  const [internalLotGroups, setInternalLotGroups] = useState<InternalLotGroup[]>([]);
  const [externalLots, setExternalLots] = useState<ExternalLotItem[]>([]);
  const [selectedExternalLots, setSelectedExternalLots] = useState<Record<string, string>>({});
  const [selectedHistoricalStyleByLot, setSelectedHistoricalStyleByLot] = useState<Record<string, string>>({});
  const [selectedHistoricalFormatByLot, setSelectedHistoricalFormatByLot] = useState<Record<string, string>>({});
  const [historicalSkuNameByLot, setHistoricalSkuNameByLot] = useState<Record<string, string>>({});
  const [historicalSkuModalLot, setHistoricalSkuModalLot] = useState<ExternalLotItem | null>(null);
  const [createdSkus, setCreatedSkus] = useState<GenericRecord[]>([]);
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [saving, setSaving] = useState(false);

  const [openingRows, setOpeningRows] = useState(() => [createOpeningLotRow()]);

  const allSkus = useMemo(() => {
    const byId = new Map<string, GenericRecord>();
    for (const row of skus || []) {
      const id = String(row?.id || "");
      if (id) byId.set(id, row);
    }
    for (const row of createdSkus) {
      const id = String(row?.id || "");
      if (id) byId.set(id, row);
    }
    return Array.from(byId.values());
  }, [skus, createdSkus]);

  const skuOptions = useMemo(() => {
    return allSkus
      .filter((row) => row && row.active !== false && row.actief !== false)
      .map(toSkuOption)
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [allSkus]);
  const formatSkuOptions = useMemo<HistoricalSkuOption[]>(() => {
    const options: HistoricalSkuOption[] = allSkus
      .filter((row) => row && (String(row.format_article_id || "").trim() || String(row.article_id || "").trim()))
      .map((row) => ({
        id: String(row.id || ""),
        value: `sku:${String(row.id || "")}`,
        label: skuLabel(row),
        optionType: "sku" as const,
        beer_id: String(row.beer_id || ""),
        ref_id: String(row.format_article_id || row.article_id || ""),
      }))
      .filter((row) => row.id);
    for (const row of articles || []) {
      const id = String(row?.id || "").trim();
      const kind = String(row?.kind || "").trim().toLowerCase();
      if (!id || kind !== "format" || row?.active === false || row?.actief === false) continue;
      options.push({
        id,
        value: `format:${id}`,
        label: `${String(row?.name || row?.label || id)} (afvuleenheid)`,
        optionType: "format",
        ref_id: id,
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [allSkus, articles]);

  async function loadRecords() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs?limit=2000`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setRecords(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function loadStockImports() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/stock-history/imports`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setStockImports(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function loadInternalLotSummary() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-summary`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setInternalLotGroups(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function loadExternalLots() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/external-lots`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setExternalLots(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  function matchedExternalLot(lotNumber: string) {
    return externalLots.find((lot) => lotExactKey(lot.lot_number) === lotExactKey(lotNumber));
  }

  function mappedExternalLots(lotNumber: string) {
    const key = lotExactKey(lotNumber);
    if (!key) return [];
    return externalLots.filter((lot) => (lot.canonical_lots || []).some((canonicalLot) => lotExactKey(canonicalLot) === key));
  }

  function nearExternalLot(lotNumber: string) {
    const exactKey = lotExactKey(lotNumber);
    const nearKey = lotNearKey(lotNumber);
    if (!nearKey) return undefined;
    return externalLots.find((lot) => lotExactKey(lot.lot_number) !== exactKey && lotNearKey(lot.lot_number) === nearKey);
  }

  function unmappedNearExternalLots(lotNumber: string) {
    const exactKey = lotExactKey(lotNumber);
    const nearKey = lotNearKey(lotNumber);
    if (!nearKey) return [];
    return externalLots.filter((lot) => {
      if (lotExactKey(lot.lot_number) === exactKey) return false;
      if (lotNearKey(lot.lot_number) !== nearKey) return false;
      return !(lot.canonical_lots || []).some((canonicalLot) => lotExactKey(canonicalLot) === exactKey);
    });
  }

  function selectedOrMatchedExternalLot(rowKey: string, lotNumber: string) {
    const selected = String(selectedExternalLots[rowKey] || "").trim();
    if (selected) return selected;
    return matchedExternalLot(lotNumber)?.lot_number || mappedExternalLots(lotNumber)[0]?.lot_number || "";
  }

  function lotStatus(rowKey: string, lotNumber: string): LotMatchStatus {
    const selected = String(selectedExternalLots[rowKey] || "").trim();
    if (selected) return lotExactKey(selected) === lotExactKey(lotNumber) ? "exact" : "selected";
    if (matchedExternalLot(lotNumber)) return "exact";
    if (mappedExternalLots(lotNumber).length) return "mapped";
    if (nearExternalLot(lotNumber)) return "near";
    return "missing";
  }

  function lotStatusLabel(status: LotMatchStatus) {
    if (status === "exact") return "match";
    if (status === "mapped") return "gekoppeld";
    if (status === "near") return "bijna-match";
    if (status === "selected") return "te corrigeren";
    return "geen externe LOT";
  }

  function lotStatusClass(status: LotMatchStatus) {
    if (status === "exact" || status === "mapped") return "status-ok";
    if (status === "near" || status === "selected") return "status-warning";
    return "status-danger";
  }

  function externalOptionsFor(rowKey: string, currentLotNumber: string) {
    const usedByOtherRows = new Set(
      Object.entries(selectedExternalLots)
        .filter(([key]) => key !== rowKey)
        .map(([, value]) => lotExactKey(value))
        .filter(Boolean)
    );
    for (const group of internalLotGroups) {
      const groupKey = group.style_id || group.style_name;
      for (const lot of group.lots || []) {
        const key = `${groupKey}-${lot.lot_number}`;
        if (key === rowKey) continue;
        const exactMatch = matchedExternalLot(lot.lot_number);
        if (exactMatch) {
          usedByOtherRows.add(lotExactKey(exactMatch.lot_number));
        }
        for (const mappedLot of mappedExternalLots(lot.lot_number)) {
          usedByOtherRows.add(lotExactKey(mappedLot.lot_number));
        }
      }
    }
    const currentKey = lotExactKey(currentLotNumber);
    return externalLots.filter((lot) => lotExactKey(lot.lot_number) === currentKey || !usedByOtherRows.has(lotExactKey(lot.lot_number)));
  }

  async function updateInternalLot(group: InternalLotGroup, lot: InternalLotItem, lotKey: string) {
    const selectedLot = selectedOrMatchedExternalLot(lotKey, lot.lot_number);
    if (!selectedLot) return;
    const externalLot = externalLots.find((item) => lotExactKey(item.lot_number) === lotExactKey(selectedLot));
    const externalStyleIds = externalLot?.style_ids || [];
    const externalStyleNames = externalLot?.style_names || [];
    const sameStyle = !externalStyleIds.length || !group.style_id || externalStyleIds.includes(group.style_id);
    const exactSame = lotExactKey(lot.lot_number) === lotExactKey(selectedLot);
    const nearSame = lotNearKey(lot.lot_number) === lotNearKey(selectedLot);
    let message = `Je gaat interne LOT ${lot.lot_number} bijwerken naar ${selectedLot}.`;
    if (!sameStyle) {
      message =
        `Let op: de externe LOT lijkt bij een andere stijl te horen.\n\n` +
        `Interne stijl: ${group.style_name || "-"}\n` +
        `Externe stijl: ${externalStyleNames.join(", ") || "onbekend"}\n\n` +
        `Weet je absoluut zeker dat je ${lot.lot_number} wilt bijwerken naar ${selectedLot}?`;
    } else if (!exactSame && !nearSame) {
      message =
        `Let op: de externe LOT wijkt duidelijk af van de interne LOT.\n\n` +
        `Intern: ${lot.lot_number}\n` +
        `Extern: ${selectedLot}\n\n` +
        `Weet je zeker dat je deze interne LOT wilt bijwerken?`;
    } else {
      message =
        `Je gaat interne LOT ${lot.lot_number} bijwerken naar ${selectedLot}.\n\n` +
        `Dit past de LOT aan in de gekoppelde kostprijsversie/inkoopfactuur.`;
    }
    if (!window.confirm(message)) return;

    setSaving(true);
    setStatus("Interne LOT bijwerken...");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-lots/update`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_ids: lot.version_ids || [],
          from_lot: lot.lot_number,
          to_lot: selectedLot,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const updatedVersions = Number(payload?.result?.updated_versions ?? 0);
      const affectedSkus = Number(payload?.result?.affected_sku_count ?? 0);
      setSelectedExternalLots((current) => {
        const next = { ...current };
        delete next[lotKey];
        return next;
      });
      const refreshed = Number(payload?.snapshot_refresh?.computed ?? 0);
      const documents = Number(payload?.snapshot_refresh?.documents ?? 0);
      const sourceText =
        updatedVersions > 0
          ? `${updatedVersions} bronversie${updatedVersions === 1 ? "" : "s"} en ${affectedSkus} SKU${affectedSkus === 1 ? "" : "'s"} bijgewerkt`
          : "Geen bronversies bijgewerkt";
      setStatus(
        refreshed > 0
          ? `Interne LOT bijgewerkt naar ${selectedLot}. ${sourceText}. Omzet en Marge snapshots ververst voor ${refreshed} regels (${documents} documenten).`
          : `Interne LOT bijgewerkt naar ${selectedLot}. ${sourceText}. Geen Omzet en Marge regels gevonden voor deze LOT.`
      );
      setTone("success");
      await loadInternalLotSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function mapExternalLotToInternal(group: InternalLotGroup, lot: InternalLotItem, lotKey: string, selectedLotOverride = "") {
    const selectedLot = selectedLotOverride || selectedOrMatchedExternalLot(lotKey, lot.lot_number);
    const internalLot = String(lot.lot_number || "").trim();
    if (!selectedLot || !internalLot || lotExactKey(selectedLot) === lotExactKey(internalLot)) return;
    const skuIds = (lot.skus || []).map((sku) => String(sku.sku_id || "").trim()).filter(Boolean);
    const externalLot = externalLots.find((item) => lotExactKey(item.lot_number) === lotExactKey(selectedLot));
    const externalStyleNames = externalLot?.style_names || [];
    const message =
      `Je gaat externe LOT ${selectedLot} koppelen aan hoofd-LOT ${internalLot}.\n\n` +
      `Stijl: ${group.style_name || "-"}\n` +
      `Externe stijl: ${externalStyleNames.join(", ") || "onbekend"}\n` +
      `Scope: ${skuIds.length > 0 ? `${skuIds.length} SKU's onder deze interne LOT` : "globale LOT-koppeling"}\n\n` +
      `Raw Douano data blijft ongewijzigd. Omzet en Marge gebruikt daarna ${internalLot} voor de kostprijsdekking.`;
    if (!window.confirm(message)) return;

    setSaving(true);
    setStatus("Externe LOT koppelen aan hoofd-LOT...");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/aliases`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_ids: skuIds,
          douano_lot_number: selectedLot,
          internal_lot_number: internalLot,
          reason: "canonical_external_lot",
          source: "lot_dekking",
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const aliases = Number(payload?.records?.length ?? 0);
      const refreshed = Number(payload?.snapshot_refresh?.computed ?? 0);
      const documents = Number(payload?.snapshot_refresh?.documents ?? 0);
      setSelectedExternalLots((current) => {
        const next = { ...current };
        delete next[lotKey];
        return next;
      });
      setStatus(
        `Externe LOT ${selectedLot} gekoppeld aan hoofd-LOT ${internalLot}. ${aliases} koppeling${aliases === 1 ? "" : "en"} opgeslagen. Omzet en Marge snapshots ververst voor ${refreshed} regels (${documents} documenten).`
      );
      setTone("success");
      await loadExternalLots();
      await loadInternalLotSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function refreshLotSnapshots(lotNumber: string) {
    const lotText = String(lotNumber || "").trim();
    if (!lotText) return;
    setSaving(true);
    setStatus(`Omzet en Marge snapshots verversen voor ${lotText}...`);
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-lots/refresh-snapshots`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lot_numbers: [lotText] }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const refreshed = Number(payload?.snapshot_refresh?.computed ?? 0);
      const documents = Number(payload?.snapshot_refresh?.documents ?? 0);
      setStatus(`Omzet en Marge snapshots ververst voor ${lotText}: ${refreshed} regels (${documents} documenten).`);
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadRecords();
    void loadStockImports();
    void loadInternalLotSummary();
    void loadExternalLots();
  }, [year]);

  async function upload(mode: "preview" | "confirm") {
    if (!file) {
      setStatus("Kies eerst een Voorraadhistoriek Excel of CSV bestand.");
      setTone("error");
      return;
    }
    setSaving(true);
    setStatus(mode === "preview" ? "Preview maken..." : "Import opslaan...");
    setTone("");
    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch(
        `${API_BASE_URL}/integrations/lot-costs/stock-history/${mode}?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer,
        }
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setPreview(payload);
      setStatus(mode === "preview" ? "Preview gereed" : "Import opgeslagen");
      setTone("success");
      if (mode === "confirm") {
        await loadStockImports();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function enrichMissingLots() {
    if (!file) {
      setStatus("Kies eerst een Excel of CSV bestand met LOT-aanvullingen.");
      setTone("error");
      return;
    }
    setSaving(true);
    setStatus("Ontbrekende LOTs verrijken...");
    setTone("");
    try {
      const buffer = await file.arrayBuffer();
      const response = await fetch(
        `${API_BASE_URL}/integrations/lot-costs/stock-history/enrich-missing?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer,
        }
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setPreview(payload);
      const enriched = Number(payload?.summary?.updated ?? 0);
      const inserted = Number(payload?.summary?.inserted ?? 0);
      const conflicts = Number(payload?.summary?.conflicts ?? 0);
      const missingTarget = Number(payload?.summary?.missing_target ?? 0);
      if (enriched > 0 || inserted > 0) {
        setStatus(
          `${enriched} opgeslagen Douano-regels aangevuld en ${inserted} Excel-verrijkingsregels toegevoegd${
            conflicts ? `, ${conflicts} conflicten` : ""
          }${missingTarget ? `, ${missingTarget} regels zonder opgeslagen Douano-match` : ""}`
        );
      } else {
        setStatus(
          `Geen LOTs aangevuld. Er waren geen opgeslagen Douano-regels zonder LOT die met dit bestand matchten${
            conflicts ? `; ${conflicts} regels hadden een ander LOT dan Douano` : ""
          }${missingTarget ? `; ${missingTarget} Excel-regels hadden geen opgeslagen Douano-match` : ""}.`
        );
      }
      setTone("success");
      await loadRecords();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadOpeningLots(mode: "preview" | "confirm") {
    if (!openingFile) {
      setStatus("Kies eerst een Opening LOT Excel of CSV bestand.");
      setTone("error");
      return;
    }
    setSaving(true);
    setStatus(mode === "preview" ? "Opening LOT preview maken..." : "Opening LOT import opslaan...");
    setTone("");
    try {
      const buffer = await openingFile.arrayBuffer();
      const response = await fetch(
        `${API_BASE_URL}/integrations/lot-costs/opening-lots/${mode}?filename=${encodeURIComponent(openingFile.name)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer,
        }
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setOpeningPreview(payload);
      setStatus(mode === "preview" ? "Opening LOT preview gereed" : "Opening LOT import opgeslagen");
      setTone("success");
      if (mode === "confirm") {
        await loadRecords();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  function updateOpeningRow(rowId: string, patch: Partial<ReturnType<typeof createOpeningLotRow>>) {
    setOpeningRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addOpeningRow() {
    setOpeningRows((prev) => [...prev, createOpeningLotRow()]);
  }

  function removeOpeningRow(rowId: string) {
    setOpeningRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== rowId) : prev));
  }

  function prepareHistoricalLot(lot: ExternalLotItem, patch: Partial<ReturnType<typeof createOpeningLotRow>> = {}) {
    const lotNumber = String(lot.lot_number || "").trim();
    if (!lotNumber) return;
    const text = `${lotNumber} ${lot.product_name || ""}`.toLowerCase();
    const supplier = text.includes("wentersch") ? "Wentersch" : "Eigen productie";
    const row = {
      ...createOpeningLotRow(),
      source_type: "opening_stock",
      source_ref: "Historie v0",
      supplier,
      lot_number: lotNumber,
      product_name: lot.product_name || "",
      source_date: lot.last_movement_date || "2024-12-31",
      ...patch,
    };
    setOpeningRows((current) => {
      const emptyIndex = current.findIndex(
        (item) => !item.lot_number.trim() && !item.sku_id.trim() && !item.sku_code.trim() && !item.purchase_price_input.trim()
      );
      if (emptyIndex === -1) return [...current, row];
      return current.map((item, index) => (index === emptyIndex ? row : item));
    });
    setStatus(`Historische LOT ${lotNumber} klaargezet. Kies de interne SKU en vul de historische kostprijs in.`);
    setTone("success");
    window.setTimeout(() => document.getElementById("historische-lot-invoer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function suggestedHistoricalSkuName(styleId: string, templateSkuId: string, fallbackProductName: string) {
    const styleName = styleOptions.find((option) => option.id === styleId)?.label || "";
    const template = formatSkuOptions.find((option) => option.value === templateSkuId || option.id === templateSkuId);
    if (!styleName || !template) return fallbackProductName;
    const templateLabel = template.label.replace(/\s*\(afvuleenheid\)\s*$/i, "");
    const separatorIndex = templateLabel.indexOf(" - ");
    const unitLabel = template.optionType === "sku" && separatorIndex >= 0 ? templateLabel.slice(separatorIndex + 3).trim() : templateLabel.trim();
    return unitLabel ? `${styleName} - ${unitLabel}` : fallbackProductName;
  }

  function setHistoricalFormatSelection(lotKey: string, lot: ExternalLotItem, styleId: string, templateSkuId: string) {
    setSelectedHistoricalFormatByLot((current) => ({
      ...current,
      [lotKey]: templateSkuId,
    }));
    const suggestedName = suggestedHistoricalSkuName(styleId, templateSkuId, String(lot.product_name || ""));
    if (suggestedName) {
      setHistoricalSkuNameByLot((current) => ({
        ...current,
        [lotKey]: current[lotKey] || suggestedName,
      }));
    }
  }

  function openHistoricalSkuModal(lot: ExternalLotItem) {
    const lotKey = `${lot.lot_number}-${lot.product_name || ""}`;
    const styleId = selectedHistoricalStyleByLot[lotKey] || lot.style_ids?.[0] || "";
    if (styleId && !selectedHistoricalStyleByLot[lotKey]) {
      setSelectedHistoricalStyleByLot((current) => ({
        ...current,
        [lotKey]: styleId,
      }));
    }
    const templateSkuId = selectedHistoricalFormatByLot[lotKey] || "";
    const suggestedName = suggestedHistoricalSkuName(styleId, templateSkuId, lot.product_name || "");
    if (suggestedName && !historicalSkuNameByLot[lotKey]) {
      setHistoricalSkuNameByLot((current) => ({
        ...current,
        [lotKey]: suggestedName,
      }));
    }
    setHistoricalSkuModalLot(lot);
  }

  async function createHistoricalSkuForLot(lot: ExternalLotItem) {
    const lotKey = `${lot.lot_number}-${lot.product_name || ""}`;
    const styleId = selectedHistoricalStyleByLot[lotKey] || lot.style_ids?.[0] || "";
    if (!styleId) {
      setStatus("Kies eerst de stijl voor deze historische SKU.");
      setTone("error");
      return;
    }
    const productName = String(lot.product_name || "").trim();
    if (!productName) {
      setStatus("Productnaam ontbreekt voor deze externe LOT.");
      setTone("error");
      return;
    }
    const templateSkuId = selectedHistoricalFormatByLot[lotKey] || "";
    if (!templateSkuId) {
      setStatus("Kies eerst de afvuleenheid/interne SKU voor deze historische SKU.");
      setTone("error");
      return;
    }
    const skuName = String(historicalSkuNameByLot[lotKey] || suggestedHistoricalSkuName(styleId, templateSkuId, productName) || productName).trim();
    if (!skuName) {
      setStatus("SKU-naam ontbreekt.");
      setTone("error");
      return;
    }
    if (!window.confirm(`Maak historische SKU '${skuName}' voor LOT ${lot.lot_number}?\n\nDaarna kun je de v0 kostprijs invullen.`)) {
      return;
    }
    setSaving(true);
    setStatus("Historische SKU aanmaken...");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/douano/create-historical-beer-sku`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beer_id: styleId,
          product_name: productName,
          sku_name: skuName,
          template_sku_id: templateSkuId.startsWith("sku:") ? templateSkuId.slice(4) : templateSkuId,
          format_article_id: templateSkuId.startsWith("format:") ? templateSkuId.slice(7) : "",
          douano_product_ids: lot.douano_product_ids || [],
          sku_codes: lot.sku_codes || [],
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const skuId = String(payload?.sku_id || "");
      if (payload?.sku && typeof payload.sku === "object") {
        setCreatedSkus((current) => {
          const createdId = String(payload.sku.id || "");
          if (!createdId || current.some((row) => String(row.id || "") === createdId)) return current;
          return [...current, payload.sku];
        });
      }
      prepareHistoricalLot(lot, {
        sku_id: skuId,
        sku_code: String(payload?.sku?.code || lot.sku_codes?.[0] || ""),
        product_name: String(payload?.sku?.name || skuName),
      });
      const refreshed = Number(payload?.snapshot_refresh?.computed ?? 0);
      const documents = Number(payload?.snapshot_refresh?.documents ?? 0);
      setStatus(`Historische SKU ${skuId} klaargezet. Omzet en Marge snapshots ververst voor ${refreshed} regels (${documents} documenten). Vul nu de v0 kostprijs in.`);
      setTone("success");
      setHistoricalSkuModalLot(null);
      await loadExternalLots();
      await loadInternalLotSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function saveOpeningLots() {
    setSaving(true);
    setStatus("Opening LOT regels opslaan...");
    setTone("");
    try {
      let saved = 0;
      let refreshed = 0;
      let documents = 0;
      for (const row of openingRows) {
        const hasContent = row.lot_number.trim() || row.sku_id.trim() || row.sku_code.trim() || row.purchase_price_input.trim();
        if (!hasContent) continue;
        const response = await fetch(`${API_BASE_URL}/integrations/lot-costs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...row,
            id: undefined,
            quantity: Number(row.quantity || 0) || 0,
            purchase_price_input: Number(row.purchase_price_input || 0) || 0,
            excise_per_unit: Number(row.excise_per_unit || 0) || 0,
            packaging_cost_per_unit: Number(row.packaging_cost_per_unit || 0) || 0,
            other_direct_cost_per_unit: Number(row.other_direct_cost_per_unit || 0) || 0,
          }),
        });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
        saved += 1;
        refreshed += Number(payload?.snapshot_refresh?.computed ?? 0);
        documents += Number(payload?.snapshot_refresh?.documents ?? 0);
      }
      setStatus(
        `${saved} Opening LOT regel${saved === 1 ? "" : "s"} opgeslagen. Omzet en Marge snapshots ververst voor ${refreshed} regels (${documents} documenten).`
      );
      setTone("success");
      setOpeningRows([createOpeningLotRow()]);
      await loadRecords();
      await loadInternalLotSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteStockImport(importBatchId: string) {
    if (!window.confirm("Weet je zeker dat je deze Voorraadhistoriek import wilt verwijderen?")) {
      return;
    }
    setSaving(true);
    setStatus("Import verwijderen...");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/stock-history/imports/${encodeURIComponent(importBatchId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setStatus(`${Number(payload?.deleted ?? 0)} Voorraadhistoriek regels verwijderd`);
      setTone("success");
      await loadStockImports();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setSaving(false);
    }
  }

  const summary = preview?.summary || {};
  const previewRows = preview?.items || [];
  const openingSummary = openingPreview?.summary || {};
  const openingPreviewRows = openingPreview?.items || [];
  const enrichedCount = Number(summary.updated ?? 0);
  const insertedCount = Number(summary.inserted ?? 0);
  const conflictCount = Number(summary.conflicts ?? 0);
  const missingTargetCount = Number(summary.missing_target ?? 0);
  const hasPreviewSummary = Number(summary.rows ?? 0) > 0;
  const hasEnrichmentSummary = "updated" in summary || "conflicts" in summary || "missing_target" in summary;
  const lotStatusCounts = useMemo(() => {
    const counts = { exact: 0, mapped: 0, near: 0, selected: 0, missing: 0 };
    for (const group of internalLotGroups) {
      const groupKey = group.style_id || group.style_name;
      for (const lot of group.lots || []) {
        const lotKey = `${groupKey}-${lot.lot_number}`;
        counts[lotStatus(lotKey, lot.lot_number)] += 1;
      }
    }
    return counts;
  }, [externalLots, internalLotGroups, selectedExternalLots]);
  const matchedInternalLotKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of internalLotGroups) {
      for (const lot of group.lots || []) {
        const key = lotExactKey(lot.lot_number);
        if (key) keys.add(key);
      }
    }
    return keys;
  }, [internalLotGroups]);
  const unusedExternalLots = useMemo(
    () =>
      externalLots.filter((lot) => {
        if (matchedInternalLotKeys.has(lotExactKey(lot.lot_number))) return false;
        return !(lot.canonical_lots || []).some((canonicalLot) => matchedInternalLotKeys.has(lotExactKey(canonicalLot)));
      }),
    [externalLots, matchedInternalLotKeys]
  );
  const internalLotsByNearKey = useMemo(() => {
    const map = new Map<string, Array<{ lot_number: string; style_name: string; versions: string[] }>>();
    for (const group of internalLotGroups) {
      for (const lot of group.lots || []) {
        const key = lotNearKey(lot.lot_number);
        if (!key) continue;
        const current = map.get(key) || [];
        current.push({
          lot_number: lot.lot_number,
          style_name: group.style_name || "Onbekende stijl",
          versions: lot.versions || [],
        });
        map.set(key, current);
      }
    }
    return map;
  }, [internalLotGroups]);
  const styleOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const group of internalLotGroups) {
      if (group.style_id) {
        options.set(group.style_id, group.style_name || group.style_id);
      }
    }
    for (const lot of externalLots) {
      (lot.style_ids || []).forEach((styleId, index) => {
        if (styleId) {
          options.set(styleId, lot.style_names?.[index] || styleId);
        }
      });
    }
    return Array.from(options.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [externalLots, internalLotGroups]);
  const classifiedUnusedExternalLots = useMemo(() => {
    const groups: Record<ExternalLotCategory, ExternalLotItem[]> = {
      variant: [],
      gift: [],
      historic: [],
      unknown_product: [],
      unclassified: [],
    };
    for (const lot of unusedExternalLots) {
      const text = `${lot.lot_number || ""} ${lot.product_name || ""}`.toLowerCase();
      const hasStyle = Boolean(lot.style_ids?.length || lot.style_names?.length);
      const hasNearInternalLot = Boolean(internalLotsByNearKey.get(lotNearKey(lot.lot_number))?.length);
      let category: ExternalLotCategory = "unclassified";
      if (hasNearInternalLot) {
        category = "variant";
      } else if (text.includes("geschenk")) {
        category = "gift";
      } else if (text.includes("wentersch")) {
        category = "historic";
      } else if (!hasStyle) {
        category = "unknown_product";
      }
      groups[category].push(lot);
    }
    return groups;
  }, [internalLotsByNearKey, unusedExternalLots]);
  const pendingVariantCount = useMemo(() => {
    let count = 0;
    for (const group of internalLotGroups) {
      for (const lot of group.lots || []) {
        count += unmappedNearExternalLots(lot.lot_number).length;
      }
    }
    return count;
  }, [externalLots, internalLotGroups]);
  const historicalModalLotKey = historicalSkuModalLot ? `${historicalSkuModalLot.lot_number}-${historicalSkuModalLot.product_name || ""}` : "";
  const historicalModalStyleId = historicalModalLotKey
    ? selectedHistoricalStyleByLot[historicalModalLotKey] || historicalSkuModalLot?.style_ids?.[0] || ""
    : "";
  const historicalModalTemplateSkuId = historicalModalLotKey ? selectedHistoricalFormatByLot[historicalModalLotKey] || "" : "";
  const historicalModalSkuName = historicalModalLotKey
    ? historicalSkuNameByLot[historicalModalLotKey] ||
      suggestedHistoricalSkuName(historicalModalStyleId, historicalModalTemplateSkuId, historicalSkuModalLot?.product_name || "")
    : "";

  return (
    <div className="beheer-data-workspace">
      <section className="module-card">
        <div className="module-card-title">Interne LOT nummers</div>
        <div className="module-card-text" style={{ marginTop: 4 }}>
          Interne LOTs uit kostprijsversies en inkoopfacturen, gegroepeerd per stijl.
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group">
            <span className="status-pill status-ok">Exacte match {lotStatusCounts.exact}</span>
            <span className="status-pill status-ok">Gekoppeld {lotStatusCounts.mapped}</span>
            <span className="status-pill status-warning">Bijna-match {lotStatusCounts.near}</span>
            <span className="status-pill status-warning">Te corrigeren {lotStatusCounts.selected}</span>
            <span className="status-pill status-warning">Varianten te koppelen {pendingVariantCount}</span>
            <span className="status-pill status-danger">Geen externe LOT {lotStatusCounts.missing}</span>
            <span className="pill">Ongebruikte externe LOTs {unusedExternalLots.length}</span>
          </div>
        </div>
        {unusedExternalLots.length > 0 ? (
          <details className="module-card compact-card" style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              Externe LOTs zonder interne match bekijken
            </summary>
            <div className="module-card-text" style={{ marginTop: 8 }}>
              Dit zijn Douano LOTs die niet exact of via een expliciete koppeling terugkomen als interne LOT.
            </div>
            <div className="editor-actions" style={{ marginTop: 10 }}>
              <div className="editor-actions-group">
                {(["variant", "gift", "historic", "unknown_product", "unclassified"] as ExternalLotCategory[]).map((category) => {
                  const meta = EXTERNAL_LOT_CATEGORY_META[category];
                  return (
                    <span key={category} className={`status-pill ${meta.tone}`}>
                      {meta.label} {classifiedUnusedExternalLots[category].length}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {(["variant", "gift", "historic", "unknown_product", "unclassified"] as ExternalLotCategory[]).map((category) => {
                const lots = classifiedUnusedExternalLots[category];
                if (!lots.length) return null;
                const meta = EXTERNAL_LOT_CATEGORY_META[category];
                return (
                  <details key={category} className="module-card compact-card" open={category === "variant"}>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                      {meta.label} <span className="pill" style={{ marginLeft: 8 }}>{lots.length}</span>
                    </summary>
                    <div className="module-card-text" style={{ marginTop: 8 }}>{meta.description}</div>
                    <div className="data-table" style={{ marginTop: 10, overflowX: "visible" }}>
                      <table style={{ tableLayout: "fixed", width: "100%" }}>
                        <thead>
                          <tr>
                            <th style={{ width: "12%" }}>External LOT</th>
                            <th style={{ width: "20%" }}>Product</th>
                            <th style={{ width: "13%" }}>Stijl</th>
                            <th style={{ width: "13%" }}>Interne hint</th>
                            <th style={{ width: 64 }}>Regels</th>
                            <th style={{ width: 112 }}>Laatste beweging</th>
                            <th style={{ width: "24%" }}>Actie</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lots.slice(0, 50).map((lot) => {
                            const hints = internalLotsByNearKey.get(lotNearKey(lot.lot_number)) || [];
                            const lotKey = `${lot.lot_number}-${lot.product_name || ""}`;
                            const canCreateHistoricalSku = category === "historic" || category === "unknown_product";
                            const selectedStyle = selectedHistoricalStyleByLot[lotKey] || lot.style_ids?.[0] || "";
                            return (
                              <tr key={`${category}-${lot.lot_number}-${lot.product_name || ""}`}>
                                <td style={{ wordBreak: "break-word" }}><code>{lot.lot_number || "-"}</code></td>
                                <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{lot.product_name || "-"}</td>
                                <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{lot.style_names?.join(", ") || "-"}</td>
                                <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                                  {hints.length
                                    ? hints
                                        .slice(0, 3)
                                        .map((hint) => `${hint.lot_number} ${hint.versions.join("/")}`.trim())
                                        .join(", ")
                                    : "-"}
                                </td>
                                <td>{Number(lot.rows || 0)}</td>
                                <td>{lot.last_movement_date || "-"}</td>
                                <td>
                                  {canCreateHistoricalSku ? (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        className="editor-button editor-button-secondary"
                                        disabled={saving}
                                        onClick={() => openHistoricalSkuModal(lot)}
                                        style={{ minWidth: 0 }}
                                      >
                                        Maak historische SKU
                                      </button>
                                      <button
                                        type="button"
                                        className="editor-button editor-button-secondary"
                                        disabled={saving}
                                        onClick={() => prepareHistoricalLot(lot)}
                                        style={{ minWidth: 0 }}
                                      >
                                        Alleen v0 LOT
                                      </button>
                                    </div>
                                  ) : (
                                    meta.action
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {lots.length > 50 ? (
                            <tr>
                              <td colSpan={7} className="dataset-empty">
                                Nog {lots.length - 50} externe LOTs verborgen in deze categorie.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ) : null}
        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Internal LOT</th>
                <th style={{ width: "48%" }}>External LOT</th>
              </tr>
            </thead>
            <tbody>
              {internalLotGroups.map((group) => {
                const groupKey = group.style_id || group.style_name;
                return (
                  <Fragment key={groupKey}>
                    <tr key={`${groupKey}-style`}>
                      <td colSpan={2}>
                        <strong>{group.style_name || "Onbekende stijl"}</strong>{" "}
                        <span className="pill" style={{ marginLeft: 8 }}>
                          {Number(group.lot_count || group.lots?.length || 0)} LOTs
                        </span>
                      </td>
                    </tr>
                    {(group.lots || []).map((lot) => {
                      const lotKey = `${groupKey}-${lot.lot_number}`;
                      const selectedLot = selectedOrMatchedExternalLot(lotKey, lot.lot_number);
                      const status = lotStatus(lotKey, lot.lot_number);
                      const selectedIsMapped = externalLots.some(
                        (externalLot) =>
                          lotExactKey(externalLot.lot_number) === lotExactKey(selectedLot) &&
                          (externalLot.canonical_lots || []).some((canonicalLot) => lotExactKey(canonicalLot) === lotExactKey(lot.lot_number))
                      );
                      const showUpdate = selectedLot.trim() && lotExactKey(selectedLot) !== lotExactKey(lot.lot_number) && !selectedIsMapped;
                      const options = externalOptionsFor(lotKey, lot.lot_number);
                      const variantLots = unmappedNearExternalLots(lot.lot_number);
                      return (
                        <tr key={lotKey}>
                          <td style={{ verticalAlign: "top", paddingLeft: 28 }}>
                            <details>
                              <summary style={{ cursor: "pointer" }}>
                                <code>{lot.lot_number || "-"}</code>{" "}
                                <span className="module-card-text">{(lot.versions || []).join("/")}</span>
                                <span className="pill" style={{ marginLeft: 8 }}>
                                  {Number(lot.sku_count || lot.skus?.length || 0)} SKU&apos;s
                                </span>
                                <span className={`status-pill ${lotStatusClass(status)}`} style={{ marginLeft: 8 }}>
                                  {lotStatusLabel(status)}
                                </span>
                              </summary>
                              <div style={{ display: "grid", gap: 6, marginTop: 8, paddingLeft: 18 }}>
                                {(lot.skus || []).map((sku) => (
                                  <div key={`${lot.lot_number}-${sku.sku_id || sku.sku_code || sku.label}`}>
                                    {sku.label || sku.name || sku.sku_code || sku.sku_id || "-"}
                                    {sku.sku_code ? <span className="module-card-text"> {sku.sku_code}</span> : null}
                                  </div>
                                ))}
                                {!lot.skus?.length ? <div className="module-card-text">Geen SKU&apos;s gevonden.</div> : null}
                              </div>
                            </details>
                          </td>
                          <td style={{ verticalAlign: "top" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 42px", gap: 8, alignItems: "center" }}>
                              <datalist id={`external-lot-options-${domId(lotKey)}`}>
                                {options.map((externalLot) => (
                                  <option
                                    key={externalLot.lot_number}
                                    value={externalLot.lot_number}
                                    label={`${externalLot.lot_number}${externalLot.product_name ? ` - ${externalLot.product_name}` : ""}${
                                      externalLot.style_names?.length ? ` - ${externalLot.style_names.join(", ")}` : ""
                                    }${externalLot.canonical_lots?.length ? ` -> ${externalLot.canonical_lots.join(", ")}` : ""}${
                                      externalLot.rows ? ` (${externalLot.rows} regels)` : ""
                                    }`}
                                  />
                                ))}
                              </datalist>
                              <input
                                className="editor-input"
                                list={`external-lot-options-${domId(lotKey)}`}
                                placeholder="Zoek externe LOT"
                                style={{ width: "100%", minWidth: 420 }}
                                value={selectedLot}
                                onChange={(event) =>
                                  setSelectedExternalLots((current) => ({
                                    ...current,
                                    [lotKey]: event.target.value,
                                  }))
                                }
                              />
                              {showUpdate ? (
                                <button
                                  type="button"
                                  className="editor-button editor-button-secondary"
                                  title="Externe LOT koppelen aan hoofd-LOT"
                                  aria-label="Externe LOT koppelen aan hoofd-LOT"
                                  disabled={saving || !(lot.version_ids || []).length}
                                  onClick={() => void mapExternalLotToInternal(group, lot, lotKey)}
                                  style={{ minWidth: 40, width: 40, paddingInline: 0 }}
                                >
                                  <Link2 size={15} aria-hidden="true" />
                                </button>
                              ) : (status === "exact" || status === "mapped") && selectedLot ? (
                                <button
                                  type="button"
                                  className="editor-button editor-button-secondary"
                                  title="Omzet en Marge snapshots verversen"
                                  aria-label="Omzet en Marge snapshots verversen"
                                  disabled={saving}
                                  onClick={() => void refreshLotSnapshots(selectedLot)}
                                  style={{ minWidth: 40, width: 40, paddingInline: 0 }}
                                >
                                  <RefreshCw size={15} aria-hidden="true" />
                                </button>
                              ) : (
                                <span aria-hidden="true" />
                              )}
                            </div>
                            {variantLots.length > 0 ? (
                              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                                {variantLots.map((variantLot) => (
                                  <div
                                    key={`${lotKey}-${variantLot.lot_number}`}
                                    className="module-card-text"
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "minmax(0, 1fr) 42px",
                                      gap: 8,
                                      alignItems: "center",
                                    }}
                                  >
                                    <span>
                                      Nog te koppelen variant: <code>{variantLot.lot_number}</code>
                                      {variantLot.product_name ? ` - ${variantLot.product_name}` : ""}
                                      {variantLot.rows ? ` (${variantLot.rows} regels)` : ""}
                                    </span>
                                    <button
                                      type="button"
                                      className="editor-button editor-button-secondary"
                                      title={`Externe LOT ${variantLot.lot_number} koppelen aan ${lot.lot_number}`}
                                      aria-label={`Externe LOT ${variantLot.lot_number} koppelen aan ${lot.lot_number}`}
                                      disabled={saving || !(lot.version_ids || []).length}
                                      onClick={() => void mapExternalLotToInternal(group, lot, lotKey, variantLot.lot_number)}
                                      style={{ minWidth: 40, width: 40, paddingInline: 0 }}
                                    >
                                      <Link2 size={15} aria-hidden="true" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {!group.lots?.length ? (
                      <tr key={`${groupKey}-empty`}>
                        <td colSpan={2} style={{ paddingLeft: 28 }}>Geen interne LOTs gevonden.</td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!internalLotGroups.length ? (
                <tr>
                  <td colSpan={2}>Geen interne LOTs gevonden.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card" style={{ overflow: "hidden" }}>
        <div className="module-card-title">Voorraadhistoriek import</div>
        <div className="module-card-text" style={{ marginTop: 4 }}>
          Douano stock-history is de hoofdbron voor LOTs. Gebruik Excel alleen om het bestand te controleren, als fallback te importeren,
          of om opgeslagen Douano-regels zonder LOT aan te vullen.
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group">
            <input
              className="editor-input"
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
            <button
              type="button"
              className="editor-button editor-button-secondary"
              disabled={saving}
              onClick={() => void upload("preview")}
            >
              Controleer
            </button>
            <button type="button" className="editor-button" disabled={saving || !preview} onClick={() => void upload("confirm")}>
              Import opslaan
            </button>
            <button type="button" className="editor-button editor-button-secondary" disabled={saving || !file} onClick={() => void enrichMissingLots()}>
              Verrijk ontbrekende LOTs
            </button>
            <a className="editor-button editor-button-secondary" href={`${API_BASE_URL}/integrations/lot-costs/stock-history/example`}>
              Download voorbeeld
            </a>
          </div>
          <div className="editor-actions-group">
            <span className="pill" title="Aantal regels dat uit het geselecteerde Excelbestand is gelezen.">
              Rijen in bestand {Number(summary.rows ?? 0)}
            </span>
            <span className="pill" title="Excel-regels die we konden koppelen aan een verkoopregel in facturen of orders.">
              Gekoppeld {Number(summary.matched ?? 0)}
            </span>
            <span className="pill" title="Excel-regels waarvoor geen verkoopregel is gevonden.">
              Niet gekoppeld {Number(summary.unmatched ?? 0)}
            </span>
            <span className="pill" title="Excel-regels waarin Batchnummer/LOT leeg is.">
              Zonder LOT in Excel {Number(summary.missing_lot ?? 0)}
            </span>
            {hasEnrichmentSummary ? (
              <>
                <span className="pill" title="Aantal opgeslagen Douano-regels zonder LOT dat is aangevuld met dit Excelbestand.">
                  Aangevuld {enrichedCount}
                </span>
                <span className="pill" title="Aantal matchende verkoopregels waarvoor Excel een fallback LOT-regel heeft toegevoegd.">
                  Toegevoegd {insertedCount}
                </span>
                <span className="pill" title="Excel-regels met een ander LOT dan al in Douano/opslag bekend is.">
                  Conflicten {conflictCount}
                </span>
                <span className="pill" title="Excel-regels die niet teruggevonden zijn in de opgeslagen Douano LOT-regels.">
                  Geen Douano-match {missingTargetCount}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {hasPreviewSummary ? (
          <div className="module-card-text" style={{ marginTop: 10 }}>
            Lees dit als controle van het geselecteerde Excelbestand: gekoppelde regels kunnen we terugvinden in verkoopdata,
            regels zonder LOT kunnen niets verrijken, en verrijken past alleen bestaande Douano-regels aan waar het LOT nog leeg is.
          </div>
        ) : null}

        {status ? (
          <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
            {status}
          </div>
        ) : null}

        {previewRows.length ? (
          <div className="data-table" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Transactie</th>
                  <th>SKU</th>
                  <th>LOT</th>
                  <th>Product</th>
                  <th>Bedrijf</th>
                  <th style={{ textAlign: "right" }}>Aantal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.transaction_number}-${row.sku_code}-${row.lot_number}-${index}`}>
                    <td><code>{row.transaction_number || "-"}</code></td>
                    <td><code>{row.sku_code || "-"}</code></td>
                    <td><code>{row.lot_number || "-"}</code></td>
                    <td>{row.product_name || "-"}</td>
                    <td>{row.company_name || "-"}</td>
                    <td style={{ textAlign: "right" }}>{Number(row.quantity || 0)}</td>
                    <td>
                      <span
                        className="pill"
                        title={(row.match?.reasons || []).join(", ")}
                        style={{
                          background:
                            row.match?.status === "matched" ? "rgba(95,255,156,0.16)" : "rgba(255,206,77,0.16)",
                        }}
                      >
                        {row.match?.status === "matched" ? "gekoppeld" : "controleer"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Import</th>
                <th>Bestand</th>
                <th>Datum</th>
                <th style={{ textAlign: "right" }}>Regels</th>
                <th style={{ minWidth: 120 }} />
              </tr>
            </thead>
            <tbody>
              {stockImports.map((row) => (
                <tr key={`${row.import_batch_id}-${row.source_filename || ""}`}>
                  <td><code>{row.import_batch_id}</code></td>
                  <td>{row.source_filename || "-"}</td>
                  <td>{row.imported_at ? new Date(row.imported_at).toLocaleString("nl-NL") : "-"}</td>
                  <td style={{ textAlign: "right" }}>{Number(row.row_count || 0)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      disabled={saving}
                      onClick={() => void deleteStockImport(row.import_batch_id)}
                    >
                      Verwijder
                    </button>
                  </td>
                </tr>
              ))}
              {!stockImports.length ? (
                <tr>
                  <td colSpan={5}>Nog geen Voorraadhistoriek imports.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card" id="historische-lot-invoer">
        <div className="module-card-header">
          <div className="module-card-title">Opening LOT / historische voorraad</div>
          <div className="module-card-text">
            Leg historische LOT kostprijzen vast voor voorraad die al aanwezig was voordat de LOT-koppeling actief werd.
          </div>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group">
            <input
              className="editor-input"
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt"
              onChange={(event) => {
                setOpeningFile(event.target.files?.[0] ?? null);
                setOpeningPreview(null);
              }}
            />
            <button
              type="button"
              className="editor-button editor-button-secondary"
              disabled={saving}
              onClick={() => void uploadOpeningLots("preview")}
            >
              Controleer
            </button>
            <button
              type="button"
              className="editor-button"
              disabled={saving || !openingPreview}
              onClick={() => void uploadOpeningLots("confirm")}
            >
              Import opslaan
            </button>
            <a className="editor-button editor-button-secondary" href={`${API_BASE_URL}/integrations/lot-costs/opening-lots/example`}>
              Download voorbeeld
            </a>
          </div>
          <div className="editor-actions-group">
            <span className="pill">Rijen {Number(openingSummary.rows ?? 0)}</span>
            <span className="pill">Ok {Number(openingSummary.ok ?? 0)}</span>
            <span className="pill">Check {Number(openingSummary.check ?? 0)}</span>
          </div>
        </div>
        {openingPreviewRows.length ? (
          <div className="data-table" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>LOT</th>
                  <th>SKU code</th>
                  <th>Product</th>
                  <th>Datum</th>
                  <th style={{ textAlign: "right" }}>Aantal ref.</th>
                  <th style={{ textAlign: "right" }}>Inkoopprijs</th>
                  <th style={{ textAlign: "right" }}>Accijns</th>
                  <th>Incl. accijns</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {openingPreviewRows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.supplier}-${row.lot_number}-${row.sku_code}-${index}`}>
                    <td>{row.supplier || "-"}</td>
                    <td><code>{row.lot_number || "-"}</code></td>
                    <td><code>{row.sku_code || "-"}</code></td>
                    <td>{row.product_name || "-"}</td>
                    <td>{row.source_date || "-"}</td>
                    <td style={{ textAlign: "right" }}>{Number(row.quantity || 0)}</td>
                    <td style={{ textAlign: "right" }}>{euro(row.purchase_price_input)}</td>
                    <td style={{ textAlign: "right" }}>{euro(row.excise_per_unit)}</td>
                    <td>{row.purchase_price_includes_excise ? "Ja" : "Nee"}</td>
                    <td>
                      <span
                        className="pill"
                        title={(row.reasons || []).join(", ")}
                        style={{ background: row.status === "ok" ? "rgba(95,255,156,0.16)" : "rgba(255,206,77,0.16)" }}
                      >
                        {row.status === "ok" ? "ok" : "check"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Supplier</th>
                <th style={{ minWidth: 150 }}>LOT nummer</th>
                <th style={{ minWidth: 240 }}>SKU</th>
                <th style={{ minWidth: 120 }}>SKU code</th>
                <th style={{ minWidth: 140 }}>Datum</th>
                <th style={{ minWidth: 130, textAlign: "right" }}>Aantal ref.</th>
                <th style={{ minWidth: 150, textAlign: "right" }}>Inkoopprijs</th>
                <th style={{ minWidth: 130, textAlign: "right" }}>Accijns</th>
                <th style={{ minWidth: 150 }}>Inclusief accijns</th>
                <th style={{ minWidth: 120 }} />
              </tr>
            </thead>
            <tbody>
              {openingRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <select className="editor-input" value={row.supplier} onChange={(e) => updateOpeningRow(row.id, { supplier: e.target.value })}>
                      {SUPPLIERS.map((supplier) => (
                        <option key={supplier} value={supplier}>{supplier}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="editor-input" value={row.lot_number} onChange={(e) => updateOpeningRow(row.id, { lot_number: e.target.value })} />
                  </td>
                  <td>
                    <select
                      className="editor-input"
                      value={row.sku_id}
                      onChange={(e) => {
                        const option = skuOptions.find((item) => item.id === e.target.value);
                        updateOpeningRow(row.id, {
                          sku_id: option?.id || "",
                          sku_code: option?.sku_code || "",
                          product_name: option?.label || "",
                        });
                      }}
                    >
                      <option value="">Kies SKU</option>
                      {row.sku_id && !skuOptions.some((option) => option.id === row.sku_id) ? (
                        <option value={row.sku_id}>{row.product_name || row.sku_code || row.sku_id}</option>
                      ) : null}
                      {skuOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="editor-input" value={row.sku_code} onChange={(e) => updateOpeningRow(row.id, { sku_code: e.target.value })} />
                  </td>
                  <td>
                    <input className="editor-input" type="date" value={row.source_date} onChange={(e) => updateOpeningRow(row.id, { source_date: e.target.value })} />
                  </td>
                  <td>
                    <input className="editor-input" type="number" value={row.quantity} onChange={(e) => updateOpeningRow(row.id, { quantity: e.target.value })} style={{ textAlign: "right" }} />
                  </td>
                  <td>
                    <input className="editor-input" type="number" step="0.01" value={row.purchase_price_input} onChange={(e) => updateOpeningRow(row.id, { purchase_price_input: e.target.value })} style={{ textAlign: "right" }} />
                  </td>
                  <td>
                    <input className="editor-input" type="number" step="0.01" value={row.excise_per_unit} onChange={(e) => updateOpeningRow(row.id, { excise_per_unit: e.target.value })} style={{ textAlign: "right" }} />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={row.purchase_price_includes_excise}
                        onChange={(e) => updateOpeningRow(row.id, { purchase_price_includes_excise: e.target.checked })}
                      />
                      Ja
                    </label>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      disabled={openingRows.length <= 1}
                      onClick={() => removeOpeningRow(row.id)}
                      title="Regel verwijderen"
                    >
                      Verwijder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={addOpeningRow}>
              Regel toevoegen
            </button>
          </div>
          <div className="editor-actions-group">
            <button type="button" className="editor-button" disabled={saving} onClick={() => void saveOpeningLots()}>
              Regels opslaan
            </button>
          </div>
        </div>
      </section>

      <section className="module-card">
        <div className="module-card-title">LOT kostprijzen</div>
        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>LOT</th>
                <th>SKU</th>
                <th>Supplier</th>
                <th>Bron</th>
                <th>Datum</th>
                <th style={{ textAlign: "right" }}>Inkoop input</th>
                <th style={{ textAlign: "right" }}>Inkoop ex accijns</th>
                <th style={{ textAlign: "right" }}>Accijns</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 200).map((record) => (
                <tr key={String(record.id)}>
                  <td><code>{String(record.lot_number || "-")}</code></td>
                  <td>{String(record.product_name || record.sku_code || record.sku_id || "-")}</td>
                  <td>{String(record.supplier || "-")}</td>
                  <td>{String(record.source_type || "-")}</td>
                  <td>{String(record.source_date || "-")}</td>
                  <td style={{ textAlign: "right" }}>{euro(record.purchase_price_input)}</td>
                  <td style={{ textAlign: "right" }}>{euro(record.purchase_price_ex_excise)}</td>
                  <td style={{ textAlign: "right" }}>{euro(record.excise_per_unit)}</td>
                </tr>
              ))}
              {!records.length ? (
                <tr>
                  <td colSpan={8}>Nog geen LOT kostprijzen.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {historicalSkuModalLot ? (
        <div className="cpq-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="historical-sku-modal-title">
          <div className="cpq-modal">
            <div className="cpq-modal-header">
              <div>
                <h3 className="cpq-modal-title" id="historical-sku-modal-title">
                  Historische SKU maken
                </h3>
                <div className="cpq-modal-subtitle">
                  LOT <code>{historicalSkuModalLot.lot_number}</code>
                  {historicalSkuModalLot.product_name ? ` - ${historicalSkuModalLot.product_name}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setHistoricalSkuModalLot(null)}
                disabled={saving}
              >
                Sluiten
              </button>
            </div>
            <div className="cpq-modal-body">
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="module-card-text">Stijl</span>
                  <select
                    className="editor-input"
                    value={historicalModalStyleId}
                    onChange={(event) => {
                      const nextStyleId = event.target.value;
                      setSelectedHistoricalStyleByLot((current) => ({
                        ...current,
                        [historicalModalLotKey]: nextStyleId,
                      }));
                      const suggestedName = suggestedHistoricalSkuName(
                        nextStyleId,
                        historicalModalTemplateSkuId,
                        historicalSkuModalLot.product_name || ""
                      );
                      if (suggestedName) {
                        setHistoricalSkuNameByLot((current) => ({
                          ...current,
                          [historicalModalLotKey]: suggestedName,
                        }));
                      }
                    }}
                  >
                    <option value="">Kies stijl</option>
                    {styleOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="module-card-text">Afvuleenheid / interne SKU</span>
                  <select
                    className="editor-input"
                    value={historicalModalTemplateSkuId}
                    onChange={(event) =>
                      setHistoricalFormatSelection(historicalModalLotKey, historicalSkuModalLot, historicalModalStyleId, event.target.value)
                    }
                  >
                    <option value="">Kies afvuleenheid / interne SKU</option>
                    {formatSkuOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="module-card-text">SKU naam</span>
                  <input
                    className="editor-input"
                    value={historicalModalSkuName}
                    onChange={(event) =>
                      setHistoricalSkuNameByLot((current) => ({
                        ...current,
                        [historicalModalLotKey]: event.target.value,
                      }))
                    }
                    placeholder="Bijvoorbeeld Berlewalde IPA - Fust 20L"
                  />
                </label>
              </div>
            </div>
            <div className="cpq-modal-footer">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setHistoricalSkuModalLot(null)}
                disabled={saving}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => void createHistoricalSkuForLot(historicalSkuModalLot)}
                disabled={saving}
              >
                Maak historische SKU
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
