"use client";

import { useEffect, useMemo, useState } from "react";

import { formatMoneyEUR } from "@/lib/formatters";

type Row = {
  company_id: number;
  company_name: string;
  omzet_ex: number;
  korting_ex: number;
  charges_ex: number;
  netto_omzet_ex: number;
  kostprijs_ex: number;
  brutomarge_ex: number;
  lines: number;
  unmapped_lines: number;
  ignored_lines?: number;
  missing_cost_lines: number;
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function euro(value: number) {
  if (!Number.isFinite(value)) return "-";
  return formatMoneyEUR(value);
}

export function OmzetgegevensWorkspace({ availableYears = [] }: { availableYears?: number[] }) {
  const [since, setSince] = useState<string>("");
  const [year, setYear] = useState<number>(0);
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const params = new URLSearchParams();
      if (since.trim()) params.set("since", since.trim());
      if (year > 0) params.set("year", String(year));
      const qs = params.toString() ? `?${params.toString()}` : "";
      const payload = await readJson(`/api/integrations/douano/margin-summary${qs}`);
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setRows([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.omzet += Number(row.omzet_ex ?? 0) || 0;
        acc.netto += Number(row.netto_omzet_ex ?? 0) || 0;
        acc.kostprijs += Number(row.kostprijs_ex ?? 0) || 0;
        acc.marge += Number(row.brutomarge_ex ?? 0) || 0;
        acc.unmapped += Number(row.unmapped_lines ?? 0) || 0;
        acc.missing_cost += Number(row.missing_cost_lines ?? 0) || 0;
        return acc;
      },
      { omzet: 0, netto: 0, kostprijs: 0, marge: 0, unmapped: 0, missing_cost: 0 }
    );
  }, [rows]);

  return (
    <section>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <select
            className="editor-input"
            style={{ width: 180 }}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value || 0) || 0)}
            aria-label="Jaarfilter"
          >
            <option value="0">Alle jaren</option>
            {availableYears.slice().reverse().map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
          <input
            className="editor-input"
            style={{ width: 180 }}
            placeholder="Sinds (YYYY-MM-DD)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Ververs
          </button>
        </div>
        <div className="editor-actions-group">
          <span className="pill">Omzet {euro(totals.omzet)}</span>
          <span className="pill">Netto {euro(totals.netto)}</span>
          <span className="pill">Kostprijs {euro(totals.kostprijs)}</span>
          <span className="pill">Marge {euro(totals.marge)}</span>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Klant</th>
              <th style={{ width: 150 }}>Omzet</th>
              <th style={{ width: 150 }}>Kortingen</th>
              <th style={{ width: 150 }}>Charges</th>
              <th style={{ width: 160 }}>Netto omzet</th>
              <th style={{ width: 150 }}>Kostprijs</th>
              <th style={{ width: 150 }}>Brutomarge</th>
              <th style={{ width: 100 }}>Regels</th>
              <th style={{ width: 120 }}>Unmapped</th>
              <th style={{ width: 110 }}>Ignored</th>
              <th style={{ width: 130 }}>Missing cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.company_id}>
                <td>
                  <a
                    href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}`}
                    style={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}
                    title="Open details"
                  >
                    {row.company_name || String(row.company_id)}
                  </a>
                </td>
                <td>{euro(row.omzet_ex)}</td>
                <td>{euro(row.korting_ex)}</td>
                <td>{euro(row.charges_ex)}</td>
                <td>{euro(row.netto_omzet_ex)}</td>
                <td>{euro(row.kostprijs_ex)}</td>
                <td>{euro(row.brutomarge_ex)}</td>
                <td>{row.lines}</td>
                <td>
                  {row.unmapped_lines > 0 ? (
                    <a
                      href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}?only_unmapped=true`}
                      className="pill"
                      style={{ textDecoration: "none" }}
                      title="Bekijk unmapped regels"
                    >
                      {row.unmapped_lines}
                    </a>
                  ) : (
                    row.unmapped_lines
                  )}
                </td>
                <td>{Number(row.ignored_lines ?? 0) || 0}</td>
                <td>
                  {row.missing_cost_lines > 0 ? (
                    <a
                      href={`/omzet-en-marge/${encodeURIComponent(String(row.company_id))}?only_missing_cost=true`}
                      className="pill"
                      style={{ textDecoration: "none" }}
                      title="Bekijk regels zonder kostprijs"
                    >
                      {row.missing_cost_lines}
                    </a>
                  ) : (
                    row.missing_cost_lines
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ opacity: 0.75 }}>
                  Geen data. Draai eerst `Sync sales-orders` en maak productkoppelingen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
