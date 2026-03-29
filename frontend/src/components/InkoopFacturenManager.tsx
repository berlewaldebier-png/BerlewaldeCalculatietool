"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type InkoopFacturenManagerProps = {
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

function normalizeFactuurRegel(raw?: GenericRecord): GenericRecord {
  const row = raw ? cloneValue(raw) : {};
  return {
    id: String(row.id ?? createId()),
    aantal: Number(row.aantal ?? 0),
    eenheid: String(row.eenheid ?? ""),
    liters: Number(row.liters ?? 0),
    subfactuurbedrag: Number(row.subfactuurbedrag ?? 0)
  };
}

function normalizeFactuur(raw?: GenericRecord): GenericRecord {
  const factuur = raw ? cloneValue(raw) : {};
  const rows = Array.isArray(factuur.factuurregels)
    ? (factuur.factuurregels as GenericRecord[]).map((row) => normalizeFactuurRegel(row))
    : [];

  return {
    id: String(factuur.id ?? createId()),
    factuurnummer: String(factuur.factuurnummer ?? ""),
    factuurdatum: String(factuur.factuurdatum ?? ""),
    verzendkosten: Number(factuur.verzendkosten ?? 0),
    overige_kosten: Number(factuur.overige_kosten ?? 0),
    factuurregels: rows
  };
}

function normalizeBerekening(raw: GenericRecord): GenericRecord {
  const row = cloneValue(raw);
  const basisgegevens =
    typeof row.basisgegevens === "object" && row.basisgegevens !== null
      ? (row.basisgegevens as GenericRecord)
      : {};
  const soort =
    typeof row.soort_berekening === "object" && row.soort_berekening !== null
      ? (row.soort_berekening as GenericRecord)
      : {};
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};

  row.id = String(row.id ?? createId());
  row.status = String(row.status ?? "concept");
  row.basisgegevens = {
    jaar: Number(basisgegevens.jaar ?? 0),
    biernaam: String(basisgegevens.biernaam ?? ""),
    stijl: String(basisgegevens.stijl ?? "")
  };
  row.soort_berekening = {
    type: String(soort.type ?? "")
  };
  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      factuurnummer: String(inkoop.factuurnummer ?? ""),
      factuurdatum: String(inkoop.factuurdatum ?? ""),
      verzendkosten: Number(inkoop.verzendkosten ?? 0),
      overige_kosten: Number(inkoop.overige_kosten ?? 0),
      factuurregels: Array.isArray(inkoop.factuurregels)
        ? (inkoop.factuurregels as GenericRecord[]).map((factuur) => normalizeFactuurRegel(factuur))
        : [],
      facturen: Array.isArray(inkoop.facturen)
        ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
        : []
    }
  };
  return row;
}

