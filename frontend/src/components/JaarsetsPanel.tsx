"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";

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

type ManagementRow =
  | { id: string; year: number; status: "concept"; kind: "Nieuw jaar voorbereiden"; date: string; draft: DraftRow }
  | { id: string; year: number; status: "definitief"; kind: "First-use backfill"; date: string; plan: PlanSnapshot }
  | { id: string; year: number; status: "definitief"; kind: "Jaar afsluiten"; date: string; close: YearCloseSnapshot }
  | { id: string; year: number; status: "definitief"; kind: "Jaarset"; date: string; isLastYear: boolean };

type BusyState = null | "load" | "deleteDraft" | "deletePlan" | "deleteClose" | "rollback" | "backfill";

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

async function deletePlan(snapshotId: string) {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/plans/${encodeURIComponent(snapshotId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Plan verwijderen mislukt (${response.status}).`));
  }
  return payload;
}

async function deleteYearClose(year: number) {
  const response = await fetch(`${API_BASE_URL}/integrations/break-even/year-closes/${encodeURIComponent(String(year))}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.detail || payload?.error || `Jaarafsluiting verwijderen mislukt (${response.status}).`));
  }
  return payload;
}

function formatIso(value: string) {
  if (!value) return "-";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleDateString();
  } catch {
    return value;
  }
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function planMetric(plan: PlanSnapshot | undefined, key: "revenue" | "fixed_costs") {
  const payload = (plan?.payload ?? {}) as Record<string, unknown>;
  const targets = (payload.targets ?? {}) as Record<string, unknown>;
  const model = (payload.model ?? {}) as Record<string, unknown>;
  if (key === "fixed_costs") {
    return num(targets.fixed_cost_total ?? targets.fixed_costs ?? model.fixed_cost_total);
  }
  return num(targets[key] ?? model[key]);
}

function buildRows(params: {
  yearsets: YearsetsResponse | null;
  plans: PlanSnapshot[];
  closes: YearCloseSnapshot[];
}): ManagementRow[] {
  const rows: ManagementRow[] = [];
  const lastYear = Number(params.yearsets?.last_year ?? 0) || 0;

  for (const draft of params.yearsets?.drafts ?? []) {
    rows.push({
      id: `draft:${draft.target_year}:${draft.id || draft.owner}`,
      year: Number(draft.target_year),
      status: "concept",
      kind: "Nieuw jaar voorbereiden",
      date: draft.updated_at || draft.created_at,
      draft,
    });
  }

  for (const plan of params.plans) {
    if (plan.status !== "active" || plan.source !== "first_use_backfill") continue;
    rows.push({
      id: `plan:${plan.id}`,
      year: Number(plan.jaar),
      status: "definitief",
      kind: "First-use backfill",
      date: plan.updated_at || plan.frozen_at || plan.created_at,
      plan,
    });
  }

  for (const close of params.closes) {
    rows.push({
      id: `close:${close.jaar}`,
      year: Number(close.jaar),
      status: "definitief",
      kind: "Jaar afsluiten",
      date: close.closed_at || close.created_at,
      close,
    });
  }

  for (const year of params.yearsets?.production_years ?? []) {
    const parsedYear = Number(year);
    if (!parsedYear) continue;
    rows.push({
      id: `yearset:${parsedYear}`,
      year: parsedYear,
      status: "definitief",
      kind: "Jaarset",
      date: "",
      isLastYear: parsedYear === lastYear,
    });
  }

  return rows.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return kindOrder(a.kind) - kindOrder(b.kind);
  });
}

