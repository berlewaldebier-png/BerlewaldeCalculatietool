"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type SelectOption = {
  value: string;
  label: string;
};

type PrijsvoorstelRow = Record<string, unknown> & {
  id: string;
  offertenummer: string;
  status: string;
  klantnaam: string;
  contactpersoon: string;
  referentie: string;
  datum_text: string;
  opmerking: string;
  jaar: number;
  voorsteltype: string;
  liters_basis: string;
  kanaal: string;
  bier_id: string;
  selected_bier_ids: string[];
  deleted_product_refs: unknown[];
  staffels: Record<string, unknown>[];
  product_rows: Record<string, unknown>[];
  beer_rows: Record<string, unknown>[];
  last_step: number;
  finalized_at: string;
  _uiId: string;
};

type PrijsvoorstelEditorProps = {
  endpoint: string;
  title: string;
  description?: string;
  initialRows: Record<string, unknown>[];
  addRowTemplate: Record<string, unknown>;
  beerOptions: SelectOption[];
  productOptions: SelectOption[];
};

function createUiId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNestedRows(value: unknown) {
  return Array.isArray(value) ? value.map((item) => ({ ...(item as Record<string, unknown>) })) : [];
}

function toInternalRow(row: Record<string, unknown>): PrijsvoorstelRow {
  return {
    ...row,
    id: String(row.id ?? ""),
    offertenummer: String(row.offertenummer ?? ""),
    status: String(row.status ?? ""),
    klantnaam: String(row.klantnaam ?? ""),
    contactpersoon: String(row.contactpersoon ?? ""),
    referentie: String(row.referentie ?? ""),
    datum_text: String(row.datum_text ?? ""),
    opmerking: String(row.opmerking ?? ""),
    jaar: Number(row.jaar ?? new Date().getFullYear()),
    voorsteltype: String(row.voorsteltype ?? ""),
    liters_basis: String(row.liters_basis ?? ""),
    kanaal: String(row.kanaal ?? ""),
    bier_id: String(row.bier_id ?? ""),
    selected_bier_ids: Array.isArray(row.selected_bier_ids)
      ? row.selected_bier_ids.map((item) => String(item))
      : [],
    deleted_product_refs: Array.isArray(row.deleted_product_refs) ? row.deleted_product_refs : [],
    staffels: normalizeNestedRows(row.staffels),
    product_rows: normalizeNestedRows(row.product_rows),
    beer_rows: normalizeNestedRows(row.beer_rows),
    last_step: Number(row.last_step ?? 1),
    finalized_at: String(row.finalized_at ?? ""),
    _uiId: String(row.id ?? createUiId())
  };
}

function stripInternal(row: PrijsvoorstelRow) {
  const { _uiId, ...rest } = row;
  return rest;
}

