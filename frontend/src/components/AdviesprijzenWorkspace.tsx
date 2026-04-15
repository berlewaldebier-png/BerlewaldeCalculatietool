"use client";

import { useMemo, useState } from "react";

const API_BASE_URL = "/api";

type Channel = {
  code: string;
  naam: string;
  actief: boolean;
  volgorde: number;
};

type AdviesprijsRow = {
  id: string;
  jaar: number;
  channel_code: string;
  opslag_pct: number;
};

type ProductieMap = Record<string, any>;

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function AdviesprijzenWorkspace(props: {
  initialChannels: any[];
  initialAdviesprijzen: any[];
  initialProductie: ProductieMap;
}) {
  const channels = useMemo<Channel[]>(() => {
    return (Array.isArray(props.initialChannels) ? props.initialChannels : [])
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        code: String(row.code ?? row.id ?? "").toLowerCase(),
        naam: String(row.naam ?? row.label ?? row.code ?? ""),
        actief: Boolean(row.actief ?? true),
        volgorde: Number(row.volgorde ?? 0)
      }))
      .filter((row) => row.code)
      .sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
  }, [props.initialChannels]);

  const [rows, setRows] = useState<AdviesprijsRow[]>(() => {
    return (Array.isArray(props.initialAdviesprijzen) ? props.initialAdviesprijzen : [])
      .filter((row) => row && typeof row === "object")
      .map((row: any) => ({
        id: String(row.id ?? ""),
        jaar: Number(row.jaar ?? 0),
        channel_code: String(row.channel_code ?? row.code ?? "").toLowerCase(),
        opslag_pct: Number(row.opslag_pct ?? row.opslag ?? 0)
      }))
      .filter((row) => row.jaar > 0 && row.channel_code);
  });

  const productionYears = useMemo(() => {
    const years = Object.keys(props.initialProductie ?? {})
      .filter((key) => /^\d+$/.test(key))
      .map((key) => Number(key))
      .filter((y) => y > 0)
      .sort((a, b) => a - b);
    return years;
  }, [props.initialProductie]);

  const years = useMemo(() => {
    const yearSet = new Set<number>(productionYears);
    rows.forEach((row) => yearSet.add(Number(row.jaar ?? 0)));
    return Array.from(yearSet).filter((y) => y > 0).sort((a, b) => a - b);
  }, [productionYears, rows]);

  const [selectedYear, setSelectedYear] = useState<number>(() => years[years.length - 1] ?? new Date().getFullYear());
  const [status, setStatus] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const activeChannels = useMemo(() => channels.filter((c) => c.actief), [channels]);

  const yearRows = useMemo(() => {
    const byCode = new Map<string, AdviesprijsRow>();
    rows
      .filter((row) => Number(row.jaar ?? 0) === selectedYear)
      .forEach((row) => byCode.set(row.channel_code, row));
    return activeChannels.map((channel) => {
      const existing = byCode.get(channel.code);
      return {
        channel,
        row: existing ?? { id: "", jaar: selectedYear, channel_code: channel.code, opslag_pct: 0 }
      };
    });
  }, [rows, selectedYear, activeChannels]);

  async function save() {
    setIsSaving(true);
    setStatus("");
    try {
      const kept = rows.filter((row) => Number(row.jaar ?? 0) !== selectedYear);
      const next = [
        ...kept,
        ...yearRows.map(({ row }) => ({
          id: row.id,
          jaar: selectedYear,
          channel_code: row.channel_code,
          opslag_pct: clampNumber(row.opslag_pct, 0)
        }))
      ];

      const response = await fetch(`${API_BASE_URL}/data/dataset/adviesprijzen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt.");
      }
      setRows(next);
      setStatus("Opgeslagen.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  if (years.length === 0) {
    return (
      <div className="module-card">
        <div className="module-card-title">Adviesprijzen</div>
        <div className="module-card-text">Nog geen productiejaar gevonden. Maak eerst een productiejaar aan.</div>
      </div>
    );
  }

  return (
    <section>
      {status ? (
        <div className="editor-status" style={{ marginBottom: 14 }}>
          {status}
        </div>
      ) : null}

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="module-card-title">Adviesopslag per kanaal</div>
            <div className="module-card-text">Deze opslag gebruiken we om adviesprijzen (sell-out) af te leiden.</div>
          </div>
          <label className="nested-field" style={{ minWidth: 160 }}>
            <span>Jaar</span>
            <select
              className="dataset-input"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              disabled={isSaving}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Kanaal</th>
              <th style={{ width: "220px" }}>Opslag (%)</th>
            </tr>
          </thead>
          <tbody>
            {yearRows.map(({ channel, row }) => (
              <tr key={channel.code}>
                <td>
                  <strong>{channel.naam}</strong>
                  <div className="muted">{channel.code}</div>
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    value={String(row.opslag_pct ?? 0)}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      setRows((current) => {
                        const other = current.filter(
                          (item) => !(Number(item.jaar ?? 0) === selectedYear && item.channel_code === channel.code)
                        );
                        return [
                          ...other,
                          {
                            id: row.id,
                            jaar: selectedYear,
                            channel_code: channel.code,
                            opslag_pct: Number.isFinite(nextValue) ? nextValue : 0
                          }
                        ];
                      });
                    }}
                    disabled={isSaving}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group" />
        <div className="editor-actions-group">
          <button type="button" className="editor-button" onClick={() => void save()} disabled={isSaving}>
            Opslaan
          </button>
        </div>
      </div>
    </section>
  );
}

