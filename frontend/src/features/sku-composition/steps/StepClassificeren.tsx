"use client";

import type { GenericRecord } from "@/features/sku-composition/skuCompositionUtils";

export function StepClassificeren({
  mode,
  sellableKind,
  name,
  uom,
  productGroup,
  alcoholCategory,
  packagingType,
  packagingTypeOptIn,
  productgroepen,
  alcoholcategorieen,
  verpakkingstypen,
  setProductGroup,
  setAlcoholCategory,
  setPackagingType,
  setPackagingTypeOptIn,
}: {
  mode: "afvuleenheid" | "verkoopbaar";
  sellableKind: "product" | "dienst";
  name: string;
  uom: string;
  productGroup: string;
  alcoholCategory: string;
  packagingType: string;
  packagingTypeOptIn: boolean;
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  setProductGroup: (value: string) => void;
  setAlcoholCategory: (value: string) => void;
  setPackagingType: (value: string) => void;
  setPackagingTypeOptIn: (value: boolean) => void;
}) {
  if (mode !== "verkoopbaar") {
    return (
      <div className="wizard-stack">
        <div className="wizard-section">
          <div className="wizard-section-title">Classificeren</div>
          <div className="wizard-section-subtitle">Afvuleenheden hoeven niet geclassificeerd te worden.</div>
        </div>
      </div>
    );
  }

  const productgroepOptions = (Array.isArray(productgroepen) ? productgroepen : [])
    .filter((row) => (row as any)?.active !== false)
    .map((row) => ({ value: String((row as any).id ?? ""), label: String((row as any).label ?? "") }))
    .filter((row) => row.value && row.label);

  const alcoholOptions = (Array.isArray(alcoholcategorieen) ? alcoholcategorieen : [])
    .filter((row) => (row as any)?.active !== false)
    .map((row) => ({ value: String((row as any).id ?? ""), label: String((row as any).label ?? "") }))
    .filter((row) => row.value && row.label);

  const verpakkingstypeOptions = (Array.isArray(verpakkingstypen) ? verpakkingstypen : [])
    .filter((row) => (row as any)?.active !== false)
    .map((row) => ({
      value: String((row as any).id ?? ""),
      label: String((row as any).label ?? ""),
      allowed: Array.isArray((row as any).allowed_product_groups) ? ((row as any).allowed_product_groups as any[]) : [],
    }))
    .filter((row) => row.value && row.label);

  const packagingRequired = productGroup === "drank" || productGroup === "giftset";
  const allowedPackaging = packagingRequired
    ? verpakkingstypeOptions.filter((row) => row.allowed.length === 0 || row.allowed.includes(productGroup))
    : verpakkingstypeOptions;
  const effectivePackagingOptIn = packagingRequired ? true : packagingTypeOptIn;

  return (
    <div className="wizard-stack">
      <div className="wizard-section">
        <div className="wizard-section-title">Classificatie per SKU</div>
        <div className="wizard-section-subtitle">
          Koppel productgroep, alcoholcategorie en verpakkingstype. Dit is leidend voor rapportages en het dashboard.
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table wizard-table-compact">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Productgroep</th>
              <th>Alcoholcategorie</th>
              <th>Verpakkingstype</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>{name || "Nieuw artikel"}</td>
              <td>
                <select
                  className="dataset-input"
                  value={productGroup}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProductGroup(next);
                    const required = next === "drank" || next === "giftset";
                    if (!required) {
                      setPackagingTypeOptIn(false);
                      setPackagingType("");
                    }
                    if (sellableKind === "dienst" && next !== "dienst") {
                      // Keep explicit selection but avoid surprising resets.
                    }
                  }}
                >
                  <option value="">Selecteer…</option>
                  {productgroepOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="dataset-input"
                  value={alcoholCategory}
                  disabled={productGroup !== "drank" && productGroup !== "giftset"}
                  title={productGroup !== "drank" && productGroup !== "giftset" ? "Alleen relevant voor drank/giftset." : ""}
                  onChange={(e) => setAlcoholCategory(e.target.value)}
                >
                  <option value="">—</option>
                  {alcoholOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {packagingRequired ? (
                    <span style={{ fontWeight: 700, opacity: 0.75 }}>verplicht</span>
                  ) : (
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={effectivePackagingOptIn}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setPackagingTypeOptIn(next);
                          if (!next) setPackagingType("");
                        }}
                      />
                      +
                    </label>
                  )}
                  <select
                    className="dataset-input"
                    value={packagingType}
                    disabled={!packagingRequired && !effectivePackagingOptIn}
                    title={!packagingRequired && !effectivePackagingOptIn ? "Optioneel. Zet '+' aan om in te vullen." : ""}
                    onChange={(e) => setPackagingType(e.target.value)}
                  >
                    <option value="">{packagingRequired || effectivePackagingOptIn ? "Selecteer…" : "—"}</option>
                    {allowedPackaging.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={4} style={{ opacity: 0.7 }}>
                UoM: {uom || "—"} {sellableKind === "dienst" ? "(dienst)" : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

