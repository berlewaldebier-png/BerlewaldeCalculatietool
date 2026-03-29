"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type FieldType = "text" | "number";

type FieldDefinition = {
  key: string;
  label: string;
  type?: FieldType;
};

type NestedSectionDefinition = {
  key: string;
  label: string;
  defaultValue?: unknown;
};

type RecordCardEditorProps = {
  endpoint: string;
  title: string;
  description?: string;
  initialRows: Record<string, unknown>[];
  addRowTemplate: Record<string, unknown>;
  fields: FieldDefinition[];
  nestedSections?: NestedSectionDefinition[];
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

export function RecordCardEditor({
  endpoint,
  title,
  description,
  initialRows,
  addRowTemplate,
  fields,
  nestedSections = []
}: RecordCardEditorProps) {
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

  function addRecord() {
    setRows((current) => [...current, { ...addRowTemplate, _uiId: createUiId() }]);
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
          <span className="muted">Bewerk de hoofdvelden direct en sla op naar JSON.</span>
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
                  {String(
                    row.offertenummer ??
                      row.verpakking ??
                      row.klantnaam ??
                      row.omschrijving ??
                      "Nieuw record"
                  )}
                </div>
                <div className="nested-editor-card-meta">ID: {String(row.id ?? "(nieuw)")}</div>
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

            {nestedSections.map((section) => {
              const rawValue = row[section.key];
              const defaultValue =
                section.defaultValue ?? (Array.isArray(rawValue) ? [] : rawValue ?? {});
              const text = JSON.stringify(rawValue ?? defaultValue, null, 2);

              return (
                <label key={section.key} className="nested-field">
                  <span>{section.label}</span>
                  <textarea
                    className="json-editor nested-json-editor"
                    value={text}
                    onChange={(event) => {
                      try {
                        const parsed = JSON.parse(event.target.value);
                        updateField(row._uiId, section.key, parsed);
                        setStatus("");
                      } catch {
                        setStatus(`JSON ongeldig in ${section.label.toLowerCase()}.`);
                      }
                    }}
                    spellCheck={false}
                  />
                </label>
              );
            })}
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
