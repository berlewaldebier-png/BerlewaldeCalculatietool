"use client";

import { CurrencyInput, TrashIcon } from "@/components/berekeningen/BerekeningenWizardParts";

type GenericRecord = Record<string, unknown>;

export function EigenProductieInputStep({
  current,
  rows,
  productie,
  updateCurrent,
  requestDelete,
  createId,
  getIngredientType,
  getYearProduction,
  calculateEigenProductieKostenRecept,
  calculateEigenProductiePrijsPerEenheid,
  formatCurrencyDisplay,
  formatDecimalValue,
}: {
  current: GenericRecord;
  rows: GenericRecord[];
  productie: Record<string, GenericRecord>;
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
  requestDelete: (title: string, body: string, onConfirm: () => void) => void;
  createId: () => string;
  getIngredientType: (row: GenericRecord) => string;
  getYearProduction: (year: number, productie: Record<string, GenericRecord>) => GenericRecord;
  calculateEigenProductieKostenRecept: (regel: GenericRecord) => number;
  calculateEigenProductiePrijsPerEenheid: (regel: GenericRecord) => number;
  formatCurrencyDisplay: (value: number) => string;
  formatDecimalValue: (value: number, digits?: number) => string;
}) {
  const ingredienten =
    ((((current.invoer as GenericRecord).ingredienten as GenericRecord).regels as GenericRecord[]) ??
      []);

  const ingredientOptions = (() => {
    const defaults = [
      "Overig",
      "Mout",
      "Hop",
      "Gist",
      "Suiker",
      "Water",
      "Kruiden",
      "Fruit",
      "Hulpstof"
    ];

    const seen = new Set<string>();
    const push = (value: unknown) => {
      const text = String(value ?? "").trim();
      if (!text) return;
      const normalized = text;
      if (seen.has(normalized)) return;
      seen.add(normalized);
    };

    defaults.forEach((value) => push(value));

    rows.forEach((row) => {
      const regels =
        ((((row.invoer as GenericRecord)?.ingredienten as GenericRecord)?.regels as GenericRecord[]) ?? []);
      regels.forEach((regel) => push(getIngredientType(regel)));
    });

    const items = Array.from(seen);
    const overig = items.find((v) => v.toLowerCase() === "overig");
    const rest = items
      .filter((v) => v.toLowerCase() !== "overig")
      .sort((a, b) => a.localeCompare(b, "nl-NL"));
    return overig ? [overig, ...rest] : rest;
  })();

  const year = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0) || 0);
  const batchGrootte = Number(getYearProduction(year, productie).batchgrootte_eigen_productie_l ?? 0);
  const leveranciersTotaal = ingredienten.reduce((sum, regel) => sum + Number(regel.prijs ?? 0), 0);
  const receptTotaal = ingredienten.reduce((sum, regel) => sum + calculateEigenProductieKostenRecept(regel), 0);
  const literPrijs = batchGrootte > 0 ? receptTotaal / batchGrootte : 0;
  const batchesPossible = ingredienten.reduce((minValue: number | null, regel) => {
    const verpakking = Number(regel.hoeveelheid ?? 0);
    const nodig = Number(regel.benodigd_in_recept ?? 0);
    if (!Number.isFinite(verpakking) || !Number.isFinite(nodig) || verpakking <= 0 || nodig <= 0) return minValue;
    const batches = verpakking / nodig;
    if (!Number.isFinite(batches) || batches <= 0) return minValue ?? 0;
    if (minValue === null) return batches;
    return Math.min(minValue, batches);
  }, null);
  const batchesLabel =
    batchesPossible === null
      ? "-"
      : formatDecimalValue(Math.max(0, batchesPossible), 2);
  const batchesNeedsAttention = (() => {
    if (batchesPossible === null) return false;
    if (!Number.isFinite(batchesPossible)) return false;
    // Highlight whenever it is not (approximately) an integer. This nudges the user to consider
    // optimizing recipe sizes/packaging so ingredients are used efficiently.
    const rounded = Math.round(batchesPossible);
    return Math.abs(batchesPossible - rounded) >= 0.01;
  })();

  return (
    <div className="wizard-stack">
      <div className="stats-grid wizard-stats-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-label">Leveranciersprijzen</div>
          <div className="stat-value small">{formatCurrencyDisplay(leveranciersTotaal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Receptkosten</div>
          <div className="stat-value small">{formatCurrencyDisplay(receptTotaal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Batchgrootte (L)</div>
          <div className="stat-value small">{batchGrootte > 0 ? formatDecimalValue(batchGrootte, 2) : "-"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Literprijs</div>
          <div className="stat-value small">{batchGrootte > 0 ? formatCurrencyDisplay(literPrijs) : "-"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Batches mogelijk</div>
          <div className={`stat-value small${batchesNeedsAttention ? " warning" : ""}`}>{batchesLabel}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ingredienten</div>
          <div className="stat-value small">{String(ingredienten.length)}</div>
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
              <th>Prijs per eenheid</th>
              <th>Kosten recept</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ingredienten.map((regel, index) => (
              <tr key={String(regel.id ?? index)}>
                <td>
                  <select
                    className="dataset-input wizard-unit-select"
                    value={getIngredientType(regel)}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index]["ingredient"] = event.target.value;
                      })
                    }
                  >
                    {(() => {
                      const currentValue = getIngredientType(regel);
                      const options = ingredientOptions.includes(currentValue)
                        ? ingredientOptions
                        : [currentValue, ...ingredientOptions];
                      return options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ));
                    })()}
                  </select>
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="text"
                    value={String(regel.omschrijving ?? "")}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index].omschrijving = event.target.value;
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    step="any"
                    value={String(regel.hoeveelheid ?? "")}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index].hoeveelheid = event.target.value === "" ? null : Number(event.target.value);
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="text"
                    value={String(regel.eenheid ?? "")}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index].eenheid = event.target.value;
                      })
                    }
                  />
                </td>
                <td>
                  <CurrencyInput
                    className="dataset-input"
                    type="number"
                    step="any"
                    value={String(regel.prijs ?? "")}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index].prijs = event.target.value === "" ? null : Number(event.target.value);
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="dataset-input"
                    type="number"
                    step="any"
                    value={String(regel.benodigd_in_recept ?? "")}
                    onChange={(event) =>
                      updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels[index].benodigd_in_recept =
                          event.target.value === "" ? null : Number(event.target.value);
                      })
                    }
                  />
                </td>
                <td>
                  <CurrencyInput
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    step="any"
                    value={formatDecimalValue(calculateEigenProductiePrijsPerEenheid(regel))}
                    readOnly
                  />
                </td>
                <td>
                  <CurrencyInput
                    className="dataset-input dataset-input-readonly"
                    type="number"
                    step="any"
                    value={formatDecimalValue(calculateEigenProductieKostenRecept(regel))}
                    readOnly
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-button-table"
                    aria-label="Ingredientregel verwijderen"
                    title="Verwijderen"
                    onClick={() =>
                      requestDelete("Ingredientregel verwijderen", "Weet je zeker dat je deze ingredientregel wilt verwijderen?", () =>
                        updateCurrent((draft) => {
                        const regels =
                          ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                            .regels as GenericRecord[]) ?? []);
                        regels.splice(index, 1);
                        })
                      )
                    }
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
            {ingredienten.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={9}>
                  Nog geen ingredientregels. Voeg hieronder een regel toe.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="editor-actions">
        <button
          type="button"
          className="editor-button editor-button-secondary"
          onClick={() =>
            updateCurrent((draft) => {
              const regels =
                ((((draft.invoer as GenericRecord).ingredienten as GenericRecord)
                  .regels as GenericRecord[]) ?? []);
              regels.push({
                id: createId(),
                ingredient: "Overig",
                omschrijving: "",
                hoeveelheid: 0,
                eenheid: "KG",
                prijs: 0,
                benodigd_in_recept: 0
              });
            })
          }
        >
          Ingredient toevoegen
        </button>
      </div>
    </div>
  );
}

