"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { API_BASE_URL } from "@/lib/api";

export type GenericRecord = Record<string, any>;

export type SetupCheck = {
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

export type SetupStatus = {
  year: number;
  can_complete: boolean;
  mode: string;
  summary: GenericRecord;
  checks: SetupCheck[];
};

export type WorkstreamKey = "overview" | "products" | "cost_sources" | "lots" | "exceptions" | "api" | "advanced";

export type WorkstreamDefinition = {
  id: WorkstreamKey;
  title: string;
  description: string;
};

export type RowActionRenderer = (row: GenericRecord, scopeRows: GenericRecord[]) => ReactNode;

export const DATA_QUALITY_WORKSTREAMS: WorkstreamDefinition[] = [
  {
    id: "overview",
    title: "Overzicht",
    description: "Werkvoorraad en betrouwbaarheid",
  },
  {
    id: "products",
    title: "Producten & SKU's",
    description: "Douano koppelen aan intern",
  },
  {
    id: "cost_sources",
    title: "Kostprijsbronnen",
    description: "Verkoopregels verwerkbaar maken",
  },
  {
    id: "lots",
    title: "LOT-register",
    description: "Interne en Douano LOTs",
  },
  {
    id: "exceptions",
    title: "Uitvalregels",
    description: "Bewuste uitzonderingen",
  },
  {
    id: "api",
    title: "API-status",
    description: "Sync runs en delta's",
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

const STEP_HELP: Record<WorkstreamKey, { title: string; description: string; outcome: string }> = {
  overview: {
    title: "Datakwaliteit workbench",
    description:
      "Dit scherm is geen lineaire wizard. Het toont welke werkvoorraad nog voorkomt dat Omzet & Marge betrouwbaar is voor het gekozen jaar.",
    outcome: "Doel: alle blokkerende kaarten op ok, met zichtbare acties voor wat nog open staat.",
  },
  products: {
    title: "Producten en SKU's",
    description:
      "Hier los je Douano producten op die nog niet naar een interne SKU wijzen. Douano blijft de bron voor verkochte producten; de app gebruikt de interne SKU voor kostprijs en rapportage.",
    outcome: "Na oplossen verdwijnen nieuwe/onbekende producten uit de werkvoorraad en kunnen verkoopregels naar kostprijsbronnen zoeken.",
  },
  cost_sources: {
    title: "Kostprijsbronnen",
    description:
      "Hier los je verkoopregels op die nog geen bruikbare kostprijsbron hebben. Denk aan SKU koppelen, historische kostprijs toevoegen, LOT alias koppelen of bewust geen kostprijs nodig.",
    outcome: "Na opslaan worden alleen de geraakte snapshots ververst en hoort de rij uit de blokkade te verdwijnen.",
  },
  lots: {
    title: "LOT-register",
    description:
      "Hier beheer je de relatie tussen interne LOTs uit kostprijzen/inkoopfacturen/opening voorraad en externe Douano LOTs. Matching is jaaroverstijgend; het jaar bepaalt alleen urgentie.",
    outcome: "Exacte matches en expliciete aliases zorgen dat Omzet & Marge de juiste kostprijsversie gebruikt.",
  },
  exceptions: {
    title: "Uitvalregels en bewuste uitzonderingen",
    description:
      "Hier staan regels die niet via de normale bier/SKU/LOT-route lopen, zoals afrondingen, diensten, giftsets en overige omzetregels.",
    outcome: "Elke uitzondering moet expliciet gecategoriseerd zijn, zodat niets stilletjes uit de margeanalyse verdwijnt.",
  },
  api: {
    title: "API-status",
    description:
      "Hier zie je de technische Douano runs en kun je syncs starten. Datakwaliteit zelf gebruikt vooral de laatste run en de nieuwe delta's.",
    outcome: "Na nieuwe API-runs ontstaan alleen nieuwe issues; bestaande expliciete oplossingen blijven staan.",
  },
  advanced: {
    title: "Geavanceerd beheer",
    description: "Technische controles, verbindingen en fallback-tools die niet in de dagelijkse datakwaliteit-flow horen.",
    outcome: "Alleen gebruiken voor diagnose, configuratie of uitzonderlijke onderhoudsacties.",
  },
};

type SyncStateItem = {
  resource: string;
  last_success_at?: string;
  last_since_date?: string;
  last_error?: string;
  stats?: GenericRecord;
  updated_at?: string;
};

export function pct(check: SetupCheck) {
  if (!check.total) return check.done ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((Number(check.current || 0) / Number(check.total || 1)) * 100)));
}

export function statusLabel(check: SetupCheck) {
  if (check.done) return "ok";
  if (check.current > 0) return "actie nodig";
  return "niet gestart";
}

export function valuePreview(row: GenericRecord) {
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

export function rowMatchPayload(row: GenericRecord) {
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

export function missingRowKey(row: GenericRecord) {
  const match = rowMatchPayload(row);
  return `${match.match_type}:${match.douano_product_id}:${match.line_description}`;
}

export function searchableMissingRowText(row: GenericRecord) {
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

export function checkById(status: SetupStatus, ids: string[]) {
  return ids.map((id) => status.checks.find((check) => check.id === id)).filter(Boolean) as SetupCheck[];
}

export function qualityChecks(status: SetupStatus) {
  return checkById(status, [
    "douano_products",
    "sales_invoices",
    "product_mappings",
    "stock_history_sync",
    "stock_history_lots",
    "sales_rows_cost_source",
  ]);
}

export function hasMissing(checks: SetupCheck[]) {
  return checks.some((check) => Array.isArray(check.missing) && check.missing.length > 0);
}

export function flowHref(href?: string) {
  if (!href) return "";
  if (href === "/beheer/productkoppelingen") return "/beheer/productkoppeling";
  if (href === "/instellingen/kostprijsbeheer") return "/nieuwe-kostprijsberekening";
  return href;
}

export function skuLabel(row: GenericRecord) {
  const name = String(row.name || row.sku_name || "").trim();
  const code = String(row.code || row.sku || "").trim();
  return [name, code].filter(Boolean).join(" - ") || String(row.id || "");
}

export function defaultHistoricalDate(year: number) {
  const safeYear = Number(year || new Date().getFullYear()) || new Date().getFullYear();
  return `${safeYear}-01-01`;
}

export async function readDataSet<T = GenericRecord>(name: string): Promise<T[]> {
  const response = await fetch(`/api/data/${encodeURIComponent(name)}`, { cache: "no-store", credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray((payload as any)?.items)) return (payload as any).items as T[];
  if (Array.isArray((payload as any)?.data)) return (payload as any).data as T[];
  return [];
}

export function StatusPill({ check }: { check: SetupCheck }) {
  const ok = Boolean(check.done);
  return <span className={`status-pill ${ok ? "status-ok" : "status-warning"}`}>{statusLabel(check)}</span>;
}

export function CheckCard({ check, onOpenMissing }: { check: SetupCheck; onOpenMissing: (id: string) => void }) {
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

export function MissingPanel({
  checks,
  openId,
  setOpenId,
  renderRowAction,
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  renderRowAction: RowActionRenderer;
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
                  <td style={{ width: 56, textAlign: "right" }}>{renderRowAction(row, selectedRows)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CheckGrid({
  checks,
  openId,
  setOpenId,
  renderRowAction,
  title = "Werkvoorraad",
  description = "Deze kaarten tonen welke data nog aandacht vraagt.",
  emptyText = "Geen openstaande regels in deze werkstroom.",
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  renderRowAction: RowActionRenderer;
  title?: string;
  description?: string;
  emptyText?: string;
}) {
  return (
    <div className="wizard-stack">
      <section>
        <div className="module-card-title" style={{ marginBottom: 8 }}>{title}</div>
        <div className="module-card-text" style={{ marginBottom: 12 }}>{description}</div>
      </section>
      {checks.length ? (
        <div className="home-grid">
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} onOpenMissing={(id) => setOpenId(openId === id ? "" : id)} />
          ))}
        </div>
      ) : (
        <div className="placeholder-block">{emptyText}</div>
      )}
      <MissingPanel checks={checks} openId={openId} setOpenId={setOpenId} renderRowAction={renderRowAction} />
    </div>
  );
}

export function SummaryMetric({ label, value }: { label: string; value: ReactNode }) {
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

export function ApiRunStatusTable() {
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

export function YearSelector({ status }: { status: SetupStatus }) {
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

export function ReliabilityBanner({ status }: { status: SetupStatus }) {
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

export function WorkstreamIntro({ step }: { step: WorkstreamDefinition }) {
  const help = STEP_HELP[step.id];
  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "grid", gap: 6 }}>
        <div className="module-card-title">{help.title}</div>
        <div className="module-card-text">{help.description}</div>
        <div className="module-card-text">
          <strong>Uitkomst:</strong> {help.outcome}
        </div>
      </div>
    </section>
  );
}
