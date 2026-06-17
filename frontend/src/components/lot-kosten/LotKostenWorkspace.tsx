"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

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

type LotCandidate = {
  lot_number: string;
  product_name?: string;
  sku_code?: string;
  rows?: number;
  last_movement_date?: string;
  source?: string;
  label?: string;
  source_date?: string;
  version_id?: string;
  year?: number;
};

type LotSkuDetail = {
  sku_id?: string;
  sku_code?: string;
  sku_name?: string;
  rows?: number;
};

type LotReconciliationRow = {
  sku_code: string;
  sku_id: string;
  sku_name: string;
  internal_lot_number: string;
  internal_label?: string;
  internal_labels?: string[];
  internal_source?: string;
  internal_version_ids?: string[];
  douano_lot_number: string;
  douano_options: LotCandidate[];
  rows: number;
  last_movement_date: string;
  status: "matched" | "near_match" | "missing_douano" | "douano_only";
  sku_details?: LotSkuDetail[];
  douano_sku_details?: LotSkuDetail[];
};

type LotReconciliationGroup = {
  style_id: string;
  style_name: string;
  rows: LotReconciliationRow[];
  summary: Record<string, number>;
};

type LotReconciliationLotGroup = {
  key: string;
  internal_lot_number: string;
  label: string;
  rows: LotReconciliationRow[];
  status: LotReconciliationRow["status"];
  douano_lots: string[];
  douano_rows: number;
  last_movement_date: string;
};

const SUPPLIERS = ["Beerselect", "Groenlo", "Wentersch", "Eigen productie"];

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

function lotStatusLabel(status: LotReconciliationRow["status"]) {
  if (status === "matched") return "match";
  if (status === "near_match") return "bijna-match";
  if (status === "douano_only") return "alleen Douano";
  return "niet gekoppeld";
}

function lotStatusClass(status: LotReconciliationRow["status"]) {
  if (status === "matched") return "status-ok";
  if (status === "near_match") return "status-warning";
  return "status-danger";
}

function lotRowKey(row: LotReconciliationRow) {
  return `${row.sku_id || row.sku_code || row.sku_name}|${row.internal_lot_number || "no-internal"}|${row.douano_lot_number || "no-douano"}`;
}

function internalLotLabel(row: LotReconciliationRow) {
  const labels = Array.isArray(row.internal_labels) ? row.internal_labels.filter(Boolean) : [];
  if (labels.length) return labels.join(", ");
  return row.internal_label || "";
}

function statusRank(status: LotReconciliationRow["status"]) {
  if (status === "matched") return 0;
  if (status === "near_match") return 1;
  if (status === "missing_douano") return 2;
  return 3;
}

function worstStatus(rows: LotReconciliationRow[]): LotReconciliationRow["status"] {
  return rows.reduce<LotReconciliationRow["status"]>(
    (worst, row) => (statusRank(row.status) > statusRank(worst) ? row.status : worst),
    "matched"
  );
}

