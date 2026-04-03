"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type EditorValue = string | number | boolean | null;
type EditorRow = Record<string, EditorValue>;

type ColumnType = "text" | "number" | "checkbox" | "select";

type EditorColumn = {
  key: string;
  label: string;
  type?: ColumnType;
  width?: string;
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type SaveShape = "array" | "recordByYear" | "groupByYearList";

type DatasetTableEditorProps = {
  endpoint: string;
  title: string;
  description?: string;
  columns: EditorColumn[];
  initialRows: EditorRow[];
  addRowTemplate: EditorRow;
  saveShape?: SaveShape;
  yearKey?: string;
  onRowsChange?: (rows: EditorRow[]) => void;
};

type InternalRow = EditorRow & {
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

export function DatasetTableEditor({
  endpoint,
  title,
  description,
  columns,
  initialRows,
  addRowTemplate,
  saveShape = "array",
  yearKey = "jaar",
  onRowsChange
}: DatasetTableEditorProps) {
  const router = useRouter();
  const preparedRows = useMemo<InternalRow[]>(
    () =>
      initialRows.map((row, index) => {
        const rawId = String(row.id ?? "").trim();
        return {
          ...row,
          _uiId: rawId ? `${rawId}-${index}` : createUiId()
        };
      }),
    [initialRows]
  );

  const [rows, setRows] = useState<InternalRow[]>(preparedRows);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const onRowsChangeRef = useRef<typeof onRowsChange>(onRowsChange);
  const readOnlyKeys = useMemo(
    () => new Set(columns.filter((column) => column.readOnly).map((column) => column.key)),
    [columns]
  );

  useEffect(() => {
    onRowsChangeRef.current = onRowsChange;
  }, [onRowsChange]);

  useEffect(() => {
    // Notify after React committed the update (avoid setState during another component update).
    onRowsChangeRef.current?.(rows.map(stripInternal));
  }, [rows]);

  function updateCell(rowId: string, key: string, value: EditorValue) {
    setRows((current) =>
      current.map((row) => (row._uiId === rowId ? { ...row, [key]: value } : row))
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        ...addRowTemplate,
        _uiId: createUiId()
      }
    ]);
  }

  function deleteRow(rowId: string) {
    setRows((current) => current.filter((row) => row._uiId !== rowId));
  }

  function buildPayload() {
    const cleanRows = rows.map((row) => {
      const stripped = stripInternal(row);
      return Object.fromEntries(
        Object.entries(stripped).filter(([key]) => !readOnlyKeys.has(key))
      ) as EditorRow;
    });

    if (saveShape === "array") {
      return cleanRows;
    }

    if (saveShape === "recordByYear") {
      return Object.fromEntries(
        cleanRows.map((row) => {
          const year = String(row[yearKey] ?? "");
          const { [yearKey]: _year, ...rest } = row;
          return [year, rest];
        })
      );
    }

    const grouped = cleanRows.reduce<Record<string, EditorRow[]>>((acc, row) => {
      const year = String(row[yearKey] ?? "");
      const { [yearKey]: _year, ...rest } = row;
      if (!acc[year]) {
        acc[year] = [];
      }
      acc[year].push(rest);
      return acc;
    }, {});

    return grouped;
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildPayload())
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

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">{title}</div>
        {description ? <div className="module-card-text">{description}</div> : null}
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{rows.length} regels</span>
          <span className="muted">Direct bewerken en opslaan via de API-opslag.</span>
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                  {column.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="dataset-empty" colSpan={columns.length + 1}>
                  Nog geen regels. Voeg hieronder een nieuwe rij toe.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row._uiId}>
                {columns.map((column) => {
                  const type = column.type ?? "text";
                  const value = row[column.key];

                  if (type === "checkbox") {
                    return (
                      <td key={column.key}>
                        <label className="dataset-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            disabled={column.readOnly}
                            onChange={(event) =>
                              updateCell(row._uiId, column.key, event.target.checked)
                            }
                          />
                          <span>{Boolean(value) ? "Ja" : "Nee"}</span>
                        </label>
                      </td>
                    );
                  }

                  if (type === "select") {
                    const options = column.options ?? [];
                    return (
                      <td key={column.key}>
                        <select
                          className={`dataset-input ${column.readOnly ? "dataset-input-readonly" : ""}`.trim()}
                          value={value === null || value === undefined ? "" : String(value)}
                          disabled={column.readOnly}
                          onChange={(event) => updateCell(row._uiId, column.key, event.target.value)}
                        >
                          <option value="">Kies...</option>
                          {options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  }

                  return (
                    <td key={column.key}>
                      <input
                        className={`dataset-input ${column.readOnly ? "dataset-input-readonly" : ""}`.trim()}
                        type={type === "number" ? "number" : "text"}
                        step={type === "number" ? "any" : undefined}
                        value={value === null || value === undefined ? "" : String(value)}
                        readOnly={column.readOnly}
                        onChange={(event) => {
                          const nextValue =
                            type === "number"
                              ? event.target.value === ""
                                ? null
                                : Number(event.target.value)
                              : event.target.value;
                          updateCell(row._uiId, column.key, nextValue);
                        }}
                      />
                    </td>
                  );
                })}
                <td>
                  <button
                    type="button"
                    className="icon-button-table"
                    aria-label="Verwijderen"
                    title="Verwijderen"
                    onClick={() => deleteRow(row._uiId)}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={addRow}>
            Rij toevoegen
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
