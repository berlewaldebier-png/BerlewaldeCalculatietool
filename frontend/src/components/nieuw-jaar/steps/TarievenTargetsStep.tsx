"use client";

import type { ReactNode } from "react";

type TariefTarget = {
  tarief_hoog: number;
  tarief_laag: number;
  verbruikersbelasting: number;
};

type TarievenTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  sourceTarief: unknown;
  draftTariefTarget: TariefTarget;
  setDraftTariefTarget: (setter: (current: TariefTarget) => TariefTarget) => void;
  copyTariefFromSource: () => void;
  saveTariefTarget: () => void;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  saveAndCloseButton: ReactNode;
  isRunning: boolean;
};

export function TarievenTargetsStep({
  sourceYear,
  targetYear,
  sourceTarief,
  draftTariefTarget,
  setDraftTariefTarget,
  copyTariefFromSource,
  saveTariefTarget,
  navigateToStep,
  saveAndCloseButton,
  isRunning,
}: TarievenTargetsStepProps) {
  return (
    <div>
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
              ["Tarief hoog", "tarief_hoog"],
              ["Tarief laag", "tarief_laag"],
              ["Verbruikersbelasting", "verbruikersbelasting"],
            ].map(([label, key]) => (
              <tr key={String(key)}>
                <td>
                  <strong>{String(label)}</strong>
                </td>
                <td>
                  <input
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    value={String(Number((sourceTarief as any)?.[key] ?? 0))}
                    readOnly
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    value={String(Number((draftTariefTarget as any)?.[key] ?? 0))}
                    onChange={(event) =>
                      setDraftTariefTarget((current) => ({
                        ...current,
                        [key]: Number(event.target.value),
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
            onClick={() => void navigateToStep(2)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={copyTariefFromSource}
            disabled={!sourceTarief}
          >
            Kopieer bronjaar
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={saveTariefTarget}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => void navigateToStep(4)}
            disabled={isRunning}
          >
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

