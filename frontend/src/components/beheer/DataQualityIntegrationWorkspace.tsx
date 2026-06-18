"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoSyncPanel } from "@/components/DouanoSyncPanel";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";
import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
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

type StepKey = "overview" | "sync" | "products" | "lots" | "costs" | "exceptions" | "advanced";

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
    id: "products",
    title: "Producten",
    description: "Koppelen of negeren",
  },
  {
    id: "lots",
    title: "LOT-dekking",
    description: "Stock-history en LOTs",
  },
  {
    id: "costs",
    title: "Kostprijsdekking",
    description: "Actief en direct gedekt",
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
    row.douano_product_id,
    row.actie,
    row.regels ? `${row.regels} regels` : "",
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" - ") : JSON.stringify(row);
}

function checkById(status: SetupStatus, ids: string[]) {
  return ids.map((id) => status.checks.find((check) => check.id === id)).filter(Boolean) as SetupCheck[];
}

function qualityChecks(status: SetupStatus) {
  return checkById(status, [
    "douano_products",
    "sales_invoices",
    "product_mappings",
    "active_costprices",
    "sold_skus_active_costs",
    "stock_history_sync",
    "stock_history_lots",
    "lot_costs",
    "fixed_costs",
    "tariffs",
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

function MissingPanel({ checks, openId, setOpenId }: { checks: SetupCheck[]; openId: string; setOpenId: (id: string) => void }) {
  const openCheck = checks.find((check) => check.id === openId);
  if (!openCheck || !openCheck.missing?.length) return null;
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
      <div className="data-table">
        <table>
          <tbody>
            {openCheck.missing.map((row, index) => (
              <tr key={`${openCheck.id}-${index}`}>
                <td>{valuePreview(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckGrid({ checks, openId, setOpenId }: { checks: SetupCheck[]; openId: string; setOpenId: (id: string) => void }) {
  return (
    <div className="wizard-stack">
      <div className="home-grid">
        {checks.map((check) => (
          <CheckCard key={check.id} check={check} onOpenMissing={(id) => setOpenId(openId === id ? "" : id)} />
        ))}
      </div>
      <MissingPanel checks={checks} openId={openId} setOpenId={setOpenId} />
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

function ReliabilityBanner({ status }: { status: SetupStatus }) {
  const checks = qualityChecks(status);
  const blockers = checks.filter((check) => !check.done);
  return (
    <section className="module-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="module-card-title">Margeanalyse betrouwbaar: {status.can_complete ? "ja" : "nee"}</div>
          <div className="module-card-text">
            De flow controleert of Douano data, productkoppelingen, LOTs, kostprijzen, vaste kosten en tarieven compleet genoeg zijn.
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
          label="LOT kostdekking"
          value={`${(Number(status.summary.lot_pairs ?? 0) || 0) - (Number(status.summary.lot_pairs_missing_cost ?? 0) || 0)}/${status.summary.lot_pairs ?? 0}`}
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
  const overviewChecks = useMemo(() => qualityChecks(initialStatus), [initialStatus]);
  const syncChecks = useMemo(() => checkById(initialStatus, ["douano_products", "sales_invoices", "stock_history_sync"]), [initialStatus]);
  const productChecks = useMemo(() => checkById(initialStatus, ["product_mappings", "active_costprices"]), [initialStatus]);
  const lotChecks = useMemo(() => checkById(initialStatus, ["stock_history_sync", "stock_history_lots", "lot_costs"]), [initialStatus]);
  const costChecks = useMemo(() => checkById(initialStatus, ["active_costprices", "sold_skus_active_costs", "lot_costs", "fixed_costs", "tariffs"]), [initialStatus]);
  const exceptionChecks = useMemo(
    () => [...productChecks, ...lotChecks].filter((check, index, rows) => rows.findIndex((row) => row.id === check.id) === index),
    [lotChecks, productChecks]
  );

  function renderStepBody() {
    if (activeStep.id === "overview") {
      return (
        <div className="wizard-stack">
          <ApiRunStatusTable />
          <ReliabilityBanner status={initialStatus} />
          <section>
            <div className="module-card-title" style={{ marginBottom: 8 }}>Resultaten om op te lossen</div>
            <div className="module-card-text" style={{ marginBottom: 12 }}>
              Deze kaarten tonen de gevolgen van de data: producten zonder SKU, ontbrekende kostprijzen, LOT-dekking en jaarinstellingen.
            </div>
          </section>
          <CheckGrid checks={overviewChecks} openId={openMissingId} setOpenId={setOpenMissingId} />
        </div>
      );
    }

    if (activeStep.id === "sync") {
      return (
        <div className="wizard-stack">
          <CheckGrid checks={syncChecks} openId={openMissingId} setOpenId={setOpenMissingId} />
          <DouanoSyncPanel />
        </div>
      );
    }

    if (activeStep.id === "products") {
      return (
        <div className="wizard-stack">
          <CheckGrid checks={productChecks} openId={openMissingId} setOpenId={setOpenMissingId} />
          <DouanoProductMappingCard />
        </div>
      );
    }

    if (activeStep.id === "lots") {
      return (
        <div className="wizard-stack">
          <CheckGrid checks={lotChecks} openId={openMissingId} setOpenId={setOpenMissingId} />
          <LotKostenWorkspace skus={skus} articles={articles} year={initialStatus.year} />
        </div>
      );
    }

    if (activeStep.id === "costs") {
      return (
        <div className="wizard-stack">
          <CheckGrid checks={costChecks} openId={openMissingId} setOpenId={setOpenMissingId} />
          <section className="module-card compact-card">
            <div className="module-card-title">Kostprijsacties</div>
            <div className="module-card-text">
              Gebruik kostprijsbeheer voor actieve SKU-kostprijzen en LOT-kosten voor directe historische inkoopdekking.
            </div>
            <div className="editor-actions" style={{ marginTop: 12 }}>
              <div className="editor-actions-group">
                <Link href="/nieuwe-kostprijsberekening" className="editor-button">
                  Open kostprijsbeheer
                </Link>
                <Link href="/beheer/lot-kosten" className="editor-button editor-button-secondary">
                  Open LOT kosten
                </Link>
                <Link href="/vaste-kosten" className="editor-button editor-button-secondary">
                  Vaste kosten
                </Link>
                <Link href="/tarieven-heffingen" className="editor-button editor-button-secondary">
                  Tarieven
                </Link>
              </div>
            </div>
          </section>
        </div>
      );
    }

    if (activeStep.id === "exceptions") {
      return (
        <div className="wizard-stack">
          {hasMissing(exceptionChecks) ? <CheckGrid checks={exceptionChecks} openId={openMissingId} setOpenId={setOpenMissingId} /> : null}
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
