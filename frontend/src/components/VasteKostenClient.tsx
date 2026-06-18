"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { createDatasetItem } from "@/lib/datasetItems";

type EditorValue = string | number | boolean | null;
type EditorRow = Record<string, EditorValue>;

type CorrectionRun = {
  id: string;
  status: string;
  scope_years?: number[];
  summary?: string;
  created_at?: string;
};

function formatEur(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

function clampPct(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

function deriveBucketLabel(row: { include_in_inventory_cost: boolean; include_in_quote_handling: boolean }) {
  if (row.include_in_quote_handling) return "Handling";
  if (row.include_in_inventory_cost) return "Productie-overhead";
  return "Business-overhead";
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function suggestAbcValues(row: {
  omschrijving: string;
  kostensoort: string;
  cost_pool: string;
  domain: string;
  allocation_driver: string;
  allocation_scope: string;
  include_in_inventory_cost: boolean;
  include_in_quote_handling: boolean;
}) {
  const oms = normalizeText(row.omschrijving);
  const kostensoort = normalizeText(row.kostensoort);

  const updates: Partial<typeof row> = {};

  // Default assumptions: business overhead allocated on sales liters.
  let domain: "sales" | "production" = "sales";
  let driver = "ALL_LITERS";
  let scope = "all";
  let includeInInventory = false;
  let includeInHandling = false;
  let pool = row.cost_pool?.trim() ? row.cost_pool : "";

  const isProductionAsset =
    oms.includes("brouwinstall") ||
    oms.includes("brouwin") ||
    oms.includes("brouwhuis") ||
    oms.includes("brouw") ||
    oms.includes("ketel") ||
    oms.includes("toebehor") ||
    oms.includes("afschrijv");

  const isFacility = oms.includes("gebouw") || oms.includes("huur") || oms.includes("huisvest") || oms.includes("pand");
  const isMarketing =
    oms.includes("marketing") || oms.includes("verkoop") || oms.includes("promot") || oms.includes("bierkaart") || oms.includes("flyer");
  const isSoftware = oms.includes("software") || oms.includes("exact") || oms.includes("licen") || oms.includes("abonnement");
  const isAdmin = oms.includes("bedrijfsvoering") || oms.includes("accountant") || oms.includes("administr") || oms.includes("kantoor");
  const isAuto = oms.includes("autok") || oms.includes("auto") || oms.includes("transport") || oms.includes("ritten") || oms.includes("brandstof");
  const isPersonnel = oms.includes("personeel") || oms.includes("salar") || oms.includes("loon");

  if (isProductionAsset) {
    domain = "production";
    driver = "OWN_PRODUCTION_LITERS";
    scope = "own_production";
    includeInInventory = true;
    includeInHandling = false;
    pool = pool || "Brouwhuis & onderhoud";
  } else if (isFacility) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "Huisvesting";
  } else if (isMarketing) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "Marketing";
  } else if (isSoftware) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "IT / software";
  } else if (isAdmin) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "Kantoor & administratie";
  } else if (isAuto) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "Auto";
  } else if (isPersonnel) {
    domain = "sales";
    driver = "ALL_LITERS";
    scope = "all";
    includeInInventory = false;
    includeInHandling = false;
    pool = pool || "Personeel";
  } else if (kostensoort.includes("direct") && !kostensoort.includes("indirect")) {
    domain = "production";
    driver = "ALL_LITERS";
    scope = "own_production";
    includeInInventory = true;
    includeInHandling = false;
    pool = pool || "Productie-overhead";
  }

  updates.domain = domain;
  updates.allocation_driver = driver;
  updates.allocation_scope = scope;
  updates.include_in_inventory_cost = includeInInventory;
  updates.include_in_quote_handling = includeInHandling;
  if (pool) updates.cost_pool = pool;

  return updates;
}

