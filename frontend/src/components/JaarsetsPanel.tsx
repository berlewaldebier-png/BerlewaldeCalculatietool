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

async function getYearsets(): Promise<YearsetsResponse> {
  const response = await fetch(`${API_BASE_URL}/meta/yearsets`, {
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Ophalen mislukt (${response.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as YearsetsResponse;
}

async function deleteDraftsForYear(targetYear: number) {
  const response = await fetch(
    `${API_BASE_URL}/meta/new-year-drafts-for-year?target_year=${encodeURIComponent(String(targetYear))}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Verwijderen mislukt (${response.status}).`);
  }
  return text ? JSON.parse(text) : {};
}

async function postRollbackYearset(year: number) {
  const response = await fetch(
    `${API_BASE_URL}/meta/rollback-yearset?year=${encodeURIComponent(String(year))}`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Rollback mislukt (${response.status}).`);
  }
  return text ? JSON.parse(text) : {};
}

function formatIso(value: string) {
  if (!value) return "";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  } catch {
    return value;
  }
}

export function JaarsetsPanel() {
  const [busy, setBusy] = useState<null | "load" | "deleteDraft" | "rollback">(null);
  const [error, setError] = useState("");
  const [data, setData] = useState<YearsetsResponse | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);

  const drafts = useMemo(() => (Array.isArray(data?.drafts) ? data!.drafts : []), [data]);
  const productionYears = useMemo(
    () => (Array.isArray(data?.production_years) ? data!.production_years : []),
    [data]
  );
  const lastYear = Number(data?.last_year ?? 0) || 0;

  useEffect(() => {
    setBusy("load");
    setError("");
    void getYearsets()
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Ophalen mislukt."))
      .finally(() => setBusy(null));
  }, []);

  const canRollback = lastYear > 0;

  return (
    <div className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Overzicht</div>
        <div className="module-card-text">
          Concepten zijn concepten in <code>new-year-drafts</code>. Definitieve jaren zijn de productie-jaren die zichtbaar
          zijn in de applicatie.
        </div>
      </div>

      {error ? (
        <div className="placeholder-block" style={{ marginBottom: 16 }}>
          <strong>Fout</strong>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 18 }}>
        <section className="placeholder-block">
          <strong>Concepten</strong>
          <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
            Je kunt een concept altijd verwijderen. Rollback geldt alleen voor definitieve jaren.
          </div>
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Doeljaar</th>
                  <th style={{ width: 110 }}>Bronjaar</th>
                  <th style={{ width: 180 }}>Owner</th>
                  <th style={{ width: 220 }}>Bijgewerkt</th>
                  <th style={{ width: 180 }}>Actieve stap</th>
                  <th style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {drafts.map((row) => {
                  const payload = (row.payload ?? {}) as any;
                  const activeStep = Number(payload?.active_step ?? 0);
                  return (
                    <tr key={row.id || `${row.owner}-${row.target_year}`}>
                      <td>{row.target_year}</td>
                      <td>{row.source_year}</td>
                      <td>{row.owner}</td>
                      <td>{formatIso(row.updated_at)}</td>
                      <td>{Number.isFinite(activeStep) ? activeStep + 1 : "-"}</td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          href={`/nieuw-jaar-voorbereiden?target_year=${encodeURIComponent(String(row.target_year))}`}
                          className="editor-button editor-button-secondary"
                          style={{ marginRight: 10, display: "inline-block", textDecoration: "none" }}
                        >
                          Open concept
                        </Link>
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          disabled={busy !== null}
                          onClick={() => {
                            const ok = window.confirm(
                              `Weet je zeker dat je alle concepten voor ${row.target_year} wilt verwijderen?`
                            );
                            if (!ok) return;
                            setBusy("deleteDraft");
                            setError("");
                            setInfo(null);
                            void deleteDraftsForYear(row.target_year)
                              .then((res) => {
                                setInfo(res as any);
                                return getYearsets();
                              })
                              .then((res) => setData(res))
                              .catch((err) => setError(err instanceof Error ? err.message : "Actie mislukt."))
                              .finally(() => setBusy(null));
                          }}
                        >
                          Verwijder concept
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {drafts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Geen concepten gevonden.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="placeholder-block">
          <strong>Definitieve jaren</strong>
          <div className="muted" style={{ marginTop: 8, marginBottom: 12 }}>
            Alleen het hoogste jaar kan worden teruggedraaid. Huidige laatste jaar:{" "}
            <strong>{lastYear || "-"}</strong>
          </div>
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Jaar</th>
                  <th style={{ width: 220 }}>Status</th>
                  <th style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {productionYears.map((year) => {
                  const isLast = year === lastYear;
                  return (
                    <tr key={year}>
                      <td>{year}</td>
                      <td>{isLast ? "Laatste (rollback mogelijk)" : "Definitief"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="editor-button"
                          disabled={!isLast || busy !== null || !canRollback}
                          onClick={() => {
                            const ok = window.confirm(
                              `Rollback verwijdert de jaarset-data voor ${year}. Kostprijzen en offertes blijven staan. Doorgaan?`
                            );
                            if (!ok) return;
                            setBusy("rollback");
                            setError("");
                            setInfo(null);
                            void postRollbackYearset(year)
                              .then((res) => {
                                setInfo(res as any);
                                return getYearsets();
                              })
                              .then((res) => setData(res))
                              .catch((err) => setError(err instanceof Error ? err.message : "Rollback mislukt."))
                              .finally(() => setBusy(null));
                          }}
                        >
                          Rollback
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {productionYears.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      Geen productie-jaren gevonden.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {busy ? (
        <div className="placeholder-block" style={{ marginTop: 16 }}>
          <strong>Bezig…</strong>
          {busy === "load" ? "Overzicht laden." : null}
          {busy === "deleteDraft" ? "Concept verwijderen." : null}
          {busy === "rollback" ? "Rollback uitvoeren." : null}
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
