"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";
import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoSyncPanel } from "@/components/DouanoSyncPanel";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";
import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
import { SkuSearchSelect } from "@/components/SkuSearchSelect";
import { WizardSteps } from "@/components/WizardSteps";

type GenericRecord = Record<string, any>;

type SetupCheck = {
  id: string;
  label: string;
  done: boolean;
  current: number;
  total: number;
  missing: GenericRecord[];
  group?: string;
  description?: string;
  href?: string;
};

type SetupStatus = {
  year: number;
  can_complete: boolean;
  mode: string;
  summary: GenericRecord;
  checks: SetupCheck[];
};

type StepKey = "overview" | "sync" | "lots" | "exceptions" | "advanced";

type StepDefinition = {
  id: StepKey;
  title: string;
  description: string;
};

const STEPS: StepDefinition[] = [
  {
    id: "overview",
    title: "Overzicht",
    description: "Stoplicht voor margeanalyse",
  },
  {
    id: "sync",
    title: "Basisdata",
    description: "Douano data ophalen",
  },
  {
    id: "lots",
    title: "LOT & kostprijs",
    description: "Omzetregels oplossen",
  },
  {
    id: "exceptions",
    title: "Uitvalregels",
    description: "Regels buiten de berekening",
  },
  {
    id: "advanced",
    title: "Geavanceerd",
    description: "Technische status en fallback",
  },
];

const API_RESOURCES = [
  { id: "companies", label: "Companies" },
  { id: "products", label: "Products" },
  { id: "sales_orders", label: "Sales orders" },
  { id: "sales_invoices", label: "Invoices" },
  { id: "stock_history_lots", label: "Stock-history LOTs" },
];

type SyncStateItem = {
  resource: string;
  last_success_at?: string;
  last_since_date?: string;
  last_error?: string;
  stats?: GenericRecord;
  updated_at?: string;
};

type ClassificationOption = {
  id: string;
  label: string;
  sort_order?: number;
  active?: boolean;
  allowed_product_groups?: string[];
};

function pct(check: SetupCheck) {
  if (!check.total) return check.done ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((Number(check.current || 0) / Number(check.total || 1)) * 100)));
}

function statusLabel(check: SetupCheck) {
  if (check.done) return "ok";
  if (check.current > 0) return "actie nodig";
  return "niet gestart";
}

function valuePreview(row: GenericRecord) {
  const parts = [
    row.douano_name || row.product_name,
    row.sku_id,
    row.sku_code || row.sku,
    row.lot_number,
    row.transaction_number,
    row.oorzaak,
    row.cost_status,
    row.douano_product_id,
    row.actie,
    row.regels ? `${row.regels} regels` : "",
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" - ") : JSON.stringify(row);
}

function missingRowKey(row: GenericRecord) {
  const match = rowMatchPayload(row);
  return `${match.match_type}:${match.douano_product_id}:${match.line_description}`;
}

