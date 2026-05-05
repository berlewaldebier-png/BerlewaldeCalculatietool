"use client";

import { formatEuro, formatPct } from "@/components/kostprijsbeheer/kostprijsBeheerUtils";

export type PendingActivationState = {
  artikelNaam: string;
  categorie: string;
  jaar: number;
  currentVersionLabel: string;
  currentCost: number | null;
  options: Array<{
    id: string;
    label: string;
    cost: number | null;
    deltaEuro: number | null;
    deltaPct: number | null;
    sortKey: string;
  }>;
  selectedOptionId: string;
};

export function ActivationModal({
  pendingActivation,
  activationStatus,
  setPendingActivation,
  setActivationStatus,
}: {
  pendingActivation: PendingActivationState;
  activationStatus: string;
  setPendingActivation: (next: PendingActivationState | null) => void;
  setActivationStatus: (next: string) => void;
}) {
  return (
    <div className="confirm-modal-overlay" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-activate-title">
        <div className="confirm-modal-title" id="confirm-activate-title">
          Activeer nieuwe kostprijsversie
        </div>
        <div className="confirm-modal-text">
          <strong>
            {pendingActivation.artikelNaam} - {pendingActivation.categorie || "-"} - {pendingActivation.jaar}
          </strong>
          <div style={{ marginTop: 10 }} />
          <div>
            <div>
              <strong>Huidig actief</strong>: {pendingActivation.currentVersionLabel}
            </div>
            <div>Kostprijs: {formatEuro(pendingActivation.currentCost)}</div>
          </div>
          <div style={{ marginTop: 10 }} />
          <div>
            <div>
              <strong>Nieuwe definitieve versie</strong>
            </div>
            <select
              className="dataset-input"
              value={pendingActivation.selectedOptionId}
              onChange={(event) =>
                setPendingActivation({
                  ...pendingActivation,
                  selectedOptionId: event.target.value,
                })
              }
            >
              {pendingActivation.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}{" "}
                  {option.cost !== null
                    ? `- ${formatEuro(option.cost)} (${formatEuro(option.deltaEuro)} / ${formatPct(option.deltaPct)})`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 10 }} />
          {(() => {
            const selected = pendingActivation.options.find((option) => option.id === pendingActivation.selectedOptionId);
            return (
              <div>
                Verschil: {formatEuro(selected?.deltaEuro ?? null)} ({formatPct(selected?.deltaPct ?? null)})
              </div>
            );
          })()}
          <div style={{ marginTop: 10 }} />
          <div className="muted">
            Nieuwe berekeningen/offertes voor dit product gaan na activatie deze nieuwe kostprijsversie gebruiken.
            Bestaande offertes blijven ongewijzigd.
          </div>
          {activationStatus ? (
            <div style={{ marginTop: 10 }} className="editor-status">
              {activationStatus}
            </div>
          ) : null}
        </div>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setPendingActivation(null)}
          >
            Annuleren
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => {
              setActivationStatus(
                "Doorzetten is nog een placeholder. Gebruik voorlopig Nieuw jaar voorbereiden > Kostprijs activeren."
              );
              setTimeout(() => setPendingActivation(null), 900);
            }}
          >
            Doorzetten
          </button>
        </div>
      </div>
    </div>
  );
}

