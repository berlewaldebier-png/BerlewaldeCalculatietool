"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { reconcileDatasetItems } from "@/lib/datasetItems";

type IncidentalCostRow = {
  id: string;
  jaar: number;
  datum: string;
  omschrijving: string;
  bedrag: number;
  toelichting: string;
  ignore: boolean;
};

type Props = {
  rows: IncidentalCostRow[];
  vasteKosten: Record<string, Array<Record<string, unknown>>>;
  productie: Record<string, unknown>;
};

function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number.isFinite(value) ? value : 0);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function makeId() {
  return `incident-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toRow(value: unknown): IncidentalCostRow {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    id: String(row.id ?? ""),
    jaar: Number(row.jaar ?? row.year ?? 0) || 0,
    datum: String(row.datum ?? row.date ?? ""),
    omschrijving: String(row.omschrijving ?? row.description ?? ""),
    bedrag: Number(row.bedrag ?? row.amount ?? 0) || 0,
    toelichting: String(row.toelichting ?? row.explanation ?? ""),
    ignore: Boolean(row.ignore ?? row.negeren ?? false),
  };
}

function deriveYearOptions(productie: Record<string, unknown>) {
  return Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
}

function chooseDefaultYear(yearOptions: number[]) {
  const currentYear = new Date().getFullYear();
  if (yearOptions.includes(currentYear)) return currentYear;
  return yearOptions[yearOptions.length - 1] ?? 0;
}

function createEmptyRow(year: number): IncidentalCostRow {
  return {
    id: makeId(),
    jaar: year,
    datum: today(),
    omschrijving: "",
    bedrag: 0,
    toelichting: "",
    ignore: false,
  };
}

export function IncidenteleKostenClient({ rows, vasteKosten, productie }: Props) {
  const router = useRouter();
  const editorRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<IncidentalCostRow[]>(() => rows.map(toRow).filter((row) => row.id));
  const yearOptions = useMemo(() => deriveYearOptions(productie), [productie]);
  const [selectedYear, setSelectedYear] = useState<number>(() => chooseDefaultYear(yearOptions));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = yearOptions.length > 0;
  const effectiveYear = yearOptions.includes(selectedYear) ? selectedYear : chooseDefaultYear(yearOptions);
  const selectedRows = useMemo(
    () => items.filter((row) => row.jaar === effectiveYear).sort((a, b) => String(a.datum).localeCompare(String(b.datum))),
    [effectiveYear, items]
  );

  const orphanRows = useMemo(() => {
    if (yearOptions.length === 0) return items;
    return items.filter((row) => !yearOptions.includes(row.jaar));
  }, [items, yearOptions]);

  const totalsByYear = useMemo(() => {
    return yearOptions
      .slice()
      .sort((a, b) => b - a)
      .map((year) => {
        const abc = (vasteKosten[String(year)] ?? []).reduce((sum, row) => sum + Number(row.bedrag_per_jaar ?? 0), 0);
        const incidental = items
          .filter((row) => row.jaar === year && !row.ignore)
          .reduce((sum, row) => sum + Number(row.bedrag || 0), 0);
        const ignored = items
          .filter((row) => row.jaar === year && row.ignore)
          .reduce((sum, row) => sum + Number(row.bedrag || 0), 0);
        return {
          year,
          abc,
          incidental,
          ignored,
          total: abc + incidental,
          rows: items.filter((row) => row.jaar === year).length,
        };
      });
  }, [items, vasteKosten, yearOptions]);

  async function persist(next: IncidentalCostRow[], message: string) {
    setIsSaving(true);
    try {
      await reconcileDatasetItems("incidentele-kosten", next);
      setItems(next);
      setStatus(message);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  function handleSelectYear(year: number) {
    setSelectedYear(year);
    setStatus("");
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function addRow() {
    if (!canEdit || !effectiveYear) return;
    setItems((current) => [...current, createEmptyRow(effectiveYear)]);
    setStatus("Nieuwe regel toegevoegd. Vul omschrijving, bedrag en toelichting in en sla daarna op.");
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function updateRow(rowId: string, key: keyof IncidentalCostRow, value: string | number | boolean) {
    setItems((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        if (key === "jaar") return row;
        if (key === "bedrag") return { ...row, bedrag: Number(value) || 0 };
        if (key === "ignore") return { ...row, ignore: Boolean(value) };
        return { ...row, [key]: value };
      })
    );
  }

  function deleteRow(rowId: string) {
    setItems((current) => current.filter((row) => row.id !== rowId));
    setStatus("Regel verwijderd. Sla op om de wijziging definitief te maken.");
  }

  async function handleSave() {
    if (!canEdit) return;
    const validYears = new Set(yearOptions);
    for (const row of items) {
      if (!validYears.has(row.jaar)) continue;
      if (!String(row.omschrijving || "").trim()) {
        setStatus("Omschrijving is verplicht.");
        return;
      }
      if (!String(row.toelichting || "").trim()) {
        setStatus("Toelichting is verplicht, zodat later duidelijk is waarom deze kost incidenteel is.");
        return;
      }
    }

    const next = items.map((row) => ({
      ...row,
      jaar: Number(row.jaar) || effectiveYear,
      bedrag: Number(row.bedrag) || 0,
      omschrijving: String(row.omschrijving || "").trim(),
      toelichting: String(row.toelichting || "").trim(),
      datum: String(row.datum || today()).trim(),
      ignore: Boolean(row.ignore),
    }));
    await persist(next, `Incidentele kosten voor ${effectiveYear} opgeslagen.`);
  }

  return (
    <>
      <section className="module-card">
        <div className="module-card-header">
          <div>
            <div className="module-card-title">Totalen per jaar</div>
            <div className="module-card-text">
              Incidentele kosten zijn een aparte laag bovenop ABC. Ze raken Break-even next en jaarresultaat, maar niet de normale SKU-kostprijs.
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Jaar</th>
                <th>ABC overhead</th>
                <th>Incidenteel actief</th>
                <th>Genegeerd</th>
                <th>Totale kosten</th>
                <th style={{ width: "110px" }}>Regels</th>
              </tr>
            </thead>
            <tbody>
              {totalsByYear.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={6}>
                    Voeg eerst een productiejaar toe in Productie en drivers. Daarna kun je incidentele kosten per jaar beheren.
                  </td>
                </tr>
              ) : null}
              {totalsByYear.map((row) => (
                <tr key={row.year} style={{ cursor: "pointer" }} onClick={() => handleSelectYear(row.year)}>
                  <td>
                    <strong>{row.year}</strong>
                    {row.year === effectiveYear ? <span className="editor-pill" style={{ marginLeft: 8 }}>geselecteerd</span> : null}
                  </td>
                  <td>{euro(row.abc)}</td>
                  <td>{euro(row.incidental)}</td>
                  <td>{euro(row.ignored)}</td>
                  <td>{euro(row.total)}</td>
                  <td>{row.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {orphanRows.length ? (
          <div className="editor-status" style={{ marginTop: "0.8rem" }}>
            {orphanRows.length} bestaande incidentele regel(s) vallen buiten Productie en drivers. Ze blijven bewaard, maar zijn niet bewerkbaar totdat het productiejaar bestaat.
          </div>
        ) : null}
      </section>

      {canEdit ? (
        <section className="module-card" ref={editorRef}>
          <div className="module-card-header">
            <div>
              <div className="module-card-title">Incidentele kosten {effectiveYear}</div>
              <div className="module-card-text">Bewerk eenmalige afboekingen en uitzonderingen voor het geselecteerde productiejaar.</div>
            </div>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                Jaar
                <select
                  className="dataset-input"
                  value={effectiveYear || ""}
                  onChange={(event) => handleSelectYear(Number(event.target.value))}
                  style={{ width: 120 }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              <span className="editor-pill">{selectedRows.length} regels</span>
              <span className="muted">Jaar is afgeleid van Productie en drivers.</span>
            </div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th style={{ width: "150px" }}>Datum</th>
                  <th style={{ width: "280px" }}>Omschrijving</th>
                  <th style={{ width: "180px" }}>Bedrag</th>
                  <th>Toelichting</th>
                  <th style={{ width: "120px" }}>Negeer</th>
                  <th style={{ width: "70px" }} />
                </tr>
              </thead>
              <tbody>
                {selectedRows.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={6}>
                      Nog geen incidentele kosten voor {effectiveYear}. Voeg alleen kosten toe die niet in de normale SKU-kostprijs of ABC-laag horen.
                    </td>
                  </tr>
                ) : null}
                {selectedRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="dataset-input"
                        type="date"
                        value={row.datum}
                        onChange={(event) => updateRow(row.id, "datum", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        value={row.omschrijving}
                        onChange={(event) => updateRow(row.id, "omschrijving", event.target.value)}
                        placeholder="Bijv. afboeking barrel-aged Weizen"
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={Number.isFinite(row.bedrag) ? String(row.bedrag) : "0"}
                        onChange={(event) => updateRow(row.id, "bedrag", event.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        className="dataset-input"
                        value={row.toelichting}
                        onChange={(event) => updateRow(row.id, "toelichting", event.target.value)}
                        placeholder="Waarom is dit incidenteel?"
                        rows={2}
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.ignore}
                        onChange={(event) => updateRow(row.id, "ignore", event.target.checked)}
                        title="Bewaar de regel, maar tel hem niet mee in Break-even next."
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button-table"
                        aria-label="Verwijderen"
                        title="Verwijderen"
                        onClick={() => deleteRow(row.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
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
              <button type="button" className="editor-button" onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="module-card">
          <div className="module-card-header">
            <div>
              <div className="module-card-title">Incidentele kosten</div>
              <div className="module-card-text">
                Voeg eerst een productiejaar toe in het scherm <strong>Productie en drivers</strong>. Daarna kun je incidentele kosten per jaar beheren.
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
