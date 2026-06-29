"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { API_BASE_URL } from "@/lib/apiShared";

type DraftRow = {
  id: string;
  owner: string;
  source_year: number;
  target_year: number;
  created_at: string;
  updated_at: string;
  payload?: Record<string, unknown>;
};

type YearsetsResponse = {
  drafts: DraftRow[];
  production_years: number[];
  last_year: number;
};

type PlanSnapshot = {
  id: string;
  jaar: number;
  scenario_name: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  frozen_at: string;
  payload?: Record<string, unknown>;
};

type YearCloseSnapshot = {
  id: string;
  jaar: number;
  status: string;
  closed_at: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

type YearClosePreview = {
  kind?: string;
  year: number;
  basis: string;
  fixed_cost_total: number;
  actuals?: {
    totals?: Record<string, unknown>;
  };
  checks?: {
    missing_cost_lines?: number;
    unmapped_revenue?: number;
  };
};

type YearOverviewRow = {
  year: number;
  draft?: DraftRow;
  isProduction: boolean;
  isLastProductionYear: boolean;
  activePlan?: PlanSnapshot;
  latestPlan?: PlanSnapshot;
  yearClose?: YearCloseSnapshot;
};

type BusyState = null | "load" | "deleteDraft" | "rollback" | "backfill" | "previewClose" | "closeYear";

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function getYearsets(): Promise<YearsetsResponse> {
  const response = await fetch(`${API_BASE_URL}/meta/yearsets`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Ophalen mislukt (${response.status}).`));
  }
  return payload as YearsetsResponse;
}

async function getPlans(): Promise<PlanSnapshot[]> {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/plans?include_archived=true`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Plannen ophalen mislukt (${response.status}).`));
  }
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function getYearCloses(): Promise<YearCloseSnapshot[]> {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/year-closes`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Jaarafsluitingen ophalen mislukt (${response.status}).`));
  }
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function deleteDraftsForYear(targetYear: number) {
  const response = await fetch(
    `${API_BASE_URL}/meta/new-year-drafts-for-year?target_year=${encodeURIComponent(String(targetYear))}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Verwijderen mislukt (${response.status}).`));
  }
  return payload;
}

async function postRollbackYearset(year: number) {
  const response = await fetch(
    `${API_BASE_URL}/meta/rollback-yearset?year=${encodeURIComponent(String(year))}`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Rollback mislukt (${response.status}).`));
  }
  return payload;
}

async function postFirstUseBackfill(params: { year: number; planRevenue: number; fixedCosts: number }) {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/first-use-backfill`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year: params.year,
      scenario_name: `First-use backfill ${params.year}`,
      replace_active: true,
      plan_revenue: params.planRevenue,
      fixed_cost_total: params.fixedCosts,
      basis: "invoice",
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Backfill mislukt (${response.status}).`));
  }
  return payload;
}

