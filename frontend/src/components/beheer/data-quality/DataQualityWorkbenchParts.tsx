"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { API_RESOURCES, STEP_HELP } from "@/components/beheer/data-quality/DataQualityConfig";
import {
  flowHref,
  formatDateTime,
  missingRowKey,
  pct,
  qualityChecks,
  searchableMissingRowText,
  statusLabel,
  syncDelta,
  valuePreview,
} from "@/components/beheer/data-quality/DataQualityHelpers";
import type {
  GenericRecord,
  RowActionRenderer,
  SetupCheck,
  SetupStatus,
  SyncStateItem,
  WorkstreamDefinition,
} from "@/components/beheer/data-quality/DataQualityTypes";

export { DATA_QUALITY_WORKSTREAMS } from "@/components/beheer/data-quality/DataQualityConfig";
export {
  checkById,
  defaultHistoricalDate,
  flowHref,
  formatDateTime,
  hasMissing,
  missingRowKey,
  pct,
  qualityChecks,
  readDataSet,
  rowMatchPayload,
  searchableMissingRowText,
  skuLabel,
  statusLabel,
  syncDelta,
  valuePreview,
} from "@/components/beheer/data-quality/DataQualityHelpers";
export type {
  GenericRecord,
  RowActionRenderer,
  SetupCheck,
  SetupStatus,
  WorkstreamDefinition,
  WorkstreamKey,
} from "@/components/beheer/data-quality/DataQualityTypes";
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