function computeYearTotals(rows: Array<Record<string, unknown>>) {
  const directTotal = rows.reduce((sum, row) => {
    const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
    const isDirect = normalized.includes("direct") && !normalized.includes("indirect");
    return isDirect ? sum + Number(row.bedrag_per_jaar ?? 0) : sum;
  }, 0);

  const indirectTotal = rows.reduce((sum, row) => {
    const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
    const isIndirect = normalized.includes("indirect");
    return isIndirect ? sum + Number(row.bedrag_per_jaar ?? 0) : sum;
  }, 0);

  const inventoryTotal = rows.reduce((sum, row) => {
    const include = Boolean((row as any).include_in_inventory_cost ?? true);
    return include ? sum + Number(row.bedrag_per_jaar ?? 0) : sum;
  }, 0);

  const quoteHandlingTotal = rows.reduce((sum, row) => {
    const include = Boolean((row as any).include_in_quote_handling ?? false);
    return include ? sum + Number(row.bedrag_per_jaar ?? 0) : sum;
  }, 0);

  const hasLegacyRedistribution = rows.some((row) => clampPct((row as any).herverdeel_pct) > 0);

  return {
    directTotal,
    indirectTotal,
    inventoryTotal,
    quoteHandlingTotal,
    total: directTotal + indirectTotal,
    hasLegacyRedistribution,
  };
}

function deriveYearOptions(productie: Record<string, unknown>) {
  const years = Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
  return years;
}

function chooseDefaultYear(yearOptions: number[]) {
  const currentYear = new Date().getFullYear();
  if (yearOptions.includes(currentYear)) return currentYear;
  return yearOptions[yearOptions.length - 1] ?? 0;
}

type VasteKostenClientProps = {
  vasteKosten: Record<string, unknown>;
  productie: Record<string, unknown>;
  pools?: unknown[];
  availableYears?: number[];
  initialSelectedYear?: number;
  lockYear?: boolean;
  titleSuffix?: string;
  mode?: "server" | "draft";
  onDraftSave?: (payload: Record<string, Array<Record<string, unknown>>>) => Promise<void> | void;
  onDraftChange?: (payload: Record<string, Array<Record<string, unknown>>>) => void;
  syncOnPropsChange?: boolean;
};

