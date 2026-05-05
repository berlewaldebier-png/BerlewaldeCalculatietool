"use client";

import { formatMoneyEUR } from "@/lib/formatters";
import { toNumber } from "@/components/article-kostprijs/articleKostprijsWizardUtils";
import type { BomCostLine, Summary } from "@/components/article-kostprijs/articleKostprijsWizardDerivations";

export function ArticleKostprijsBasisStep(props: {
  selectedYear: number;
  onSelectedYearChange: (nextYear: number) => void;
  selectedBundleSkuId: string;
  onSelectedBundleSkuIdChange: (nextSkuId: string) => void;
  bundleOptions: Array<{ skuId: string; label: string }>;
}) {
  return (
    <div className="wizard-form-grid">
      <label className="nested-field">
        <span>Jaar</span>
        <input
          className="dataset-input"
          type="number"
          value={String(props.selectedYear)}
          onChange={(e) => props.onSelectedYearChange(toNumber(e.target.value, props.selectedYear))}
        />
      </label>
      <label className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Artikel</span>
        <select
          className="dataset-input"
          value={props.selectedBundleSkuId}
          onChange={(e) => props.onSelectedBundleSkuIdChange(String(e.target.value))}
        >
          {props.bundleOptions.map((opt) => (
            <option key={opt.skuId} value={opt.skuId}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function ArticleKostprijsSamenstellingStep(props: { bomCostLines: BomCostLine[] }) {
  return (
    <div className="dataset-editor-scroll">
      <table className="dataset-editor-table">
        <thead>
          <tr>
            <th>Onderdeel</th>
            <th>Aantal</th>
            <th style={{ whiteSpace: "nowrap" }}>Productkosten</th>
            <th style={{ whiteSpace: "nowrap" }}>Verpakkingskosten</th>
            <th style={{ whiteSpace: "nowrap" }}>Opslag direct/indirect</th>
            <th style={{ whiteSpace: "nowrap" }}>Accijnzen (totaal)</th>
            <th style={{ whiteSpace: "nowrap" }}>Kostprijs</th>
          </tr>
        </thead>
        <tbody>
          {props.bomCostLines.length > 0 ? (
            props.bomCostLines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.label}
                  {line.warnings.length > 0 ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      {line.warnings.join(" ")}
                    </div>
                  ) : null}
                </td>
                <td>{line.qty}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.productkosten)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.verpakkingskosten)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.opslag)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.accijnzen)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(line.kostprijs)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={7} className="dataset-empty">
                Geen samenstelling gevonden voor dit artikel.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ArticleKostprijsSamenvattingStep(props: { selectedLabel: string; summary: Summary }) {
  return (
    <div>
      {props.summary.warnings.length > 0 ? (
        <div className="editor-status" style={{ marginBottom: 12 }}>
          {props.summary.warnings.slice(0, 4).join(" ")}
        </div>
      ) : null}
      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th>Artikel</th>
              <th style={{ whiteSpace: "nowrap" }}>Productkosten</th>
              <th style={{ whiteSpace: "nowrap" }}>Verpakkingskosten</th>
              <th style={{ whiteSpace: "nowrap" }}>Opslag direct/indirect</th>
              <th style={{ whiteSpace: "nowrap" }}>Accijnzen (totaal)</th>
              <th style={{ whiteSpace: "nowrap" }}>Kostprijs</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{props.selectedLabel}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(props.summary.productkosten)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(props.summary.verpakkingskosten)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(props.summary.opslag)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(props.summary.accijnzen)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatMoneyEUR(props.summary.kostprijs)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

