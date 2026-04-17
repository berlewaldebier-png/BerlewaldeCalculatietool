"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type FieldType = "text" | "number" | "checkbox";
type NestedFieldType = FieldType | "select";

type FieldDefinition = {
  key: string;
  label: string;
  type?: FieldType;
  readOnly?: boolean;
};

type NestedOption = {
  value: string;
  label: string;
  payload?: Record<string, unknown>;
};

type NestedOptionResolverArgs = {
  row: InternalRow;
  nestedRows: Record<string, unknown>[];
  nestedIndex: number;
  nestedRow: Record<string, unknown>;
};

type NestedFieldDefinition = {
  key: string;
  label: string;
  type?: NestedFieldType;
  readOnly?: boolean;
  options?: NestedOption[] | ((args: NestedOptionResolverArgs) => NestedOption[]);
  resetOnSelect?: boolean;
  preserveOnSelect?: string[];
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

type CompactSummaryColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "count";
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
  compactSummaryColumns?: CompactSummaryColumn[];
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

function resolveNestedOptions(
  field: NestedFieldDefinition,
  args: NestedOptionResolverArgs
) {
  if (typeof field.options === "function") {
    return field.options(args);
  }

  return field.options ?? [];
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
  parentAggregates = [],
  compactSummaryColumns
}: NestedCollectionEditorProps) {
  const router = useRouter();
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
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  function TrashIcon() {
    return (
      <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
      </svg>
    );
  }

  function EditIcon() {
    return (
      <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10-10-4-4L4 16v4Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m12 6 4 4" />
      </svg>
    );
  }

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
        const optionArgs = {
          row,
          nestedRows,
          nestedIndex,
          nestedRow: currentNestedRow
        } satisfies NestedOptionResolverArgs;
        let nextNestedRow: Record<string, unknown>;

        if (field.type === "select" && field.resetOnSelect) {
          const preservedKeys = new Set(field.preserveOnSelect ?? []);
          nextNestedRow = {
            ...nestedRowTemplate,
            ...Object.fromEntries(
              Object.entries(currentNestedRow).filter(([key]) => preservedKeys.has(key))
            ),
            [field.key]: rawValue
          };
        } else {
          nextNestedRow = {
            ...currentNestedRow,
            [field.key]: rawValue
          };
        }

        if (field.type === "select") {
          const option = resolveNestedOptions(field, optionArgs).find((item) => item.value === rawValue);
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
    setExpandedRowId((current) => (current === rowId ? null : current));
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
      router.refresh();
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  function renderDetailEditor(row: InternalRow) {
    const nestedRows = Array.isArray(row[nestedKey])
      ? (row[nestedKey] as Record<string, unknown>[])
      : [];

    return (
      <>
        <div className="nested-editor-grid">
          {fields.map((field) => (
            <label key={field.key} className="nested-field">
              <span>{field.label}</span>
              {field.type === "checkbox" ? (
                <input
                  className={`dataset-input ${field.readOnly ? "dataset-input-readonly" : ""}`.trim()}
                  type="checkbox"
                  checked={Boolean(row[field.key])}
                  disabled={field.readOnly}
                  onChange={(event) => updateField(row._uiId, field.key, event.target.checked)}
                />
              ) : (
                <input
                  className={`dataset-input ${field.readOnly ? "dataset-input-readonly" : ""}`.trim()}
                  type={field.type === "number" ? "number" : "text"}
                  step={field.type === "number" ? "any" : undefined}
                  value={
                    row[field.key] === null || row[field.key] === undefined ? "" : String(row[field.key])
                  }
                  readOnly={field.readOnly}
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
              )}
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
                        const options = resolveNestedOptions(field, {
                          row,
                          nestedRows,
                          nestedIndex,
                          nestedRow
                        });
                        return (
                          <label key={field.key} className="nested-field">
                            <span>{field.label}</span>
                            <select
                              className={`dataset-input ${field.readOnly ? "dataset-input-readonly" : ""}`.trim()}
                              value={fieldValue}
                              disabled={field.readOnly}
                              onChange={(event) =>
                                updateNestedRow(row._uiId, nestedIndex, field, event.target.value)
                              }
                            >
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

                      return (
                        <label key={field.key} className="nested-field">
                          <span>{field.label}</span>
                          <input
                            className={`dataset-input ${field.readOnly ? "dataset-input-readonly" : ""}`.trim()}
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
                      className="icon-button-table"
                      aria-label="Regel verwijderen"
                      title="Regel verwijderen"
                      onClick={() => deleteNestedRow(row._uiId, nestedIndex)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
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

      {compactSummaryColumns ? (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                {compactSummaryColumns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={compactSummaryColumns.length + 1}>
                    Nog geen records. Voeg hieronder een eerste record toe.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => {
                const nestedRows = Array.isArray(row[nestedKey])
                  ? (row[nestedKey] as Record<string, unknown>[])
                  : [];
                const isExpanded = expandedRowId === row._uiId;

                return (
                  <Fragment key={row._uiId}>
                    <tr
                      onClick={() =>
                        setExpandedRowId((current) => (current === row._uiId ? null : row._uiId))
                      }
                      style={{ cursor: "pointer" }}
                    >
                      {compactSummaryColumns.map((column) => {
                        const displayValue =
                          column.type === "count"
                            ? nestedRows.length
                            : row[column.key] ?? "";
                        return <td key={column.key}>{String(displayValue)}</td>;
                      })}
                      <td>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.55rem" }}>
                          <button
                            type="button"
                            className="icon-button-table"
                            aria-label="Bewerken"
                            title="Bewerken"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedRowId((current) => (current === row._uiId ? null : row._uiId));
                            }}
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className="icon-button-table"
                            aria-label="Verwijderen"
                            title="Verwijderen"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteRow(row._uiId);
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={compactSummaryColumns.length + 1}>
                          <div className="nested-editor-card">{renderDetailEditor(row)}</div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="nested-editor-list">
          {rows.length === 0 ? (
            <div className="nested-empty">Nog geen records. Voeg hieronder een eerste record toe.</div>
          ) : null}
          {rows.map((row) => (
            <article key={row._uiId} className="nested-editor-card">
              <div className="nested-editor-card-header">
                <div>
                  <div className="nested-editor-card-title">
                    {String(row.omschrijving ?? "Nieuw record")}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button-table"
                  aria-label="Verwijderen"
                  title="Verwijderen"
                  onClick={() => deleteRow(row._uiId)}
                >
                  <TrashIcon />
                </button>
              </div>
              {renderDetailEditor(row)}
            </article>
          ))}
        </div>
      )}

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
