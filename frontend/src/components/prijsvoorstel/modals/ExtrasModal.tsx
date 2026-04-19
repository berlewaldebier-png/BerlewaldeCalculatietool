"use client";

import { useMemo } from "react";

import TrashIcon from "@/components/prijsvoorstel/modals/_TrashIcon";

export type ExtrasApplies = "both" | "intro" | "standard";

export type ExtrasDraftRow = {
  id: string;
  label: string;
  qty: number;
  unitPriceEx: number;
  unitCostEx: number;
  isFree: boolean;
  thresholdAmountEx: number;
};

export default function ExtrasModal({
  open,
  appliesTo,
  rows,
  canDelete,
  onChangeAppliesTo,
  onChangeRows,
  onAddRow,
  onDelete,
  onCancel,
  onSave
}: {
  open: boolean;
  appliesTo: ExtrasApplies;
  rows: ExtrasDraftRow[];
  canDelete: boolean;
  onChangeAppliesTo: (value: ExtrasApplies) => void;
  onChangeRows: (rows: ExtrasDraftRow[]) => void;
  onAddRow: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const hasAnyRow = rows.length > 0;
  const saveDisabled = useMemo(() => false, []);

  if (!open) return null;

  return (
    <div className="confirm-modal-overlay" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="extras-modal-title">
        <div className="confirm-modal-title" id="extras-modal-title">
          Extra&apos;s (diensten) instellen
        </div>
        <div className="confirm-modal-text">
          Extra&apos;s zijn diensten (bijv. proeverij, tapverhuur). BTW is altijd 21% voor de factuur; de berekening
          hier blijft exclusief BTW. Je kunt extra&apos;s gratis maken of conditioneel laten worden op basis van een
          omzetdrempel (ex).
        </div>

        <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
          <label className="nested-field">
            <span>Toepassen op</span>
            <select
              className="dataset-input"
              value={appliesTo}
              onChange={(event) => onChangeAppliesTo(event.target.value as ExtrasApplies)}
            >
              <option value="intro">Introductie (periode 1)</option>
              <option value="standard">Standaard (periode 2)</option>
              <option value="both">Beide periodes</option>
            </select>
          </label>
        </div>

        <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th>Aantal</th>
                <th>Verkoopprijs (ex)</th>
                <th>Kosten (ex)</th>
                <th>Gratis</th>
                <th>Omzetdrempel (ex)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      className="dataset-input"
                      value={row.label}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) => (item.id === row.id ? { ...item, label: event.target.value } : item))
                        )
                      }
                      placeholder="Bijv. Proeverij"
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="1"
                      value={String(row.qty)}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) =>
                            item.id === row.id
                              ? { ...item, qty: Math.max(0, Math.floor(Number(event.target.value || 0))) }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={String(row.unitPriceEx)}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, unitPriceEx: Math.max(0, Number(event.target.value || 0)) } : item
                          )
                        )
                      }
                      disabled={row.isFree}
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={String(row.unitCostEx)}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, unitCostEx: Math.max(0, Number(event.target.value || 0)) } : item
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.isFree}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  isFree: event.target.checked,
                                  unitPriceEx: event.target.checked ? 0 : item.unitPriceEx
                                }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={String(row.thresholdAmountEx)}
                      onChange={(event) =>
                        onChangeRows(
                          rows.map((item) =>
                            item.id === row.id
                              ? { ...item, thresholdAmountEx: Math.max(0, Number(event.target.value || 0)) }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button-table"
                      aria-label="Verwijderen"
                      title="Verwijderen"
                      onClick={() => onChangeRows(rows.filter((item) => item.id !== row.id))}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {!hasAnyRow ? (
                <tr>
                  <td colSpan={7} className="prijs-empty-cell">
                    Nog geen extra&apos;s toegevoegd.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={onAddRow}>
              Extra toevoegen
            </button>
          </div>
          <div className="editor-actions-group" />
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

