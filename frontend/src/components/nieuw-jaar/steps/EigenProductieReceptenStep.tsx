"use client";

import type { ReactNode } from "react";

type GenericRecord = Record<string, unknown>;

type EigenProductieBier = {
  bierId: string;
  biernaam: string;
  stijl: string;
  alcoholpercentage: number;
};

type IngredientRule = {
  id: string;
  ingredient: string;
  omschrijving: string;
  hoeveelheid: number;
  eenheid: string;
  prijs: number;
  benodigd_in_recept: number;
};

type EigenProductieOverride = {
  alcoholpercentage: number;
  tarief_accijns: "Hoog" | "Laag";
  ingredienten: IngredientRule[];
};

type EigenProductieTotals = {
  leveranciersTotaal: number;
  receptTotaal: number;
  literPrijs: number;
};

type EigenProductieReceptenStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;

  eigenProductieBieren: EigenProductieBier[];
  sourceEigenProductieVersionByBierId: Map<string, GenericRecord>;
  ensureEigenOverride: (bierId: string) => EigenProductieOverride;
  updateEigenOverride: (bierId: string, patch: Partial<EigenProductieOverride>) => void;
  updateEigenIngredient: (bierId: string, ingredientId: string, patch: Partial<IngredientRule>) => void;
  deleteEigenIngredient: (bierId: string, ingredientId: string) => void;
  addEigenIngredient: (bierId: string) => void;

  getProductieForYear: (year: number) => GenericRecord;
  computeEigenProductieReceptTotals: (override: EigenProductieOverride, batchGrootte: number) => EigenProductieTotals;
  calculateEigenProductieKostenRecept: (regel: IngredientRule) => number;
};

