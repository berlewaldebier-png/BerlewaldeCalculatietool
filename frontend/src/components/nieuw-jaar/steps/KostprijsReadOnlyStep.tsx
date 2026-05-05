"use client";

import type { ReactNode } from "react";

type KostprijsPreviewRow = {
  biernaam: string;
  soort: string;
  verpakkingseenheid: string;
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
};

type KostprijsTargetRows = {
  basisRows: KostprijsPreviewRow[];
  samengRows: KostprijsPreviewRow[];
};

type KostprijsReadOnlyStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;
  kostprijsTargetRows: KostprijsTargetRows;
};

export function KostprijsReadOnlyStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  kostprijsTargetRows,
}: KostprijsReadOnlyStepProps) {
  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Kostprijs {targetYear}</div>
        <div className="module-card-text">
          Read-only opbouw per bier en verpakkingseenheid op basis van jouw doeljaar-invoer en inkoopscenario.
        </div>
      </div>

      {(
        [
          ["Basisproducten", kostprijsTargetRows.basisRows],
          ["Samengestelde producten", kostprijsTargetRows.samengRows],
        ] as [string, KostprijsPreviewRow[]][]
      ).map(([label, records]) => (
        <div key={label} className="module-card compact-card" style={{ marginBottom: 14 }}>
          <div className="module-card-title">{label}</div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Biernaam</th>
                  <th>Soort</th>
                  <th>Verpakkingseenheid</th>
                  <th>Inkoop/IngrediÃ«nten</th>
                  <th>Verpakkingskosten</th>
                  <th>Indirecte/Directe kosten</th>
                  <th>Accijns</th>
                  <th>Kostprijs</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={8}>
                      Geen regels beschikbaar (controleer of er actieve kostprijzen zijn voor {sourceYear}).
                    </td>
                  </tr>
                ) : null}
                {records.map((row, index) => (
                  <tr key={`${row.biernaam}::${row.verpakkingseenheid}::${index}`}>
                    <td>{row.biernaam}</td>
                    <td>{row.soort}</td>
                    <td>{row.verpakkingseenheid}</td>
                    <td>{formatEur(row.primaire_kosten)}</td>
                    <td>{formatEur(row.verpakkingskosten)}</td>
                    <td>{formatEur(row.vaste_kosten)}</td>
                    <td>{formatEur(row.accijns)}</td>
                    <td>{formatEur(row.kostprijs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(7)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(9)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

