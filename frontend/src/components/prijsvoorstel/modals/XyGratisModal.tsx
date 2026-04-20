"use client";

export type XyGratisApplies = "both" | "intro" | "standard";

export type XyGratisOption = { value: string; label: string };

export default function XyGratisModal({
  open,
  isLitersMode,
  requiredQty,
  freeQty,
  appliesTo,
  eligibleRefs,
  eligibleOptions,
  onChangeRequiredQty,
  onChangeFreeQty,
  onChangeAppliesTo,
  onAddEligibleRef,
  onRemoveEligibleRef,
  onCancel,
  onSave
}: {
  open: boolean;
  isLitersMode: boolean;
  requiredQty: number;
  freeQty: number;
  appliesTo: XyGratisApplies;
  eligibleRefs: string[];
  eligibleOptions: XyGratisOption[];
  onChangeRequiredQty: (value: number) => void;
  onChangeFreeQty: (value: number) => void;
  onChangeAppliesTo: (value: XyGratisApplies) => void;
  onAddEligibleRef: (value: string) => void;
  onRemoveEligibleRef: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="xy-modal-title">
        <div className="confirm-modal-title" id="xy-modal-title">
          X+Y gratis instellen
        </div>
        <div className="confirm-modal-text">
          De goedkoopste eligible units worden gratis (omzet = 0, kosten tellen wel mee). Korting stapelt niet met
          staffels of % korting.
        </div>
        <div className="confirm-modal-text" style={{ marginTop: "0.5rem" }}>
          Let op: de aantallen in de offerte zijn de betaalde stuks. De gratis stuks worden hier bovenop toegevoegd.
        </div>

        <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
          <label className="nested-field">
            <span>Toepassen op</span>
            <select
              className="dataset-input"
              value={appliesTo}
              onChange={(event) => onChangeAppliesTo(event.target.value as XyGratisApplies)}
            >
              <option value="intro">Introductie (periode 1)</option>
              <option value="standard">Standaard (periode 2)</option>
              <option value="both">Beide periodes</option>
            </select>
          </label>
          <label className="nested-field">
            <span>X (kopen)</span>
            <input
              className="dataset-input"
              type="number"
              min={1}
              step="1"
              value={String(requiredQty)}
              onChange={(event) => onChangeRequiredQty(Math.max(1, Math.floor(Number(event.target.value || 1))))}
            />
          </label>
          <label className="nested-field">
            <span>Y (gratis)</span>
            <input
              className="dataset-input"
              type="number"
              min={1}
              step="1"
              value={String(freeQty)}
              onChange={(event) => onChangeFreeQty(Math.max(1, Math.floor(Number(event.target.value || 1))))}
            />
          </label>
        </div>

        <div className="module-card compact-card" style={{ marginTop: "0.75rem" }}>
          <div className="module-card-title">Eligible producten</div>
          <div className="module-card-text">
            Laat leeg om alle (niet-catalogus) producten mee te nemen. Kies 1 of meer producten voor een mix-actie.
          </div>
          <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Product</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {eligibleRefs.map((ref) => {
                  const option = eligibleOptions.find((o) => o.value === ref);
                  return (
                    <tr key={ref}>
                      <td>{option?.label ?? ref}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-button-table"
                          aria-label="Verwijderen"
                          title="Verwijderen"
                          onClick={() => onRemoveEligibleRef(ref)}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {eligibleRefs.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="prijs-empty-cell">
                      Alle producten zijn eligible.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
            <div className="editor-actions-group">
              <select
                className="dataset-input"
                value=""
                onChange={(event) => {
                  const value = String(event.target.value ?? "");
                  if (!value) return;
                  onAddEligibleRef(value);
                }}
              >
                <option value="">Product toevoegen...</option>
                {eligibleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="editor-actions-group" />
          </div>
        </div>

        <div className="confirm-modal-actions">
          <button type="button" className="editor-button editor-button-secondary" onClick={onCancel}>
            Annuleren
          </button>
          <button type="button" className="editor-button" onClick={onSave} disabled={isLitersMode}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
