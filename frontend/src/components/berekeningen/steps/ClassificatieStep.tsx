"use client";

type GenericRecord = Record<string, unknown>;

export function ClassificatieStep({
  current,
  productgroepen,
  alcoholcategorieen,
  verpakkingstypen,
  updateCurrent,
}: {
  current: GenericRecord;
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
}) {
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const productGroup = String((basis as any).product_group ?? "");
  const alcoholCategory = String((basis as any).alcohol_category ?? "");
  const packagingType = String((basis as any).packaging_type ?? "");
  const packagingOptIn = Boolean((basis as any).packaging_type_opt_in ?? false);

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

  return (
    <div className="wizard-form-grid">
      <label className="nested-field">
        <span>Productgroep</span>
        <select
          className="dataset-input"
          value={productGroup}
          onChange={(event) =>
            updateCurrent((draft) => {
              const next = event.target.value;
              const basisgegevens = draft.basisgegevens as GenericRecord;
              (basisgegevens as any).product_group = next;
              const required = next === "drank" || next === "giftset";
              if (!required) {
                (basisgegevens as any).packaging_type_opt_in = false;
                (basisgegevens as any).packaging_type = "";
              }
            })
          }
        >
          <option value="">Selecteer...</option>
          {productgroepOptions.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>

      <label className="nested-field">
        <span>Alcoholcategorie</span>
        <select
          className="dataset-input"
          value={alcoholCategory}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).alcohol_category = event.target.value;
            })
          }
          disabled={productGroup !== "drank" && productGroup !== "giftset"}
          title={productGroup !== "drank" && productGroup !== "giftset" ? "Alleen relevant voor drank/giftset." : ""}
        >
          <option value="">--</option>
          {alcoholOptions.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>

      <div className="nested-field" style={{ gridColumn: "1 / -1" }}>
        <span>Verpakkingstype</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {packagingRequired ? (
            <span style={{ fontWeight: 700, opacity: 0.75 }}>verplicht</span>
          ) : (
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={packagingOptIn}
                onChange={(event) =>
                  updateCurrent((draft) => {
                    const basisgegevens = draft.basisgegevens as GenericRecord;
                    (basisgegevens as any).packaging_type_opt_in = event.target.checked;
                    if (!event.target.checked) {
                      (basisgegevens as any).packaging_type = "";
                    }
                  })
                }
              />
              + verpakkingstype
            </label>
          )}
          <select
            className="dataset-input"
            style={{ flex: 1 }}
            value={packagingType}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).packaging_type = event.target.value;
              })
            }
            disabled={!packagingRequired && !packagingOptIn}
            title={!packagingRequired && !packagingOptIn ? "Optioneel. Zet '+ verpakkingstype' aan om in te vullen." : ""}
          >
            <option value="">{packagingRequired || packagingOptIn ? "Selecteer..." : "--"}</option>
            {allowedPackaging.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

