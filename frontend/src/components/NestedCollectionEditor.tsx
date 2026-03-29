"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type FieldType = "text" | "number";
type NestedFieldType = FieldType | "select";

type FieldDefinition = {
  key: string;
  label: string;
  type?: FieldType;
};

type NestedOption = {
  value: string;
  label: string;
  payload?: Record<string, unknown>;
};

type NestedFieldDefinition = {
  key: string;
  label: string;
  type?: NestedFieldType;
  readOnly?: boolean;
  options?: NestedOption[];
};

type NestedComputedField = {
  targetKey: string;
  leftKey: string;
  rightKey: string;
};

type ParentAggregate = {
  targetKey: string;
  sourceKey: string;
};

type NestedCollectionEditorProps = {
  endpoint: string;
  title: string;
  description?: string;
  initialRows: Record<string, unknown>[];
  addRowTemplate: Record<string, unknown>;
  fields: FieldDefinition[];
  nestedKey: string;
  nestedLabel: string;
  nestedFields: NestedFieldDefinition[];
  nestedRowTemplate: Record<string, unknown>;
  nestedComputedFields?: NestedComputedField[];
  parentAggregates?: ParentAggregate[];
};

type InternalRow = Record<string, unknown> & {
  _uiId: string;
};

function createUiId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripInternal(row: InternalRow) {
  const { _uiId, ...rest } = row;
  return rest;
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function applyNestedComputedFields(
  row: Record<string, unknown>,
  computedFields: NestedComputedField[]
) {
  const nextRow = { ...row };
  for (const field of computedFields) {
    nextRow[field.targetKey] = toNumber(nextRow[field.leftKey]) * toNumber(nextRow[field.rightKey]);
  }
  return nextRow;
}

function applyParentAggregates(
  row: InternalRow,
  nestedKey: string,
  parentAggregates: ParentAggregate[]
) {
  const nestedRows = Array.isArray(row[nestedKey]) ? (row[nestedKey] as Record<string, unknown>[]) : [];
  const nextRow = { ...row };
  for (const aggregate of parentAggregates) {
    nextRow[aggregate.targetKey] = nestedRows.reduce(
      (sum, nestedRow) => sum + toNumber(nestedRow[aggregate.sourceKey]),
      0
    );
  }
  return nextRow;
}

export function NestedCollectionEditor({
  endpoint,
  title,
  description,
  initialRows,
  addRowTemplate,
  fields,
  nestedKey,
  nestedLabel,
  nestedFields,
  nestedRowTemplate,
  nestedComputedFields = [],
  parentAggregates = []
}: NestedCollectionEditorProps) {
  const preparedRows = useMemo<InternalRow[]>(
    () =>
      initialRows.map((row) => ({
        ...row,
        _uiId: String(row.id ?? createUiId())
      })),
    [initialRows]
  );

  const [rows, setRows] = useState<InternalRow[]>(preparedRows);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function updateField(rowId: string, key: string, value: unknown) {
    setRows((current) =>
      current.map((row) => (row._uiId === rowId ? { ...row, [key]: value } : row))
    );
  }

  function updateNestedRow(
    rowId: string,
    nestedIndex: number,
    field: NestedFieldDefinition,
    rawValue: unknown
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        const nestedRows = Array.isArray(row[nestedKey])
          ? [...(row[nestedKey] as Record<string, unknown>[])]
          : [];
        const currentNestedRow = { ...(nestedRows[nestedIndex] ?? {}) };
        let nextNestedRow: Record<string, unknown> = {
          ...currentNestedRow,
          [field.key]: rawValue
        };

        if (field.type === "select") {
          const option = field.options?.find((item) => item.value === rawValue);
          if (option?.payload) {
            nextNestedRow = {
              ...nextNestedRow,
              ...option.payload
            };
          }
        }

        nextNestedRow = applyNestedComputedFields(nextNestedRow, nestedComputedFields);
        nestedRows[nestedIndex] = nextNestedRow;

        return applyParentAggregates(
          {
            ...row,
            [nestedKey]: nestedRows
          },
          nestedKey,
          parentAggregates
        );
      })
    );
  }

  function addRow() {
    setRows((current) => [...current, { ...addRowTemplate, _uiId: createUiId() }]);
  }

  function deleteRow(rowId: string) {
    setRows((current) => current.filter((row) => row._uiId !== rowId));
  }

  function addNestedRow(rowId: string) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        const nestedRows = Array.isArray(row[nestedKey])
          ? [...(row[nestedKey] as Record<string, unknown>[])]
          : [];
        nestedRows.push({ ...nestedRowTemplate });

        return applyParentAggregates(
          {
            ...row,
            [nestedKey]: nestedRows
          },
          nestedKey,
          parentAggregates
        );
      })
    );
  }

  function deleteNestedRow(rowId: string, nestedIndex: number) {
    setRows((current) =>
      current.map((row) => {
        if (row._uiId !== rowId) {
          return row;
        }

        const nestedRows = Array.isArray(row[nestedKey])
          ? [...(row[nestedKey] as Record<string, unknown>[])]
          : [];
        nestedRows.splice(nestedIndex, 1);

        return applyParentAggregates(
          {
            ...row,
            [nestedKey]: nestedRows
          },
          nestedKey,
          parentAggregates
        );
      })
    );
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);

    try {
      const payload = rows.map(stripInternal);
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
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
          <span className="muted">
            Hoofdvelden en geneste {nestedLabel.toLowerCase()} zijn direct bewerkbaar.
          </span>
        </div>
      </div>

      <div className="nested-editor-list">
        {rows.length === 0 ? (
          <div className="nested-empty">Nog geen records. Voeg hieronder een eerste record toe.</div>
        ) : null}
        {rows.map((row) => {
          const nestedRows = Array.isArray(row[nestedKey])
            ? (row[nestedKey] as Record<string, unknown>[])
            : [];

          return (
            <article key={row._uiId} className="nested-editor-card">
              <div className="nested-editor-card-header">
                <div>
                  <div className="nested-editor-card-title">
                    {String(row.omschrijving ?? "Nieuw record")}
                  </div>
                  <div className="nested-editor-card-meta">ID: {String(row.id ?? "(nieuw)")}</div>
                </div>
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => deleteRow(row._uiId)}
                >
                  Verwijderen
                </button>
              </div>

              <div className="nested-editor-grid">
                {fields.map((field) => (
                  <label key={field.key} className="nested-field">
                    <span>{field.label}</span>
                    <input
                      className="dataset-input"
                      type={field.type === "number" ? "number" : "text"}
                      step={field.type === "number" ? "any" : undefined}
                      value={
                        row[field.key] === null || row[field.key] === undefined
                          ? ""
                          : String(row[field.key])
                      }
                      onChange={(event) => {
                        const nextValue =
                          field.type === "number"
                            ? event.target.value === ""
                              ? null
                              : Number(event.target.value)
                            : event.target.value;
                        updateField(row._uiId, field.key, nextValue);
                      }}
                    />
                  </label>
                ))}
              </div>

              <div className="nested-subsection">
                <div className="nested-subsection-header">
                  <div className="nested-subsection-title">{nestedLabel}</div>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => addNestedRow(row._uiId)}
                  >
                    {nestedLabel.slice(0, -1) || "Regel"} toevoegen
                  </button>
                </div>

                {nestedRows.length === 0 ? (
                  <div className="nested-empty">Nog geen {nestedLabel.toLowerCase()}.</div>
                ) : (
                  <div className="nested-rows">
                    {nestedRows.map((nestedRow, nestedIndex) => (
                      <div key={`${row._uiId}-${nestedIndex}`} className="nested-row-card">
                        <div className="nested-row-grid">
                          {nestedFields.map((field) => {
                            const fieldValue =
                              nestedRow[field.key] === null || nestedRow[field.key] === undefined
                                ? ""
                                : String(nestedRow[field.key]);

                            if (field.type === "select") {
                              return (
                                <label key={field.key} className="nested-field">
                                  <span>{field.label}</span>
                                  <select
                                    className="dataset-input"
                                    value={fieldValue}
                                    disabled={field.readOnly}
                                    onChange={(event) =>
                                      updateNestedRow(row._uiId, nestedIndex, field, event.target.value)
                                    }
                                  >
                                    <option value="">Kies...</option>
                                    {(field.options ?? []).map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              );
                            }

                            return (
                              <label key={field.key} className="nested-field">
                                <span>{field.label}</span>
                                <input
                                  className="dataset-input"
                                  type={field.type === "number" ? "number" : "text"}
                                  step={field.type === "number" ? "any" : undefined}
                                  value={fieldValue}
                                  readOnly={field.readOnly}
                                  onChange={(event) => {
                                    const nextValue =
                                      field.type === "number"
                                        ? event.target.value === ""
                                          ? null
                                          : Number(event.target.value)
                                        : event.target.value;
                                    updateNestedRow(row._uiId, nestedIndex, field, nextValue);
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                        <div className="nested-row-actions">
                          <button
                            type="button"
                            className="editor-button editor-button-secondary"
                            onClick={() => deleteNestedRow(row._uiId, nestedIndex)}
                          >
                            Regel verwijderen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="editor-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
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