export function EigenProductieReceptenStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  eigenProductieBieren,
  sourceEigenProductieVersionByBierId,
  ensureEigenOverride,
  updateEigenOverride,
  updateEigenIngredient,
  deleteEigenIngredient,
  addEigenIngredient,
  getProductieForYear,
  computeEigenProductieReceptTotals,
  calculateEigenProductieKostenRecept,
}: EigenProductieReceptenStepProps) {
  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Recepten {targetYear}</div>
        <div className="module-card-text">
          Pas hier voor bieren met <strong>eigen productie</strong> de doeljaar-gegevens aan. Bij afronden en daarna activeren
          worden deze instellingen de nieuwe waarheid voor {targetYear} (oude activaties voor {targetYear} worden dan gedeactiveerd).
        </div>
      </div>

      {eigenProductieBieren.length === 0 ? (
        <div className="editor-status" style={{ marginBottom: 14 }}>
          Geen bieren met eigen productie gevonden in bronjaar {sourceYear}.
        </div>
      ) : null}

      {eigenProductieBieren.map((bier) => {
        const bierId = bier.bierId;
        const sourceVersion = sourceEigenProductieVersionByBierId.get(bierId);
        const sourceBasis =
          typeof sourceVersion?.basisgegevens === "object" && sourceVersion?.basisgegevens ? sourceVersion.basisgegevens : {};
        const sourceAlcohol = Number((sourceBasis as any)?.alcoholpercentage ?? bier.alcoholpercentage ?? 0) || 0;
        const sourceTarief = String((sourceBasis as any)?.tarief_accijns ?? "Hoog") === "Laag" ? "Laag" : "Hoog";

        const override = ensureEigenOverride(bierId);
        const batchGrootte = Number((getProductieForYear(targetYear) as any)?.batchgrootte_eigen_productie_l ?? 0);
        const totals = computeEigenProductieReceptTotals(override, batchGrootte);

        return (
          <div key={bierId} className="module-card compact-card" style={{ marginBottom: 14 }}>
            <div className="module-card-title">{bier.biernaam}</div>
            <div className="module-card-text">
              {bier.stijl ? `${bier.stijl} Â· ` : ""}bronjaar {sourceYear} (read-only) links, doeljaar {targetYear} rechts.
            </div>

            <div className="data-table" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "280px" }}>Veld</th>
                    <th style={{ width: "220px" }}>Bronjaar {sourceYear}</th>
                    <th style={{ width: "220px" }}>Doeljaar {targetYear}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Alcoholpercentage</td>
                    <td>
                      <input className="dataset-input dataset-input-readonly" type="number" value={String(sourceAlcohol)} readOnly />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        value={String(Number(override.alcoholpercentage ?? 0))}
                        onChange={(event) => updateEigenOverride(bierId, { alcoholpercentage: Number(event.target.value) })}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Accijnstarief</td>
                    <td>
                      <input className="dataset-input dataset-input-readonly" type="text" value={sourceTarief} readOnly />
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={override.tarief_accijns}
                        onChange={(event) =>
                          updateEigenOverride(bierId, { tarief_accijns: event.target.value === "Laag" ? "Laag" : "Hoog" })
                        }
                      >
                        <option value="Hoog">Hoog</option>
                        <option value="Laag">Laag</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="stats-grid wizard-stats-grid" style={{ marginTop: 14, marginBottom: 14 }}>
              <div className="stat-card">
                <div className="stat-label">Leveranciersprijzen</div>
                <div className="stat-value small">{formatEur(totals.leveranciersTotaal)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Receptkosten</div>
                <div className="stat-value small">{formatEur(totals.receptTotaal)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Batchgrootte (L)</div>
                <div className="stat-value small">{batchGrootte > 0 ? String(batchGrootte) : "-"}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Literprijs</div>
                <div className="stat-value small">{batchGrootte > 0 ? formatEur(totals.literPrijs) : "-"}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Ingredienten</div>
                <div className="stat-value small">{String((override.ingredienten ?? []).length)}</div>
              </div>
            </div>

            <div className="dataset-editor-scroll">
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Omschrijving</th>
                    <th>Inhoud verpakking</th>
                    <th>Eenheid</th>
                    <th>Leveranciersprijs</th>
                    <th>Hoeveel in recept</th>
                    <th>Kosten recept</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(override.ingredienten ?? []).length === 0 ? (
                    <tr>
                      <td className="dataset-empty" colSpan={8}>
                        Nog geen ingredienten. Voeg een regel toe.
                      </td>
                    </tr>
                  ) : null}
                  {(override.ingredienten ?? []).map((regel) => (
                    <tr key={regel.id}>
                      <td>
                        <input
                          className="dataset-input"
                          value={regel.ingredient ?? ""}
                          onChange={(event) => updateEigenIngredient(bierId, regel.id, { ingredient: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          value={regel.omschrijving ?? ""}
                          onChange={(event) => updateEigenIngredient(bierId, regel.id, { omschrijving: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          value={String(Number(regel.hoeveelheid ?? 0))}
                          onChange={(event) => updateEigenIngredient(bierId, regel.id, { hoeveelheid: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          value={regel.eenheid ?? ""}
                          onChange={(event) => updateEigenIngredient(bierId, regel.id, { eenheid: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          value={String(Number(regel.prijs ?? 0))}
                          onChange={(event) => updateEigenIngredient(bierId, regel.id, { prijs: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          value={String(Number(regel.benodigd_in_recept ?? 0))}
                          onChange={(event) =>
                            updateEigenIngredient(bierId, regel.id, { benodigd_in_recept: Number(event.target.value) })
                          }
                        />
                      </td>
                      <td>{formatEur(calculateEigenProductieKostenRecept(regel))}</td>
                      <td>
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => deleteEigenIngredient(bierId, regel.id)}
                          disabled={isRunning}
                        >
                          Verwijderen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="editor-actions" style={{ marginTop: 10 }}>
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => addEigenIngredient(bierId)}
                  disabled={isRunning}
                >
                  IngrediÃ«nt toevoegen
                </button>
              </div>
              <div className="editor-actions-group" />
            </div>
          </div>
        );
      })}

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void navigateToStep(6)} disabled={isRunning}>
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(8)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}

