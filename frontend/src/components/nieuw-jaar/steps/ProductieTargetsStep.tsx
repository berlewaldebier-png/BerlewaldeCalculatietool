"use client";

import type { ReactNode } from "react";

type ProductieYear = {
  hoeveelheid_inkoop_l: number;
  hoeveelheid_productie_l: number;
  batchgrootte_eigen_productie_l: number;
};

type ProductieTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  sourceProductie: unknown;
  sourceYearCloseReference?: Record<string, number>;
  draftProductieTarget: ProductieYear;
  setDraftProductieTarget: (setter: (current: ProductieYear) => ProductieYear) => void;
  copyProductieFromSource: () => void;
  saveProductieTarget: () => void;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveAndCloseButton: ReactNode;
  isRunning: boolean;
  formatEur: (value: number) => string;
};

export function ProductieTargetsStep({
  sourceYear,
  targetYear,
  sourceProductie,
  sourceYearCloseReference,
  draftProductieTarget,
  setDraftProductieTarget,
  copyProductieFromSource,
  saveProductieTarget,
  navigateToStep,
  saveAndCloseButton,
  isRunning,
  formatEur
}: ProductieTargetsStepProps) {
  return (
    <div>
      {sourceYearCloseReference ? (
        <div className="placeholder-block" style={{ marginBottom: 14 }}>
          <strong>Afgesloten werkelijkheid {sourceYear}</strong>
          <div className="muted" style={{ marginTop: 8 }}>
            Gebruik deze cijfers als reality check voor je volumeplanning. De velden hieronder blijven bewust handmatig:
            volume is een stuurkeuze voor {targetYear}, geen automatische kopie van de gerealiseerde omzet.
          </div>
          <div className="record-card-grid" style={{ marginTop: 12 }}>
            <div className="wizard-toggle-card"><span><strong>Omzet</strong><small>{formatEur(sourceYearCloseReference.revenue ?? 0)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Contributie</strong><small>{formatEur(sourceYearCloseReference.contribution ?? 0)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Variabele kosten</strong><small>{formatEur(sourceYearCloseReference.variableCost ?? 0)}</small></span></div>
          </div>
        </div>
      ) : null}

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "260px" }}></th>
              <th style={{ width: "260px" }}>Bronjaar {sourceYear}</th>
              <th style={{ width: "260px" }}>Doeljaar {targetYear}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Hoeveelheid inkoop (L)", "hoeveelheid_inkoop_l"],
              ["Hoeveelheid productie (L)", "hoeveelheid_productie_l"],
              ["Batchgrootte eigen productie (L)", "batchgrootte_eigen_productie_l"]
            ].map(([label, key]) => (
              <tr key={String(key)}>
                <td>
                  <strong>{String(label)}</strong>
                </td>
                <td>
                  <input
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    value={String(Number((sourceProductie as any)?.[key] ?? 0))}
                    readOnly
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    value={String(Number((draftProductieTarget as any)?.[key] ?? 0))}
                    onChange={(event) =>
                      setDraftProductieTarget((current) => ({
                        ...current,
                        [key]: Number(event.target.value)
                      }))
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(1)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={copyProductieFromSource}
            disabled={!sourceProductie}
          >
            Kopieer bronjaar
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={saveProductieTarget}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => void navigateToStep(3)}
            disabled={isRunning}
          >
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

