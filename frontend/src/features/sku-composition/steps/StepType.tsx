"use client";

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  mode: FlowMode;
  sellableKind: SellableKind;
  onModeChange: (next: FlowMode) => void;
  onSellableKindChange: (next: SellableKind) => void;
};

export function StepType(props: Props) {
  return (
    <div className="wizard-form-grid">
      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Wat wil je maken?</span>
        <select className="dataset-input" value={props.mode} onChange={(e) => props.onModeChange(e.target.value as FlowMode)}>
          <option value="afvuleenheid">Afvuleenheid</option>
          <option value="verkoopbaar">Verkoopbaar artikel</option>
        </select>
      </label>

      {props.mode === "verkoopbaar" ? (
        <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
          <span>Soort</span>
          <select className="dataset-input" value={props.sellableKind} onChange={(e) => props.onSellableKindChange(e.target.value as SellableKind)}>
            <option value="product">Product</option>
            <option value="dienst">Dienstverlening</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

