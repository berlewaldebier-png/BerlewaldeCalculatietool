"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionStatus, type ActionStatusState } from "@/components/ActionStatus";
import { API_BASE_URL } from "@/lib/apiShared";

type ForecastBinding = {
  generation_id: string;
  run_id: string;
  plan_id: string;
  plan_contract_hash: string;
  operational_year: number;
};

type ForecastPeriod = {
  period: string;
  closed: boolean;
  current_partial: boolean;
  plan_revenue: number;
  plan_variable_cost: number;
  plan_contribution: number;
  plan_liters: number;
  plan_units: number;
  actual_revenue: number;
  actual_variable_cost: number;
  actual_contribution: number;
  actual_liters: number;
  actual_units: number;
  forecast_revenue: number;
  forecast_variable_cost: number;
  forecast_contribution: number;
  forecast_liters: number;
  forecast_units: number;
};

type Revision = {
  id: string;
  revision_number: number;
  status: string;
  as_of_date: string;
  reason: string;
  created_by: string;
  created_role: string;
  created_at: string;
};

type ForecastWorkspace = {
  status: "ready" | "closed";
  binding: ForecastBinding;
  actual_as_of_date: string;
  actual_cutoff_period: string;
  forecast_source: string;
  current_revision?: Revision | null;
  history?: Revision[];
  periods: ForecastPeriod[];
};

type ReadModelSource = Record<string, unknown>;

type EditablePeriod = Pick<
  ForecastPeriod,
  "period" | "closed" | "current_partial" | "actual_revenue" | "actual_variable_cost" | "actual_contribution" | "actual_liters" | "actual_units"
> & {
  revenue: number;
  variable_cost: number;
  contribution: number;
  liters: number;
  units: number;
};

const monthNames = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: digits }).format(value);
}

function record(value: unknown): ReadModelSource {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ReadModelSource
    : {};
}

function initialWorkspaceFromReadModel(readModel: Record<string, unknown> | null | undefined): ForecastWorkspace | null {
  if (!readModel) return null;
  const sources = record(readModel.sources);
  if (String(sources.consumer_mode ?? "") !== "active_generation") return null;
  const binding: ForecastBinding = {
    generation_id: String(sources.commercial_generation_id ?? ""),
    run_id: String(sources.commercial_run_id ?? ""),
    plan_id: String(sources.plan_snapshot_id ?? ""),
    plan_contract_hash: String(sources.plan_contract_hash ?? ""),
    operational_year: Number(readModel.year ?? 0),
  };
  if (!binding.generation_id || !binding.run_id || !binding.plan_id || !binding.plan_contract_hash || binding.operational_year <= 0) return null;
  const timeline = Array.isArray(readModel.timeline) ? readModel.timeline : [];
  const cutoff = String(sources.forecast_cutoff_period ?? "");
  const actualAsOf = String(sources.actual_as_of_date ?? "");
  const currentRevisionId = String(sources.reforecast_snapshot_id ?? "");
  const periods = timeline.map((raw) => {
    const row = record(raw);
    const period = String(row.period ?? "").slice(0, 7);
    const [yearPart, monthPart] = period.split("-").map(Number);
    const asOf = actualAsOf ? new Date(`${actualAsOf}T00:00:00`) : null;
    const lastDay = yearPart > 0 && monthPart > 0 ? new Date(yearPart, monthPart, 0).getDate() : 0;
    const cutoffClosed = period < cutoff || Boolean(
      period === cutoff
      && asOf
      && asOf.getFullYear() === yearPart
      && asOf.getMonth() + 1 === monthPart
      && asOf.getDate() === lastDay
    );
    return {
      period,
      closed: cutoffClosed,
      current_partial: period === cutoff && !cutoffClosed,
      plan_revenue: Number(row.plan_revenue ?? 0),
      plan_variable_cost: Number(row.plan_variable_cost ?? 0),
      plan_contribution: Number(row.plan_contribution ?? 0),
      plan_liters: Number(row.plan_liters ?? 0),
      plan_units: Number(row.plan_units ?? 0),
      actual_revenue: Number(row.actual_revenue ?? 0),
      actual_variable_cost: Number(row.actual_variable_cost ?? 0),
      actual_contribution: Number(row.actual_contribution ?? 0),
      actual_liters: Number(row.actual_liters ?? 0),
      actual_units: Number(row.actual_units ?? 0),
      forecast_revenue: Number(row.forecast_revenue ?? 0),
      forecast_variable_cost: Number(row.forecast_variable_cost ?? 0),
      forecast_contribution: Number(row.forecast_contribution ?? 0),
      forecast_liters: Number(row.forecast_liters ?? 0),
      forecast_units: Number(row.forecast_units ?? 0),
    } satisfies ForecastPeriod;
  }).filter((row) => row.period.length === 7);
  if (periods.length !== 12) return null;
  return {
    status: String(sources.reforecast_source ?? "") === "year_close_snapshot" ? "closed" : "ready",
    binding,
    actual_as_of_date: actualAsOf,
    actual_cutoff_period: cutoff,
    forecast_source: String(sources.reforecast_source ?? ""),
    current_revision: currentRevisionId ? {
      id: currentRevisionId,
      revision_number: 0,
      status: "active",
      as_of_date: actualAsOf,
      reason: "",
      created_by: "",
      created_role: "",
      created_at: "",
    } : null,
    history: [],
    periods,
  };
}

