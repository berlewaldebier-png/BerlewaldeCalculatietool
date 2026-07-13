"use client";

import type { ReactNode } from "react";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react";

type HerverdelingTotals = {
  directAfter: number;
  directOut: number;
  indirectAfter: number;
  indirectOut: number;
  redistributedTotal: number;
};

type SourceVasteKostenRow = {
  key: string;
  omschrijving: string;
  kostensoort: string;
  exact_rekening: string;
  cost_pool: string;
  domain: string;
  allocation_driver: string;
  allocation_scope: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
};

type VasteKostenUiRow = {
  uiId: string;
  omschrijving: string;
  kostensoort: string;
  exact_rekening: string;
  cost_pool: string;
  domain: string;
  allocation_driver: string;
  allocation_scope: string;
  bedrag_per_jaar: number;
  herverdeel_pct: number;
  ignored: boolean;
  isNew: boolean;
};

type PlanTargets = {
  fixed_cost_inflation_pct?: number;
};

type VasteKostenTargetsStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;

  sourceVasteKostenRows: SourceVasteKostenRow[];
  draftVasteKostenTarget: VasteKostenUiRow[];
  draftPlanTargets: PlanTargets;
  sourceYearCloseReference?: Record<string, number>;

  updateVasteKostenRow: (uiId: string, patch: Partial<VasteKostenUiRow>) => void;
  updatePlanTargets: (patch: Partial<PlanTargets>) => void;
  removeVasteKostenRow: (uiId: string) => void;
  addVasteKostenRow: () => void;

  fixedCostRowsForYear: (year: number) => Array<Record<string, unknown>>;
  computeHerverdelingTotals: (rows: Array<Record<string, unknown>>) => HerverdelingTotals;
  formatEur: (value: number) => string;

  saveDraftToServer: (message?: string) => Promise<unknown> | unknown;
};