function getInkoopFacturen(row: GenericRecord) {
  const inkoop = (((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {}) as GenericRecord;
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];

  if (facturen.length > 0) {
    return facturen.map((factuur) => normalizeFactuur(factuur));
  }

  const fallback = normalizeFactuur({
    factuurnummer: inkoop.factuurnummer,
    factuurdatum: inkoop.factuurdatum,
    verzendkosten: inkoop.verzendkosten,
    overige_kosten: inkoop.overige_kosten,
    factuurregels: inkoop.factuurregels
  });

  const hasData =
    String(fallback.factuurnummer ?? "").trim() !== "" ||
    String(fallback.factuurdatum ?? "").trim() !== "" ||
    Number(fallback.verzendkosten ?? 0) > 0 ||
    Number(fallback.overige_kosten ?? 0) > 0 ||
    (Array.isArray(fallback.factuurregels) && fallback.factuurregels.length > 0);

  return hasData ? [fallback] : [];
}

function setInkoopFacturen(row: GenericRecord, facturen: GenericRecord[]) {
  const invoer =
    typeof row.invoer === "object" && row.invoer !== null ? (row.invoer as GenericRecord) : {};
  const inkoop =
    typeof invoer.inkoop === "object" && invoer.inkoop !== null
      ? (invoer.inkoop as GenericRecord)
      : {};
  const normalized = facturen.map((factuur) => normalizeFactuur(factuur));
  const primary = normalized[0] ?? normalizeFactuur();

  row.invoer = {
    ...invoer,
    inkoop: {
      ...inkoop,
      facturen: normalized,
      factuurnummer: String(primary.factuurnummer ?? ""),
      factuurdatum: String(primary.factuurdatum ?? ""),
      verzendkosten: Number(primary.verzendkosten ?? 0),
      overige_kosten: Number(primary.overige_kosten ?? 0),
      factuurregels: Array.isArray(primary.factuurregels) ? primary.factuurregels : []
    }
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(value || 0);
}

function getTotals(record: GenericRecord) {
  const facturen = getInkoopFacturen(record);
  let liters = 0;
  let bedrag = 0;
  let extra = 0;

  facturen.forEach((factuur) => {
    extra += Number(factuur.verzendkosten ?? 0) + Number(factuur.overige_kosten ?? 0);
    const regels = Array.isArray(factuur.factuurregels)
      ? (factuur.factuurregels as GenericRecord[])
      : [];
    regels.forEach((regel) => {
      liters += Number(regel.liters ?? 0);
      bedrag += Number(regel.subfactuurbedrag ?? 0);
    });
  });

  return { liters, bedrag, extra };
}

export function InkoopFacturenManager({ initialRows }: InkoopFacturenManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState<GenericRecord[]>(initial);
  const [selectedRecordId, setSelectedRecordId] = useState<string>(() => {
    const first = initial.find(
      (row) =>
        String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() === "inkoop" &&
        String(row.status ?? "").toLowerCase() === "definitief"
    );
    return String(first?.id ?? "");
  });
  const [selectedFactuurId, setSelectedFactuurId] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const inkoopRecords = rows.filter(
    (row) =>
      String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() === "inkoop" &&
      String(row.status ?? "").toLowerCase() === "definitief"
  );
  const currentRecord =
    inkoopRecords.find((row) => String(row.id) === selectedRecordId) ?? inkoopRecords[0] ?? null;
  const currentFacturen = currentRecord ? getInkoopFacturen(currentRecord) : [];
  const currentFactuur =
    currentFacturen.find((factuur) => String(factuur.id) === selectedFactuurId) ??
    currentFacturen[0] ??
    null;
  const totals = currentRecord ? getTotals(currentRecord) : { liters: 0, bedrag: 0, extra: 0 };

  function updateCurrentFacturen(nextFacturen: GenericRecord[]) {
    if (!currentRecord) {
      return;
    }

    const normalized = nextFacturen.map((factuur) => normalizeFactuur(factuur));
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (String(row.id) !== String(currentRecord.id)) {
          return row;
        }
        const draft = cloneValue(row);
        setInkoopFacturen(draft, normalized);
        draft.updated_at = new Date().toISOString();
        return draft;
      })
    );
    setSelectedFactuurId(String(normalized[0]?.id ?? ""));
  }

  function updateFactuurField(factuurId: string, key: string, value: unknown) {
    updateCurrentFacturen(
      currentFacturen.map((factuur) =>
        String(factuur.id) === factuurId ? { ...factuur, [key]: value } : factuur
      )
    );
  }

  function updateFactuurRegel(factuurId: string, rowId: string, key: string, value: unknown) {
    updateCurrentFacturen(
      currentFacturen.map((factuur) => {
        if (String(factuur.id) !== factuurId) {
          return factuur;
        }

        const regels = Array.isArray(factuur.factuurregels)
          ? (factuur.factuurregels as GenericRecord[])
          : [];

        return {
          ...factuur,
          factuurregels: regels.map((regel) =>
            String(regel.id) === rowId ? { ...regel, [key]: value } : regel
          )
        };
      })
    );
  }

  function addFactuur() {
    const nextFactuur = normalizeFactuur();
    updateCurrentFacturen([...currentFacturen, nextFactuur]);
    setSelectedFactuurId(String(nextFactuur.id));
  }

  function removeFactuur(factuurId: string) {
    updateCurrentFacturen(currentFacturen.filter((factuur) => String(factuur.id) !== factuurId));
  }

  function addFactuurRegel(factuurId: string) {
    updateCurrentFacturen(
      currentFacturen.map((factuur) =>
        String(factuur.id) === factuurId
          ? {
              ...factuur,
              factuurregels: [
                ...((Array.isArray(factuur.factuurregels)
                  ? (factuur.factuurregels as GenericRecord[])
                  : []) as GenericRecord[]),
                normalizeFactuurRegel()
              ]
            }
          : factuur
      )
    );
  }

  function removeFactuurRegel(factuurId: string, rowId: string) {
    updateCurrentFacturen(
      currentFacturen.map((factuur) =>
        String(factuur.id) === factuurId
          ? {
              ...factuur,
              factuurregels: (
                Array.isArray(factuur.factuurregels)
                  ? (factuur.factuurregels as GenericRecord[])
                  : []
              ).filter((regel) => String(regel.id) !== rowId)
            }
          : factuur
      )
    );
  }

  async function handleSave() {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/data/berekeningen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setStatus("Inkoopfacturen opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Inkoopfacturen beheren</div>
        <div className="module-card-text">
          Beheer meerdere facturen per definitieve inkoopberekening en schrijf alles terug naar de
          berekeningen-JSON.
        </div>
      </div>

      <div className="wizard-page-grid">
        <aside className="wizard-record-list">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Definitieve inkoopbieren</div>
            <div className="wizard-panel-text">{inkoopRecords.length} records</div>
          </div>

          {inkoopRecords.map((record) => {
            const basis = (record.basisgegevens as GenericRecord) ?? {};
            return (
              <button
                key={String(record.id)}
                type="button"
                className={`wizard-record-card${
                  String(record.id) === String(currentRecord?.id ?? "") ? " active" : ""
                }`}
                onClick={() => {
                  setSelectedRecordId(String(record.id));
                  setSelectedFactuurId("");
                  setStatus("");
                }}
              >
                <strong>{String(basis.biernaam ?? "Onbekend bier")}</strong>
                <span>
                  {String(basis.jaar ?? "-")} · {String(basis.stijl ?? "-")}
                </span>
                <span>{getInkoopFacturen(record).length} facturen</span>
              </button>
            );
          })}
        </aside>

        <div className="wizard-shell wizard-shell-single">
          {currentRecord ? (
            <>
              <div className="wizard-step-card">
                <div className="wizard-step-header">
                  <div>
                    <div className="wizard-step-title">
                      {String(((currentRecord.basisgegevens as GenericRecord)?.biernaam ?? "") || "Bier")}
                    </div>
                    <div className="wizard-step-text">
                      Jaar {String(((currentRecord.basisgegevens as GenericRecord)?.jaar ?? "-"))} ·{" "}
                      {currentFacturen.length} facturen gekoppeld
                    </div>
                  </div>
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={addFactuur}
                  >
                    Factuur toevoegen
                  </button>
                </div>

                <div className="wizard-stats-grid">
                  <div className="wizard-stat-card">
                    <span>Totaal liters</span>
                    <strong>{totals.liters.toLocaleString("nl-NL")}</strong>
                  </div>
                  <div className="wizard-stat-card">
                    <span>Subfacturen</span>
                    <strong>{formatCurrency(totals.bedrag)}</strong>
                  </div>
                  <div className="wizard-stat-card">
                    <span>Extra kosten</span>
                    <strong>{formatCurrency(totals.extra)}</strong>
                  </div>
                </div>
              </div>

              <div className="wizard-step-card">
                <div className="wizard-panel-header">
                  <div className="wizard-panel-title">Facturen</div>
                  <div className="wizard-panel-text">Kies een factuur om details te bewerken.</div>
                </div>

                <div className="record-card-grid">
                  {currentFacturen.length > 0 ? (
                    currentFacturen.map((factuur) => (
                      <button
                        key={String(factuur.id)}
                        type="button"
                        className={`wizard-record-card${
                          String(factuur.id) === String(currentFactuur?.id ?? "") ? " active" : ""
                        }`}
                        onClick={() => setSelectedFactuurId(String(factuur.id))}
                      >
                        <strong>{String(factuur.factuurnummer ?? "").trim() || "Nieuwe factuur"}</strong>
                        <span>{String(factuur.factuurdatum ?? "").trim() || "Geen datum"}</span>
                        <span>
                          {Array.isArray(factuur.factuurregels)
                            ? (factuur.factuurregels as GenericRecord[]).length
                            : 0}{" "}
                          regels
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="nested-empty">
                      Nog geen facturen gekoppeld. Voeg hierboven een eerste factuur toe.
                    </div>
                  )}
                </div>
              </div>

              {currentFactuur ? (
                <div className="wizard-step-card">
                  <div className="wizard-step-header">
                    <div>
                      <div className="wizard-step-title">Factuurdetails</div>
                      <div className="wizard-step-text">Bewerk kopgegevens en factuurregels.</div>
                    </div>
                    <button
                      type="button"
                      className="editor-button editor-button-secondary"
                      onClick={() => removeFactuur(String(currentFactuur.id))}
                    >
                      Factuur verwijderen
                    </button>
                  </div>

                  <div className="wizard-form-grid">
                    {[
                      ["Factuurnummer", "factuurnummer", "text"],
                      ["Factuurdatum", "factuurdatum", "text"],
                      ["Verzendkosten", "verzendkosten", "number"],
                      ["Overige kosten", "overige_kosten", "number"]
                    ].map(([label, key, type]) => (
                      <label key={key} className="nested-field">
                        <span>{label}</span>
                        <input
                          className="dataset-input"
                          type={type}
                          step={type === "number" ? "any" : undefined}
                          value={String(currentFactuur[key] ?? "")}
                          onChange={(event) =>
                            updateFactuurField(
                              String(currentFactuur.id),
                              key,
                              type === "number"
                                ? event.target.value === ""
                                  ? 0
                                  : Number(event.target.value)
                                : event.target.value
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>

                  <div className="dataset-editor-scroll">
                    <table className="dataset-editor-table">
                      <thead>
                        <tr>
                          <th>Aantal</th>
                          <th>Eenheid</th>
                          <th>Liters</th>
                          <th>Subfactuurbedrag</th>
                          <th>Actie</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.isArray(currentFactuur.factuurregels) &&
                        (currentFactuur.factuurregels as GenericRecord[]).length > 0 ? (
                          (currentFactuur.factuurregels as GenericRecord[]).map((regel) => (
                            <tr key={String(regel.id)}>
                              {[
                                ["aantal", "number"],
                                ["eenheid", "text"],
                                ["liters", "number"],
                                ["subfactuurbedrag", "number"]
                              ].map(([key, type]) => (
                                <td key={key}>
                                  <input
                                    className="dataset-input"
                                    type={type}
                                    step={type === "number" ? "any" : undefined}
                                    value={String(regel[key] ?? "")}
                                    onChange={(event) =>
                                      updateFactuurRegel(
                                        String(currentFactuur.id),
                                        String(regel.id),
                                        key,
                                        type === "number"
                                          ? event.target.value === ""
                                            ? 0
                                            : Number(event.target.value)
                                          : event.target.value
                                      )
                                    }
                                  />
                                </td>
                              ))}
                              <td>
                                <button
                                  type="button"
                                  className="editor-button editor-button-secondary"
                                  onClick={() =>
                                    removeFactuurRegel(
                                      String(currentFactuur.id),
                                      String(regel.id)
                                    )
                                  }
                                >
                                  Verwijderen
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td className="dataset-empty" colSpan={5}>
                              Nog geen factuurregels.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="editor-actions">
                    <div className="editor-actions-group">
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        onClick={() => addFactuurRegel(String(currentFactuur.id))}
                      >
                        Regel toevoegen
                      </button>
                    </div>
                    <div className="editor-actions-group">
                      {status ? <span className="editor-status">{status}</span> : null}
                      <button
                        type="button"
                        className="editor-button"
                        onClick={handleSave}
                        disabled={isSaving}
                      >
                        {isSaving ? "Opslaan..." : "Opslaan"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="wizard-step-card">
              <div className="nested-empty">
                Nog geen definitieve inkoopberekeningen gevonden. Rond eerst een inkoopberekening af
                in de kostprijswizard.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
