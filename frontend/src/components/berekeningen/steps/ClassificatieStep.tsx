"use client";

type GenericRecord = Record<string, unknown>;

type ClassificationDraft = {
  product_group?: string;
  alcohol_category?: string;
  packaging_type?: string;
  packaging_type_opt_in?: boolean;
};

type ClassificationTargetKind = "sku" | "format";

export function ClassificatieStep({
  current,
  productgroepen,
  alcoholcategorieen,
  verpakkingstypen,
  targets,
  updateCurrent,
}: {
  current: GenericRecord;
  productgroepen: GenericRecord[];
  alcoholcategorieen: GenericRecord[];
  verpakkingstypen: GenericRecord[];
  targets: Array<{
    id: string;
    kind: ClassificationTargetKind;
    label: string;
    current_product_group?: string;
    current_alcohol_category?: string;
    current_packaging_type?: string;
  }>;
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
}) {
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

  const overridesBySkuId = ((current as any).classification_overrides ?? {}) as Record<string, ClassificationDraft>;
  const overridesByFormatId = ((current as any).classification_overrides_by_format ?? {}) as Record<
    string,
    ClassificationDraft
  >;
  return (
    <div className="wizard-stack">
      <div className="wizard-section">
        <div className="wizard-section-title">Classificatie per SKU</div>
        <div className="wizard-section-subtitle">
          Een kostprijsberekening kan meerdere SKU's opleveren (bijv. fles + doos). Koppel hier productgroep en verpakkingstype per SKU.
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
            {targets.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ opacity: 0.7 }}>
                  Geen SKU's gevonden om te classificeren. Vul eerst Inkoop/Recept in.
                </td>
              </tr>
            ) : (
              targets.map((target) => {
                const targetId = target.id;
                const draft =
                  target.kind === "format" ? overridesByFormatId[targetId] ?? {} : overridesBySkuId[targetId] ?? {};
                const productGroup = String(draft.product_group ?? target.current_product_group ?? "");
                const alcoholCategory = String(draft.alcohol_category ?? target.current_alcohol_category ?? "");
                const packagingType = String(draft.packaging_type ?? target.current_packaging_type ?? "");
                const packagingRequired = productGroup === "drank" || productGroup === "giftset";
                const packagingOptIn = Boolean(draft.packaging_type_opt_in ?? packagingType);
                const allowedPackaging = packagingRequired
                  ? verpakkingstypeOptions.filter((row) => row.allowed.length === 0 || row.allowed.includes(productGroup))
                  : verpakkingstypeOptions;

                return (
                  <tr key={`${target.kind}:${targetId}`}>
                    <td style={{ fontWeight: 600 }}>{target.label}</td>
                    <td>
                      <select
                        className="dataset-input"
                        value={productGroup}
                        onChange={(event) =>
                          updateCurrent((draftRow) => {
                            const next = event.target.value;
                            const field =
                              target.kind === "format" ? "classification_overrides_by_format" : "classification_overrides";
                            const map = (((draftRow as any)[field] ?? {}) as Record<string, ClassificationDraft>);
                            const currentDraft = map[targetId] ?? {};
                            map[targetId] = { ...currentDraft, product_group: next };
                            const required = next === "drank" || next === "giftset";
                            if (!required) {
                              map[targetId] = { ...map[targetId], packaging_type_opt_in: false, packaging_type: "" };
                            }
                            (draftRow as any)[field] = map;
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
                    </td>
                    <td>
                      <select
                        className="dataset-input"
                        value={alcoholCategory}
                        disabled={productGroup !== "drank" && productGroup !== "giftset"}
                        title={productGroup !== "drank" && productGroup !== "giftset" ? "Alleen relevant voor drank/giftset." : ""}
                        onChange={(event) =>
                          updateCurrent((draftRow) => {
                            const field =
                              target.kind === "format" ? "classification_overrides_by_format" : "classification_overrides";
                            const map = (((draftRow as any)[field] ?? {}) as Record<string, ClassificationDraft>);
                            const currentDraft = map[targetId] ?? {};
                            map[targetId] = { ...currentDraft, alcohol_category: event.target.value };
                            (draftRow as any)[field] = map;
                          })
                        }
                      >
                        <option value="">--</option>
                        {alcoholOptions.map((row) => (
                          <option key={row.value} value={row.value}>
                            {row.label}
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
                              checked={packagingOptIn}
                              onChange={(event) =>
                                updateCurrent((draftRow) => {
                                  const field =
                                    target.kind === "format"
                                      ? "classification_overrides_by_format"
                                      : "classification_overrides";
                                  const map = (((draftRow as any)[field] ?? {}) as Record<string, ClassificationDraft>);
                                  const currentDraft = map[targetId] ?? {};
                                  map[targetId] = { ...currentDraft, packaging_type_opt_in: event.target.checked };
                                  if (!event.target.checked) {
                                    map[targetId] = { ...map[targetId], packaging_type: "" };
                                  }
                                  (draftRow as any)[field] = map;
                                })
                              }
                            />
                            +
                          </label>
                        )}
                        <select
                          className="dataset-input"
                          value={packagingType}
                          disabled={!packagingRequired && !packagingOptIn}
                          title={!packagingRequired && !packagingOptIn ? "Optioneel. Zet '+' aan om in te vullen." : ""}
                          onChange={(event) =>
                            updateCurrent((draftRow) => {
                              const field =
                                target.kind === "format"
                                  ? "classification_overrides_by_format"
                                  : "classification_overrides";
                              const map = (((draftRow as any)[field] ?? {}) as Record<string, ClassificationDraft>);
                              const currentDraft = map[targetId] ?? {};
                              map[targetId] = { ...currentDraft, packaging_type: event.target.value };
                              (draftRow as any)[field] = map;
                            })
                          }
                        >
                          <option value="">{packagingRequired || packagingOptIn ? "Selecteer..." : "--"}</option>
                          {allowedPackaging.map((row) => (
                            <option key={row.value} value={row.value}>
                              {row.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