export function PrijsvoorstelEditor({
  endpoint,
  title,
  description,
  initialRows,
  addRowTemplate,
  beerOptions,
  productOptions
}: PrijsvoorstelEditorProps) {
  const preparedRows = useMemo(() => initialRows.map((row) => toInternalRow(row)), [initialRows]);

  const [rows, setRows] = useState<PrijsvoorstelRow[]>(preparedRows);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function updateRow(rowId: string, updates: Partial<PrijsvoorstelRow>) {
    setRows((current) =>
      current.map((row) => (row._uiId === rowId ? { ...row, ...updates } : row))
    );
  }

  function updateNestedArray(
    rowId: string,
    key: "staffels" | "product_rows" | "beer_rows",
    index: number,
    field: string,
    value: unknown
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        const nextArray = [...row[key]];
        nextArray[index] = { ...(nextArray[index] ?? {}), [field]: value };
        return { ...row, [key]: nextArray };
      })
    );
  }

  function addNestedItem(
    rowId: string,
    key: "selected_bier_ids" | "staffels" | "product_rows" | "beer_rows"
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        if (key === "selected_bier_ids") {
          return { ...row, selected_bier_ids: [...row.selected_bier_ids, ""] };
        }

        const template =
          key === "staffels"
            ? { id: createUiId(), liters: 0, korting_pct: 0, product_id: "" }
            : key === "product_rows"
              ? { id: createUiId(), aantal: 0, bier_id: "", korting_pct: 0, product_id: "" }
              : { id: createUiId(), liters: 0, bier_id: "", korting_pct: 0, product_id: "" };

        return { ...row, [key]: [...row[key], template] };
      })
    );
  }

  function removeNestedItem(
    rowId: string,
    key: "selected_bier_ids" | "staffels" | "product_rows" | "beer_rows",
    index: number
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        if (key === "selected_bier_ids") {
          const next = [...row.selected_bier_ids];
          next.splice(index, 1);
          return { ...row, selected_bier_ids: next };
        }

        const next = [...row[key]];
        next.splice(index, 1);
        return { ...row, [key]: next };
      })
    );
  }

  function updateSelectedBeerId(rowId: string, index: number, value: string) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        const next = [...row.selected_bier_ids];
        next[index] = value;
        return { ...row, selected_bier_ids: next };
      })
    );
  }

  function addRecord() {
    setRows((current) => [...current, toInternalRow({ ...addRowTemplate, id: "", _uiId: createUiId() })]);
  }

  function deleteRecord(rowId: string) {
    setRows((current) => current.filter((row) => row._uiId !== rowId));
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);

    try {
      const payload = rows.map(stripInternal);
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setStatus("Opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">{title}</div>
        {description ? <div className="module-card-text">{description}</div> : null}
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{rows.length} records</span>
          <span className="muted">Hoofdvelden en regels zijn direct bewerkbaar zonder JSON-blokken.</span>
        </div>
      </div>

      <div className="nested-editor-list">
        {rows.length === 0 ? (
          <div className="nested-empty">Nog geen records. Voeg hieronder een eerste record toe.</div>
        ) : null}

        {rows.map((row) => (
          <article key={row._uiId} className="nested-editor-card">
            <div className="nested-editor-card-header">
              <div>
                <div className="nested-editor-card-title">
                  {row.offertenummer || row.klantnaam || "Nieuw prijsvoorstel"}
                </div>
                <div className="nested-editor-card-meta">ID: {row.id || "(nieuw)"}</div>
              </div>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => deleteRecord(row._uiId)}
              >
                Verwijderen
              </button>
            </div>

            <div className="nested-editor-grid">
              {[
                ["offertenummer", "Offertenummer"],
                ["status", "Status"],
                ["klantnaam", "Klantnaam"],
                ["contactpersoon", "Contactpersoon"],
                ["referentie", "Referentie"],
                ["datum_text", "Datum"],
                ["jaar", "Jaar"],
                ["voorsteltype", "Voorsteltype"],
                ["liters_basis", "Liters basis"],
                ["kanaal", "Kanaal"],
                ["bier_id", "Bier ID"],
                ["opmerking", "Opmerking"]
              ].map(([key, label]) => (
                <label key={key} className="nested-field">
                  <span>{label}</span>
                  {key === "jaar" ? (
                    <input
                      className="dataset-input"
                      type="number"
                      step="1"
                      value={String(row[key as keyof PrijsvoorstelRow] ?? "")}
                      onChange={(event) =>
                        updateRow(row._uiId, { [key]: event.target.value === "" ? 0 : Number(event.target.value) })
                      }
                    />
                  ) : key === "bier_id" ? (
                    <select
                      className="dataset-input"
                      value={row.bier_id}
                      onChange={(event) => updateRow(row._uiId, { bier_id: event.target.value })}
                    >
                      <option value="">Kies...</option>
                      {beerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="dataset-input"
                      type="text"
                      value={String(row[key as keyof PrijsvoorstelRow] ?? "")}
                      onChange={(event) => updateRow(row._uiId, { [key]: event.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="nested-subsection">
              <div className="nested-subsection-header">
                <div className="nested-subsection-title">Gekoppelde bier-ID's</div>
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => addNestedItem(row._uiId, "selected_bier_ids")}
                >
                  Bier toevoegen
                </button>
              </div>
              {row.selected_bier_ids.length === 0 ? (
                <div className="nested-empty">Nog geen gekoppelde bieren.</div>
              ) : (
                <div className="nested-rows">
                  {row.selected_bier_ids.map((beerId, index) => (
                    <div key={`${row._uiId}-beerkey-${index}`} className="nested-row-card">
                      <div className="nested-row-grid nested-row-grid-compact">
                        <label className="nested-field">
                          <span>Bier ID</span>
                          <select
                            className="dataset-input"
                            value={beerId}
                            onChange={(event) =>
                              updateSelectedBeerId(row._uiId, index, event.target.value)
                            }
                          >
                            <option value="">Kies...</option>
                            {beerOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="nested-row-actions">
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => removeNestedItem(row._uiId, "selected_bier_ids", index)}
                        >
                          Regel verwijderen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <NestedRowsSection
              title="Staffels"
              rows={row.staffels}
              onAdd={() => addNestedItem(row._uiId, "staffels")}
              onRemove={(index) => removeNestedItem(row._uiId, "staffels", index)}
              renderFields={(nestedRow, index) => (
                <>
                  <NestedNumberField
                    label="Liters"
                    value={nestedRow.liters}
                    onChange={(value) => updateNestedArray(row._uiId, "staffels", index, "liters", value)}
                  />
                  <NestedNumberField
                    label="Korting %"
                    value={nestedRow.korting_pct}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "staffels", index, "korting_pct", value)
                    }
                  />
                  <NestedSelectField
                    label="Product"
                    value={String(nestedRow.product_id ?? "")}
                    options={productOptions}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "staffels", index, "product_id", value)
                    }
                  />
                </>
              )}
            />

            <NestedRowsSection
              title="Productregels"
              rows={row.product_rows}
              onAdd={() => addNestedItem(row._uiId, "product_rows")}
              onRemove={(index) => removeNestedItem(row._uiId, "product_rows", index)}
              renderFields={(nestedRow, index) => (
                <>
                  <NestedSelectField
                    label="Bier ID"
                    value={String(nestedRow.bier_id ?? "")}
                    options={beerOptions}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "product_rows", index, "bier_id", value)
                    }
                  />
                  <NestedSelectField
                    label="Product ID"
                    value={String(nestedRow.product_id ?? "")}
                    options={productOptions}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "product_rows", index, "product_id", value)
                    }
                  />
                  <NestedNumberField
                    label="Aantal"
                    value={nestedRow.aantal}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "product_rows", index, "aantal", value)
                    }
                  />
                  <NestedNumberField
                    label="Korting %"
                    value={nestedRow.korting_pct}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "product_rows", index, "korting_pct", value)
                    }
                  />
                </>
              )}
            />

            <NestedRowsSection
              title="Bierregels"
              rows={row.beer_rows}
              onAdd={() => addNestedItem(row._uiId, "beer_rows")}
              onRemove={(index) => removeNestedItem(row._uiId, "beer_rows", index)}
              renderFields={(nestedRow, index) => (
                <>
                  <NestedSelectField
                    label="Bier ID"
                    value={String(nestedRow.bier_id ?? "")}
                    options={beerOptions}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "beer_rows", index, "bier_id", value)
                    }
                  />
                  <NestedSelectField
                    label="Product ID"
                    value={String(nestedRow.product_id ?? "")}
                    options={productOptions}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "beer_rows", index, "product_id", value)
                    }
                  />
                  <NestedNumberField
                    label="Liters"
                    value={nestedRow.liters}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "beer_rows", index, "liters", value)
                    }
                  />
                  <NestedNumberField
                    label="Korting %"
                    value={nestedRow.korting_pct}
                    onChange={(value) =>
                      updateNestedArray(row._uiId, "beer_rows", index, "korting_pct", value)
                    }
                  />
                </>
              )}
            />
          </article>
        ))}
      </div>

      <div className="editor-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addRecord}>
            Record toevoegen
          </button>
        </div>
        <div className="editor-actions-group">
          {status ? <span className="editor-status">{status}</span> : null}
          <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>
    </section>
  );
}

function NestedRowsSection({
  title,
  rows,
  onAdd,
  onRemove,
  renderFields
}: {
  title: string;
  rows: Record<string, unknown>[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderFields: (row: Record<string, unknown>, index: number) => React.ReactNode;
}) {
  return (
    <div className="nested-subsection">
      <div className="nested-subsection-header">
        <div className="nested-subsection-title">{title}</div>
        <button type="button" className="editor-button editor-button-secondary" onClick={onAdd}>
          Regel toevoegen
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="nested-empty">Nog geen regels.</div>
      ) : (
        <div className="nested-rows">
          {rows.map((row, index) => (
            <div key={`${title}-${index}`} className="nested-row-card">
              <div className="nested-row-grid">{renderFields(row, index)}</div>
              <div className="nested-row-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => onRemove(index)}
                >
                  Regel verwijderen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NestedSelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="nested-field">
      <span>{label}</span>
      <select className="dataset-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Kies...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NestedNumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: unknown;
  onChange: (value: number) => void;
}) {
  return (
    <label className="nested-field">
      <span>{label}</span>
      <input
        className="dataset-input"
        type="number"
        step="any"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
      />
    </label>
  );
}
