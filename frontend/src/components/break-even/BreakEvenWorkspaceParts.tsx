"use client";

import {
  formatMoney,
  formatNumber,
  type BreakEvenScenarioAdjustment,
  type BreakEvenScenarioAdjustmentType,
} from "@/components/break-even/breakEvenUtils";
import {
  formatAdjustmentTitle,
  formatAdjustmentValue,
  parseSignedNumberInput,
} from "@/components/break-even/breakEvenFormatting";

type AdjustmentModalKind = "price" | "fixed" | "variable" | "volume" | "mix";

type AdjustmentModalState = {
  kind: AdjustmentModalKind;
  adjustmentId: string | null;
  draftType: BreakEvenScenarioAdjustmentType;
  value: number;
  valueInput: string;
  targetKey: string;
  targetLabel: string;
};

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="cpq-live-summary-metric">
      <div className="cpq-live-summary-metric-label">{label}</div>
      <div className="cpq-live-summary-metric-value">{value}</div>
    </div>
  );
}

export function formatMoneyOrMissing(value: number) {
  return value > 0 ? formatMoney(value) : "Niet bekend";
}

export function formatStandaloneLiters(value: number) {
  return value > 0 ? `${formatNumber(value, 0)} L` : "Niet bekend";
}

export function formatDelta(value: number, suffix = "") {
  const prefix = value > 0 ? "+" : "";
  if (!Number.isFinite(value)) return "-";
  if (suffix) return `${prefix}${formatNumber(value, 0)}${suffix}`;
  return `${prefix}${formatMoney(value)}`;
}

export function normalizePromotedBaseName(name: string, year: number) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return `Break-even basis ${year}`;
  return trimmed.replace(/\s+scenario$/i, "").trim() || `Break-even basis ${year}`;
}

export function ScenarioSummary({
  adjustments,
  mixMode,
  onEdit,
  onRemove,
}: {
  adjustments: BreakEvenScenarioAdjustment[];
  mixMode: "product" | "packaging";
  onEdit: (adjustment: BreakEvenScenarioAdjustment) => void;
  onRemove: (adjustment: BreakEvenScenarioAdjustment) => void;
}) {
  if (adjustments.length === 0) {
    return <div className="cpq-empty">Nog geen wijzigingen toegepast.</div>;
  }

  return (
    <div className="cpq-stack">
      {adjustments.map((adjustment) => (
        <div key={adjustment.id} className="cpq-block tone-neutral">
          <div className="cpq-block-row">
            <div className="cpq-block-body">
              <div className="cpq-block-title">{formatAdjustmentTitle(adjustment, mixMode)}</div>
              <div className="cpq-block-subtitle">{formatAdjustmentValue(adjustment)}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="cpq-icon-action"
                onClick={() => onEdit(adjustment)}
                aria-label="Bewerk wijziging"
                title="Bewerken"
              >
                ✎
              </button>
              <button
                type="button"
                className="cpq-icon-action"
                onClick={() => onRemove(adjustment)}
                aria-label="Verwijder wijziging"
                title="Verwijderen"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BreakEvenAdjustmentModal({
  modal,
  mixMode,
  productOptions,
  packagingOptions,
  onChange,
  onClose,
  onSave,
}: {
  modal: AdjustmentModalState;
  mixMode: "product" | "packaging";
  productOptions: Array<{ key: string; label: string }>;
  packagingOptions: Array<{ key: string; label: string }>;
  onChange: (next: AdjustmentModalState | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const targetOptions = mixMode === "packaging" ? packagingOptions : productOptions;
  const needsTarget = modal.draftType === "volume_mix_pct";
  const title =
    modal.kind === "price"
      ? "Prijsaanpassing"
      : modal.kind === "fixed"
        ? "Vaste kosten aanpassen"
        : modal.kind === "variable"
          ? "Variabele kosten aanpassen"
          : modal.kind === "mix"
            ? "Mixverschuiving"
            : "Volumeverschuiving";
  const subtitle =
    modal.kind === "price"
      ? "Pas de verkoopprijs procentueel aan. Negatieve waarden zijn toegestaan."
      : modal.kind === "fixed"
        ? "Kies een euro- of procentcorrectie op de vaste kosten."
        : modal.kind === "variable"
          ? "Pas de variabele kosten procentueel aan. Negatieve waarden zijn toegestaan."
          : modal.kind === "mix"
            ? "Verplaats de mix richting een specifiek product of verpakking."
            : "Laat een product of verpakking harder of zachter meegroeien binnen de mix.";

  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cpq-modal">
        <div className="cpq-modal-header">
          <div>
            <h3 className="cpq-modal-title">{title}</h3>
            <div className="cpq-modal-subtitle">{subtitle}</div>
          </div>
          <button
            type="button"
            className="cpq-icon-action"
            onClick={onClose}
            aria-label="Sluiten"
            title="Sluiten"
          >
            ×
          </button>
        </div>
        <div className="cpq-modal-body">
          {modal.kind === "fixed" ? (
            <label className="cpq-field">
              <span className="cpq-label">Eenheid</span>
              <select
                className="cpq-select"
                value={modal.draftType}
                onChange={(event) =>
                  onChange({
                    ...modal,
                    draftType: event.target.value as BreakEvenScenarioAdjustmentType,
                  })
                }
              >
                <option value="fixed_cost_eur">EUR</option>
                <option value="fixed_cost_pct">%</option>
              </select>
            </label>
          ) : null}

          {needsTarget ? (
            <label className="cpq-field">
              <span className="cpq-label">
                {mixMode === "packaging" ? "Verpakking" : "Product"}
              </span>
              <select
                className="cpq-select"
                value={modal.targetKey}
                onChange={(event) => {
                  const option = targetOptions.find((item) => item.key === event.target.value);
                  onChange({
                    ...modal,
                    targetKey: event.target.value,
                    targetLabel: option?.label ?? "",
                  });
                }}
              >
                <option value="">Selecteer...</option>
                {targetOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="cpq-field">
            <span className="cpq-label">
              Waarde {modal.draftType === "fixed_cost_eur" ? "(EUR)" : "(%)"}
            </span>
            <input
              className="cpq-input"
              type="text"
              inputMode="decimal"
              value={modal.valueInput}
              onChange={(event) => {
                const nextInput = event.target.value;
                const parsedValue = parseSignedNumberInput(nextInput);
                onChange({
                  ...modal,
                  valueInput: nextInput,
                  value: parsedValue ?? modal.value,
                });
              }}
            />
          </label>

          <div className="cpq-alert">
            Voorbeelden: <strong>-5</strong> verlaagt, <strong>+5</strong> verhoogt.
          </div>
        </div>
        <div className="cpq-modal-footer">
          <button type="button" className="cpq-button cpq-button-secondary" onClick={onClose}>
            Annuleren
          </button>
          <button type="button" className="cpq-button cpq-button-primary" onClick={onSave}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