function kindOrder(kind: ManagementRow["kind"]) {
  if (kind === "Jaarset") return 0;
  if (kind === "Jaar afsluiten") return 1;
  if (kind === "First-use backfill") return 2;
  return 3;
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="editor-button editor-button-secondary editor-button-icon"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function LinkIconButton({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <Link
      href={href as any}
      className="editor-button editor-button-secondary editor-button-icon"
      title={title}
      aria-label={title}
    >
      {children}
    </Link>
  );
}

export function JaarsetsPanel() {
  const [busy, setBusy] = useState<BusyState>("load");
  const [error, setError] = useState("");
  const [yearsets, setYearsets] = useState<YearsetsResponse | null>(null);
  const [plans, setPlans] = useState<PlanSnapshot[]>([]);
  const [closes, setCloses] = useState<YearCloseSnapshot[]>([]);
  const [info, setInfo] = useState("");
  const [editingPlan, setEditingPlan] = useState<PlanSnapshot | null>(null);
  const [backfillYear, setBackfillYear] = useState("2025");
  const [backfillRevenue, setBackfillRevenue] = useState("144000");
  const [backfillFixedCosts, setBackfillFixedCosts] = useState("56000");

  const rows = useMemo(() => buildRows({ yearsets, plans, closes }), [yearsets, plans, closes]);

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

  function runAction(action: BusyState, task: () => Promise<unknown>, successMessage: string) {
    setBusy(action);
    setError("");
    setInfo("");
    void task()
      .then(() => {
        setInfo(successMessage);
        setEditingPlan(null);
        return reload();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
      .finally(() => setBusy(null));
  }

  function startPlanEdit(plan: PlanSnapshot) {
    setEditingPlan(plan);
    setBackfillYear(String(plan.jaar || ""));
    setBackfillRevenue(String(planMetric(plan, "revenue") || ""));
    setBackfillFixedCosts(String(planMetric(plan, "fixed_costs") || ""));
    setInfo("");
    setError("");
  }

  function saveBackfill() {
    const year = Number(backfillYear);
    const planRevenue = Number(backfillRevenue);
    const fixedCosts = Number(backfillFixedCosts);
    if (!year || !planRevenue || !fixedCosts) {
      setError("Vul jaar, plan omzet en plan vaste kosten in.");
      return;
    }
    const ok = window.confirm(`First-use backfill voor ${year} opslaan? Het actieve break-even plan voor dit jaar wordt vervangen.`);
    if (!ok) return;
    runAction("backfill", () => postFirstUseBackfill({ year, planRevenue, fixedCosts }), "First-use backfill opgeslagen.");
  }

  return (
    <div className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Jaarbeheer</div>
        <div className="module-card-text">
          Compact beheer van jaarsets, first-use backfill, jaarafsluiting en nieuw-jaar-concepten.
        </div>
      </div>

      {error ? (
        <div className="placeholder-block" style={{ marginBottom: 16 }}>
          <strong>Fout</strong>
          {error}
        </div>
      ) : null}

      {info ? (
        <div className="placeholder-block" style={{ marginBottom: 16 }}>
          <strong>Resultaat</strong>
          {info}
        </div>
      ) : null}

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Jaar</th>
              <th style={{ width: 140 }}>Status</th>
              <th>Soort</th>
              <th style={{ width: 150 }}>Datum</th>
              <th style={{ width: 170, textAlign: "right" }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.year}</td>
                <td>
                  <span className={`status-pill ${row.status === "definitief" ? "status-ok" : "status-warning"}`}>
                    {row.status}
                  </span>
                </td>
                <td>{row.kind}</td>
                <td>{formatIso(row.date)}</td>
                <td>
                  <div className="editor-actions" style={{ justifyContent: "flex-end", marginTop: 0, gap: 8 }}>
                    {row.kind === "Nieuw jaar voorbereiden" ? (
                      <>
                        <LinkIconButton
                          title="Open concept"
                          href={`/nieuw-jaar-voorbereiden?source_year=${encodeURIComponent(String(row.draft.source_year))}&target_year=${encodeURIComponent(String(row.draft.target_year))}`}
                        >
                          <ExternalLink size={16} aria-hidden="true" />
                        </LinkIconButton>
                        <LinkIconButton
                          title="Bewerk concept"
                          href={`/nieuw-jaar-voorbereiden?source_year=${encodeURIComponent(String(row.draft.source_year))}&target_year=${encodeURIComponent(String(row.draft.target_year))}`}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </LinkIconButton>
                        <IconButton
                          title="Verwijder concept"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(`Concept voor ${row.draft.target_year} verwijderen?`);
                            if (!ok) return;
                            runAction("deleteDraft", () => deleteDraftsForYear(row.draft.target_year), "Concept verwijderd.");
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}

                    {row.kind === "First-use backfill" ? (
                      <>
                        <IconButton title="Bewerk first-use backfill" disabled={busy !== null} onClick={() => startPlanEdit(row.plan)}>
                          <Pencil size={16} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          title="Archiveer first-use backfill"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(`First-use backfill voor ${row.year} archiveren?`);
                            if (!ok) return;
                            runAction("deletePlan", () => deletePlan(row.plan.id), "First-use backfill gearchiveerd.");
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}

                    {row.kind === "Jaar afsluiten" ? (
                      <>
                        <LinkIconButton title="Open jaarafsluiting" href={`/jaar-afsluiten?year=${encodeURIComponent(String(row.year))}`}>
                          <ExternalLink size={16} aria-hidden="true" />
                        </LinkIconButton>
                        <LinkIconButton title="Bewerk jaarafsluiting" href={`/jaar-afsluiten?year=${encodeURIComponent(String(row.year))}`}>
                          <Pencil size={16} aria-hidden="true" />
                        </LinkIconButton>
                        <IconButton
                          title="Verwijder jaarafsluiting"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(`Jaarafsluiting ${row.year} verwijderen?`);
                            if (!ok) return;
                            runAction("deleteClose", () => deleteYearClose(row.year), "Jaarafsluiting verwijderd.");
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}

                    {row.kind === "Jaarset" ? (
                      <>
                        <LinkIconButton title="Open nieuw jaar voorbereiden" href={`/nieuw-jaar-voorbereiden?source_year=${encodeURIComponent(String(row.year))}&target_year=${encodeURIComponent(String(row.year + 1))}`}>
                          <ExternalLink size={16} aria-hidden="true" />
                        </LinkIconButton>
                        <IconButton
                          title="Rollback jaarset"
                          disabled={busy !== null || !row.isLastYear}
                          onClick={() => {
                            const ok = window.confirm(`Jaarset ${row.year} terugdraaien? Kostprijzen en offertes blijven staan.`);
                            if (!ok) return;
                            runAction("rollback", () => postRollbackYearset(row.year), "Jaarset rollback uitgevoerd.");
                          }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Geen jaarbeheerregels gevonden.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editingPlan ? (
        <section className="placeholder-block" style={{ marginTop: 18 }}>
          <strong>First-use backfill bewerken</strong>
          <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
            Pas alleen de eerste planbasis aan. Opslaan archiveert het huidige actieve plan voor dit jaar en maakt een nieuwe actieve snapshot.
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
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setEditingPlan(null)} disabled={busy !== null}>
              Annuleren
            </button>
            <button type="button" className="editor-button" onClick={saveBackfill} disabled={busy !== null}>
              Opslaan
            </button>
          </div>
        </section>
      ) : null}

      {busy ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Bezig...</strong>
          {busy === "load" ? "Overzicht laden." : null}
          {busy === "deleteDraft" ? "Concept verwijderen." : null}
          {busy === "deletePlan" ? "First-use backfill archiveren." : null}
          {busy === "deleteClose" ? "Jaarafsluiting verwijderen." : null}
          {busy === "rollback" ? "Rollback uitvoeren." : null}
          {busy === "backfill" ? "First-use backfill opslaan." : null}
        </div>
      ) : null}
    </div>
  );
}
