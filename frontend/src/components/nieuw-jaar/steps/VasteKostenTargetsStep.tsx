"use client";

import type { ReactNode } from "react";

type HerverdelingTotals = {
  directAfter: number;
  directOut: number;
  indirectAfter: number;
  indirectOut: number;
  redistributedTotal: number;
};

type SourceVasteKostenRow = {
  key: string;
  omschrijving: string;
  kostensoort: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
};

type VasteKostenUiRow = {
  uiId: string;
  omschrijving: string;
  kostensoort: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
  isNew: boolean;
};

type VasteKostenTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;

  sourceVasteKostenRows: SourceVasteKostenRow[];
  draftVasteKostenTarget: VasteKostenUiRow[];

  vasteKostenKey: (row: VasteKostenUiRow) => string;
  updateVasteKostenRow: (uiId: string, patch: Partial<VasteKostenUiRow>) => void;
  addVasteKostenRow: () => void;

  fixedCostRowsForYear: (year: number) => Array<Record<string, unknown>>;
  computeHerverdelingTotals: (rows: Array<Record<string, unknown>>) => HerverdelingTotals;
  formatEur: (value: number) => string;

  saveDraftToServer: (message?: string) => Promise<unknown> | unknown;
};

export function VasteKostenTargetsStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  sourceVasteKostenRows,
  draftVasteKostenTarget,
  vasteKostenKey,
  updateVasteKostenRow,
  addVasteKostenRow,
  fixedCostRowsForYear,
  computeHerverdelingTotals,
  formatEur,
  saveDraftToServer,
}: VasteKostenTargetsStepProps) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Links zie je de vaste kosten van bronjaar {sourceYear} (read-only). Rechts vul je de vaste kosten voor doeljaar{" "}
        {targetYear} in.
      </div>

      <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "120px" }}>Jaar</th>
              <th style={{ width: "220px" }}>Directe kosten</th>
              <th style={{ width: "220px" }}>Indirecte kosten</th>
              <th style={{ width: "220px" }}>Totale kosten</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sourceTotals = computeHerverdelingTotals(fixedCostRowsForYear(sourceYear));
              const targetTotals = computeHerverdelingTotals(fixedCostRowsForYear(targetYear));
              return [
                { year: targetYear, totals: targetTotals },
                { year: sourceYear, totals: sourceTotals },
              ].map(({ year, totals }) => (
                <tr key={String(year)}>
                  <td>
                    <strong>{year}</strong>
                  </td>
                  <td>
                    {formatEur(totals.directAfter)}{" "}
                    <span className="muted">(herverdeeld uit direct: {formatEur(totals.directOut)})</span>
                  </td>
                  <td>
                    {formatEur(totals.indirectAfter)}{" "}
                    <span className="muted">(herverdeeld uit indirect: {formatEur(totals.indirectOut)})</span>
                  </td>
                  <td>
                    {formatEur(totals.directAfter + totals.indirectAfter)}{" "}
                    <span className="muted">(totaal herverdeeld: {formatEur(totals.redistributedTotal)})</span>
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "320px" }}>Omschrijving</th>
              <th style={{ width: "180px" }}>Kostensoort</th>
              <th style={{ width: "170px" }}>Kosten {sourceYear}</th>
              <th style={{ width: "150px" }}>Herverdelen %</th>
              <th style={{ width: "170px" }}>Kosten {targetYear}</th>
              <th style={{ width: "170px" }}>Herverdelen % {targetYear}</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const queues = new Map<string, VasteKostenUiRow[]>();
              draftVasteKostenTarget
                .filter((row) => !row.isNew)
                .forEach((row) => {
                  const key = vasteKostenKey(row);
                  const current = queues.get(key) ?? [];
                  current.push(row);
                  queues.set(key, current);
                });

              return sourceVasteKostenRows.map((srcRow, idx) => {
                const queue = queues.get(srcRow.key) ?? [];
                const draftRow = queue.shift();
                queues.set(srcRow.key, queue);

                if (!draftRow) {
                  return (
                    <tr key={`${srcRow.key}-${idx}`}>
                      <td>{srcRow.omschrijving}</td>
                      <td>{srcRow.kostensoort}</td>
                      <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                      <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                      <td className="muted">-</td>
                      <td className="muted">-</td>
                    </tr>
                  );
                }

                return (
                  <tr key={draftRow.uiId}>
                    <td>{srcRow.omschrijving}</td>
                    <td>{srcRow.kostensoort}</td>
                    <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                    <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        value={String(Number(draftRow.bedrag_per_jaar ?? 0))}
                        onChange={(event) =>
                          updateVasteKostenRow(draftRow.uiId, { bedrag_per_jaar: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        value={String(Number(draftRow.herverdeel_pct ?? 0))}
                        onChange={(event) =>
                          updateVasteKostenRow(draftRow.uiId, { herverdeel_pct: Number(event.target.value) })
                        }
                      />
                    </td>
                  </tr>
                );
              });
            })()}

            {draftVasteKostenTarget
              .filter((row) => row.isNew)
              .map((row) => (
                <tr key={row.uiId}>
                  <td>
                    <input
                      className="dataset-input"
                      value={row.omschrijving}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { omschrijving: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="dataset-input"
                      value={row.kostensoort}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { kostensoort: event.target.value })}
                    >
                      <option value="">(kies)</option>
                      <option value="Directe kosten">Directe kosten</option>
                      <option value="Indirecte kosten">Indirecte kosten</option>
                    </select>
                  </td>
                  <td className="muted">0</td>
                  <td className="muted">0</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(Number(row.bedrag_per_jaar ?? 0))}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { bedrag_per_jaar: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(Number(row.herverdeel_pct ?? 0))}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { herverdeel_pct: Number(event.target.value) })}
                    />
                  </td>
                </tr>
              ))}

            {sourceVasteKostenRows.length === 0 &&
            draftVasteKostenTarget.filter((row) => row.isNew).length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Geen vaste kosten gevonden voor bronjaar {sourceYear}. Voeg een rij toe voor {targetYear}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="editor-actions" style={{ marginTop: 0 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addVasteKostenRow}>
            Rij toevoegen
          </button>
        </div>
        <div className="editor-actions-group" />
      </div>
      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(3)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void saveDraftToServer(`Vaste kosten (concept) voor ${targetYear} opgeslagen.`)}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(5)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

