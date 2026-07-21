"use client";

import type { BeerViewRow } from "@/components/verkoopstrategie/verkoopstrategieTypes";
import { inputClass, money } from "@/components/verkoopstrategie/verkoopstrategieUi";
import { ActionStatus } from "@/components/ActionStatus";
import type { CentralSkuRow } from "@/features/sku/centralSkuIndex";
import {
  getSalesStrategyListOpslag,
  getSalesStrategyListPrice,
  getSalesStrategyActionStatus,
  type SalesStrategyBeerGroup,
} from "@/features/sales-strategy/salesStrategyFormModel";
import { parseNumberLoose } from "@/lib/pricingEngine";

type SalesStrategyWorkspaceViewProps = {
  hasProductionYears: boolean;
  sellRowCount: number;
  serviceRows: CentralSkuRow[];
  effectiveSelectedYear: number;
  lockYear: boolean;
  yearOptions: number[];
  sellFilter: string;
  groupedBeerRows: SalesStrategyBeerGroup[];
  openPriceGroups: Record<string, boolean>;
  allPriceGroupsOpen: Record<string, boolean>;
  status: string;
  mode: "server" | "draft";
  hasPendingServerUpdate: boolean;
  isSaving: boolean;
  onYearChange: (year: number) => void;
  onFilterChange: (value: string) => void;
  onSetOpenPriceGroups: (groups: Record<string, boolean>) => void;
  onTogglePriceGroup: (beerName: string) => void;
  onListPriceChange: (row: BeerViewRow, value: number | "") => void;
  onReloadDraft: () => void;
  onSave: () => Promise<void>;
};

