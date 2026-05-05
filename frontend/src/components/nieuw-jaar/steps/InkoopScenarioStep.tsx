"use client";

import type { ReactNode } from "react";

type InkoopScenarioRow = {
  bierId: string;
  biernaam: string;
  productId: string;
  productLabel: string;
  sourceCost: number;
  sourcePrimaryCost: number;
  estimatedTargetCost: number;
};

type InkoopScenarioStepProps = {
  sourceYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;

  inkoopScenarioRows: InkoopScenarioRow[];
  scenarioPrimaryCosts: Record<string, number>;
  setScenarioPrimaryCosts: (setter: (current: Record<string, number>) => Record<string, number>) => void;
};

export function InkoopScenarioStep({
  sourceYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  inkoopScenarioRows,
  scenarioPrimaryCosts,
  setScenarioPrimaryCosts,
}: InkoopScenarioStepProps) {
  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        <strong>Scenario</strong>: deze inkoopprijzen zijn alleen voor de preview in deze wizard en worden niet opgeslagen.
        De echte inkoopprijzen komen later via inkoopfacturen.
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "260px" }}>Bier</th>
              <th style={{ width: "280px" }}>Product</th>
              <th style={{ width: "160px" }}>Bron kostprijs</th>
              <th style={{ width: "160px" }}>Bron inkoop</th>
              <th style={{ width: "160px" }}>Scenario inkoop</th>
              <th style={{ width: "160px" }}>Scenario kostprijs</th>
            </tr>
          </thead>
          <tbody>
            {inkoopScenarioRows.map((row) => {
              const scenarioKey = `${row.bierId}::${row.productId}`;
              const scenarioValue = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
                ? Number(scenarioPrimaryCosts[scenarioKey] ?? 0)
                : row.sourcePrimaryCost;

              return (
                <tr key={scenarioKey}>
                  <td>{row.biernaam}</td>
                  <td>{row.productLabel}</td>
                  <td>{formatEur(row.sourceCost)}</td>
                  <td>{formatEur(row.sourcePrimaryCost)}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(scenarioValue)}
                      placeholder="(bron)"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw.trim() === "") {
                          setScenarioPrimaryCosts((current) => {
                            const next = { ...current };
                            delete next[scenarioKey];
                            return next;
                          });
                          return;
                        }
                        const parsed = Number(raw);
                        setScenarioPrimaryCosts((current) => ({ ...current, [scenarioKey]: parsed }));
                      }}
                    />
                  </td>
                  <td>{formatEur(row.estimatedTargetCost)}</td>
                </tr>
              );
            })}
            {inkoopScenarioRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Geen inkoop-bieren gevonden (controleer of er actieve inkoop-kostprijzen zijn voor {sourceYear}).
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
            onClick={() => void navigateToStep(5)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setScenarioPrimaryCosts(() => ({}))}
            disabled={isRunning}
          >
            Reset scenario
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(7)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