export function VasteKostenClient({
  vasteKosten,
  productie,
  pools = [],
  availableYears,
  initialSelectedYear,
  lockYear,
  titleSuffix,
  mode = "server",
  onDraftSave,
  onDraftChange,
  syncOnPropsChange = false
}: VasteKostenClientProps) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement | null>(null);

  const poolOptions = useMemo(() => {
    const rows = (Array.isArray(pools) ? pools : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const r = row as any;
        const label = String(r.label ?? "").trim();
        return {
          id: String(r.id ?? "").trim(),
          label,
          sort_order: Number(r.sort_order ?? 0) || 0,
          active: Boolean(r.active ?? true),
        };
      })
      .filter((row) => row.label);

    rows.sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return String(a.label).localeCompare(String(b.label));
    });

    return rows;
  }, [pools]);
  const yearOptions = useMemo(() => {
    const explicit = (Array.isArray(availableYears) ? availableYears : [])
      .map((year) => Number(year))
      .filter((year) => Number.isFinite(year) && year > 0);
    if (explicit.length > 0) {
      return [...new Set(explicit)].sort((a, b) => a - b);
    }
    return deriveYearOptions(productie);
  }, [availableYears, productie]);
  const defaultYear = useMemo(() => chooseDefaultYear(yearOptions), [yearOptions]);

  function createUiId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  type InternalRow = {
    _uiId: string;
    id: string;
    omschrijving: string;
    kostensoort: string;
    cost_pool: string;
    domain: string;
    allocation_driver: string;
    allocation_scope: string;
    stand: string;
    include_in_inventory_cost: boolean;
    include_in_quote_handling: boolean;
    bedrag_per_jaar: number;
    herverdeel_pct: number;
  };

  const normalizedByYear = useMemo(() => {
    const result: Record<string, InternalRow[]> = {};
    for (const [yearKey, rawItems] of Object.entries(vasteKosten ?? {})) {
      if (!Array.isArray(rawItems)) continue;
      result[String(yearKey)] = (rawItems as Array<Record<string, unknown>>).map((item, index) => {
        const rawId = String(item.id ?? "").trim();
        return {
          _uiId: rawId ? `${rawId}-${index}` : createUiId(),
          id: rawId,
          omschrijving: String(item.omschrijving ?? ""),
          kostensoort: String(item.kostensoort ?? ""),
          cost_pool: String((item as any).cost_pool ?? ""),
          domain: String((item as any).domain ?? (item as any).domein ?? "production") || "production",
          allocation_driver: String((item as any).allocation_driver ?? ""),
          allocation_scope: String((item as any).allocation_scope ?? "all") || "all",
          stand: String((item as any).stand ?? (item as any).basis ?? "normal") || "normal",
          include_in_inventory_cost: Boolean((item as any).include_in_inventory_cost ?? true),
          include_in_quote_handling: Boolean((item as any).include_in_quote_handling ?? false),
          bedrag_per_jaar: Number(item.bedrag_per_jaar ?? 0),
          herverdeel_pct: clampPct(item.herverdeel_pct ?? 0)
        };
      });
    }
    return result;
  }, [vasteKosten]);

  const resolvedInitialYear =
    typeof initialSelectedYear === "number" && Number.isFinite(initialSelectedYear)
      ? initialSelectedYear
      : defaultYear;
  const [selectedYear, setSelectedYear] = useState<number>(resolvedInitialYear);
  const [rowsByYear, setRowsByYear] = useState<Record<string, InternalRow[]>>(normalizedByYear);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isPoolSaving, setIsPoolSaving] = useState(false);
  const [correctionRuns, setCorrectionRuns] = useState<CorrectionRun[]>([]);

  useEffect(() => {
    if (!syncOnPropsChange) return;
    setRowsByYear(normalizedByYear);
  }, [normalizedByYear, syncOnPropsChange]);

  async function loadCorrectionRuns() {
    if (mode === "draft") return;
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/correction-runs?source_type=fixed_costs&limit=5`, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return;
      const payload = await response.json();
      setCorrectionRuns(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      // Non-critical: fixed-cost editing must keep working if history cannot be loaded.
    }
  }

  useEffect(() => {
    void loadCorrectionRuns();
  }, [mode]);

  const totalsByYear = useMemo(() => {
    const years =
      yearOptions.length > 0
        ? [...yearOptions].sort((a, b) => b - a)
        : Object.keys(rowsByYear)
            .map((key) => Number(key))
            .filter((year) => Number.isFinite(year) && year > 0)
            .sort((a, b) => b - a);

    return years.map((year) => {
      const totals = computeYearTotals(rowsByYear[String(year)] ?? []);
      return { year, ...totals };
    });
  }, [rowsByYear, yearOptions]);

  const effectiveSelectedYear = lockYear ? resolvedInitialYear : selectedYear;

  const canEdit = yearOptions.length > 0;

  const selectedYearKey = String(effectiveSelectedYear || "");
  const selectedRows = rowsByYear[selectedYearKey] ?? [];

  function applyAbcSuggestions() {
    if (!effectiveSelectedYear) return;
    setRowsByYear((current) => {
      const next = { ...current };
      const key = String(effectiveSelectedYear);
      next[key] = (next[key] ?? []).map((row) => ({ ...row, ...suggestAbcValues(row) }));
      return next;
    });
    setStatus("ABC voorstel ingevuld. Controleer en klik op Opslaan.");
  }

  function handleSelectYear(year: number) {
    setSelectedYear(year);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function updateRow(rowId: string, key: keyof Omit<InternalRow, "_uiId">, value: unknown) {
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = (next[selectedYearKey] ?? []).map((row) => {
        if (row._uiId !== rowId) return row;
        if (key === "bedrag_per_jaar") {
          return { ...row, bedrag_per_jaar: Number(value ?? 0) };
        }
        if (key === "herverdeel_pct") {
          return { ...row, herverdeel_pct: clampPct(value) };
        }
        if (key === "include_in_inventory_cost") {
          return { ...row, include_in_inventory_cost: Boolean(value) };
        }
        if (key === "include_in_quote_handling") {
          return { ...row, include_in_quote_handling: Boolean(value) };
        }
        if (key === "kostensoort") {
          return { ...row, kostensoort: String(value ?? "") };
        }
        if (key === "cost_pool") {
          return { ...row, cost_pool: String(value ?? "") };
        }
        if (key === "domain") {
          return { ...row, domain: String(value ?? "") };
        }
        if (key === "allocation_driver") {
          return { ...row, allocation_driver: String(value ?? "") };
        }
        if (key === "allocation_scope") {
          return { ...row, allocation_scope: String(value ?? "") };
        }
        if (key === "stand") {
          return { ...row, stand: String(value ?? "") };
        }
        return { ...row, omschrijving: String(value ?? "") };
      });
      return next;
    });
  }

  function addRow() {
    if (!effectiveSelectedYear || !Number.isFinite(effectiveSelectedYear)) return;
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = [
        ...(next[selectedYearKey] ?? []),
        {
          _uiId: createUiId(),
          id: "",
          omschrijving: "",
          kostensoort: "",
          cost_pool: "",
          domain: "production",
          allocation_driver: "",
          allocation_scope: "all",
          stand: "normal",
          include_in_inventory_cost: true,
          include_in_quote_handling: false,
          bedrag_per_jaar: 0,
          herverdeel_pct: 0
        }
      ];
      return next;
    });
  }

  function deleteRow(rowId: string) {
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = (next[selectedYearKey] ?? []).filter((row) => row._uiId !== rowId);
      return next;
    });
  }

  function copyFromPreviousYear() {
    if (!effectiveSelectedYear || !Number.isFinite(effectiveSelectedYear)) return;
    const sourceKey = String(effectiveSelectedYear - 1);
    const source = rowsByYear[sourceKey] ?? [];
    if (source.length === 0) return;
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = source.map((row) => ({
        _uiId: createUiId(),
        id: "", // Let backend generate stable UUIDs.
        omschrijving: row.omschrijving,
        kostensoort: row.kostensoort,
        cost_pool: row.cost_pool,
        domain: row.domain,
        allocation_driver: row.allocation_driver,
        allocation_scope: row.allocation_scope,
        stand: row.stand,
        include_in_inventory_cost: row.include_in_inventory_cost,
        include_in_quote_handling: row.include_in_quote_handling,
        bedrag_per_jaar: row.bedrag_per_jaar,
        herverdeel_pct: row.herverdeel_pct
      }));
      return next;
    });
  }

  function buildPayload() {
    const payload: Record<string, Array<Record<string, unknown>>> = {};
    for (const [yearKey, rows] of Object.entries(rowsByYear)) {
      // Only persist years that are part of productie (FK constraint).
      const parsedYear = Number(yearKey);
      if (!Number.isFinite(parsedYear) || parsedYear <= 0) continue;
      if (yearOptions.length > 0 && !yearOptions.includes(parsedYear)) continue;

      payload[yearKey] = rows.map(({ _uiId, ...rest }) => rest);
    }
    // Ensure the selected year key exists even if empty (keeps intent clear; backend ignores empty).
    if (selectedYearKey && !payload[selectedYearKey]) {
      payload[selectedYearKey] = [];
    }
    return payload;
  }

  const draftPayload = useMemo(() => buildPayload(), [rowsByYear, selectedYearKey, yearOptions]);
  useEffect(() => {
    if (mode !== "draft") return;
    onDraftChange?.(draftPayload);
  }, [draftPayload, mode, onDraftChange]);

  async function handleSave() {
    setStatus("");
    setIsSaving(true);
    try {
      const payload = buildPayload();
      if (mode === "draft") {
        await onDraftSave?.(payload);
        setStatus("Concept opgeslagen.");
      } else {
        const response = await fetch(`${API_BASE_URL}/data/vaste-kosten`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Opslaan mislukt");
        }
        const result = await response.json().catch(() => null);
        const correctionRun = result?.correction_run;
        const years = Array.isArray(correctionRun?.scope_years) ? correctionRun.scope_years.join(", ") : "";
        const reports = Array.isArray(correctionRun?.result?.revision_reports) ? correctionRun.result.revision_reports : [];
        const refreshes = Array.isArray(correctionRun?.result?.snapshot_refreshes) ? correctionRun.result.snapshot_refreshes : [];
        const revised = reports.reduce((sum: number, row: any) => sum + Number(row?.revised_versions ?? 0), 0);
        const refreshed = refreshes.reduce((sum: number, row: any) => sum + Number(row?.computed ?? 0), 0);
        const correctionStatus = String(correctionRun?.status ?? "");
        setStatus(
          correctionRun
            ? correctionStatus === "failed"
              ? `Opgeslagen, maar correctierevisie faalde voor ${years || "gewijzigde jaren"}. Controleer de correctierun.`
              : `Opgeslagen. Correctierevisie voor ${years || "gewijzigde jaren"}: ${revised} kostprijsversies bijgewerkt, ${refreshed} Omzet & Marge regels ververst.`
            : "Opgeslagen."
        );
        await loadCorrectionRuns();
        router.refresh();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Opslaan mislukt.";
      setStatus(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshFixedCostsFromServer() {
    const response = await fetch(`${API_BASE_URL}/data/vaste-kosten`, { cache: "no-store", credentials: "include" });
    if (!response.ok) return;
    const payload = await response.json();
    const data = payload?.data;
    if (!data || typeof data !== "object") return;
    const next: Record<string, InternalRow[]> = {};
    for (const [yearKey, rawItems] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(rawItems)) continue;
      next[String(yearKey)] = (rawItems as Array<Record<string, unknown>>).map((item, index) => {
        const rawId = String(item.id ?? "").trim();
        return {
          _uiId: rawId ? `${rawId}-${index}` : createUiId(),
          id: rawId,
          omschrijving: String(item.omschrijving ?? ""),
          kostensoort: String(item.kostensoort ?? ""),
          cost_pool: String((item as any).cost_pool ?? ""),
          domain: String((item as any).domain ?? (item as any).domein ?? "production") || "production",
          allocation_driver: String((item as any).allocation_driver ?? ""),
          allocation_scope: String((item as any).allocation_scope ?? "all") || "all",
          stand: String((item as any).stand ?? (item as any).basis ?? "normal") || "normal",
          include_in_inventory_cost: Boolean((item as any).include_in_inventory_cost ?? true),
          include_in_quote_handling: Boolean((item as any).include_in_quote_handling ?? false),
          bedrag_per_jaar: Number(item.bedrag_per_jaar ?? 0),
          herverdeel_pct: clampPct(item.herverdeel_pct ?? 0)
        };
      });
    }
    setRowsByYear(next);
  }

  async function handleRevertLatestCorrection() {
    const latest = correctionRuns.find((run) => run.status === "applied");
    if (!latest?.id) {
      setStatus("Geen toegepaste vaste-kosten correctierun om terug te draaien.");
      return;
    }
    const confirmed = window.confirm(
      `Laatste vaste-kosten correctie terugdraaien?\n\n${latest.summary || latest.id}\n\nDit herstelt de vaste-kosten brondata.`
    );
    if (!confirmed) return;
    setIsReverting(true);
    setStatus("Correctierun terugdraaien...");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/correction-runs/${latest.id}/revert`, {
        method: "POST",
        credentials: "include"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.detail || "Terugdraaien mislukt."));
      await refreshFixedCostsFromServer();
      await loadCorrectionRuns();
      setStatus("Laatste vaste-kosten correctie teruggedraaid.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Terugdraaien mislukt.");
    } finally {
      setIsReverting(false);
    }
  }

  function TrashIcon() {
    return (
      <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
      </svg>
    );
  }

  function normalizePoolLabel(value: unknown) {
    return String(value ?? "").trim();
  }

  async function ensurePoolExists(label: string) {
    const normalized = normalizePoolLabel(label);
    if (!normalized) return;
    const exists = poolOptions.some((p) => String(p.label).toLowerCase() === normalized.toLowerCase());
    if (exists) return;

    setIsPoolSaving(true);
    try {
      const next = [
        ...poolOptions,
        {
          id: normalized
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "new",
          label: normalized,
          sort_order: (poolOptions.length + 1) * 10,
          active: true,
        },
      ];

      await createDatasetItem("cost-pools", next[next.length - 1]);
      router.refresh();
    } finally {
      setIsPoolSaving(false);
    }
  }

  return (
    <>
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Totalen per jaar</div>
          <div className="module-card-text">
            Overhead wordt verdeeld op basis van drivers (ABC-light). Directe kosten landen als productie-overhead, indirecte kosten als business-overhead.
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Jaar</th>
                <th>Productie-overhead</th>
                <th>Business-overhead</th>
                <th>Quote handling (subset)</th>
                <th>Totale kosten</th>
              </tr>
            </thead>
            <tbody>
              {totalsByYear.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={5}>
                    Nog geen vaste kostenregels. Voeg hieronder regels toe.
                  </td>
                </tr>
              ) : null}
              {totalsByYear.map((row) => (
                <tr
                  key={row.year}
                  style={{ cursor: lockYear ? "default" : "pointer" }}
                  onClick={() => {
                    if (lockYear) return;
                    handleSelectYear(row.year);
                  }}
                >
                  <td>
                    <strong>{row.year}</strong>
                  </td>
                  <td>
                    {formatEur(row.directTotal)}
                  </td>
                  <td>
                    {formatEur(row.indirectTotal)}
                  </td>
                  <td>
                    {formatEur(row.quoteHandlingTotal)}
                  </td>
                  <td>
                    {formatEur(row.total)}{" "}
                    {row.hasLegacyRedistribution ? (
                      <span className="muted" title="Er staan nog legacy herverdeel-percentages ingevuld. Deze worden niet gebruikt in ABC.">
                        (legacy herverdeling actief)
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit ? (
        <section className="module-card" ref={editorRef}>
          <div className="module-card-header">
            <div className="module-card-title">
              Vaste kosten {titleSuffix ?? String(effectiveSelectedYear || "")}
            </div>
            <div className="module-card-text">Bewerk de vaste kostenregels voor het geselecteerde jaar (ABC-light).</div>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{selectedRows.length} regels</span>
              <span className="muted">Jaar is afgeleid van de selectie en is read-only.</span>
            </div>
            <div className="editor-toolbar-meta">
              <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={showAdvanced}
                  onChange={(event) => setShowAdvanced(event.target.checked)}
                />
                Geavanceerd
              </label>
            </div>
          </div>

          {effectiveSelectedYear && selectedRows.length === 0 ? (
            <div className="editor-toolbar" style={{ paddingTop: 0 }}>
              <div className="editor-toolbar-meta">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={copyFromPreviousYear}
                  disabled={
                    effectiveSelectedYear <= 0 ||
                    (rowsByYear[String(effectiveSelectedYear - 1)] ?? []).length === 0
                  }
                >
                  Kosten overnemen uit jaar {effectiveSelectedYear - 1}
                </button>
              </div>
            </div>
          ) : null}

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th style={{ width: "280px" }}>Omschrijving</th>
                  <th style={{ width: "170px" }} title="Afgeleid van Voorraad/Handling.">
                    Bucket
                  </th>
                  <th style={{ width: "220px" }}>Kostensoort</th>
                  <th style={{ width: "220px" }}>Pool</th>
                  <th style={{ width: "140px" }}>Domein</th>
                  <th style={{ width: "190px" }}>Driver</th>
                  <th style={{ width: "160px" }}>Scope</th>
                  <th style={{ width: "130px" }}>Stand</th>
                  <th style={{ width: "120px" }}>Voorraad</th>
                  <th style={{ width: "180px" }}>Handling (scenario)</th>
                  <th style={{ width: "180px" }}>Bedrag per jaar</th>
                  {showAdvanced ? <th style={{ width: "150px" }}>Herverdelen %</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {effectiveSelectedYear && selectedRows.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={showAdvanced ? 11 : 10}>
                      Nog geen regels voor {effectiveSelectedYear}. Voeg een rij toe of neem gegevens over.
                    </td>
                  </tr>
                ) : null}
                {selectedRows.map((row) => (
                  <tr key={row._uiId}>
                    <td>
                      <input
                        className="dataset-input"
                        type="text"
                        value={row.omschrijving}
                        onChange={(event) => updateRow(row._uiId, "omschrijving", event.target.value)}
                      />
                    </td>
                    <td>
                      <span className="editor-pill" title="Afgeleid van Voorraad/Handling.">
                        {deriveBucketLabel(row)}
                      </span>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.kostensoort}
                        onChange={(event) => updateRow(row._uiId, "kostensoort", event.target.value)}
                      >
                        <option value="">Kies...</option>
                        <option value="Indirecte kosten">Indirecte kosten</option>
                        <option value="Directe kosten">Directe kosten</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.cost_pool}
                        onChange={(event) => updateRow(row._uiId, "cost_pool", event.target.value)}
                        onBlur={() => {
                          const value = normalizePoolLabel(row.cost_pool);
                          if (!value) return;
                          void ensurePoolExists(value);
                        }}
                        title="Selecteer een pool of typ een nieuwe poolnaam."
                        disabled={isPoolSaving}
                      >
                        <option value="">Kies...</option>
                        {poolOptions
                          .filter((p) => p.active !== false)
                          .map((p) => (
                            <option key={p.id || p.label} value={p.label}>
                              {p.label}
                            </option>
                          ))}
                        {row.cost_pool &&
                        !poolOptions.some((p) => String(p.label).toLowerCase() === String(row.cost_pool).toLowerCase()) ? (
                          <option value={row.cost_pool}>{row.cost_pool} (nieuw)</option>
                        ) : null}
                      </select>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.domain}
                        onChange={(event) => updateRow(row._uiId, "domain", event.target.value)}
                        title="Kies of deze driver-totalen uit Productie of Sales komen."
                      >
                        <option value="sales">Sales</option>
                        <option value="production">Productie</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.allocation_driver}
                        onChange={(event) => updateRow(row._uiId, "allocation_driver", event.target.value)}
                        title="Kies de driver waarop je deze kosten wilt verdelen."
                      >
                        <option value="">(legacy / geen driver)</option>
                        <option value="ALL_LITERS">Alle liters</option>
                        <option value="PURCHASED_LITERS">Inkoop liters</option>
                        <option value="OWN_PRODUCTION_LITERS">Eigen productie liters</option>
                        <option value="CONTRACT_BREW_LITERS">Contract brew liters</option>
                        <option value="SHIPMENTS">Shipments</option>
                        <option value="PICKS_OR_ORDER_LINES">Orderregels/picks</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.allocation_scope}
                        onChange={(event) => updateRow(row._uiId, "allocation_scope", event.target.value)}
                        title="Beperk deze regel tot een subset van SKU's."
                      >
                        <option value="all">Alle SKU's</option>
                        <option value="purchased">Alleen inkoop</option>
                        <option value="own_production">Alleen eigen productie</option>
                        <option value="contract_brew">Alleen contract brew</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.stand}
                        onChange={(event) => updateRow(row._uiId, "stand", event.target.value)}
                        title="Normal gebruikt baseline totals in Productie & drivers; Actual gebruikt gerealiseerd (of ingevuld) voor het jaar."
                      >
                        <option value="normal">Normal</option>
                        <option value="actual">Actual</option>
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.include_in_inventory_cost}
                        onChange={(event) => updateRow(row._uiId, "include_in_inventory_cost", event.target.checked)}
                        title="Meenemen in integrale SKU-kostprijs (voorraadkost)."
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.include_in_quote_handling}
                        onChange={(event) => updateRow(row._uiId, "include_in_quote_handling", event.target.checked)}
                        title="Meenemen in handling berekening voor offertes (transactie-/handelingskosten)."
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={Number.isFinite(row.bedrag_per_jaar) ? String(row.bedrag_per_jaar) : "0"}
                        onChange={(event) => updateRow(row._uiId, "bedrag_per_jaar", event.target.value)}
                      />
                    </td>
                    {showAdvanced ? (
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          step="any"
                          value={Number.isFinite(row.herverdeel_pct) ? String(row.herverdeel_pct) : "0"}
                          onChange={(event) => updateRow(row._uiId, "herverdeel_pct", event.target.value)}
                          title="Legacy herverdeling; wordt niet gebruikt in ABC."
                        />
                      </td>
                    ) : null}
                    <td>
                      <button
                        type="button"
                        className="icon-button-table"
                        aria-label="Verwijderen"
                        title="Verwijderen"
                        onClick={() => deleteRow(row._uiId)}
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
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
                Rij toevoegen
              </button>
              {selectedRows.length > 0 ? (
                <button type="button" className="editor-button editor-button-secondary" onClick={applyAbcSuggestions}>
                  Vul ABC voorstel
                </button>
              ) : null}
            </div>
            <div className="editor-actions-group">
              {status ? <span className="editor-status">{status}</span> : null}
              {mode !== "draft" && correctionRuns.some((run) => run.status === "applied") ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={handleRevertLatestCorrection}
                  disabled={isSaving || isReverting}
                  title="Herstel de vaste-kosten brondata van de laatste toegepaste correctierun."
                >
                  {isReverting ? "Terugdraaien..." : "Laatste correctie terugdraaien"}
                </button>
              ) : null}
              <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? (mode === "draft" ? "Concept opslaan..." : "Opslaan...") : mode === "draft" ? "Concept opslaan" : "Opslaan"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Vaste kosten</div>
            <div className="module-card-text">
              Voeg eerst een productiejaar toe in het scherm <strong>Productie</strong>. Daarna kun je vaste kosten per jaar beheren.
            </div>
          </div>
        </section>
      )}
    </>
  );
}
