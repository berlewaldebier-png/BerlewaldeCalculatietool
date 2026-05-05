"use client";

import { toNumber } from "@/components/producten-verpakking/productenVerpakkingUtils";

type GenericRecord = Record<string, unknown>;

export function YearPricesTab({
  packagingMasters,
  availablePriceYears,
  activeYearForPrices,
  setYearPricesYear,
  yearPricesDraft,
  setYearPricesDraft,
  isSavingYearPrices,
  handleSaveYearPricesLayer,
  yearPricesStatus,
}: {
  packagingMasters: GenericRecord[];
  availablePriceYears: number[];
  activeYearForPrices: number;
  setYearPricesYear: (next: number) => void;
  yearPricesDraft: Record<string, number>;
  setYearPricesDraft: (updater: (current: Record<string, number>) => Record<string, number>) => void;
  isSavingYearPrices: boolean;
  handleSaveYearPricesLayer: () => Promise<void>;
  yearPricesStatus: string;
}) {
  return (
    <div className="content-card">
      <div className="module-card-header">
        <div className="module-card-title">Jaarprijzen</div>
        <div className="module-card-text">Beheer per jaar de prijs per stuk voor alle verpakkingsonderdelen.</div>
      </div>

      {packagingMasters.length === 0 ? (
        <div className="editor-status" style={{ marginTop: 12 }}>
          Voeg eerst verpakkingsonderdelen toe. Daarna kun je jaarprijzen invullen.
        </div>
      ) : (
        <>
          <div className="wizard-form-grid" style={{ marginTop: 12 }}>
            <label className="nested-field" style={{ maxWidth: 220 }}>
              <span>Jaar</span>
              <select
                className="dataset-input"
                value={String(activeYearForPrices)}
                onChange={(e) => setYearPricesYear(Number(e.target.value))}
              >
                {availablePriceYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
            <table className="dataset-editor-table wizard-table-compact wizard-table-fit">
              <thead>
                <tr>
                  <th>Onderdeel</th>
                  <th style={{ width: 180 }}>Prijs per stuk</th>
                </tr>
              </thead>
              <tbody>
                {packagingMasters.map((row) => {
                  const id = String((row as any)?.id ?? "").trim();
                  const label = String((row as any)?.omschrijving ?? "").trim() || id;
                  return (
                    <tr key={id}>
                      <td>{label}</td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          step="0.01"
                          value={String(yearPricesDraft[id] ?? 0)}
                          onChange={(e) =>
                            setYearPricesDraft((current) => ({
                              ...current,
                              [id]: toNumber(e.target.value, 0),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="editor-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="editor-button"
              disabled={isSavingYearPrices}
              onClick={() => void handleSaveYearPricesLayer()}
            >
              {isSavingYearPrices ? "Opslaan..." : "Opslaan"}
            </button>
            {yearPricesStatus ? <span className="editor-status">{yearPricesStatus}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

