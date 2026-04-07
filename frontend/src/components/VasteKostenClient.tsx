"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type EditorValue = string | number | boolean | null;
type EditorRow = Record<string, EditorValue>;

function formatEur(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

function clampPct(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

function computeHerverdeling(rows: Array<Record<string, unknown>>) {
  const directRows = rows.filter((row) => {
    const normalized = String(row.kostensoort ?? "").trim().toLowerCase();
    return normalized.includes("direct") && !normalized.includes("indirect");
  });
  const indirectRows = rows.filter((row) => String(row.kostensoort ?? "").trim().toLowerCase().includes("indirect"));

  const directBase = directRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
  const indirectBase = indirectRows.reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);

  const directOut = directRows.reduce((sum, row) => {
    const amount = Number(row.bedrag_per_jaar ?? 0);
    const pct = clampPct(row.herverdeel_pct);
    return sum + (amount * pct) / 100;
  }, 0);

  const indirectOut = indirectRows.reduce((sum, row) => {
    const amount = Number(row.bedrag_per_jaar ?? 0);
    const pct = clampPct(row.herverdeel_pct);
    return sum + (amount * pct) / 100;
  }, 0);

  return {
    directBase,
    indirectBase,
    directOut,
    indirectOut,
    directAfter: directBase - directOut + indirectOut,
    indirectAfter: indirectBase - indirectOut + directOut,
    redistributedTotal: directOut + indirectOut
  };
}

function deriveYearOptions(productie: Record<string, unknown>) {
  const years = Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
  return years;
}

function chooseDefaultYear(yearOptions: number[]) {
  const currentYear = new Date().getFullYear();
  if (yearOptions.includes(currentYear)) return currentYear;
  return yearOptions[yearOptions.length - 1] ?? 0;
}

type VasteKostenClientProps = {
  vasteKosten: Record<string, unknown>;
  productie: Record<string, unknown>;
  initialSelectedYear?: number;
  lockYear?: boolean;
  titleSuffix?: string;
};

export function VasteKostenClient({
  vasteKosten,
  productie,
  initialSelectedYear,
  lockYear,
  titleSuffix
}: VasteKostenClientProps) {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const yearOptions = useMemo(() => deriveYearOptions(productie), [productie]);
  const defaultYear = useMemo(() => chooseDefaultYear(yearOptions), [yearOptions]);

  function createUiId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  type InternalRow = {
    _uiId: string;
    id: string;
    omschrijving: string;
    kostensoort: string;
    bedrag_per_jaar: number;
    herverdeel_pct: number;
  };

  const normalizedByYear = useMemo(() => {
    const result: Record<string, InternalRow[]> = {};
    for (const [yearKey, rawItems] of Object.entries(vasteKosten ?? {})) {
      if (!Array.isArray(rawItems)) continue;
      result[String(yearKey)] = (rawItems as Array<Record<string, unknown>>).map((item, index) => {
        const rawId = String(item.id ?? "").trim();
        return {
          _uiId: rawId ? `${rawId}-${index}` : createUiId(),
          id: rawId,
          omschrijving: String(item.omschrijving ?? ""),
          kostensoort: String(item.kostensoort ?? ""),
          bedrag_per_jaar: Number(item.bedrag_per_jaar ?? 0),
          herverdeel_pct: clampPct(item.herverdeel_pct ?? 0)
        };
      });
    }
    return result;
  }, [vasteKosten]);

  const resolvedInitialYear =
    typeof initialSelectedYear === "number" && Number.isFinite(initialSelectedYear)
      ? initialSelectedYear
      : defaultYear;
  const [selectedYear, setSelectedYear] = useState<number>(resolvedInitialYear);
  const [rowsByYear, setRowsByYear] = useState<Record<string, InternalRow[]>>(normalizedByYear);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const totalsByYear = useMemo(() => {
    const years =
      yearOptions.length > 0
        ? [...yearOptions].sort((a, b) => b - a)
        : Object.keys(rowsByYear)
            .map((key) => Number(key))
            .filter((year) => Number.isFinite(year) && year > 0)
            .sort((a, b) => b - a);

    return years.map((year) => {
      const totals = computeHerverdeling(rowsByYear[String(year)] ?? []);
      return { year, ...totals };
    });
  }, [rowsByYear, yearOptions]);

  const effectiveSelectedYear = lockYear ? resolvedInitialYear : selectedYear;

  const canEdit = yearOptions.length > 0;

  const selectedYearKey = String(effectiveSelectedYear || "");
  const selectedRows = rowsByYear[selectedYearKey] ?? [];

  function handleSelectYear(year: number) {
    setSelectedYear(year);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function updateRow(rowId: string, key: keyof Omit<InternalRow, "_uiId">, value: unknown) {
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = (next[selectedYearKey] ?? []).map((row) => {
        if (row._uiId !== rowId) return row;
        if (key === "bedrag_per_jaar") {
          return { ...row, bedrag_per_jaar: Number(value ?? 0) };
        }
        if (key === "herverdeel_pct") {
          return { ...row, herverdeel_pct: clampPct(value) };
        }
        if (key === "kostensoort") {
          return { ...row, kostensoort: String(value ?? "") };
        }
        return { ...row, omschrijving: String(value ?? "") };
      });
      return next;
    });
  }

  function addRow() {
    if (!effectiveSelectedYear || !Number.isFinite(effectiveSelectedYear)) return;
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = [
        ...(next[selectedYearKey] ?? []),
        {
          _uiId: createUiId(),
          id: "",
          omschrijving: "",
          kostensoort: "",
          bedrag_per_jaar: 0,
          herverdeel_pct: 0
        }
      ];
      return next;
    });
  }

  function deleteRow(rowId: string) {
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = (next[selectedYearKey] ?? []).filter((row) => row._uiId !== rowId);
      return next;
    });
  }

  function copyFromPreviousYear() {
    if (!effectiveSelectedYear || !Number.isFinite(effectiveSelectedYear)) return;
    const sourceKey = String(effectiveSelectedYear - 1);
    const source = rowsByYear[sourceKey] ?? [];
    if (source.length === 0) return;
    setRowsByYear((current) => {
      const next = { ...current };
      next[selectedYearKey] = source.map((row) => ({
        _uiId: createUiId(),
        id: "", // Let backend generate stable UUIDs.
        omschrijving: row.omschrijving,
        kostensoort: row.kostensoort,
        bedrag_per_jaar: row.bedrag_per_jaar,
        herverdeel_pct: row.herverdeel_pct
      }));
      return next;
    });
  }

  function buildPayload() {
    const payload: Record<string, Array<Record<string, unknown>>> = {};
    for (const [yearKey, rows] of Object.entries(rowsByYear)) {
      // Only persist years that are part of productie (FK constraint).
      const parsedYear = Number(yearKey);
      if (!Number.isFinite(parsedYear) || parsedYear <= 0) continue;
      if (yearOptions.length > 0 && !yearOptions.includes(parsedYear)) continue;

      payload[yearKey] = rows.map(({ _uiId, ...rest }) => rest);
    }
    // Ensure the selected year key exists even if empty (keeps intent clear; backend ignores empty).
    if (selectedYearKey && !payload[selectedYearKey]) {
      payload[selectedYearKey] = [];
    }
    return payload;
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/data/vaste-kosten`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt");
      }
      setStatus("Opgeslagen.");
      router.refresh();
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  function TrashIcon() {
    return (
      <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
      </svg>
    );
  }

  return (
    <>
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Totalen per jaar</div>
          <div className="module-card-text">
            Totalen rekenen met herverdeling: het percentage verplaatst kosten naar de andere primaire kostensoort.
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Jaar</th>
                <th>Directe kosten</th>
                <th>Indirecte kosten</th>
                <th>Totale kosten</th>
              </tr>
            </thead>
            <tbody>
              {totalsByYear.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={4}>
                    Nog geen vaste kostenregels. Voeg hieronder regels toe.
                  </td>
                </tr>
              ) : null}
              {totalsByYear.map((row) => (
                <tr
                  key={row.year}
                  style={{ cursor: lockYear ? "default" : "pointer" }}
                  onClick={() => {
                    if (lockYear) return;
                    handleSelectYear(row.year);
                  }}
                >
                  <td>
                    <strong>{row.year}</strong>
                  </td>
                  <td>
                    {formatEur(row.directAfter)}{" "}
                    <span className="muted">(herverdeeld uit direct: {formatEur(row.directOut)})</span>
                  </td>
                  <td>
                    {formatEur(row.indirectAfter)}{" "}
                    <span className="muted">(herverdeeld uit indirect: {formatEur(row.indirectOut)})</span>
                  </td>
                  <td>
                    {formatEur(row.directAfter + row.indirectAfter)}{" "}
                    <span className="muted">(totaal herverdeeld: {formatEur(row.redistributedTotal)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit ? (
        <section className="module-card" ref={editorRef}>
          <div className="module-card-header">
            <div className="module-card-title">
              Vaste kosten {titleSuffix ?? String(effectiveSelectedYear || "")}
            </div>
            <div className="module-card-text">Bewerk de vaste kostenregels voor het geselecteerde jaar.</div>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{selectedRows.length} regels</span>
              <span className="muted">Jaar is afgeleid van de selectie en is read-only.</span>
            </div>
          </div>

          {effectiveSelectedYear && selectedRows.length === 0 ? (
            <div className="editor-toolbar" style={{ paddingTop: 0 }}>
              <div className="editor-toolbar-meta">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={copyFromPreviousYear}
                  disabled={
                    effectiveSelectedYear <= 0 ||
                    (rowsByYear[String(effectiveSelectedYear - 1)] ?? []).length === 0
                  }
                >
                  Kosten overnemen uit jaar {effectiveSelectedYear - 1}
                </button>
              </div>
            </div>
          ) : null}

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th style={{ width: "280px" }}>Omschrijving</th>
                  <th style={{ width: "220px" }}>Kostensoort</th>
                  <th style={{ width: "180px" }}>Bedrag per jaar</th>
                  <th style={{ width: "150px" }}>Herverdelen %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {effectiveSelectedYear && selectedRows.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={5}>
                      Nog geen regels voor {effectiveSelectedYear}. Voeg een rij toe of neem gegevens over.
                    </td>
                  </tr>
                ) : null}
                {selectedRows.map((row) => (
                  <tr key={row._uiId}>
                    <td>
                      <input
                        className="dataset-input"
                        type="text"
                        value={row.omschrijving}
                        onChange={(event) => updateRow(row._uiId, "omschrijving", event.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={row.kostensoort}
                        onChange={(event) => updateRow(row._uiId, "kostensoort", event.target.value)}
                      >
                        <option value="">Kies...</option>
                        <option value="Indirecte kosten">Indirecte kosten</option>
                        <option value="Directe kosten">Directe kosten</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={Number.isFinite(row.bedrag_per_jaar) ? String(row.bedrag_per_jaar) : "0"}
                        onChange={(event) => updateRow(row._uiId, "bedrag_per_jaar", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={Number.isFinite(row.herverdeel_pct) ? String(row.herverdeel_pct) : "0"}
                        onChange={(event) => updateRow(row._uiId, "herverdeel_pct", event.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button-table"
                        aria-label="Verwijderen"
                        title="Verwijderen"
                        onClick={() => deleteRow(row._uiId)}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="editor-actions">
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
                Rij toevoegen
              </button>
            </div>
            <div className="editor-actions-group">
              {status ? <span className="editor-status">{status}</span> : null}
              <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Vaste kosten</div>
            <div className="module-card-text">
              Voeg eerst een productiejaar toe in het scherm <strong>Productie</strong>. Daarna kun je vaste kosten per jaar beheren.
            </div>
          </div>
        </section>
      )}
    </>
  );
}