function editableRows(workspace: ForecastWorkspace): EditablePeriod[] {
  return (workspace.periods ?? []).map((row) => {
    const normalizeForecast = row.closed ? finiteNumber : asNumber;
    const revenue = normalizeForecast(row.forecast_revenue);
    const variableCost = normalizeForecast(row.forecast_variable_cost);
    return {
      period: row.period,
      closed: Boolean(row.closed),
      current_partial: Boolean(row.current_partial),
      actual_revenue: finiteNumber(row.actual_revenue),
      actual_variable_cost: finiteNumber(row.actual_variable_cost),
      actual_contribution: finiteNumber(row.actual_contribution),
      actual_liters: finiteNumber(row.actual_liters),
      actual_units: finiteNumber(row.actual_units),
      revenue,
      variable_cost: variableCost,
      contribution: revenue - variableCost,
      liters: normalizeForecast(row.forecast_liters),
      units: normalizeForecast(row.forecast_units),
    };
  });
}

async function responseError(response: Response) {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail || `Request mislukt (${response.status}).`;
  } catch {
    return `Request mislukt (${response.status}).`;
  }
}

export function ManagementForecastPanel({
  enabled,
  canManage,
  initialReadModel,
}: {
  enabled: boolean;
  canManage: boolean;
  initialReadModel?: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const initialWorkspace = useMemo(() => initialWorkspaceFromReadModel(initialReadModel), [initialReadModel]);
  const [workspace, setWorkspace] = useState<ForecastWorkspace | null>(initialWorkspace);
  const [rows, setRows] = useState<EditablePeriod[]>(() => initialWorkspace ? editableRows(initialWorkspace) : []);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(enabled && !initialWorkspace);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ActionStatusState | null>(null);

  useEffect(() => {
    if (!initialWorkspace) return;
    setWorkspace(initialWorkspace);
    setRows(editableRows(initialWorkspace));
    setHistoryLoaded(false);
  }, [initialWorkspace]);

  useEffect(() => {
    if (!enabled || initialWorkspace) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/integrations/break-even/management-forecast`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        const payload = await response.json() as { item?: ForecastWorkspace };
        if (!payload.item) throw new Error("Management Forecast-contract ontbreekt.");
        if (!cancelled) {
          setWorkspace(payload.item);
          setRows(editableRows(payload.item));
          setStatus(null);
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus({ kind: "error", message: "Forecast-editor kon niet worden geladen.", guidance: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled, initialWorkspace]);

  async function loadHistory() {
    if (!workspace || historyLoading || historyLoaded) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/management-forecast`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as { item?: ForecastWorkspace };
      if (!payload.item) throw new Error("Revisiehistorie ontbreekt.");
      setWorkspace((current) => current ? {
        ...current,
        current_revision: payload.item?.current_revision,
        history: payload.item?.history ?? [],
      } : payload.item ?? null);
      setHistoryLoaded(true);
    } catch (error) {
      setStatus({ kind: "error", message: "Revisiehistorie kon niet worden geladen.", guidance: error instanceof Error ? error.message : String(error) });
    } finally {
      setHistoryLoading(false);
    }
  }

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue,
    variable_cost: sum.variable_cost + row.variable_cost,
    contribution: sum.contribution + row.contribution,
    liters: sum.liters + row.liters,
    units: sum.units + row.units,
  }), { revenue: 0, variable_cost: 0, contribution: 0, liters: 0, units: 0 }), [rows]);

  function updateRow(period: string, key: "revenue" | "variable_cost" | "liters" | "units", value: string) {
    setRows((current) => current.map((row) => {
      if (row.period !== period || row.closed) return row;
      const next = { ...row, [key]: asNumber(value) };
      next.contribution = next.revenue - next.variable_cost;
      return next;
    }));
  }

  async function save() {
    if (!workspace || saving || workspace.status === "closed") return;
    if (reason.trim().length < 10) {
      setStatus({ kind: "warning", message: "Vul een reden van minimaal 10 tekens in.", guidance: "De reden hoort bij de audittrail van deze Forecast-revisie." });
      return;
    }
    if (!window.confirm(`Forecast-revisie voor ${workspace.binding.operational_year} opslaan? Het Plan en Actual blijven ongewijzigd.`)) return;
    setSaving(true);
    setStatus({ kind: "pending", message: "Forecast-revisie opslaan…", guidance: "De jaarset- en Plan-binding worden opnieuw gecontroleerd." });
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/management-forecast`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          binding: workspace.binding,
          expected_active_revision_id: workspace.current_revision?.id ?? "",
          reason: reason.trim(),
          period_allocations: rows.map((row) => ({
            period: row.period,
            revenue: row.revenue,
            variable_cost: row.variable_cost,
            contribution: row.contribution,
            liters: row.liters,
            units: row.units,
          })),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as { result?: { workspace?: ForecastWorkspace } };
      const next = payload.result?.workspace;
      if (next) {
        setWorkspace(next);
        setRows(editableRows(next));
        setHistoryLoaded(true);
      }
      setReason("");
      setStatus({ kind: "success", message: "Forecast-revisie is opgeslagen.", guidance: "Dashboard en analyse gebruiken nu deze revisie; Plan en Actual zijn niet gewijzigd." });
      router.refresh();
    } catch (error) {
      setStatus({ kind: "error", message: "Forecast-revisie is niet opgeslagen.", guidance: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="module-card management-forecast-panel">
      <div className="module-card-header be-next-table-header">
        <div>
          <div className="module-card-title">Management Forecast</div>
          <div className="module-card-text">
            Plan blijft bevroren. Verstreken maanden zijn exact Actual; alleen de lopende en toekomstige verwachting kan als nieuwe revisie worden vastgelegd. Niet-gefactureerde orders worden niet automatisch ingeschat.
          </div>
        </div>
        <span className={`status-pill ${workspace?.current_revision ? "status-ok" : "status-neutral"}`}>
          {workspace?.current_revision ? (workspace.current_revision.revision_number > 0 ? `revisie ${workspace.current_revision.revision_number}` : "actieve revisie") : "initiële Forecast"}
        </span>
      </div>

      {loading ? <ActionStatus kind="pending" message="Forecast-editor laden…" guidance="Plan, Actual en de actieve revisie worden gekoppeld." /> : null}
      {status ? <ActionStatus {...status} /> : null}

      {workspace ? (
        <>
          <div className="management-forecast-meta">
            <span><strong>Jaar:</strong> {workspace.binding.operational_year}</span>
            <span><strong>Actual t/m:</strong> {workspace.actual_as_of_date || "nog geen facturen"}</span>
            <span><strong>Basis:</strong> factuurdatum</span>
          </div>
          <div className="data-table management-forecast-table">
            <table>
              <thead>
                <tr><th>Maand</th><th>Status</th><th>Actual omzet</th><th>Forecast omzet</th><th>Variabele kosten</th><th>Contributie</th><th>Liters</th><th>Eenheden</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const month = Number(row.period.slice(5, 7));
                  const disabled = row.closed || !canManage || workspace.status === "closed";
                  return (
                    <tr key={row.period}>
                      <td><strong>{monthNames[month - 1] ?? row.period}</strong><small>{row.period}</small></td>
                      <td>{row.closed ? "Verstreken · Actual" : row.current_partial ? "Lopend" : "Toekomst"}</td>
                      <td>{money(row.actual_revenue)}</td>
                      <td><input aria-label={`Forecast omzet ${row.period}`} className="editor-input forecast-number" type="number" min="0" step="0.01" disabled={disabled} value={row.revenue} onChange={(event) => updateRow(row.period, "revenue", event.target.value)} /></td>
                      <td><input aria-label={`Forecast variabele kosten ${row.period}`} className="editor-input forecast-number" type="number" min="0" step="0.01" disabled={disabled} value={row.variable_cost} onChange={(event) => updateRow(row.period, "variable_cost", event.target.value)} /></td>
                      <td>{money(row.contribution)}</td>
                      <td><input aria-label={`Forecast liters ${row.period}`} className="editor-input forecast-number" type="number" min="0" step="0.01" disabled={disabled} value={row.liters} onChange={(event) => updateRow(row.period, "liters", event.target.value)} /></td>
                      <td><input aria-label={`Forecast eenheden ${row.period}`} className="editor-input forecast-number" type="number" min="0" step="1" disabled={disabled} value={row.units} onChange={(event) => updateRow(row.period, "units", event.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><th colSpan={3}>Jaar-Forecast</th><th>{money(totals.revenue)}</th><th>{money(totals.variable_cost)}</th><th>{money(totals.contribution)}</th><th>{number(totals.liters, 1)}</th><th>{number(totals.units)}</th></tr></tfoot>
            </table>
          </div>

          {canManage && workspace.status !== "closed" ? (
            <div className="management-forecast-actions">
              <label className="management-forecast-reason">Reden voor deze revisie
                <textarea className="editor-input" rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Bijvoorbeeld: verwachting juli aangepast na voorraadherstel." />
              </label>
              <button type="button" className="editor-button" disabled={saving || rows.length !== 12} onClick={() => void save()}>{saving ? "Opslaan…" : "Forecast-revisie opslaan"}</button>
            </div>
          ) : (
            <ActionStatus kind="warning" message={workspace.status === "closed" ? "Dit jaar is afgesloten." : "Alleen Management of Administrator kan Forecast wijzigen."} guidance="De Forecast en revisiehistorie blijven read-only zichtbaar." />
          )}

          {workspace.current_revision || (workspace.history ?? []).length ? (
            <details className="management-forecast-history" onToggle={(event) => { if (event.currentTarget.open) void loadHistory(); }}>
              <summary>Revisiehistorie{historyLoaded ? ` (${workspace.history?.length ?? 0})` : " laden"}</summary>
              {historyLoading ? <ActionStatus kind="pending" message="Revisiehistorie laden…" /> : null}
              <div className="data-table"><table><thead><tr><th>Revisie</th><th>Status</th><th>Vastgelegd</th><th>Door</th><th>Reden</th></tr></thead><tbody>
                {(workspace.history ?? []).map((revision) => <tr key={revision.id}><td>{revision.revision_number}</td><td>{revision.status === "active" ? "Actief" : "Vervangen"}</td><td>{revision.created_at}</td><td>{revision.created_by} ({revision.created_role})</td><td>{revision.reason}</td></tr>)}
              </tbody></table></div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
