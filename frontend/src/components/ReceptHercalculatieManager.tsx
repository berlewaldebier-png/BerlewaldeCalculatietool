"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type ReceptHercalculatieManagerProps = {
  initialRows: GenericRecord[];
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneValue(raw);
  const basis =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};
  const soort =
    typeof row.soort_berekening === "object" && row.soort_berekening !== null
      ? (row.soort_berekening as GenericRecord)
      : {};

  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.calculation_variant = String(row.calculation_variant ?? "origineel");
  row.bron_berekening_id = String(row.bron_berekening_id ?? "");
  row.hercalculatie_reden = String(row.hercalculatie_reden ?? "");
  row.hercalculatie_notitie = String(row.hercalculatie_notitie ?? "");
  row.hercalculatie_timestamp = String(row.hercalculatie_timestamp ?? "");
  row.basisgegevens = {
    ...basis,
    jaar: Number(basis.jaar ?? 0),
    biernaam: String(basis.biernaam ?? ""),
    stijl: String(basis.stijl ?? "")
  };
  row.soort_berekening = {
    type: String(soort.type ?? "")
  };
  return row;
}

function formatEuroPerLiter(value: unknown) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value ?? 0));
}

export function ReceptHercalculatieManager({ initialRows }: ReceptHercalculatieManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState(initial);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => {
    const first = initial.find(
      (row) =>
        String(row.status).toLowerCase() === "definitief" &&
        String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() ===
          "eigen productie"
    );
    return String(first?.id ?? "");
  });
  const [reason, setReason] = useState("Hercalculatie");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sourceRows = rows.filter(
    (row) =>
      String(row.status).toLowerCase() === "definitief" &&
      String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() ===
        "eigen productie"
  );
  const hercalculaties = rows.filter(
    (row) =>
      String(row.calculation_variant ?? "") === "hercalculatie" ||
      String(row.bron_berekening_id ?? "") !== ""
  );
  const currentSource =
    sourceRows.find((row) => String(row.id) === selectedSourceId) ?? sourceRows[0] ?? null;

  async function saveRows(nextRows: GenericRecord[], successMessage: string) {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/data/berekeningen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextRows)
      });
      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }
      setRows(nextRows);
      setStatus(successMessage);
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function createHercalculatie() {
    if (!currentSource) {
      return;
    }

    const draft = cloneValue(currentSource);
    const now = new Date().toISOString();
    draft.id = createId();
    draft.status = "concept";
    draft.calculation_variant = "hercalculatie";
    draft.bron_berekening_id = String(currentSource.id);
    draft.hercalculatie_reden = reason.trim() || "Hercalculatie";
    draft.hercalculatie_notitie = note.trim();
    draft.hercalculatie_timestamp = now;
    draft.finalized_at = "";
    draft.created_at = now;
    draft.updated_at = now;
    draft.last_completed_step = 1;

    const nextRows = [draft, ...rows];
    await saveRows(nextRows, "Concept-hercalculatie aangemaakt.");
    setNote("");
  }

  async function removeHercalculatie(id: string) {
    const nextRows = rows.filter((row) => String(row.id) !== id);
    await saveRows(nextRows, "Hercalculatie verwijderd.");
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Recept hercalculeren</div>
        <div className="module-card-text">
          Start nieuwe concept-hercalculaties op basis van definitieve eigen-productieberekeningen.
        </div>
      </div>

      <div className="wizard-page-grid">
        <aside className="wizard-record-list">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Definitieve bronberekeningen</div>
            <div className="wizard-panel-text">{sourceRows.length} beschikbaar</div>
          </div>

          {sourceRows.map((row) => {
            const basis = (row.basisgegevens as GenericRecord) ?? {};
            const resultaat = (row.resultaat_snapshot as GenericRecord) ?? {};
            return (
              <button
                key={String(row.id)}
                type="button"
                className={`wizard-record-card${
                  String(row.id) === String(currentSource?.id ?? "") ? " active" : ""
                }`}
                onClick={() => {
                  setSelectedSourceId(String(row.id));
                  setStatus("");
                }}
              >
                <strong>{String(basis.biernaam ?? "Onbekend bier")}</strong>
                <span>
                  {String(basis.stijl ?? "-")} · {String(basis.jaar ?? "-")}
                </span>
                <span>{formatEuroPerLiter(resultaat.integrale_kostprijs_per_liter)} / liter</span>
              </button>
            );
          })}
        </aside>

        <div className="wizard-shell wizard-shell-single">
          {currentSource ? (
            <div className="wizard-step-card">
              <div className="wizard-step-header">
                <div>
                  <div className="wizard-step-title">Nieuwe hercalculatie starten</div>
                  <div className="wizard-step-text">
                    Bron: {String(((currentSource.basisgegevens as GenericRecord)?.biernaam ?? ""))} ·{" "}
                    {String(((currentSource.basisgegevens as GenericRecord)?.jaar ?? ""))}
                  </div>
                </div>
              </div>

              <div className="wizard-form-grid">
                <label className="nested-field">
                  <span>Reden</span>
                  <input
                    className="dataset-input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <label className="nested-field">
                  <span>Notitie</span>
                  <input
                    className="dataset-input"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </div>

              <div className="wizard-stats-grid">
                <div className="wizard-stat-card">
                  <span>Stijl</span>
                  <strong>{String(((currentSource.basisgegevens as GenericRecord)?.stijl ?? "-"))}</strong>
                </div>
                <div className="wizard-stat-card">
                  <span>Bronstatus</span>
                  <strong>{String(currentSource.status ?? "-")}</strong>
                </div>
                <div className="wizard-stat-card">
                  <span>Variant</span>
                  <strong>{String(currentSource.calculation_variant ?? "origineel")}</strong>
                </div>
              </div>

              <div className="editor-actions">
                <div className="editor-actions-group">
                  <span className="muted">
                    Er wordt een nieuw conceptrecord aangemaakt op basis van de gekozen bron.
                  </span>
                </div>
                <div className="editor-actions-group">
                  {status ? <span className="editor-status">{status}</span> : null}
                  <button
                    type="button"
                    className="editor-button"
                    onClick={createHercalculatie}
                    disabled={isSaving}
                  >
                    {isSaving ? "Aanmaken..." : "Concept hercalculatie starten"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="wizard-step-card">
              <div className="nested-empty">
                Nog geen definitieve eigen-productieberekeningen beschikbaar om te hercalculeren.
              </div>
            </div>
          )}

          <div className="wizard-step-card">
            <div className="wizard-panel-header">
              <div className="wizard-panel-title">Bestaande hercalculaties</div>
              <div className="wizard-panel-text">
                Overzicht van concepten die vanuit een bronberekening zijn gestart.
              </div>
            </div>

            <div className="dataset-editor-scroll">
              <table className="dataset-editor-table">
                <thead>
                  <tr>
                    <th>Jaar</th>
                    <th>Bier</th>
                    <th>Reden</th>
                    <th>Status</th>
                    <th>Bronrecord</th>
                    <th>Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {hercalculaties.length > 0 ? (
                    hercalculaties.map((row) => {
                      const basis = (row.basisgegevens as GenericRecord) ?? {};
                      return (
                        <tr key={String(row.id)}>
                          <td>{String(basis.jaar ?? "-")}</td>
                          <td>{String(basis.biernaam ?? "-")}</td>
                          <td>{String(row.hercalculatie_reden ?? "-")}</td>
                          <td>{String(row.status ?? "-")}</td>
                          <td>{String(row.bron_berekening_id ?? "-")}</td>
                          <td>
                            <button
                              type="button"
                              className="editor-button editor-button-secondary"
                              onClick={() => removeHercalculatie(String(row.id))}
                            >
                              Verwijderen
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="dataset-empty" colSpan={6}>
                        Nog geen hercalculaties aangemaakt.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
