"use client";

import { toNumber, type PackagingLine } from "@/features/sku-composition/skuCompositionUtils";

type Option = { value: string; label: string };

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  mode: FlowMode;
  sellableKind: SellableKind;

  uom: "stuk" | "pakket" | "uur" | "doos" | "fust";
  setUom: (next: Props["uom"]) => void;

  contentLiter: number;
  setContentLiter: (next: number) => void;

  manualRateEx: number;
  setManualRateEx: (next: number) => void;

  packaging: PackagingLine[];
  setPackaging: (updater: (current: PackagingLine[]) => PackagingLine[]) => void;
  packagingOptions: Option[];
};

export function StepExtras(props: Props) {
  return (
    <div className="wizard-form-grid">
      {props.mode === "verkoopbaar" ? (
        <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
          <span>Eenheid</span>
          <select className="dataset-input" value={props.uom} onChange={(e) => props.setUom(e.target.value as any)}>
            <option value="stuk">stuk</option>
            <option value="pakket">pakket</option>
            <option value="uur">uur</option>
          </select>
        </label>
      ) : (
        <>
          <label className="nested-field">
            <span>Eenheid</span>
            <select className="dataset-input" value={props.uom} onChange={(e) => props.setUom(e.target.value as any)}>
              <option value="stuk">stuk</option>
              <option value="doos">doos</option>
              <option value="fust">fust</option>
            </select>
          </label>
          <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
            <span>Inhoud (L) (optioneel, anders afgeleid)</span>
            <input className="dataset-input" type="number" step="any" value={String(props.contentLiter)} onChange={(e) => props.setContentLiter(toNumber(e.target.value, 0))} />
          </label>
        </>
      )}

      {props.mode === "verkoopbaar" && props.sellableKind === "dienst" ? (
        <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
          <span>Tarief (ex) per uur</span>
          <input className="dataset-input" type="number" step="any" value={String(props.manualRateEx)} onChange={(e) => props.setManualRateEx(toNumber(e.target.value, 0))} />
        </label>
      ) : null}

      {props.mode === "verkoopbaar" ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="content-card-title" style={{ marginBottom: 8 }}>
            Extra verpakking
          </div>
          {props.packaging.map((line) => (
            <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 10, marginBottom: 10 }}>
              <select
                className="dataset-input"
                value={line.componentId}
                onChange={(e) => props.setPackaging((current) => current.map((row) => (row.id === line.id ? { ...row, componentId: e.target.value } : row)))}
              >
                <option value="">Kies verpakking…</option>
                {props.packagingOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <input
                className="dataset-input"
                type="number"
                min={0}
                value={String(line.qty)}
                onChange={(e) => props.setPackaging((current) => current.map((row) => (row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row)))}
              />
              <button type="button" className="icon-button-table" onClick={() => props.setPackaging((current) => current.filter((row) => row.id !== line.id))}>
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              props.setPackaging((current) => [...current, { id: `p-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: "packaging_component", componentId: "", qty: 1 }])
            }
          >
            Verpakking toevoegen
          </button>
        </div>
      ) : null}
    </div>
  );
}

