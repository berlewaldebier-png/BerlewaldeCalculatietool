"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type VerkoopstrategieRow = {
  id: string;
  record_type: string;
  jaar: number;
  bron_jaar: number;
  verpakking_key: string;
  verpakking: string;
  bron_verkoopstrategie_id: string;
  strategie_type: string;
  kanaalmarges: Record<string, number>;
  _uiId: string;
};

type VerkoopstrategieEditorProps = {
  endpoint: string;
  title: string;
  description?: string;
  initialRows: Record<string, unknown>[];
  addRowTemplate: Record<string, unknown>;
};

const CHANNELS = ["particulier", "zakelijk", "retail", "horeca", "slijterij"] as const;

function createUiId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRow(row: Record<string, unknown>): VerkoopstrategieRow {
  const rawMargins =
    typeof row.kanaalmarges === "object" && row.kanaalmarges !== null
      ? (row.kanaalmarges as Record<string, unknown>)
      : {};

  const kanaalmarges = Object.fromEntries(
    CHANNELS.map((channel) => [channel, Number(rawMargins[channel] ?? 0)])
  ) as Record<string, number>;

  return {
    id: String(row.id ?? ""),
    record_type: String(row.record_type ?? ""),
    jaar: Number(row.jaar ?? new Date().getFullYear()),
    bron_jaar: Number(row.bron_jaar ?? new Date().getFullYear()),
    verpakking_key: String(row.verpakking_key ?? ""),
    verpakking: String(row.verpakking ?? ""),
    bron_verkoopstrategie_id: String(row.bron_verkoopstrategie_id ?? ""),
    strategie_type: String(row.strategie_type ?? ""),
    kanaalmarges,
    _uiId: String(row.id ?? createUiId())
  };
}

function stripInternal(row: VerkoopstrategieRow) {
  const { _uiId, ...rest } = row;
  return rest;
}

export function VerkoopstrategieEditor({
  endpoint,
  title,
  description,
  initialRows,
  addRowTemplate
}: VerkoopstrategieEditorProps) {
  const preparedRows = useMemo(
    () => initialRows.map((row) => normalizeRow(row)),
    [initialRows]
  );

  const [rows, setRows] = useState<VerkoopstrategieRow[]>(preparedRows);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function updateField(rowId: string, key: keyof VerkoopstrategieRow, value: unknown) {
    setRows((current) =>
      current.map((row) => (row._uiId === rowId ? { ...row, [key]: value } : row))
    );
  }

  function updateMargin(rowId: string, channel: (typeof CHANNELS)[number], value: number) {
    setRows((current) =>
      current.map((row) =>
        row._uiId === rowId
          ? {
              ...row,
              kanaalmarges: {
                ...row.kanaalmarges,
                [channel]: value
              }
            }
          : row
      )
    );
  }

  function addRecord() {
    setRows((current) => [...current, normalizeRow(addRowTemplate)]);
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
          <span className="muted">Kanaalmarges zijn nu direct bewerkbaar per kanaal.</span>
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
                  {row.verpakking || "Nieuwe verkoopstrategie"}
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
              <label className="nested-field">
                <span>Jaar</span>
                <input
                  className="dataset-input"
                  type="number"
                  step="1"
                  value={String(row.jaar)}
                  onChange={(event) =>
                    updateField(
                      row._uiId,
                      "jaar",
                      event.target.value === "" ? new Date().getFullYear() : Number(event.target.value)
                    )
                  }
                />
              </label>
              <label className="nested-field">
                <span>Bronjaar</span>
                <input
                  className="dataset-input"
                  type="number"
                  step="1"
                  value={String(row.bron_jaar)}
                  onChange={(event) =>
                    updateField(
                      row._uiId,
                      "bron_jaar",
                      event.target.value === "" ? new Date().getFullYear() : Number(event.target.value)
                    )
                  }
                />
              </label>
              <label className="nested-field">
                <span>Verpakking</span>
                <input
                  className="dataset-input"
                  type="text"
                  value={row.verpakking}
                  onChange={(event) => updateField(row._uiId, "verpakking", event.target.value)}
                />
              </label>
              <label className="nested-field">
                <span>Verpakking key</span>
                <input
                  className="dataset-input"
                  type="text"
                  value={row.verpakking_key}
                  onChange={(event) => updateField(row._uiId, "verpakking_key", event.target.value)}
                />
              </label>
              <label className="nested-field">
                <span>Strategietype</span>
                <input
                  className="dataset-input"
                  type="text"
                  value={row.strategie_type}
                  onChange={(event) => updateField(row._uiId, "strategie_type", event.target.value)}
                />
              </label>
            </div>

            <div className="nested-subsection">
              <div className="nested-subsection-header">
                <div className="nested-subsection-title">Kanaalmarges</div>
              </div>
              <div className="nested-row-card">
                <div className="nested-row-grid">
                  {CHANNELS.map((channel) => (
                    <label key={channel} className="nested-field">
                      <span>{channel}</span>
                      <input
                        className="dataset-input"
                        type="number"
                        step="any"
                        value={String(row.kanaalmarges[channel] ?? 0)}
                        onChange={(event) =>
                          updateMargin(
                            row._uiId,
                            channel,
                            event.target.value === "" ? 0 : Number(event.target.value)
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
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
