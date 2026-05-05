"use client";

import type { ReactNode } from "react";

export function InitializeConceptStep({
  sourceYear,
  targetYear,
  copyProductie,
  setCopyProductie,
  copyVasteKosten,
  setCopyVasteKosten,
  copyTarieven,
  setCopyTarieven,
  copyVerpakkingsonderdelen,
  setCopyVerpakkingsonderdelen,
  copyVerkoopstrategie,
  setCopyVerkoopstrategie,
  saveAndCloseButton,
  navigateToStep,
  initializeYear,
  isRunning,
  canInitialize,
  conceptStarted,
}: {
  sourceYear: number;
  targetYear: number;
  copyProductie: boolean;
  setCopyProductie: (next: boolean) => void;
  copyVasteKosten: boolean;
  setCopyVasteKosten: (next: boolean) => void;
  copyTarieven: boolean;
  setCopyTarieven: (next: boolean) => void;
  copyVerpakkingsonderdelen: boolean;
  setCopyVerpakkingsonderdelen: (next: boolean) => void;
  copyVerkoopstrategie: boolean;
  setCopyVerkoopstrategie: (next: boolean) => void;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  initializeYear: () => Promise<void> | void;
  isRunning: boolean;
  canInitialize: boolean;
  conceptStarted: boolean;
}) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Selecteer de stamdata die klaargezet moet worden voor <strong>{targetYear}</strong> op basis van bronjaar{" "}
        <strong>{sourceYear}</strong>. Daarna vul je per onderdeel de nieuwe parameters voor {targetYear} in. Pas bij{" "}
        <strong>Afronden</strong> wordt de data definitief opgeslagen en zichtbaar in de applicatie.
        <div className="muted" style={{ marginTop: 8 }}>
          Niet aangevinkt: dat onderdeel wordt niet voorbereid in dit concept en de bijbehorende stap blijft uitgeschakeld.
        </div>
      </div>
      <div className="record-card-grid">
        {[
          ["Productie", copyProductie, setCopyProductie],
          ["Vaste kosten (nieuw invullen)", copyVasteKosten, setCopyVasteKosten],
          ["Tarieven en heffingen", copyTarieven, setCopyTarieven],
          ["Verpakkingsonderdelen (jaarprijzen)", copyVerpakkingsonderdelen, setCopyVerpakkingsonderdelen],
          ["Verkoopstrategie", copyVerkoopstrategie, setCopyVerkoopstrategie]
        ].map(([label, value, setter]) => (
          <label key={String(label)} className="wizard-toggle-card">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(event) => (setter as any)(event.target.checked)}
            />
            <span>{String(label)}</span>
          </label>
        ))}
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(0)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button primary"
            onClick={initializeYear}
            disabled={isRunning || !canInitialize || conceptStarted}
          >
            Start concept {targetYear}
          </button>
        </div>
      </div>
    </div>
  );
}

