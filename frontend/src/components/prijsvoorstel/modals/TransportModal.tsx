"use client";

export type TransportApplies = "both" | "intro" | "standard";

export default function TransportModal({
  open,
  appliesTo,
  postcode,
  distanceKm,
  kmThreshold,
  thresholdAmountEx,
  deliveries,
  rateEx,
  canDelete,
  onChangeAppliesTo,
  onChangePostcode,
  onChangeDistanceKm,
  onChangeKmThreshold,
  onChangeThresholdAmountEx,
  onChangeDeliveries,
  onChangeRateEx,
  onDelete,
  onCancel,
  onSave
}: {
  open: boolean;
  appliesTo: TransportApplies;
  postcode: string;
  distanceKm: number;
  kmThreshold: number;
  thresholdAmountEx: number;
  deliveries: number;
  rateEx: number;
  canDelete: boolean;
  onChangeAppliesTo: (value: TransportApplies) => void;
  onChangePostcode: (value: string) => void;
  onChangeDistanceKm: (value: number) => void;
  onChangeKmThreshold: (value: number) => void;
  onChangeThresholdAmountEx: (value: number) => void;
  onChangeDeliveries: (value: number) => void;
  onChangeRateEx: (value: number) => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!open) return null;

  const saveDisabled =
    !String(postcode || "").trim() || distanceKm <= 0 || deliveries <= 0 || rateEx <= 0;

  return (
    <div className="confirm-modal-overlay" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="transport-modal-title">
        <div className="confirm-modal-title" id="transport-modal-title">
          Transport instellen
        </div>
        <div className="confirm-modal-text">
          Transport is per levering. Binnen de km-drempel telt het als kostenpost. Boven de km-drempel kan transport
          worden doorbelast (omzet) wanneer de order onder de omzetdrempel blijft. Transport heeft altijd 21% BTW
          (weergave), maar de berekening blijft exclusief BTW.
        </div>

        <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
          <label className="nested-field">
            <span>Toepassen op</span>
            <select
              className="dataset-input"
              value={appliesTo}
              onChange={(event) => onChangeAppliesTo(event.target.value as TransportApplies)}
            >
              <option value="intro">Introductie (periode 1)</option>
              <option value="standard">Standaard (periode 2)</option>
              <option value="both">Beide periodes</option>
            </select>
          </label>
          <label className="nested-field">
            <span>Postcode (klant)</span>
            <input
              className="dataset-input"
              value={postcode}
              onChange={(event) => onChangePostcode(event.target.value)}
              placeholder="1234AB"
            />
          </label>
          <label className="nested-field">
            <span>Afstand (km)</span>
            <input
              className="dataset-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={String(distanceKm)}
              onChange={(event) => onChangeDistanceKm(Math.max(0, Number(event.target.value || 0)))}
            />
          </label>
          <label className="nested-field">
            <span>Km-drempel</span>
            <input
              className="dataset-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              value={String(kmThreshold)}
              onChange={(event) => onChangeKmThreshold(Math.max(0, Number(event.target.value || 0)))}
            />
          </label>
          <label className="nested-field">
            <span>Omzetdrempel (ex)</span>
            <input
              className="dataset-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={String(thresholdAmountEx)}
              onChange={(event) => onChangeThresholdAmountEx(Math.max(0, Number(event.target.value || 0)))}
            />
          </label>
          <label className="nested-field">
            <span>Aantal leveringen</span>
            <input
              className="dataset-input"
              type="number"
              min={1}
              step="1"
              value={String(deliveries)}
              onChange={(event) => onChangeDeliveries(Math.max(1, Math.floor(Number(event.target.value || 1))))}
            />
          </label>
          <label className="nested-field">
            <span>Tarief per levering (ex)</span>
            <input
              className="dataset-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={String(rateEx)}
              onChange={(event) => onChangeRateEx(Math.max(0, Number(event.target.value || 0)))}
            />
          </label>
        </div>

        <div className="confirm-modal-actions">
          {canDelete ? (
            <button type="button" className="editor-button editor-button-secondary" onClick={onDelete}>
              Verwijderen
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="editor-button editor-button-secondary" onClick={onCancel}>
            Annuleren
          </button>
          <button type="button" className="editor-button" onClick={onSave} disabled={saveDisabled}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

