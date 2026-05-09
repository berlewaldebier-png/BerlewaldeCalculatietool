"use client";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

export function StepControle(props: {
  mode: FlowMode;
  sellableKind: SellableKind;
  name: string;
  uom: string;
  totals: { liters: number; cost: number; packagingCost: number; totalCost: number };
  blockingWarnings: string[];
  beheerWarning?: string;
  onGoToBeheer?: () => void;
}) {
  const { mode, sellableKind, name, uom, totals, blockingWarnings, beheerWarning, onGoToBeheer } = props;
  return (
    <div className="wizard-form-grid">
      <div className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Samenvatting</span>
        <div className="dataset-editor-scroll" style={{ borderRadius: 12 }}>
          <table className="dataset-editor-table">
            <thead>
              {mode === "verkoopbaar" && sellableKind === "dienst" ? (
                <tr>
                  <th>Naam</th>
                  <th>UoM</th>
                  <th>Kostprijs item</th>
                  <th>Totaal</th>
                </tr>
              ) : (
                <tr>
                  <th>Naam</th>
                  <th>UoM</th>
                  <th>Liters (afgeleid)</th>
                  <th>Kostprijs items</th>
                  <th>Verpakking</th>
                  <th>Totaal</th>
                </tr>
              )}
            </thead>
            <tbody>
              {mode === "verkoopbaar" && sellableKind === "dienst" ? (
                <tr>
                  <td>{name}</td>
                  <td>{uom}</td>
                  <td>{totals.cost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                  <td>{totals.totalCost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                </tr>
              ) : (
                <tr>
                  <td>{name}</td>
                  <td>{uom}</td>
                  <td>
                    {totals.liters.toLocaleString("nl-NL", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td>{totals.cost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                  <td>{totals.packagingCost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                  <td>{totals.totalCost.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {blockingWarnings.length > 0 ? (
        <div className="editor-status wizard-inline-status" style={{ gridColumn: "1 / -1" }}>
          <strong>Kan niet afronden:</strong> {blockingWarnings.join(" ")}
        </div>
      ) : null}
      {beheerWarning ? (
        <div className="editor-status wizard-inline-status" style={{ gridColumn: "1 / -1" }}>
          <strong>Let op:</strong> {beheerWarning}{" "}
          {onGoToBeheer ? (
            <button type="button" className="cpq-button" style={{ marginLeft: 10 }} onClick={onGoToBeheer}>
              Naar productkoppeling
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