function uniqueTexts(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const text = String(value ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function uniqueInternalLotCount(group: LotReconciliationGroup) {
  return uniqueTexts(group.rows.map((row) => row.internal_lot_number)).length;
}

function uniqueDouanoLotCount(group: LotReconciliationGroup) {
  return uniqueTexts(group.rows.map((row) => row.douano_lot_number)).length;
}

function skuDetailLabel(detail: LotSkuDetail) {
  const name = String(detail.sku_name || "").trim();
  const code = String(detail.sku_code || "").trim();
  const id = String(detail.sku_id || "").trim();
  if (name && code) return `${name} ${code}`;
  return name || code || id || "-";
}

function groupRowsByInternalLot(group: LotReconciliationGroup): LotReconciliationLotGroup[] {
  const buckets = new Map<string, LotReconciliationRow[]>();
  group.rows.forEach((row) => {
    const internalLot = String(row.internal_lot_number || "").trim();
    const key = internalLot ? `internal:${internalLot.toLowerCase()}` : `douano:${String(row.douano_lot_number || row.sku_code || row.sku_id).toLowerCase()}`;
    buckets.set(key, [...(buckets.get(key) || []), row]);
  });

  const out = Array.from(buckets.entries()).map(([key, rows]) => {
    const first = rows[0];
    const internalLot = String(first?.internal_lot_number || "").trim();
    const labels = uniqueTexts(rows.flatMap((row) => (Array.isArray(row.internal_labels) ? row.internal_labels : [row.internal_label])));
    const douanoLots = uniqueTexts(rows.map((row) => row.douano_lot_number));
    const lastDate = rows
      .map((row) => String(row.last_movement_date || ""))
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    return {
      key,
      internal_lot_number: internalLot,
      label: internalLot ? `${internalLot}${labels.length ? ` ${labels.join(", ")}` : ""}` : `Alleen Douano: ${douanoLots.join(", ") || "zonder interne LOT"}`,
      rows,
      status: worstStatus(rows),
      douano_lots: douanoLots,
      douano_rows: rows.reduce((sum, row) => sum + Number(row.rows || 0), 0),
      last_movement_date: lastDate,
    };
  });

  out.sort((a, b) => {
    if (!a.internal_lot_number && b.internal_lot_number) return 1;
    if (a.internal_lot_number && !b.internal_lot_number) return -1;
    return a.label.localeCompare(b.label, "nl-NL");
  });
  return out;
}

export function LotKostenWorkspace({ skus, year = new Date().getFullYear() }: { skus: GenericRecord[]; year?: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPayload | null>(null);
  const [openingFile, setOpeningFile] = useState<File | null>(null);
  const [openingPreview, setOpeningPreview] = useState<OpeningLotImportPayload | null>(null);
  const [records, setRecords] = useState<GenericRecord[]>([]);
  const [stockImports, setStockImports] = useState<StockHistoryImport[]>([]);
  const [reconciliationGroups, setReconciliationGroups] = useState<LotReconciliationGroup[]>([]);
  const [selectedDouanoLots, setSelectedDouanoLots] = useState<Record<string, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedLotGroups, setExpandedLotGroups] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [saving, setSaving] = useState(false);

  const [openingRows, setOpeningRows] = useState(() => [createOpeningLotRow()]);

  const skuOptions = useMemo(() => {
    return (skus || [])
      .filter((row) => row && row.active !== false && row.actief !== false)
      .map((row) => ({
        id: String(row.id || ""),
        label: skuLabel(row),
        sku_code: String(row.sku || row.code || row.external_sku || ""),
      }))
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [skus]);

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

  async function loadReconciliation() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/reconciliation?year=${encodeURIComponent(String(year))}&limit=1000`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      setReconciliationGroups(groups);
      setSelectedDouanoLots((prev) => {
        const next = { ...prev };
        groups.forEach((group: LotReconciliationGroup) => {
          group.rows.forEach((row) => {
            const key = lotRowKey(row);
            if (!(key in next)) {
              next[key] = row.douano_lot_number || row.douano_options?.[0]?.lot_number || "";
            }
          });
        });
        return next;
      });
      setExpandedGroups((prev) => {
        if (Object.keys(prev).length) return prev;
        const next: Record<string, boolean> = {};
        groups.slice(0, 5).forEach((group: LotReconciliationGroup) => {
          const needsAttention = Number(group.summary?.near_match || 0) + Number(group.summary?.missing || 0) + Number(group.summary?.douano_only || 0);
          next[group.style_id] = needsAttention > 0;
        });
        return next;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void loadRecords();
    void loadStockImports();
    void loadReconciliation();
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

  async function saveOpeningLots() {
    setSaving(true);
    setStatus("Opening LOT regels opslaan...");
    setTone("");
    try {
      let saved = 0;
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
      }
      setStatus(`${saved} Opening LOT regel${saved === 1 ? "" : "s"} opgeslagen`);
      setTone("success");
      setOpeningRows([createOpeningLotRow()]);
      await loadRecords();
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

  async function correctInternalLot(row: LotReconciliationRow) {
    const internalLot = String(row.internal_lot_number || "").trim();
    const selectedDouanoLot = String(selectedDouanoLots[lotRowKey(row)] || row.douano_lot_number || "").trim();
    if (!internalLot) {
      setStatus("Geen interne LOT gevonden om gelijk te zetten.");
      setTone("error");
      return;
    }
    if (!selectedDouanoLot) {
      setStatus("Kies eerst de Douano LOT waar deze interne LOT bij hoort.");
      setTone("error");
      return;
    }
    if (!window.confirm(`Internal LOT ${internalLot} for ${row.sku_code} will be changed to Douano LOT ${selectedDouanoLot}. Continue?`)) {
      return;
    }
    setSaving(true);
    setStatus("Interne LOT gelijkzetten aan Douano...");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/correct-internal-lot`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_id: row.sku_id,
          sku_code: row.sku_code,
          douano_lot_number: selectedDouanoLot,
          internal_lot_number: internalLot,
          internal_version_ids: row.internal_version_ids || [],
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      const result = payload?.result || {};
      setStatus(
        `Internal LOT ${internalLot} updated to ${selectedDouanoLot}: ${Number(result.updated_cost_versions || 0)} cost version(s), ${Number(result.updated_cost_version_lots || 0)} canonical LOT row(s), ${Number(result.updated_lot_cost_records || 0)} LOT cost row(s).`
      );
      setTone("success");
      await loadRecords();
      await loadReconciliation();
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
  const reconciliationSummary = useMemo(() => {
    return reconciliationGroups.reduce(
      (acc, group) => {
        acc.total += group.rows.length;
        acc.matched += Number(group.summary?.matched || 0);
        acc.near_match += Number(group.summary?.near_match || 0);
        acc.missing += Number(group.summary?.missing || 0);
        acc.douano_only += Number(group.summary?.douano_only || 0);
        return acc;
      },
      { total: 0, matched: 0, near_match: 0, missing: 0, douano_only: 0 } as Record<string, number>
    );
  }, [reconciliationGroups]);

  return (
    <div className="beheer-data-workspace">
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

      <section className="module-card lot-reconciliation-card">
        <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="module-card-title">LOT-afstemming Douano naar intern</div>
            <div className="module-card-text">
              Douano LOT is the source of truth. Expand a style to compare our internal LOTs from cost prices/invoices with
              the LOTs Douano used on sales rows. Near matches can be corrected here.
            </div>
          </div>
          <button type="button" className="editor-button editor-button-secondary" disabled={saving} onClick={() => void loadReconciliation()}>
            Ververs
          </button>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group">
            <span className="pill">Totaal {reconciliationSummary.total}</span>
            <span className="pill" style={{ background: "#dcfce7" }}>Exact {reconciliationSummary.matched}</span>
            <span className="pill" style={{ background: "#fef3c7" }}>Bijna-match {reconciliationSummary.near_match}</span>
            <span className="pill" style={{ background: "#fee2e2" }}>Geen Douano match {reconciliationSummary.missing}</span>
            <span className="pill" style={{ background: "#fee2e2" }}>Alleen Douano {reconciliationSummary.douano_only}</span>
          </div>
        </div>
        <div className="data-table lot-reconciliation-table" style={{ marginTop: 12, maxWidth: "100%" }}>
          <table style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "52%" }}>Style / SKU</th>
                <th style={{ width: "14%", textAlign: "right" }}>Internal LOTs</th>
                <th style={{ width: "14%", textAlign: "right" }}>Douano LOTs</th>
                <th style={{ width: "20%" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationGroups.map((group) => {
                const open = expandedGroups[group.style_id] ?? false;
                const issues = Number(group.summary?.near_match || 0) + Number(group.summary?.missing || 0) + Number(group.summary?.douano_only || 0);
                return (
                  <Fragment key={group.style_id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.style_id]: !open }))}
                        >
                          {open ? "v" : ">"} {group.style_name}
                        </button>
                      </td>
                      <td style={{ textAlign: "right" }}>{uniqueInternalLotCount(group)}</td>
                      <td style={{ textAlign: "right" }}>{uniqueDouanoLotCount(group)}</td>
                      <td>
                        <span className={`status-pill ${issues ? "status-warning" : "status-ok"}`}>
                          {issues ? `${issues} to check` : "ok"}
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={4}>
                          <div className="data-table nested-table lot-reconciliation-nested" style={{ maxWidth: "100%" }}>
                            <table style={{ tableLayout: "fixed", width: "100%" }}>
                              <thead>
                                <tr>
                                  <th style={{ width: "42%" }}>Calculation app LOT</th>
                                  <th style={{ width: "44%" }}>Douano LOTs / SKU details</th>
                                  <th style={{ width: "14%" }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupRowsByInternalLot(group).map((lotGroup) => {
                                  const lotOpen = expandedLotGroups[`${group.style_id}|${lotGroup.key}`] ?? false;
                                  return (
                                    <Fragment key={lotGroup.key}>
                                      <tr className="lot-reconciliation-lot-row">
                                        <td>
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={() =>
                                              setExpandedLotGroups((prev) => ({
                                                ...prev,
                                                [`${group.style_id}|${lotGroup.key}`]: !lotOpen,
                                              }))
                                            }
                                          >
                                            {lotOpen ? "v" : ">"} {lotGroup.internal_lot_number ? (
                                              <>
                                                <code>{lotGroup.internal_lot_number}</code>
                                                {lotGroup.label.replace(lotGroup.internal_lot_number, "").trim() ? ` ${lotGroup.label.replace(lotGroup.internal_lot_number, "").trim()}` : ""}
                                              </>
                                            ) : (
                                              lotGroup.label
                                            )}
                                          </button>
                                        </td>
                                        <td>
                                          {lotGroup.douano_lots.length ? lotGroup.douano_lots.map((lot) => <code key={lot}>{lot}</code>) : <span className="module-card-text">Geen Douano match</span>}
                                          <div className="module-card-text">
                                            {lotGroup.rows.length} SKU-regel{lotGroup.rows.length === 1 ? "" : "s"} - {lotGroup.douano_rows} Douano row{lotGroup.douano_rows === 1 ? "" : "s"}
                                            {lotGroup.last_movement_date ? ` - ${lotGroup.last_movement_date}` : ""}
                                          </div>
                                        </td>
                                        <td>
                                          <span className={`status-pill ${lotStatusClass(lotGroup.status)}`}>{lotStatusLabel(lotGroup.status)}</span>
                                        </td>
                                      </tr>
                                      {lotOpen
                                        ? lotGroup.rows.map((row) => {
                                            const key = lotRowKey(row);
                                            const selectedDouanoLot = selectedDouanoLots[key] ?? row.douano_lot_number ?? "";
                                            const canUpdate = Boolean(row.internal_lot_number && selectedDouanoLot && row.internal_lot_number !== selectedDouanoLot);
                                            const internalSkuDetails = Array.isArray(row.sku_details) ? row.sku_details : [];
                                            const douanoSkuDetails = Array.isArray(row.douano_sku_details) ? row.douano_sku_details : [];
                                            return (
                                              <tr key={`${lotGroup.key}-${key}`} className="lot-reconciliation-sku-row">
                                                <td>
                                                  {internalSkuDetails.length ? (
                                                    <div className="stack-compact">
                                                      {internalSkuDetails.map((detail, index) => (
                                                        <div className="module-card-text" key={`${key}-internal-${detail.sku_id || detail.sku_code || index}`}>
                                                          <span style={{ overflowWrap: "anywhere" }}>{skuDetailLabel(detail)}</span>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  ) : (
                                                    <div className="module-card-text">Geen interne SKU-details</div>
                                                  )}
                                                </td>
                                                <td>
                                                  {row.status === "matched" ? (
                                                    <code>{row.douano_lot_number}</code>
                                                  ) : (
                                                    <select
                                                      className="editor-input"
                                                      style={{ width: "100%" }}
                                                      value={selectedDouanoLot}
                                                      onChange={(event) => setSelectedDouanoLots((prev) => ({ ...prev, [key]: event.target.value }))}
                                                    >
                                                      <option value="">Select Douano LOT</option>
                                                      {row.douano_options.map((option) => (
                                                        <option key={`${key}-${option.lot_number}`} value={option.lot_number}>
                                                          {option.lot_number} - {option.product_name || row.sku_name} ({Number(option.rows || 0)} rows)
                                                        </option>
                                                      ))}
                                                    </select>
                                                  )}
                                                  <div className="module-card-text">
                                                    {Number(row.rows || 0)} row{Number(row.rows || 0) === 1 ? "" : "s"}
                                                    {row.last_movement_date ? ` - ${row.last_movement_date}` : ""}
                                                  </div>
                                                  {douanoSkuDetails.length ? (
                                                    <div className="stack-compact" style={{ marginTop: 6 }}>
                                                      {douanoSkuDetails.map((detail, index) => (
                                                        <div className="module-card-text" key={`${key}-douano-${detail.sku_id || detail.sku_code || index}`}>
                                                          <span style={{ overflowWrap: "anywhere" }}>{skuDetailLabel(detail)}</span>
                                                          {Number(detail.rows || 0) ? ` (${Number(detail.rows || 0)} rows)` : ""}
                                                        </div>
                                                      ))}
                                                    </div>
                                                  ) : null}
                                                </td>
                                                <td>
                                                  <div className="lot-reconciliation-status-cell">
                                                    <span className={`status-pill ${lotStatusClass(row.status)}`}>{lotStatusLabel(row.status)}</span>
                                                    {canUpdate ? (
                                                      <button
                                                        type="button"
                                                        className="editor-button editor-button-secondary"
                                                        disabled={saving}
                                                        title={`Update internal LOT ${row.internal_lot_number} to Douano LOT ${selectedDouanoLot}`}
                                                        onClick={() => void correctInternalLot(row)}
                                                      >
                                                        Update
                                                      </button>
                                                    ) : null}
                                                  </div>
                                                </td>
                                              </tr>
                                            );
                                          })
                                        : null}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!reconciliationGroups.length ? (
                <tr>
                  <td colSpan={4}>No LOTs found for this year yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="module-card">
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
    </div>
  );
}
