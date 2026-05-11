"use client";

import { toNumber, type CompositionLine, type PackagingLine } from "@/features/sku-composition/skuCompositionUtils";

type Option = { value: string; label: string; contentLiter?: number };

type FlowMode = "afvuleenheid" | "verkoopbaar";
type SellableKind = "product" | "dienst";

type Props = {
  mode: FlowMode;
  sellableKind: SellableKind;

  name: string;
  setName: (next: string) => void;

  composition: CompositionLine[];
  setComposition: (updater: (current: CompositionLine[]) => CompositionLine[]) => void;
  selectableSkuOptions: Option[];

  afvulParts: PackagingLine[];
  setAfvulParts: (updater: (current: PackagingLine[]) => PackagingLine[]) => void;
  formatOptions: Option[];
  packagingOptions: Option[];
};

export function StepSamenstelling(props: Props) {
  const { mode, sellableKind } = props;

  return (
    <div className="wizard-form-grid">
      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Naam</span>
        <input className="dataset-input" value={props.name} onChange={(e) => props.setName(e.target.value)} />
      </label>

      {mode === "verkoopbaar" ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="content-card-title" style={{ marginBottom: 8 }}>
            Items
          </div>
          {props.composition.map((line) => (
            <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 10, marginBottom: 10 }}>
              <select
                className="dataset-input"
                value={line.componentSkuId}
                onChange={(e) =>
                  props.setComposition((current) => current.map((row) => (row.id === line.id ? { ...row, componentSkuId: e.target.value } : row)))
                }
              >
                <option value="">Kies item…</option>
                {props.selectableSkuOptions
                  .filter((opt) => opt.value === line.componentSkuId || !props.composition.some((row) => row.id !== line.id && row.componentSkuId === opt.value))
                  .map((opt) => (
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
                onChange={(e) =>
                  props.setComposition((current) => current.map((row) => (row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row)))
                }
              />
              <button type="button" className="icon-button-table" onClick={() => props.setComposition((current) => current.filter((row) => row.id !== line.id))}>
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="editor-button editor-button-secondary"
            disabled={sellableKind === "dienst"}
            title={sellableKind === "dienst" ? "Diensten hebben geen samenstelling." : ""}
            onClick={() =>
              props.setComposition((current) => [...current, { id: `c-${Date.now()}-${Math.random().toString(16).slice(2)}`, componentSkuId: "", qty: 1 }])
            }
          >
            Item toevoegen
          </button>
        </div>
      ) : (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="content-card-title" style={{ marginBottom: 8 }}>
            Verpakkingsonderdelen
          </div>

          {props.afvulParts.map((line) => (
            <div key={line.id} style={{ display: "grid", gridTemplateColumns: "160px 1fr 120px 40px", gap: 10, marginBottom: 10 }}>
              <select
                className="dataset-input"
                value={line.kind}
                onChange={(e) => props.setAfvulParts((current) => current.map((row) => (row.id === line.id ? { ...row, kind: e.target.value as any, componentId: "" } : row)))}
              >
                <option value="format">Afvuleenheid</option>
                <option value="packaging_component">Verpakkingsonderdeel</option>
              </select>

              <select
                className="dataset-input"
                value={line.componentId}
                onChange={(e) => props.setAfvulParts((current) => current.map((row) => (row.id === line.id ? { ...row, componentId: e.target.value } : row)))}
              >
                <option value="">{line.kind === "format" ? "Kies afvuleenheid…" : "Kies onderdeel…"}</option>
                {(line.kind === "format" ? props.formatOptions : props.packagingOptions).map((opt) => (
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
                onChange={(e) => props.setAfvulParts((current) => current.map((row) => (row.id === line.id ? { ...row, qty: toNumber(e.target.value, 0) } : row)))}
              />

              <button type="button" className="icon-button-table" onClick={() => props.setAfvulParts((current) => current.filter((row) => row.id !== line.id))}>
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() =>
              props.setAfvulParts((current) => [...current, { id: `ap-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind: "packaging_component", componentId: "", qty: 1 }])
            }
          >
            Onderdeel toevoegen
          </button>
        </div>
      )}
    </div>
  );
}