export function VasteKostenTargetsStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  sourceVasteKostenRows,
  draftVasteKostenTarget,
  draftPlanTargets,
  sourceYearCloseReference,
  updateVasteKostenRow,
  updatePlanTargets,
  removeVasteKostenRow,
  addVasteKostenRow,
  fixedCostRowsForYear,
  computeHerverdelingTotals,
  formatEur,
  saveDraftToServer,
}: VasteKostenTargetsStepProps) {
  const inflationPct = Number(draftPlanTargets.fixed_cost_inflation_pct ?? 0);

  function applyInflation() {
    const pct = Number(inflationPct || 0);
    if (!Number.isFinite(pct)) return;

    const existingDraftRows = draftVasteKostenTarget.filter((row) => !row.isNew);
    existingDraftRows.forEach((row, index) => {
      if (row.ignored) return;
      const sourceRow = sourceVasteKostenRows[index];
      if (!sourceRow) return;
      updateVasteKostenRow(row.uiId, { bedrag_per_jaar: Number((sourceRow.bedrag_per_jaar * (1 + pct / 100)).toFixed(2)) });
    });
  }

  function resetToSourceYear() {
    const ok = confirm(
      `Vaste kosten terugzetten naar ${sourceYear}?\n\nAlle bestaande doeljaarregels worden teruggezet naar de waarden en ABC-instellingen van ${sourceYear}. Nieuwe toegevoegde regels blijven staan.`
    );
    if (!ok) return;

    const existingDraftRows = draftVasteKostenTarget.filter((row) => !row.isNew);
    existingDraftRows.forEach((row, index) => {
      const sourceRow = sourceVasteKostenRows[index];
      if (!sourceRow) return;
      updateVasteKostenRow(row.uiId, {
        kostensoort: sourceRow.kostensoort,
        exact_rekening: sourceRow.exact_rekening,
        cost_pool: sourceRow.cost_pool,
        domain: sourceRow.domain || "production",
        allocation_driver: sourceRow.allocation_driver,
        allocation_scope: sourceRow.allocation_scope || "all",
        bedrag_per_jaar: Number(sourceRow.bedrag_per_jaar ?? 0),
        herverdeel_pct: Number(sourceRow.herverdeel_pct ?? 0),
        ignored: false,
      });
    });
  }

  function confirmIgnore(row: VasteKostenUiRow, nextIgnored: boolean) {
    if (nextIgnored) {
      const ok = confirm(
        `Vaste kostenregel negeren?\n\n${row.omschrijving}\n\nDeze regel telt dan niet mee voor ${targetYear}. Controleer dat deze kosten ook niet alsnog terugkomen in Exact of via een andere boeking.`
      );
      if (!ok) return;
    }
    updateVasteKostenRow(row.uiId, { ignored: nextIgnored });
  }

  function confirmDelete(row: VasteKostenUiRow) {
    const ok = confirm(`Nieuwe vaste-kostenregel verwijderen?\n\n${row.omschrijving || "(lege regel)"}`);
    if (!ok) return;
    removeVasteKostenRow(row.uiId);
  }

  function metadataCells(row: VasteKostenUiRow) {
    return (
      <>
        <td>
          <select
            className="dataset-input"
            value={row.kostensoort}
            disabled={row.ignored}
            onChange={(event) => updateVasteKostenRow(row.uiId, { kostensoort: event.target.value })}
          >
            <option value="">Kies...</option>
            <option value="Indirecte kosten">Indirecte kosten</option>
            <option value="Directe kosten">Directe kosten</option>
          </select>
        </td>
        <td>
          <input
            className="dataset-input"
            value={row.cost_pool ?? ""}
            disabled={row.ignored}
            onChange={(event) => updateVasteKostenRow(row.uiId, { cost_pool: event.target.value })}
            placeholder="Pool"
          />
        </td>
        <td>
          <select
            className="dataset-input"
            value={row.domain || "production"}
            disabled={row.ignored}
            onChange={(event) => updateVasteKostenRow(row.uiId, { domain: event.target.value })}
          >
            <option value="production">Productie</option>
            <option value="sales">Sales</option>
          </select>
        </td>
        <td>
          <select
            className="dataset-input"
            value={row.allocation_driver ?? ""}
            disabled={row.ignored}
            onChange={(event) => updateVasteKostenRow(row.uiId, { allocation_driver: event.target.value })}
          >
            <option value="">(legacy / geen driver)</option>
            <option value="ALL_LITERS">Alle liters</option>
            <option value="PURCHASED_LITERS">Inkoop liters</option>
            <option value="OWN_PRODUCTION_LITERS">Eigen productie liters</option>
            <option value="CONTRACT_BREW_LITERS">Contract brew liters</option>
            <option value="SHIPMENTS">Shipments</option>
            <option value="PICKS_OR_ORDER_LINES">Orderregels/picks</option>
          </select>
        </td>
        <td>
          <select
            className="dataset-input"
            value={row.allocation_scope || "all"}
            disabled={row.ignored}
            onChange={(event) => updateVasteKostenRow(row.uiId, { allocation_scope: event.target.value })}
          >
            <option value="all">Alle SKU's</option>
            <option value="purchased">Alleen inkoop</option>
            <option value="own_production">Alleen eigen productie</option>
            <option value="contract_brew">Alleen contract brew</option>
          </select>
        </td>
      </>
    );
  }

  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        Links zie je de vaste kosten van bronjaar {sourceYear} (read-only). Rechts vul je de vaste kosten voor doeljaar{" "}
        {targetYear} in.
      </div>

      {sourceYearCloseReference ? (
        <div className="placeholder-block" style={{ marginBottom: 14 }}>
          <strong>Afgesloten vaste-kosten referentie {sourceYear}</strong>
          <div className="muted" style={{ marginTop: 8 }}>
            De jaarafsluiting gebruikt vaste kosten als definitieve drempel voor het resultaat. Gebruik dit bedrag om te beoordelen
            of de target vaste kosten voor {targetYear} nog realistisch zijn.
          </div>
          <div className="record-card-grid" style={{ marginTop: 12 }}>
            <div className="wizard-toggle-card"><span><strong>Vaste kosten afsluiting</strong><small>{formatEur(sourceYearCloseReference.fixedCost ?? 0)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>ABC in kostprijsregels</strong><small>{formatEur(sourceYearCloseReference.fixedAlloc ?? 0)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Operationeel resultaat</strong><small>{formatEur((sourceYearCloseReference.contribution ?? 0) - (sourceYearCloseReference.fixedCost ?? 0))}</small></span></div>
          </div>
        </div>
      ) : null}

      <div className="placeholder-block" style={{ marginBottom: 14 }}>
        <strong>Inflatie toepassen</strong>
        <div className="muted" style={{ marginTop: 8 }}>
          Vul een verwacht percentage in om alle bestaande doeljaarregels te verhogen op basis van {sourceYear}. Nieuwe regels
          en genegeerde regels blijven ongemoeid; daarna kun je elke regel handmatig aanpassen.
        </div>
        <div className="editor-actions" style={{ marginTop: 10, padding: 0 }}>
          <div className="editor-actions-group">
            <input
              className="dataset-input"
              type="number"
              step="0.1"
              style={{ width: 160 }}
              placeholder="bijv. 2.5"
              value={String(inflationPct || "")}
              onChange={(event) => updatePlanTargets({ fixed_cost_inflation_pct: Number(event.target.value) })}
              aria-label="Verwachte inflatie in procent"
            />
            <button type="button" className="editor-button editor-button-secondary" onClick={applyInflation}>
              Toepassen
            </button>
          </div>
        </div>
      </div>

      <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "120px" }}>Jaar</th>
              <th style={{ width: "220px" }}>Directe kosten</th>
              <th style={{ width: "220px" }}>Indirecte kosten</th>
              <th style={{ width: "220px" }}>Totale kosten</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sourceTotals = computeHerverdelingTotals(fixedCostRowsForYear(sourceYear));
              const targetTotals = computeHerverdelingTotals(fixedCostRowsForYear(targetYear));
              return [
                { year: targetYear, totals: targetTotals },
                { year: sourceYear, totals: sourceTotals },
              ].map(({ year, totals }) => (
                <tr key={String(year)}>
                  <td>
                    <strong>{year}</strong>
                  </td>
                  <td>
                    {formatEur(totals.directAfter)}{" "}
                    <span className="muted">(herverdeeld uit direct: {formatEur(totals.directOut)})</span>
                  </td>
                  <td>
                    {formatEur(totals.indirectAfter)}{" "}
                    <span className="muted">(herverdeeld uit indirect: {formatEur(totals.indirectOut)})</span>
                  </td>
                  <td>
                    {formatEur(totals.directAfter + totals.indirectAfter)}{" "}
                    <span className="muted">(totaal herverdeeld: {formatEur(totals.redistributedTotal)})</span>
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      <div className="dataset-editor-scroll" style={{ marginBottom: 14 }}>
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "320px" }}>Omschrijving</th>
              <th style={{ width: "170px" }}>Kosten {sourceYear}</th>
              <th style={{ width: "150px" }}>Herverdelen %</th>
              <th style={{ width: "180px" }}>Exact rekening</th>
              <th style={{ width: "180px" }}>Kostensoort</th>
              <th style={{ width: "180px" }}>Pool</th>
              <th style={{ width: "140px" }}>Domein</th>
              <th style={{ width: "190px" }}>Driver</th>
              <th style={{ width: "160px" }}>Scope</th>
              <th style={{ width: "170px" }}>Kosten {targetYear}</th>
              <th style={{ width: "170px" }}>Herverdelen % {targetYear}</th>
              <th style={{ width: "96px" }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const existingDraftRows = draftVasteKostenTarget.filter((row) => !row.isNew);

              return sourceVasteKostenRows.map((srcRow, idx) => {
                const draftRow = existingDraftRows[idx];

                if (!draftRow) {
                  return (
                    <tr key={`${srcRow.key}-${idx}`}>
                      <td>{srcRow.omschrijving}</td>
                      <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                      <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                      <td className="muted">-</td>
                      <td>{srcRow.kostensoort}</td>
                      <td>{srcRow.cost_pool || <span className="muted">-</span>}</td>
                      <td>{srcRow.domain || <span className="muted">-</span>}</td>
                      <td>{srcRow.allocation_driver || <span className="muted">-</span>}</td>
                      <td>{srcRow.allocation_scope || <span className="muted">-</span>}</td>
                      <td className="muted">-</td>
                      <td className="muted">-</td>
                      <td className="muted">-</td>
                    </tr>
                  );
                }

                return (
                  <tr key={draftRow.uiId}>
                    <td>{srcRow.omschrijving}</td>
                    <td>{formatEur(srcRow.bedrag_per_jaar)}</td>
                    <td>{String(Number(srcRow.herverdeel_pct ?? 0))}</td>
                    <td>
                      <input
                        className="dataset-input"
                        value={draftRow.exact_rekening ?? ""}
                        onChange={(event) => updateVasteKostenRow(draftRow.uiId, { exact_rekening: event.target.value })}
                        placeholder="bijv. 4300, 4400"
                      />
                    </td>
                    {metadataCells(draftRow)}
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        value={String(Number(draftRow.bedrag_per_jaar ?? 0))}
                        disabled={draftRow.ignored}
                        onChange={(event) =>
                          updateVasteKostenRow(draftRow.uiId, { bedrag_per_jaar: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        value={String(Number(draftRow.herverdeel_pct ?? 0))}
                        disabled={draftRow.ignored}
                        onChange={(event) =>
                          updateVasteKostenRow(draftRow.uiId, { herverdeel_pct: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button-table"
                        title={draftRow.ignored ? "Weer meenemen" : "Negeren voor doeljaar"}
                        aria-label={draftRow.ignored ? "Vaste-kostenregel weer meenemen" : "Vaste-kostenregel negeren"}
                        onClick={() => confirmIgnore(draftRow, !draftRow.ignored)}
                      >
                        {draftRow.ignored ? <RotateCcw size={15} /> : <EyeOff size={15} />}
                      </button>
                    </td>
                  </tr>
                );
              });
            })()}

            {draftVasteKostenTarget
              .filter((row) => row.isNew)
              .map((row) => (
                <tr key={row.uiId}>
                  <td>
                    <input
                      className="dataset-input"
                      value={row.omschrijving}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { omschrijving: event.target.value })}
                    />
                  </td>
                  <td className="muted">0</td>
                  <td className="muted">0</td>
                  <td>
                    <input
                      className="dataset-input"
                      value={row.exact_rekening ?? ""}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { exact_rekening: event.target.value })}
                      placeholder="bijv. 4300, 4400"
                    />
                  </td>
                  {metadataCells(row)}
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(Number(row.bedrag_per_jaar ?? 0))}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { bedrag_per_jaar: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(Number(row.herverdeel_pct ?? 0))}
                      onChange={(event) => updateVasteKostenRow(row.uiId, { herverdeel_pct: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button-table"
                      title="Nieuwe regel verwijderen"
                      aria-label="Nieuwe vaste-kostenregel verwijderen"
                      onClick={() => confirmDelete(row)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}

            {sourceVasteKostenRows.length === 0 &&
            draftVasteKostenTarget.filter((row) => row.isNew).length === 0 ? (
              <tr>
                <td colSpan={12} className="muted">
                  Geen vaste kosten gevonden voor bronjaar {sourceYear}. Voeg een rij toe voor {targetYear}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="editor-actions" style={{ marginTop: 0 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addVasteKostenRow}>
            Rij toevoegen
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={resetToSourceYear}>
            Reset naar {sourceYear}
          </button>
        </div>
        <div className="editor-actions-group" />
      </div>
      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(3)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void saveDraftToServer(`Vaste kosten (concept) voor ${targetYear} opgeslagen.`)}
            disabled={isRunning}
          >
            Opslaan
          </button>
          <button type="button" className="editor-button" onClick={() => void navigateToStep(5)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

