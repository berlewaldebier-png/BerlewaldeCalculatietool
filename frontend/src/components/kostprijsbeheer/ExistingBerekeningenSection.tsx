"use client";

import type { RefObject } from "react";

export type ExistingBerekeningRow = {
  id: string;
  bierNaam: string;
  jaar: number;
  status: string;
  type: string;
  kostprijsPerLiter: number;
  ts: string;
};

type ExistingFilterMode = "all" | "concept" | "definitief";
type WorkspaceMode = "landing" | "wizard-new" | "wizard-edit";

export function ExistingBerekeningenSection({
  existingRef,
  existingSearch,
  setExistingSearch,
  existingFilterMode,
  setExistingFilterMode,
  existingBerekeningenRows,
  selectedYear,
  formatEuro,
  setSelectedId,
  setMode,
}: {
  existingRef: RefObject<HTMLDivElement | null>;
  existingSearch: string;
  setExistingSearch: (next: string) => void;
  existingFilterMode: ExistingFilterMode;
  setExistingFilterMode: (next: ExistingFilterMode) => void;
  existingBerekeningenRows: ExistingBerekeningRow[];
  selectedYear: number;
  formatEuro: (value: number) => string;
  setSelectedId: (next: string) => void;
  setMode: (next: WorkspaceMode) => void;
}) {
  return (
    <>
      <div style={{ marginTop: 18 }} ref={existingRef} />

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Bestaande kostprijsberekeningen</div>
          <div className="module-card-text">Open een concept of definitieve berekening om deze te bewerken.</div>
        </div>

        <div className="wizard-form-grid" style={{ alignItems: "end" }}>
          <label className="nested-field">
            <span>Zoeken</span>
            <input
              className="dataset-input"
              value={existingSearch}
              onChange={(event) => setExistingSearch(event.target.value)}
              placeholder="Zoek bier, status of type..."
            />
          </label>

          <div className="kostprijs-filter-tabs" style={{ justifyContent: "flex-start" }}>
            {[
              ["concept", "Concept"],
              ["definitief", "Definitief"],
              ["all", "Alles"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tab-button${existingFilterMode === value ? " active" : ""}`}
                onClick={() => setExistingFilterMode(value as ExistingFilterMode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Jaar</th>
                <th>Status</th>
                <th>Type</th>
                <th>Kostprijs</th>
                <th>Laatst gewijzigd</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {existingBerekeningenRows.length > 0 ? (
                existingBerekeningenRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.bierNaam}</td>
                    <td>{row.jaar || "-"}</td>
                    <td>{row.status || "-"}</td>
                    <td>{row.type || "-"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatEuro(row.kostprijsPerLiter)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{row.ts || "-"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() => {
                          setSelectedId(row.id);
                          setMode("wizard-edit");
                        }}
                      >
                        Openen
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="dataset-empty" colSpan={7}>
                    Geen berekeningen gevonden voor {selectedYear}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
