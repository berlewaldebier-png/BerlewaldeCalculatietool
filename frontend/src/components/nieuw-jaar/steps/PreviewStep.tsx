"use client";

import type { ReactNode } from "react";

import type { PreviewRow } from "@/components/nieuw-jaar/nieuwJaarWizardPreview";

export function PreviewStep({
  previewRows,
  sourceYear,
  targetYear,
  formatEur,
  isRunning,
  conceptStarted,
  saveAndCloseButton,
  navigateToStep,
  saveDraftToServer,
}: {
  previewRows: PreviewRow[];
  sourceYear: number;
  targetYear: number;
  formatEur: (value: number) => string;
  isRunning: boolean;
  conceptStarted: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveDraftToServer: (statusMessage?: string) => Promise<unknown> | unknown;
}) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Hieronder zie je de indicatieve kostprijzen voor het doeljaar {targetYear}. Pas als recepten of
        inkoopfacturen aan producten worden gekoppeld en geactiveerd, is een kostprijs definitief. We rekenen hier
        met de gegevens die je in deze wizard hebt ingevuld; de inkoopprijzen zijn een scenario totdat ze later via
        inkoopfacturen definitief worden.
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "240px" }}>Bier</th>
              <th style={{ width: "260px" }}>Product</th>
              <th style={{ width: "160px" }}>Kostprijs {sourceYear}</th>
              <th style={{ width: "160px" }}>Kostprijs {targetYear} (indicatief)</th>
              <th style={{ width: "160px" }}>Delta</th>
              <th style={{ width: "180px" }}>Sell-in Horeca</th>
              <th style={{ width: "180px" }}>Sell-in Retail</th>
              <th style={{ width: "180px" }}>Sell-in Slijterij</th>
              <th style={{ width: "180px" }}>Sell-in Speciaalzaak</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr key={`${row.bierId}::${row.productId}`}>
                <td>{row.biernaam}</td>
                <td>{row.productLabel}</td>
                <td>{formatEur(row.sourceCost)}</td>
                <td>{formatEur(row.estimatedTargetCost)}</td>
                <td>{formatEur(row.delta)}</td>
                <td>{formatEur(row.sellIn.horeca ?? 0)}</td>
                <td>{formatEur(row.sellIn.retail ?? 0)}</td>
                <td>{formatEur(row.sellIn.slijterij ?? 0)}</td>
                <td>{formatEur(row.sellIn.zakelijk ?? 0)}</td>
              </tr>
            ))}
            {previewRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  Geen preview-rijen beschikbaar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(9)}
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
            onClick={() => void saveDraftToServer("Concept opgeslagen.")}
            disabled={isRunning || !conceptStarted}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(12)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