export function SalesStrategyWorkspaceView({
  hasProductionYears,
  sellRowCount,
  serviceRows,
  effectiveSelectedYear,
  lockYear,
  yearOptions,
  sellFilter,
  groupedBeerRows,
  openPriceGroups,
  allPriceGroupsOpen,
  status,
  mode,
  hasPendingServerUpdate,
  isSaving,
  onYearChange,
  onFilterChange,
  onSetOpenPriceGroups,
  onTogglePriceGroup,
  onListPriceChange,
  onReloadDraft,
  onSave,
}: SalesStrategyWorkspaceViewProps) {
  const actionStatus = getSalesStrategyActionStatus(status, isSaving);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopstrategie</div>
        <div className="module-card-text">Beheer de actieve prijslijst per jaar en SKU. De lijstprijs is de SSOT; varianten kunnen later daarvan worden afgeleid.</div>
      </div>

      {!hasProductionYears ? (
        <div className="module-card compact-card" style={{ marginTop: "1rem" }}>
          <div className="module-card-title">Nog geen productiejaar</div>
          <div className="module-card-text">
            Maak eerst een productiejaar aan. Zodra er een productiejaar bestaat kun je hier per jaar de verkoopprijzen instellen.
          </div>
        </div>
      ) : (
        <>
          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{sellRowCount} SKU&apos;s</span>
              {serviceRows.length > 0 ? (
                <span className="editor-pill">{serviceRows.length} diensten</span>
              ) : null}
              <span className="muted">Een actieve prijslijst per jaar.</span>
            </div>
            <div className="editor-actions-group">
              <label className="nested-field">
                <span>Jaar</span>
                <select
                  className="dataset-input"
                  value={String(effectiveSelectedYear)}
                  disabled={lockYear}
                  onChange={(event) => {
                    if (!lockYear) onYearChange(Number(event.target.value));
                  }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nested-field">
                <span>Zoeken</span>
                <input
                  className="dataset-input"
                  type="text"
                  value={sellFilter}
                  onChange={(event) => onFilterChange(event.target.value)}
                  placeholder="Zoek bier of product..."
                />
              </label>
            </div>
          </div>

          <div className="editor-actions" style={{ marginTop: 12, marginBottom: 12 }}>
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={() => onSetOpenPriceGroups(allPriceGroupsOpen)}>
                Alles openen
              </button>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => onSetOpenPriceGroups({})}>
                Alles sluiten
              </button>
            </div>
          </div>

          {groupedBeerRows.length === 0 ? (
            <div className="dataset-empty" style={{ padding: "1rem" }}>
              Geen verkoopbare SKU&apos;s gevonden voor {effectiveSelectedYear}.
            </div>
          ) : (
            <div className="wizard-stack">
              {groupedBeerRows.map((group) => {
                const isOpen = openPriceGroups[group.biernaam] ?? false;
                return (
                  <section key={group.biernaam} className="module-card compact-card">
                    <button
                      type="button"
                      className="module-card-title"
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        textAlign: "left",
                      }}
                      aria-expanded={isOpen}
                      onClick={() => onTogglePriceGroup(group.biernaam)}
                    >
                      <span>{isOpen ? "v" : ">"} {group.biernaam}</span>
                      <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
                    </button>

                    {isOpen ? (
                      <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                        <table className="dataset-editor-table">
                          <caption className="sr-only">Verkoopprijzen voor {group.biernaam} in {effectiveSelectedYear}</caption>
                          <thead>
                            <tr>
                              <th>Artikel</th>
                              <th>Kostprijs</th>
                              <th>Lijstprijs {effectiveSelectedYear}</th>
                              <th>Opslag</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => {
                              const price = getSalesStrategyListPrice(row);
                              const opslag = getSalesStrategyListOpslag(row);
                              const statusOk = price > row.kostprijs && price > 0;
                              const priceSource = row.sellInPriceSources?.list ?? "opslag";
                              const statusLabel =
                                priceSource === "derived"
                                  ? "afgeleid"
                                  : priceSource === "explicit"
                                    ? "prijs gezet"
                                    : statusOk
                                      ? "opslag"
                                      : "prijs ontbreekt";
                              return (
                                <tr key={`${row.bierId}::${row.productId}`}>
                                  <td>
                                    <strong>{row.product}</strong>
                                    <div className="muted">{row.productId}</div>
                                  </td>
                                  <td>{money(row.kostprijs)}</td>
                                  <td>
                                    <input
                                      className={inputClass(false)}
                                      type="number"
                                      step="0.01"
                                      aria-label={`Lijstprijs ${effectiveSelectedYear} voor ${row.biernaam} - ${row.product}`}
                                      value={price || ""}
                                      onChange={(event) =>
                                        onListPriceChange(
                                          row,
                                          event.target.value === "" ? "" : parseNumberLoose(event.target.value)
                                        )
                                      }
                                      style={{ maxWidth: 140 }}
                                    />
                                  </td>
                                  <td>{opslag.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                                  <td>
                                    <span className={`status-pill ${statusOk ? "status-ok" : "status-warning"}`}>
                                      {statusLabel}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}

          {serviceRows.length > 0 ? (
            <div className="module-card compact-card" style={{ marginTop: "1rem" }}>
              <div className="module-card-title">Dienstverlening (uurtarieven)</div>
              <div className="module-card-text">
                Diensten hebben een vast tarief (ex) en worden niet via opslag% per kanaal berekend.
                Pas het tarief aan via Producten &amp; verpakking → Samenstellen.
              </div>
              <div className="dataset-editor-scroll" style={{ marginTop: 12, borderRadius: 12 }}>
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th>UoM</th>
                      <th>Tarief (ex)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceRows.map((row) => (
                      <tr key={row.skuId}>
                        <td>{row.label}</td>
                        <td>{row.uom}</td>
                        <td>{row.manualRateEx.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="editor-actions">
            <div className="editor-actions-group" />
            <div className="editor-actions-group">
              {actionStatus ? <ActionStatus {...actionStatus} /> : null}
              {mode === "draft" && hasPendingServerUpdate ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={onReloadDraft}
                  disabled={isSaving}
                >
                  Herlaad
                </button>
              ) : null}
              <button type="button" className="editor-button" onClick={onSave} disabled={isSaving}>
                {isSaving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