function searchableMissingRowText(row: GenericRecord) {
  return [
    valuePreview(row),
    row.douano_name,
    row.product_name,
    row.sku_id,
    row.sku_code,
    row.sku,
    row.lot_number,
    row.transaction_number,
    row.oorzaak,
    row.cost_status,
    row.douano_product_id,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function checkById(status: SetupStatus, ids: string[]) {
  return ids.map((id) => status.checks.find((check) => check.id === id)).filter(Boolean) as SetupCheck[];
}

function qualityChecks(status: SetupStatus) {
  return checkById(status, [
    "douano_products",
    "sales_invoices",
    "product_mappings",
    "stock_history_sync",
    "stock_history_lots",
    "sales_rows_cost_source",
  ]);
}

function hasMissing(checks: SetupCheck[]) {
  return checks.some((check) => Array.isArray(check.missing) && check.missing.length > 0);
}

function flowHref(href?: string) {
  if (!href) return "";
  if (href === "/beheer/productkoppelingen") return "/beheer/productkoppeling";
  if (href === "/instellingen/kostprijsbeheer") return "/nieuwe-kostprijsberekening";
  return href;
}

function StatusPill({ check }: { check: SetupCheck }) {
  const ok = Boolean(check.done);
  return <span className={`status-pill ${ok ? "status-ok" : "status-warning"}`}>{statusLabel(check)}</span>;
}

function rowMatchPayload(row: GenericRecord) {
  const douanoProductId = Number(row.douano_product_id ?? 0) || 0;
  if (douanoProductId > 0) {
    return {
      match_type: "douano_product_id",
      douano_product_id: douanoProductId,
      line_description: "",
    };
  }
  return {
    match_type: "product0_description",
    douano_product_id: 0,
    line_description: String(row.douano_name || row.product_name || "").trim(),
  };
}

function skuLabel(row: GenericRecord) {
  const name = String(row.name || row.sku_name || "").trim();
  const code = String(row.code || row.sku || "").trim();
  return [name, code].filter(Boolean).join(" - ") || String(row.id || "");
}

function defaultHistoricalDate(year: number) {
  const safeYear = Number(year || new Date().getFullYear()) || new Date().getFullYear();
  return `${safeYear}-01-01`;
}

async function readDataSet<T = GenericRecord>(name: string): Promise<T[]> {
  const response = await fetch(`/api/data/${encodeURIComponent(name)}`, { cache: "no-store", credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray((payload as any)?.items)) return (payload as any).items as T[];
  if (Array.isArray((payload as any)?.data)) return (payload as any).data as T[];
  return [];
}

function CostSourceRowAction({
  row,
  scopeRows = [],
  skus,
  year,
}: {
  row: GenericRecord;
  scopeRows?: GenericRecord[];
  skus: GenericRecord[];
  year: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"map_to_sku" | "no_cost_required" | "lot_alias" | "internal_lot" | "historical_cost">("map_to_sku");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [modalSkus, setModalSkus] = useState<GenericRecord[]>(skus);
  const [productGroup, setProductGroup] = useState("");
  const [alcoholCategory, setAlcoholCategory] = useState("");
  const [packagingType, setPackagingType] = useState("");
  const [productGroups, setProductGroups] = useState<ClassificationOption[]>([]);
  const [alcoholCategories, setAlcoholCategories] = useState<ClassificationOption[]>([]);
  const [packagingTypes, setPackagingTypes] = useState<ClassificationOption[]>([]);
  const [selectedInternalLot, setSelectedInternalLot] = useState("");
  const [internalLots, setInternalLots] = useState<GenericRecord[]>([]);
  const [historicalCost, setHistoricalCost] = useState("");
  const [historicalSupplier, setHistoricalSupplier] = useState("Historisch");
  const [historicalDate, setHistoricalDate] = useState(defaultHistoricalDate(year));
  const [historicalNote, setHistoricalNote] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const actionRows = scopeRows.length ? scopeRows : [row];
  const isBulkAction = actionRows.length > 1;
  const rowHasSku = Boolean(String(row.sku_id || "").trim());
  const rowHasLot = Boolean(String(row.lot_number || "").trim());
  const historicalCostSkuIds = actionRows.map((item) => String(item.sku_id || "").trim()).filter(Boolean);
  const historicalCostMatchKeys = actionRows.map(missingRowKey);
  const canAddHistoricalCost =
    historicalCostSkuIds.length === actionRows.length &&
    new Set(historicalCostSkuIds).size === 1 &&
    new Set(historicalCostMatchKeys).size === 1 &&
    actionRows.every((item) => !String(item.lot_number || "").trim() && Boolean(item.missing_cost ?? true));

  const skuOptions = useMemo(() => {
    return (Array.isArray(modalSkus) ? modalSkus : [])
      .filter((sku) => Boolean((sku as any).active ?? (sku as any).actief ?? true))
      .map((sku) => {
        const id = String((sku as any).id || "").trim();
        return {
          id,
          value: id,
          label: skuLabel(sku),
          description: String((sku as any).code ?? (sku as any).sku_code ?? "").trim() || id,
          keywords: `${String((sku as any).code ?? "")} ${String((sku as any).kind ?? "")} ${String((sku as any).product_group ?? "")}`,
        };
      })
      .filter((sku) => sku.id && sku.label)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [modalSkus]);

  const activeProductGroups = useMemo(
    () => productGroups.filter((item) => item.active !== false).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    [productGroups]
  );
  const activeAlcoholCategories = useMemo(
    () => alcoholCategories.filter((item) => item.active !== false).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    [alcoholCategories]
  );
  const activePackagingTypes = useMemo(() => {
    const group = String(productGroup || "").trim();
    return packagingTypes
      .filter((item) => item.active !== false)
      .filter((item) => !group || !Array.isArray(item.allowed_product_groups) || item.allowed_product_groups.length === 0 || item.allowed_product_groups.includes(group))
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  }, [packagingTypes, productGroup]);

  const requiresPackaging = productGroup === "drank" || productGroup === "giftset";

  function applySkuDefaults(skuId: string) {
    const sku = (Array.isArray(modalSkus) ? modalSkus : []).find((item) => String((item as any)?.id ?? "").trim() === skuId);
    if (!sku) return;
    const payload = (sku as any).payload && typeof (sku as any).payload === "object" ? (sku as any).payload : {};
    const explicitGroup = String((sku as any).product_group ?? payload.product_group ?? "").trim();
    const kind = String((sku as any).kind ?? "").trim().toLowerCase();
    const nextGroup = explicitGroup || (kind === "beer_format" ? "drank" : kind === "article" ? "merchandise" : "");
    if (nextGroup) setProductGroup(nextGroup);
    const nextAlcohol = String((sku as any).alcohol_category ?? payload.alcohol_category ?? "").trim();
    if (nextAlcohol) setAlcoholCategory(nextAlcohol);
    const nextPackaging = String((sku as any).packaging_type ?? payload.packaging_type ?? "").trim();
    if (nextPackaging) setPackagingType(nextPackaging);
  }

  async function loadInternalLots() {
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/internal-summary?year=${encodeURIComponent(String(year || 0))}&limit=5000`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
      setInternalLots(Array.isArray((payload as any)?.items) ? (payload as any).items : []);
    } catch {
      setInternalLots([]);
    }
  }

  async function loadModalData() {
    try {
      const [freshSkus, groups, alcohol, packaging] = await Promise.all([
        readDataSet<GenericRecord>("skus"),
        readDataSet<ClassificationOption>("productgroepen"),
        readDataSet<ClassificationOption>("alcoholcategorieen"),
        readDataSet<ClassificationOption>("verpakkingstypen"),
      ]);
      if (freshSkus.length) setModalSkus(freshSkus);
      setProductGroups(groups);
      setAlcoholCategories(alcohol);
      setPackagingTypes(packaging);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function openModal() {
    setOpen(true);
    setStatus("");
    if (scopeRows.length > 1 && action === "lot_alias") {
      setAction("map_to_sku");
    }
    const existingSkuId = String(row.sku_id || "").trim();
    if (existingSkuId) {
      setSelectedSkuId(existingSkuId);
      applySkuDefaults(existingSkuId);
    }
    setHistoricalDate(defaultHistoricalDate(year));
    void loadInternalLots();
    void loadModalData();
  }

  async function submit() {
    setSaving(true);
    setStatus("Opslaan...");
    try {
      if (action === "map_to_sku") {
        if (!selectedSkuId) throw new Error("Kies een SKU.");
        if (!productGroup) throw new Error("Kies een productgroep.");
        if (requiresPackaging && !packagingType) throw new Error("Kies een verpakkingstype voor drank/giftset.");
        if (isBulkAction) {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "map_to_sku",
              items: actionRows.map(rowMatchPayload),
              sku_id: selectedSkuId,
              product_group: productGroup,
              alcohol_category: alcoholCategory,
              packaging_type: packagingType,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
          const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
          if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
        } else {
        const douanoProductId = Number(row.douano_product_id ?? 0) || 0;
        if (douanoProductId > 0) {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/product-mappings/${encodeURIComponent(String(douanoProductId))}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sku_id: selectedSkuId,
              product_group: productGroup,
              alcohol_category: alcoholCategory,
              packaging_type: packagingType,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        } else {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...rowMatchPayload(row), action: "map_to_sku", sku_id: selectedSkuId }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        }
        }
      }

      if (action === "internal_lot") {
        if (isBulkAction) throw new Error("Koppel een interne LOT veilig per regel.");
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
        const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rowMatchPayload(row),
            action: "map_to_sku",
            sku_id: skuId,
            internal_lot_number: selectedInternalLot,
            note: "Interne LOT expliciet gekoppeld voor verkoopregel zonder Douano LOT.",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
      }

      if (action === "historical_cost") {
        const skuId = String(row.sku_id || selectedSkuId || "").trim();
        const costValue = Number(String(historicalCost || "").replace(",", "."));
        if (!skuId) throw new Error("Deze regel mist nog een SKU. Koppel eerst aan een SKU.");
        if (rowHasLot) throw new Error("Deze actie is alleen voor verkoopregels zonder LOT.");
        if (!Number.isFinite(costValue) || costValue < 0) throw new Error("Vul een geldige kostprijs per eenheid in.");
        const costResponse = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/historical-cost`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rowMatchPayload(row),
            sku_id: skuId,
            year,
            supplier: String(historicalSupplier || "Historisch").trim() || "Historisch",
            effective_from: historicalDate,
            purchase_price_input: costValue,
            note: historicalNote,
          }),
        });
        const costPayload = await costResponse.json().catch(() => ({}));
        if (!costResponse.ok) throw new Error(String((costPayload as any)?.detail || costResponse.statusText));
      }

      if (action === "no_cost_required") {
        const containsSkuLikeRows = actionRows.some((item) => String(item.sku_id || item.sku_code || item.sku || "").trim());
        if (
          !window.confirm(
            `Dit betekent dat ${actionRows.length} orderregel(s) wel meetellen in de omzet, maar geen kostprijs nodig hebben. Een SKU zoals bier en merchandise moet voorzien zijn van een SKU/LOT om de juiste kostprijs te bepalen.${containsSkuLikeRows ? " Deze selectie bevat regels met SKU-informatie; controleer extra goed of dit geen echte verkoopbare artikelen zijn." : ""} Doorgaan?`
          )
        ) {
          setStatus("");
          return;
        }
        if (isBulkAction) {
          const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules/batch`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "no_cost_required",
              items: actionRows.map(rowMatchPayload),
              category: "Geen kostprijs nodig",
              include_revenue: true,
              include_liters: false,
              include_break_even: false,
              note: "Geen kostprijs nodig vanuit datakwaliteit.",
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
          const errors = Array.isArray((payload as any)?.result?.errors) ? (payload as any).result.errors : [];
          if (errors.length) throw new Error(`${errors.length} regels konden niet worden opgeslagen.`);
        } else {
        const response = await fetch(`${API_BASE_URL}/integrations/douano/unmapped-rules`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rowMatchPayload(row),
            action: "no_cost_required",
            category: "Geen kostprijs nodig",
            include_revenue: true,
            include_liters: false,
            include_break_even: false,
            note: "Geen kostprijs nodig vanuit datakwaliteit.",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
        }
      }

      if (action === "lot_alias") {
        if (isBulkAction) throw new Error("LOT alias kan veilig per regel worden gekoppeld. Selecteer hiervoor één regel.");
        const externalLot = String(row.lot_number || "").trim();
        if (!externalLot) throw new Error("Externe LOT ontbreekt.");
        if (!selectedInternalLot) throw new Error("Kies een interne LOT.");
        const response = await fetch(`${API_BASE_URL}/integrations/lot-costs/aliases`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku_ids: String(row.sku_id || "").trim() ? [String(row.sku_id || "").trim()] : [],
            sku_codes: String(row.sku_code || row.sku || "").trim() ? [String(row.sku_code || row.sku || "").trim()] : [],
            douano_lot_number: externalLot,
            internal_lot_number: selectedInternalLot,
            reason: "data_quality_sales_row_action",
            source: "data_quality_missing_cost_source",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
      }

      setStatus("Opgeslagen. Snapshot wordt ververst.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const internalLotOptions = internalLots
    .flatMap((group) =>
      Array.isArray((group as any).lots)
        ? (group as any).lots.map((lot: GenericRecord) => ({
            value: String(lot.lot_number || "").trim(),
            label: `${String(lot.lot_number || "").trim()} ${Array.isArray(lot.versions) ? lot.versions.join("/") : ""} - ${String(group.style_name || "").trim()}`.trim(),
          }))
        : []
    )
    .filter((option, index, all) => option.value && all.findIndex((item) => item.value === option.value) === index)
    .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));

  return (
    <>
      <button
        type="button"
        className="icon-button-table"
        aria-label="Actie kiezen"
        title="Actie kiezen"
        onClick={openModal}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
          <div className="cpq-modal">
            <div className="cpq-modal-header">
              <div>
                <div className="cpq-modal-title">Kostprijsbron oplossen</div>
                <div className="cpq-modal-subtitle">
                  {isBulkAction ? `${actionRows.length} geselecteerde regels` : valuePreview(row)}
                </div>
              </div>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpen(false)}>
                Sluiten
              </button>
            </div>
            <div className="cpq-modal-body">
              <label className="field-label">
                Actie
                <select className="editor-input" value={action} onChange={(event) => setAction(event.target.value as any)}>
                  <option value="map_to_sku">Koppel aan SKU</option>
                  {canAddHistoricalCost ? <option value="historical_cost">Kostprijs toevoegen</option> : null}
                  {!isBulkAction ? <option value="internal_lot">Koppel aan interne LOT</option> : null}
                  {!isBulkAction ? <option value="lot_alias">Koppel LOT alias</option> : null}
                  <option value="no_cost_required">Geen kostprijs nodig</option>
                </select>
              </label>
              {action === "map_to_sku" ? (
                <>
                  <label className="field-label">
                    SKU
                    <SkuSearchSelect
                      className="editor-input"
                      value={selectedSkuId}
                      placeholder="Zoek SKU"
                      options={skuOptions}
                      onChange={(nextSkuId) => {
                        setSelectedSkuId(nextSkuId);
                        applySkuDefaults(nextSkuId);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Productgroep
                    <select className="editor-input" value={productGroup} onChange={(event) => setProductGroup(event.target.value)}>
                      <option value="">Kies productgroep</option>
                      {activeProductGroups.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Alcohol
                    <select
                      className="editor-input"
                      value={alcoholCategory}
                      onChange={(event) => setAlcoholCategory(event.target.value)}
                      disabled={productGroup !== "drank" && productGroup !== "giftset"}
                    >
                      <option value="">-</option>
                      {activeAlcoholCategories.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Verpakkingstype
                    <select className="editor-input" value={packagingType} onChange={(event) => setPackagingType(event.target.value)}>
                      <option value="">Kies verpakkingstype</option>
                      {activePackagingTypes.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {action === "lot_alias" || action === "internal_lot" ? (
                <label className="field-label">
                  Interne LOT
                  <select className="editor-input" value={selectedInternalLot} onChange={(event) => setSelectedInternalLot(event.target.value)}>
                    <option value="">Kies interne LOT</option>
                    {internalLotOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {action === "internal_lot" ? (
                    <span className="module-card-text">
                      Gebruik dit voor verkoopregels zonder Douano LOT. De gekozen interne LOT wordt expliciet op deze productregel toegepast.
                    </span>
                  ) : null}
                </label>
              ) : null}
              {action === "historical_cost" ? (
                <>
                  <label className="field-label">
                    Interne SKU
                    <input className="editor-input" value={String(row.sku_id || selectedSkuId || "")} readOnly />
                  </label>
                  <label className="field-label">
                    Inkoopprijs per eenheid
                    <input
                      className="editor-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={historicalCost}
                      onChange={(event) => setHistoricalCost(event.target.value)}
                      placeholder="Bijvoorbeeld 66.20"
                    />
                  </label>
                  <label className="field-label">
                    Actief sinds
                    <input className="editor-input" type="date" value={historicalDate} onChange={(event) => setHistoricalDate(event.target.value)} />
                  </label>
                  <label className="field-label">
                    Leverancier / bron
                    <input className="editor-input" value={historicalSupplier} onChange={(event) => setHistoricalSupplier(event.target.value)} />
                  </label>
                  <label className="field-label">
                    Notitie
                    <input className="editor-input" value={historicalNote} onChange={(event) => setHistoricalNote(event.target.value)} />
                  </label>
                  <span className="module-card-text">
                    Gebruik dit alleen voor bekende verkoopbare SKU's zonder Douano LOT en zonder bestaande kostprijs. De app maakt een historische kostprijsversie aan en telt overhead en accijns automatisch op bij de inkoopprijs.
                  </span>
                </>
              ) : null}
              {status ? <div className="editor-status">{status}</div> : null}
            </div>
            <div className="editor-actions" style={{ padding: "0 1.1rem 1rem" }}>
              <div />
              <div className="editor-actions-group">
                <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpen(false)}>
                  Annuleren
                </button>
                <button type="button" className="editor-button" onClick={() => void submit()} disabled={saving}>
                  {saving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CheckCard({ check, onOpenMissing }: { check: SetupCheck; onOpenMissing: (id: string) => void }) {
  const href = flowHref(check.href);
  return (
    <div className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="module-card-title">{check.label}</div>
          {check.description ? <div className="module-card-text">{check.description}</div> : null}
        </div>
        <StatusPill check={check} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: 800 }}>
          <span>
            {check.current} / {check.total}
          </span>
          <span>{pct(check)}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct(check)}%` }} />
        </div>
        <div className="editor-actions" style={{ marginTop: 2 }}>
          <div className="editor-actions-group">
            {href ? (
              <Link className="editor-button editor-button-secondary" href={href as any}>
                Open
              </Link>
            ) : null}
            {check.missing?.length ? (
              <button type="button" className="editor-button editor-button-secondary" onClick={() => onOpenMissing(check.id)}>
                Bekijk {check.missing.length}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MissingPanel({
  checks,
  openId,
  setOpenId,
  skus,
  year,
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  skus: GenericRecord[];
  year: number;
}) {
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const openCheck = checks.find((check) => check.id === openId);
  if (!openCheck || !openCheck.missing?.length) return null;
  const rows = Array.isArray(openCheck.missing) ? openCheck.missing : [];
  const query = search.trim().toLowerCase();
  const filteredRows = query ? rows.filter((row) => searchableMissingRowText(row).includes(query)) : rows;
  const visibleKeys = filteredRows.map(missingRowKey);
  const selectedSet = new Set(selectedKeys);
  const selectedRows = rows.filter((row) => selectedSet.has(missingRowKey(row)));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedSet.has(key));

  function toggleVisibleRows(checked: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const key of visibleKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return Array.from(next);
    });
  }

  function toggleRow(row: GenericRecord, checked: boolean) {
    const key = missingRowKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return Array.from(next);
    });
  }

  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="module-card-title">Ontbrekend: {openCheck.label}</div>
          <div className="module-card-text">Deze regels houden de datakwaliteit nog tegen.</div>
        </div>
        <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenId("")}>
          Sluiten
        </button>
      </div>
      {openCheck.id === "sales_rows_cost_source" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <input
            className="editor-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Zoek op product, SKU, LOT, transactie of oorzaak"
          />
          <span className="status-pill">{selectedRows.length ? `${selectedRows.length} geselecteerd` : `${filteredRows.length} zichtbaar`}</span>
        </div>
      ) : null}
      <div className="data-table">
        <table>
          {openCheck.id === "sales_rows_cost_source" ? (
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecteer zichtbare regels"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleVisibleRows(event.target.checked)}
                  />
                </th>
                <th>Regel</th>
                <th style={{ width: 56, textAlign: "right" }}>Actie</th>
              </tr>
            </thead>
          ) : null}
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={`${openCheck.id}-${index}`}>
                {openCheck.id === "sales_rows_cost_source" ? (
                  <td style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      aria-label="Selecteer regel"
                      checked={selectedSet.has(missingRowKey(row))}
                      onChange={(event) => toggleRow(row, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td>{valuePreview(row)}</td>
                {openCheck.id === "sales_rows_cost_source" ? (
                  <td style={{ width: 56, textAlign: "right" }}>
                    <CostSourceRowAction row={row} scopeRows={selectedRows} skus={skus} year={year} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckGrid({
  checks,
  openId,
  setOpenId,
  skus,
  year,
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  skus: GenericRecord[];
  year: number;
}) {
  return (
    <div className="wizard-stack">
      <div className="home-grid">
        {checks.map((check) => (
          <CheckCard key={check.id} check={check} onOpenMissing={(id) => setOpenId(openId === id ? "" : id)} />
        ))}
      </div>
      <MissingPanel checks={checks} openId={openId} setOpenId={setOpenId} skus={skus} year={year} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value small">{value}</div>
    </div>
  );
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nl-NL");
}

function syncDelta(stats?: GenericRecord) {
  if (!stats) return "-";
  const values = [
    ["opgehaald", stats.fetched],
    ["opgeslagen", stats.saved],
    ["upserted", stats.upserted],
    ["regels", stats.lines],
    ["zonder LOT", stats.missing_lot],
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${Number(value) || 0}`);
  return values.length ? values.join(" / ") : "-";
}

function ApiRunStatusTable() {
  const [items, setItems] = useState<SyncStateItem[]>([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/integrations/douano/sync-status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(String(payload?.detail ?? response.statusText));
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const byResource = useMemo(() => {
    const map = new Map<string, SyncStateItem>();
    items.forEach((item) => {
      const key = String(item?.resource ?? "").trim();
      if (key) map.set(key, item);
    });
    return map;
  }, [items]);

  return (
    <section className="module-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="module-card-title">API runs</div>
          <div className="module-card-text">
            Laatste Douano sync per bron. De kolom delta toont de laatst bekende run-statistiek; echte verschilmeting tussen runs vraagt nog runhistorie.
          </div>
        </div>
        <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
          Ververs
        </button>
      </div>
      {error ? (
        <div className="placeholder-block">
          <strong>API status niet beschikbaar</strong>
          {error}
        </div>
      ) : null}
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>API</th>
              <th>Status</th>
              <th>Laatst succes</th>
              <th>Since</th>
              <th>Delta laatste run</th>
              <th>Laatste fout</th>
            </tr>
          </thead>
          <tbody>
            {API_RESOURCES.map((resource) => {
              const row = byResource.get(resource.id);
              const ok = Boolean(row?.last_success_at && !String(row?.last_error ?? "").trim());
              return (
                <tr key={resource.id}>
                  <td>{resource.label}</td>
                  <td>
                    <span className={`status-pill ${ok ? "status-ok" : "status-warning"}`}>{ok ? "gedraaid" : "niet gedraaid"}</span>
                  </td>
                  <td>{formatDateTime(row?.last_success_at)}</td>
                  <td>{row?.last_since_date || "-"}</td>
                  <td>{syncDelta(row?.stats)}</td>
                  <td>{row?.last_error || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function YearSelector({ status }: { status: SetupStatus }) {
  const currentYear = Number(status.year || new Date().getFullYear());
  const productionYears = Array.isArray(status.summary.production_years)
    ? status.summary.production_years.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const years = Array.from(new Set([...productionYears, currentYear])).sort((a, b) => b - a);
  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div>
          <div className="module-card-title">Productiejaar</div>
          <div className="module-card-text">Datakwaliteit controleert Omzet & Marge voor het geselecteerde jaar.</div>
        </div>
        <select
          className="editor-input"
          value={String(currentYear)}
          onChange={(event) => {
            const nextYear = event.target.value;
            const url = new URL(window.location.href);
            url.searchParams.set("year", nextYear);
            window.location.href = url.toString();
          }}
          style={{ maxWidth: 220 }}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-actions" style={{ marginTop: 10 }}>
        <div className="editor-actions-group">
          {years.map((year) => (
            <Link
              key={year}
              href={`/beheer/api?year=${year}` as any}
              className={`status-pill ${year === currentYear ? (status.can_complete ? "status-ok" : "status-warning") : "pill"}`}
            >
              {year}{year === currentYear ? ` - ${status.can_complete ? "ok" : "controle"}` : ""}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReliabilityBanner({ status }: { status: SetupStatus }) {
  const checks = qualityChecks(status);
  const blockers = checks.filter((check) => !check.done);
  return (
    <section className="module-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="module-card-title">Margeanalyse betrouwbaar: {status.can_complete ? "ja" : "nee"}</div>
          <div className="module-card-text">
            De flow controleert of Douano data, productkoppelingen, LOTs en kostprijsbronnen compleet genoeg zijn voor Omzet & Marge.
          </div>
        </div>
        <span className={`status-pill ${status.can_complete ? "status-ok" : "status-warning"}`}>
          {status.can_complete ? "klaar" : `${blockers.length} acties`}
        </span>
      </div>
      <div className="stats-grid wizard-stats-grid" style={{ marginBottom: 0 }}>
        <SummaryMetric label="Douano producten" value={status.summary.douano_products ?? 0} />
        <SummaryMetric label="Verkochte producten gekoppeld" value={`${status.summary.sold_products_mapped ?? 0}/${status.summary.sold_products ?? 0}`} />
        <SummaryMetric label="LOT regels zonder LOT" value={status.summary.sales_lot_without_lot ?? 0} />
        <SummaryMetric
          label="SKU-regels met kostprijsbron"
          value={`${status.summary.sales_rows_sku_with_cost_source ?? 0}/${status.summary.sales_rows_sku_total ?? 0}`}
        />
        <SummaryMetric
          label="Niet-SKU regels gecategoriseerd"
          value={`${status.summary.sales_rows_non_sku_categorized ?? 0}/${status.summary.sales_rows_non_sku_total ?? 0}`}
        />
        <SummaryMetric
          label="Verkoopregels verwerkt"
          value={`${status.summary.sales_rows_processed ?? status.summary.sales_rows_with_cost_source ?? 0}/${status.summary.sales_rows_total ?? status.summary.sales_rows_cost_source_total ?? 0}`}
        />
      </div>
    </section>
  );
}

export function DataQualityIntegrationWorkspace({
  initialStatus,
  skus,
  articles = [],
  advanced,
}: {
  initialStatus: SetupStatus;
  skus: GenericRecord[];
  articles?: GenericRecord[];
  advanced: ReactNode;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [openMissingId, setOpenMissingId] = useState("");

  const activeStep = STEPS[activeStepIndex] ?? STEPS[0];
  const overviewChecks = useMemo(() => checkById(initialStatus, ["product_mappings", "stock_history_lots", "sales_rows_cost_source"]), [initialStatus]);
  const syncChecks = useMemo(() => checkById(initialStatus, ["douano_products", "sales_invoices", "stock_history_sync"]), [initialStatus]);
  const productChecks = useMemo(() => checkById(initialStatus, ["product_mappings"]), [initialStatus]);
  const lotChecks = useMemo(() => checkById(initialStatus, ["stock_history_lots", "sales_rows_cost_source"]), [initialStatus]);
  const exceptionChecks = useMemo(
    () => [...productChecks, ...lotChecks].filter((check, index, rows) => rows.findIndex((row) => row.id === check.id) === index),
    [lotChecks, productChecks]
  );

  function renderStepBody() {
    if (activeStep.id === "overview") {
      return (
        <div className="wizard-stack">
          <YearSelector status={initialStatus} />
          <ReliabilityBanner status={initialStatus} />
          <section>
            <div className="module-card-title" style={{ marginBottom: 8 }}>Resultaten om op te lossen</div>
            <div className="module-card-text" style={{ marginBottom: 12 }}>
              Deze kaarten tonen alleen wat Omzet & Marge voor dit jaar onbetrouwbaar maakt.
            </div>
          </section>
          <CheckGrid checks={overviewChecks} openId={openMissingId} setOpenId={setOpenMissingId} skus={skus} year={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "sync") {
      return (
        <div className="wizard-stack">
          <ApiRunStatusTable />
          <CheckGrid checks={syncChecks} openId={openMissingId} setOpenId={setOpenMissingId} skus={skus} year={initialStatus.year} />
          <DouanoSyncPanel />
        </div>
      );
    }

    if (activeStep.id === "lots") {
      return (
        <div className="wizard-stack">
          <CheckGrid checks={lotChecks} openId={openMissingId} setOpenId={setOpenMissingId} skus={skus} year={initialStatus.year} />
          <LotKostenWorkspace skus={skus} articles={articles} year={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "exceptions") {
      return (
        <div className="wizard-stack">
          {hasMissing(exceptionChecks) ? (
            <CheckGrid checks={exceptionChecks} openId={openMissingId} setOpenId={setOpenMissingId} skus={skus} year={initialStatus.year} />
          ) : null}
          <DouanoProductMappingCard />
          <DouanoUnmappedRulesCard initialYear={initialStatus.year} />
        </div>
      );
    }

    return <div className="wizard-stack">{advanced}</div>;
  }

  return (
    <div className="cpq-shell data-quality-shell">
      <WizardSteps
        title="Datakwaliteit"
        steps={STEPS.map((step) => ({
          id: step.id,
          title: step.title,
          description: step.description,
        }))}
        activeIndex={activeStepIndex}
        onSelect={(index) => {
          setOpenMissingId("");
          setActiveStepIndex(index);
        }}
      />
      <div className="cpq-main">
        <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div className="wizard-step-title">
              Stap {activeStepIndex + 1}: {activeStep.title}
            </div>
            <div className="wizard-step-description">{activeStep.description}</div>
          </div>
          <div className="wizard-step-body">{renderStepBody()}</div>
          <div className="wizard-footer-actions">
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={() => {
                setOpenMissingId("");
                setActiveStepIndex((index) => Math.max(0, index - 1));
              }}
              disabled={activeStepIndex === 0}
            >
              Vorige
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                setOpenMissingId("");
                setActiveStepIndex((index) => Math.min(STEPS.length - 1, index + 1));
              }}
              disabled={activeStepIndex >= STEPS.length - 1}
            >
              Volgende
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