async function getYearClosePreview(year: number): Promise<YearClosePreview> {
  const response = await fetch(
    `${API_BASE_URL}/integrations/break-even/year-close-preview?year=${encodeURIComponent(String(year))}&basis=invoice`,
    {
      credentials: "include",
      cache: "no-store",
    }
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Jaarafsluiting controleren mislukt (${response.status}).`));
  }
  return payload.preview as YearClosePreview;
}

async function postCloseYear(year: number) {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/close-year`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, basis: "invoice", overwrite: false }),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Jaarafsluiting opslaan mislukt (${response.status}).`));
  }
  return payload;
}

function formatIso(value: string) {
  if (!value) return "-";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  } catch {
    return value;
  }
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  const amount = num(value);
  if (!amount) return "-";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function planMetric(plan: PlanSnapshot | undefined, key: "revenue" | "contribution" | "fixed_costs") {
  const payload = (plan?.payload ?? {}) as Record<string, unknown>;
  const targets = (payload.targets ?? {}) as Record<string, unknown>;
  const model = (payload.model ?? {}) as Record<string, unknown>;
  if (key === "fixed_costs") {
    return num(targets.fixed_cost_total ?? targets.fixed_costs ?? model.fixed_cost_total);
  }
  return num(targets[key] ?? model[key]);
}

function previewTotal(preview: YearClosePreview | null, key: string) {
  return num(preview?.actuals?.totals?.[key]);
}

function planLabel(plan: PlanSnapshot | undefined) {
  if (!plan) return "Geen plan";
  if (plan.status === "active" && plan.source === "first_use_backfill") return "First-use backfill";
  if (plan.status === "active") return "Plan actief";
  return `Plan ${plan.status || "onbekend"}`;
}

function rowStatus(row: YearOverviewRow) {
  if (row.yearClose) return "Afgesloten";
  if (row.draft) return "Concept nieuw jaar";
  if (row.activePlan?.source === "first_use_backfill") return "First-use backfill";
  if (row.activePlan) return "Plan actief";
  if (row.isProduction) return "Productiejaar";
  return "Nog niet ingericht";
}

function buildRows(params: {
  yearsets: YearsetsResponse | null;
  plans: PlanSnapshot[];
  closes: YearCloseSnapshot[];
}): YearOverviewRow[] {
  const years = new Set<number>();
  const productionYears = new Set<number>();
  const draftsByYear = new Map<number, DraftRow>();
  const activePlansByYear = new Map<number, PlanSnapshot>();
  const latestPlansByYear = new Map<number, PlanSnapshot>();
  const closesByYear = new Map<number, YearCloseSnapshot>();

  for (const year of params.yearsets?.production_years ?? []) {
    const value = Number(year);
    if (value > 0) {
      years.add(value);
      productionYears.add(value);
    }
  }
  for (const draft of params.yearsets?.drafts ?? []) {
    const value = Number(draft.target_year);
    if (value > 0) {
      years.add(value);
      draftsByYear.set(value, draft);
    }
  }
  for (const plan of params.plans) {
    const value = Number(plan.jaar);
    if (value <= 0) continue;
    years.add(value);
    if (!latestPlansByYear.has(value)) latestPlansByYear.set(value, plan);
    if (plan.status === "active" && !activePlansByYear.has(value)) activePlansByYear.set(value, plan);
  }
  for (const close of params.closes) {
    const value = Number(close.jaar);
    if (value > 0) {
      years.add(value);
      closesByYear.set(value, close);
    }
  }

  return [...years]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      draft: draftsByYear.get(year),
      isProduction: productionYears.has(year),
      isLastProductionYear: year === Number(params.yearsets?.last_year ?? 0),
      activePlan: activePlansByYear.get(year),
      latestPlan: latestPlansByYear.get(year),
      yearClose: closesByYear.get(year),
    }));
}

export function JaarsetsPanel() {
  const [busy, setBusy] = useState<BusyState>("load");
  const [error, setError] = useState("");
  const [yearsets, setYearsets] = useState<YearsetsResponse | null>(null);
  const [plans, setPlans] = useState<PlanSnapshot[]>([]);
  const [closes, setCloses] = useState<YearCloseSnapshot[]>([]);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [backfillYear, setBackfillYear] = useState("2025");
  const [backfillRevenue, setBackfillRevenue] = useState("144000");
  const [backfillFixedCosts, setBackfillFixedCosts] = useState("56000");
  const [closePreview, setClosePreview] = useState<YearClosePreview | null>(null);
  const [closePreviewYear, setClosePreviewYear] = useState(0);

  const rows = useMemo(() => buildRows({ yearsets, plans, closes }), [yearsets, plans, closes]);
  const lastYear = Number(yearsets?.last_year ?? 0) || 0;
  const activePlanCount = plans.filter((plan) => plan.status === "active").length;

  async function reload() {
    const [nextYearsets, nextPlans, nextCloses] = await Promise.all([getYearsets(), getPlans(), getYearCloses()]);
    setYearsets(nextYearsets);
    setPlans(nextPlans);
    setCloses(nextCloses);
  }

  useEffect(() => {
    setBusy("load");
    setError("");
    void reload()
      .catch((err) => setError(err instanceof Error ? err.message : "Ophalen mislukt."))
      .finally(() => setBusy(null));
  }, []);

  function runAction(action: BusyState, task: () => Promise<Record<string, unknown>>) {
    setBusy(action);
    setError("");
    setInfo(null);
    void task()
      .then((res) => {
        setInfo(res);
        if (action === "closeYear") {
          setClosePreview(null);
          setClosePreviewYear(0);
        }
        return reload();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
      .finally(() => setBusy(null));
  }

  function previewYearClose(year: number) {
    setBusy("previewClose");
    setError("");
    setInfo(null);
    setClosePreview(null);
    setClosePreviewYear(year);
    void getYearClosePreview(year)
      .then((preview) => setClosePreview(preview))
      .catch((err) => setError(err instanceof Error ? err.message : "Jaarafsluiting controleren mislukt."))
      .finally(() => setBusy(null));
  }

  function closeYearFromPreview() {
    if (!closePreviewYear || !closePreview) return;
    const missingCostLines = Number(closePreview.checks?.missing_cost_lines ?? 0);
    const unmappedRevenue = Number(closePreview.checks?.unmapped_revenue ?? 0);
    const warning = missingCostLines || unmappedRevenue
      ? ` Er zijn nog aandachtspunten: ${missingCostLines} regels zonder kostprijs en ${money(unmappedRevenue)} ongekoppelde omzet.`
      : "";
    const ok = window.confirm(`Jaar ${closePreviewYear} definitief afsluiten?${warning}`);
    if (!ok) return;
    runAction("closeYear", () => postCloseYear(closePreviewYear));
  }

  return (
    <div className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Jaarbeheer</div>
        <div className="module-card-text">
          Beheer per jaar de jaarset, het frozen break-even plan, nieuw-jaar-concepten en de jaarafsluiting. Break-even gebruikt het actieve plan als stuurinformatie; jaarafsluiting legt de werkelijkheid vast.
        </div>
      </div>

      {error ? (
        <div className="placeholder-block" style={{ marginBottom: 16 }}>
          <strong>Fout</strong>
          {error}
        </div>
      ) : null}

      <div className="data-quality-score-grid" style={{ marginBottom: 18 }}>
        <div className="data-quality-card">
          <div className="data-quality-card-title">Productiejaren</div>
          <div className="data-quality-card-count">{yearsets?.production_years?.length ?? 0}</div>
          <div className="data-quality-card-text">Laatste jaar: {lastYear || "-"}</div>
        </div>
        <div className="data-quality-card">
          <div className="data-quality-card-title">Actieve plannen</div>
          <div className="data-quality-card-count">{activePlanCount}</div>
          <div className="data-quality-card-text">Frozen plan of first-use backfill.</div>
        </div>
        <div className="data-quality-card">
          <div className="data-quality-card-title">Concepten nieuw jaar</div>
          <div className="data-quality-card-count">{yearsets?.drafts?.length ?? 0}</div>
          <div className="data-quality-card-text">Concepten blijven bewerkbaar tot commit.</div>
        </div>
        <div className="data-quality-card">
          <div className="data-quality-card-title">Afgesloten jaren</div>
          <div className="data-quality-card-count">{closes.length}</div>
          <div className="data-quality-card-text">Definitieve resultaat-snapshots.</div>
        </div>
      </div>

      <section className="placeholder-block" style={{ marginBottom: 18 }}>
        <strong>First-use backfill</strong>
        <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
          Gebruik dit alleen om een bestaand jaar een eerste plan te geven. De app reconstrueert variabele kosten en contributie uit de echte Omzet & Marge snapshot.
        </div>
        <div className="wizard-form-grid">
          <label className="form-field">
            <span>Jaar</span>
            <input value={backfillYear} onChange={(event) => setBackfillYear(event.target.value)} inputMode="numeric" />
          </label>
          <label className="form-field">
            <span>Plan omzet</span>
            <input value={backfillRevenue} onChange={(event) => setBackfillRevenue(event.target.value)} inputMode="decimal" />
          </label>
          <label className="form-field">
            <span>Plan vaste kosten</span>
            <input value={backfillFixedCosts} onChange={(event) => setBackfillFixedCosts(event.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="editor-button"
            disabled={busy !== null}
            onClick={() => {
              const year = Number(backfillYear);
              const planRevenue = Number(backfillRevenue);
              const fixedCosts = Number(backfillFixedCosts);
              if (!year || !planRevenue || !fixedCosts) {
                setError("Vul jaar, plan omzet en plan vaste kosten in.");
                return;
              }
              const ok = window.confirm(
                `First-use backfill voor ${year} opslaan? Het actieve break-even plan voor dit jaar wordt vervangen.`
              );
              if (!ok) return;
              runAction("backfill", () => postFirstUseBackfill({ year, planRevenue, fixedCosts }));
            }}
          >
            Frozen plan opslaan
          </button>
        </div>
      </section>

      <section className="placeholder-block">
        <strong>Jaren</strong>
        <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
          Dit is het centrale overzicht. Gebruik Break-even voor analyse, Nieuw jaar voorbereiden voor concepten en Jaarafsluiting voor definitieve werkelijkheid.
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Jaar</th>
                <th style={{ width: 180 }}>Status</th>
                <th style={{ width: 170 }}>Plan</th>
                <th style={{ width: 130 }}>Plan omzet</th>
                <th style={{ width: 150 }}>Plan contributie</th>
                <th style={{ width: 140 }}>Vaste kosten</th>
                <th style={{ width: 190 }}>Jaarafsluiting</th>
                <th style={{ width: 190 }}>Nieuw jaar</th>
                <th style={{ width: 300 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const plan = row.activePlan ?? row.latestPlan;
                return (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    <td>
                      <span className={`status-pill ${row.yearClose ? "status-ok" : row.activePlan ? "status-warning" : "status-neutral"}`}>
                        {rowStatus(row)}
                      </span>
                    </td>
                    <td>
                      <div>{planLabel(row.activePlan)}</div>
                      {plan ? <small className="muted">{plan.scenario_name}</small> : null}
                    </td>
                    <td>{money(planMetric(plan, "revenue"))}</td>
                    <td>{money(planMetric(plan, "contribution"))}</td>
                    <td>{money(planMetric(plan, "fixed_costs"))}</td>
                    <td>
                      {row.yearClose ? (
                        <>
                          <div>Afgesloten</div>
                          <small className="muted">{formatIso(row.yearClose.closed_at)}</small>
                        </>
                      ) : (
                        <span className="muted">Nog open</span>
                      )}
                    </td>
                    <td>
                      {row.draft ? (
                        <>
                          <div>Concept uit {row.draft.source_year}</div>
                          <small className="muted">{formatIso(row.draft.updated_at)}</small>
                        </>
                      ) : (
                        <span className="muted">Geen concept</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/break-even-next?year=${encodeURIComponent(String(row.year))}`}
                        className="editor-button editor-button-secondary"
                        style={{ marginRight: 8, display: "inline-block", textDecoration: "none" }}
                      >
                        Break-even
                      </Link>
                      <Link
                        href={`/nieuw-jaar-voorbereiden?target_year=${encodeURIComponent(String(row.year + 1))}`}
                        className="editor-button editor-button-secondary"
                        style={{ marginRight: 8, display: "inline-block", textDecoration: "none" }}
                      >
                        Nieuw jaar
                      </Link>
                      {row.draft ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(
                              `Weet je zeker dat je alle concepten voor ${row.year} wilt verwijderen?`
                            );
                            if (!ok) return;
                            runAction("deleteDraft", () => deleteDraftsForYear(row.year));
                          }}
                        >
                          Verwijder concept
                        </button>
                      ) : null}
                      {row.isLastProductionYear ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(
                              `Rollback verwijdert de jaarset-data voor ${row.year}. Kostprijzen en offertes blijven staan. Doorgaan?`
                            );
                            if (!ok) return;
                            runAction("rollback", () => postRollbackYearset(row.year));
                          }}
                          style={{ marginLeft: row.draft ? 8 : 0 }}
                        >
                          Rollback
                        </button>
                      ) : null}
                      {!row.yearClose ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          disabled={busy !== null}
                          onClick={() => previewYearClose(row.year)}
                          style={{ marginLeft: 8 }}
                        >
                          Controleer afsluiting
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    Geen jaren gevonden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {closePreview ? (
        <section className="placeholder-block" style={{ marginTop: 18 }}>
          <strong>Jaarafsluiting {closePreviewYear}</strong>
          <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
            Facturenbasis. Controleer deze snapshot voordat je het jaar definitief vastlegt.
          </div>
          <div className="record-card-grid" style={{ marginBottom: 14 }}>
            <div className="wizard-toggle-card">
              <span><strong>Omzet</strong><small>{money(previewTotal(closePreview, "revenue"))}</small></span>
            </div>
            <div className="wizard-toggle-card">
              <span><strong>Variabele kosten</strong><small>{money(previewTotal(closePreview, "variable_cost"))}</small></span>
            </div>
            <div className="wizard-toggle-card">
              <span><strong>Contributie</strong><small>{money(previewTotal(closePreview, "contribution"))}</small></span>
            </div>
            <div className="wizard-toggle-card">
              <span><strong>Vaste kosten</strong><small>{money(closePreview.fixed_cost_total)}</small></span>
            </div>
          </div>
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Waarde</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Verkoopregels zonder kostprijsbron</td>
                  <td>
                    <span className={`status-pill ${Number(closePreview.checks?.missing_cost_lines ?? 0) === 0 ? "status-ok" : "status-warning"}`}>
                      {Number(closePreview.checks?.missing_cost_lines ?? 0) === 0 ? "ok" : "aandacht nodig"}
                    </span>
                  </td>
                  <td>{Number(closePreview.checks?.missing_cost_lines ?? 0)}</td>
                </tr>
                <tr>
                  <td>Ongekoppelde omzet</td>
                  <td>
                    <span className={`status-pill ${Number(closePreview.checks?.unmapped_revenue ?? 0) === 0 ? "status-ok" : "status-warning"}`}>
                      {Number(closePreview.checks?.unmapped_revenue ?? 0) === 0 ? "ok" : "aandacht nodig"}
                    </span>
                  </td>
                  <td>{money(closePreview.checks?.unmapped_revenue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="editor-actions" style={{ marginTop: 12 }}>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setClosePreview(null)} disabled={busy !== null}>
              Sluiten
            </button>
            <button type="button" className="editor-button" onClick={closeYearFromPreview} disabled={busy !== null}>
              Jaar definitief afsluiten
            </button>
          </div>
        </section>
      ) : null}

      {busy ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Bezig...</strong>
          {busy === "load" ? "Overzicht laden." : null}
          {busy === "deleteDraft" ? "Concept verwijderen." : null}
          {busy === "rollback" ? "Rollback uitvoeren." : null}
          {busy === "backfill" ? "Frozen plan opslaan." : null}
          {busy === "previewClose" ? "Jaarafsluiting controleren." : null}
          {busy === "closeYear" ? "Jaarafsluiting opslaan." : null}
        </div>
      ) : null}

      {info ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Resultaat</strong>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(info, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
