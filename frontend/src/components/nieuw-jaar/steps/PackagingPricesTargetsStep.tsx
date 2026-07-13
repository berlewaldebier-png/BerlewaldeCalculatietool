"use client";

import type { ReactNode } from "react";

type PackagingPriceRow = {
  jaar: number;
  verpakkingsonderdeel_id: string;
  prijs_per_stuk: number;
};

type PackagingTargetRow = {
  componentId: string;
  omschrijving: string;
};

type PackagingPricesTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;

  packagingComponentsCount: number;
  packagingRowsForTarget: PackagingTargetRow[];
  currentPackagingPrices: PackagingPriceRow[];
  draftPackagingPrices: Record<string, number>;
  setDraftPackagingPrices: (setter: (current: Record<string, number>) => Record<string, number>) => void;
  inflationPct: number;

  copyPackagingPricesFromSource: () => void;
  savePackagingPricesTarget: () => void;
};

export function PackagingPricesTargetsStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  packagingComponentsCount,
  packagingRowsForTarget,
  currentPackagingPrices,
  draftPackagingPrices,
  setDraftPackagingPrices,
  inflationPct,
  copyPackagingPricesFromSource,
  savePackagingPricesTarget,
}: PackagingPricesTargetsStepProps) {
  const normalizedInflationPct = Number.isFinite(Number(inflationPct)) ? Number(inflationPct) : 0;
  return (
    <div>
      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{packagingComponentsCount} onderdelen</span>
          <span className="muted">Links bronjaar, rechts doeljaar</span>
        </div>
      </div>

      <div className="editor-status" style={{ marginBottom: 14 }}>
        Vul de jaarprijzen voor {targetYear} in. Je kunt optioneel starten vanuit bronjaar {sourceYear} via de knop
        hieronder. Basis- en samengestelde producten blijven hetzelfde; alleen de jaarprijzen van verpakkingsonderdelen
        sturen de kostprijs door.
      </div>

      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Inflatie uit vaste kosten</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Verwachte inflatie: {normalizedInflationPct.toFixed(1).replace(".", ",")}%.
          De kopieeractie verhoogt bronjaarprijzen met dit percentage. Daarna kun je elke doeljaarprijs handmatig overschrijven.
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "320px" }}>Onderdeel</th>
              <th style={{ width: "180px" }}>Bronjaar {sourceYear}</th>
              <th style={{ width: "180px" }}>Bron + inflatie</th>
              <th style={{ width: "180px" }}>Doeljaar {targetYear}</th>
              <th style={{ width: "160px" }}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {packagingRowsForTarget.map((row) => {
              const sourcePrice =
                currentPackagingPrices.find(
                  (priceRow) => priceRow.jaar === sourceYear && priceRow.verpakkingsonderdeel_id === row.componentId
                )?.prijs_per_stuk ?? 0;
              const targetPrice = Number(draftPackagingPrices[row.componentId] ?? 0);
              const inflatedPrice = Number((Number(sourcePrice ?? 0) * (1 + normalizedInflationPct / 100)).toFixed(2));
              const delta = targetPrice - Number(sourcePrice ?? 0);
              return (
                <tr key={row.componentId}>
                  <td>{row.omschrijving}</td>
                  <td>
                    <input
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      value={String(Number(sourcePrice ?? 0))}
                      readOnly
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input dataset-input-readonly"
                      type="number"
                      value={String(inflatedPrice)}
                      readOnly
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(targetPrice)}
                      onChange={(event) =>
                        setDraftPackagingPrices((current) => ({
                          ...current,
                          [row.componentId]: Number(event.target.value),
                        }))
                      }
                    />
                  </td>
                  <td>{formatEur(delta)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(4)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={copyPackagingPricesFromSource}
            disabled={isRunning}
          >
            Kopieer bronjaar + inflatie
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={savePackagingPricesTarget}
            disabled={isRunning || packagingComponentsCount === 0}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(6)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

