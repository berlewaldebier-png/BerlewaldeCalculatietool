"use client";

import { Fragment, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type InkoopFacturenManagerProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

const KOSTPRIJSVERSIES_API = `${API_BASE_URL}/data/kostprijsversies`;

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
  row.jaar = Number(row.jaar ?? basisgegevens.jaar ?? 0);
  row.versie_nummer = Number(row.versie_nummer ?? 0);
  row.brontype = String(row.brontype ?? "stam");
  row.bron_id = String(row.bron_id ?? "");
  row.bron_berekening_id = String(row.bron_berekening_id ?? "");
  row.is_actief = Boolean(row.is_actief ?? false);
  row.effectief_vanaf = String(row.effectief_vanaf ?? "");
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
      facturen: Array.isArray(inkoop.facturen)
        ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
        : [],
      factuurnummer: String(inkoop.factuurnummer ?? ""),
      factuurdatum: String(inkoop.factuurdatum ?? ""),
      verzendkosten: Number(inkoop.verzendkosten ?? 0),
      overige_kosten: Number(inkoop.overige_kosten ?? 0),
      factuurregels: Array.isArray(inkoop.factuurregels)
        ? (inkoop.factuurregels as GenericRecord[]).map((regel) => normalizeFactuurRegel(regel))
        : []
    }
  };
  return row;
}

function isInkoopRecord(row: GenericRecord) {
  return String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() === "inkoop";
}

function isMeaningfulFactuur(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  return (
    String(factuur.factuurnummer ?? "").trim() !== "" ||
    String(factuur.factuurdatum ?? "").trim() !== "" ||
    Number(factuur.verzendkosten ?? 0) > 0 ||
    Number(factuur.overige_kosten ?? 0) > 0 ||
    regels.some(
      (regel) =>
        Number(regel.aantal ?? 0) > 0 ||
        String(regel.eenheid ?? "").trim() !== "" ||
        Number(regel.liters ?? 0) > 0 ||
        Number(regel.subfactuurbedrag ?? 0) > 0
    )
  );
}

function sanitizeFacturen(facturen: GenericRecord[]) {
  return facturen.map((factuur) => normalizeFactuur(factuur)).filter((factuur) => isMeaningfulFactuur(factuur));
}

function isConceptFactuurVersie(row: GenericRecord) {
  return (
    String(row.status ?? "").toLowerCase() === "concept" &&
    String(row.brontype ?? "").toLowerCase() === "factuur"
  );
}

function getRecordYear(row: GenericRecord) {
  return Number(row.jaar ?? ((row.basisgegevens as GenericRecord | undefined)?.jaar ?? 0));
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

function getInkoopFacturen(row: GenericRecord) {
  const inkoop = (((row.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {}) as GenericRecord;
  return Array.isArray(inkoop.facturen)
    ? (inkoop.facturen as GenericRecord[]).map((factuur) => normalizeFactuur(factuur))
    : [];
}

function createFactuurVersieFromSource(source: GenericRecord, factuur: GenericRecord) {
  const nowIso = new Date().toISOString();
  const draft = cloneValue(source);
  draft.id = createId();
  draft.status = "concept";
  draft.is_actief = false;
  draft.effectief_vanaf = "";
  draft.versie_nummer = 0;
  draft.brontype = "factuur";
  draft.calculation_variant = "factuur";
  draft.bron_id = String(factuur.id ?? "");
  draft.bron_berekening_id = String(source.id ?? "");
  draft.created_at = nowIso;
  draft.updated_at = nowIso;
  draft.aangemaakt_op = nowIso;
  draft.aangepast_op = nowIso;
  draft.finalized_at = "";
  draft.resultaat_snapshot = {};
  setInkoopFacturen(draft, [factuur]);
  return normalizeBerekening(draft);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(value || 0);
}

function getFactuurTotals(factuur: GenericRecord) {
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  const liters = regels.reduce((sum, regel) => sum + Number(regel.liters ?? 0), 0);
  const bedrag =
    regels.reduce((sum, regel) => sum + Number(regel.subfactuurbedrag ?? 0), 0) +
    Number(factuur.verzendkosten ?? 0) +
    Number(factuur.overige_kosten ?? 0);
  return { liters, bedrag, regels: regels.length };
}

function isDraftValid(factuur: GenericRecord) {
  if (String(factuur.factuurnummer ?? "").trim() === "") {
    return false;
  }
  if (String(factuur.factuurdatum ?? "").trim() === "") {
    return false;
  }
  const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
  if (regels.length === 0) {
    return false;
  }
  return regels.every(
    (regel) =>
      Number(regel.aantal ?? 0) > 0 &&
      String(regel.eenheid ?? "").trim() !== "" &&
      Number(regel.liters ?? 0) > 0 &&
      Number(regel.subfactuurbedrag ?? 0) > 0
  );
}

function getProductUnitOptions(
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  return [
    ...basisproducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.inhoud_per_eenheid_liter ?? 0)
    })),
    ...samengesteldeProducten.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.omschrijving ?? ""),
      litersPerUnit: Number(row.totale_inhoud_liter ?? 0)
    }))
  ]
    .filter((option) => option.id && option.label)
    .sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
}

export function InkoopFacturenManager({
  initialRows,
  basisproducten,
  samengesteldeProducten
}: InkoopFacturenManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState<GenericRecord[]>(initial);
  const [selectedBeerKey, setSelectedBeerKey] = useState("");
  const [draftFactuur, setDraftFactuur] = useState<GenericRecord | null>(null);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);

  const unitOptions = useMemo(
    () => getProductUnitOptions(basisproducten, samengesteldeProducten),
    [basisproducten, samengesteldeProducten]
  );
  const litersPerUnitById = useMemo(
    () => new Map(unitOptions.map((option) => [option.id, option.litersPerUnit])),
    [unitOptions]
  );

  const bierGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { key: string; biernaam: string; stijl: string; jaar: number; records: GenericRecord[] }
    >();

    rows
      .filter((row) => isInkoopRecord(row))
      .forEach((row) => {
        const basis = (row.basisgegevens as GenericRecord) ?? {};
        const key = `${String(row.bier_id ?? "")}::${getRecordYear(row)}`;
        const current = grouped.get(key);
        const next = current ?? {
          key,
          biernaam: String(basis.biernaam ?? "Onbekend bier"),
          stijl: String(basis.stijl ?? ""),
          jaar: getRecordYear(row),
          records: []
        };
        next.records.push(normalizeBerekening(row));
        grouped.set(key, next);
      });

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort((left, right) =>
          String(right.aangepast_op ?? right.updated_at ?? "").localeCompare(
            String(left.aangepast_op ?? left.updated_at ?? "")
          )
        )
      }))
      .sort((left, right) => {
        const bierCompare = left.biernaam.localeCompare(right.biernaam, "nl-NL");
        if (bierCompare !== 0) {
          return bierCompare;
        }
        return right.jaar - left.jaar;
      });
  }, [rows]);

  const selectedGroup = bierGroups.find((group) => group.key === selectedBeerKey) ?? null;

  const selectedActiveRecord =
    selectedGroup?.records.find(
      (row) => String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
    ) ??
    selectedGroup?.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
    null;

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function startDraftForRecord(sourceRecord: GenericRecord | null) {
    if (!sourceRecord) {
      return;
    }
    setDraftFactuur(
      normalizeFactuur({
        factuurregels: [normalizeFactuurRegel()]
      })
    );
    setStatus("");
  }

  function updateDraftField(key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    setDraftFactuur({
      ...draftFactuur,
      [key]: value
    });
  }

  function updateDraftRegel(rowId: string, key: string, value: unknown) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.map((regel) => {
        if (String(regel.id) !== rowId) {
          return regel;
        }
        const nextRegel = { ...regel, [key]: value };
        const aantal = Number(nextRegel.aantal ?? 0);
        const litersPerUnit = litersPerUnitById.get(String(nextRegel.eenheid ?? "").trim()) ?? 0;
        if (litersPerUnit > 0 && aantal > 0) {
          nextRegel.liters = Number((aantal * litersPerUnit).toFixed(6));
        } else if (key === "eenheid" || key === "aantal") {
          nextRegel.liters = 0;
        }
        return nextRegel;
      })
    });
  }

  function addDraftRegel() {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: [...regels, normalizeFactuurRegel()]
    });
  }

  function removeDraftRegel(rowId: string) {
    if (!draftFactuur) {
      return;
    }
    const regels = Array.isArray(draftFactuur.factuurregels) ? (draftFactuur.factuurregels as GenericRecord[]) : [];
    setDraftFactuur({
      ...draftFactuur,
      factuurregels: regels.filter((regel) => String(regel.id) !== rowId)
    });
  }

  function cancelDraft() {
    setDraftFactuur(null);
    setStatus("");
  }

  async function saveDraft() {
    if (!draftFactuur || !selectedActiveRecord) {
      return;
    }

    setStatus("");
    setIsSaving(true);
    try {
      const normalizedDraft = normalizeFactuur(draftFactuur);
      const nextVersion = createFactuurVersieFromSource(selectedActiveRecord, normalizedDraft);
      const cleanedRows = rows
        .filter(
          (row) =>
            !(
              String(row.bier_id ?? "") === String(selectedActiveRecord.bier_id ?? "") &&
              getRecordYear(row) === getRecordYear(selectedActiveRecord) &&
              isConceptFactuurVersie(row)
            )
        )
        .concat(nextVersion)
        .map((row) => normalizeBerekening(row))
        .filter((row) => !isConceptFactuurVersie(row) || sanitizeFacturen(getInkoopFacturen(row)).length > 0);

      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedRows)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setRows(cleanedRows);
      setDraftFactuur(null);
      setStatus("Factuurversie opgeslagen.");
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
          Klik op een bier om de onderliggende facturen te bekijken. Met `+` start je een nieuwe
          concept-factuurversie.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <div className="wizard-step-card">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Inkoopbieren</div>
            <div className="wizard-panel-text">{bierGroups.length} bieren zichtbaar</div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>Biernaam</th>
                  <th>Datum actief</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bierGroups.length > 0 ? (
                  bierGroups.map((group) => {
                    const activeRecord =
                      group.records.find(
                        (row) =>
                          String(row.status ?? "").toLowerCase() === "definitief" && Boolean(row.is_actief)
                      ) ??
                      group.records.find((row) => String(row.status ?? "").toLowerCase() === "definitief") ??
                      null;
                    const isSelected = group.key === (selectedGroup?.key ?? "");
                    const factuurRows = group.records.flatMap((record) =>
                      getInkoopFacturen(record).map((factuur) => ({
                        versie: `v${Number(record.versie_nummer ?? 0) || 1}`,
                        status: `${String(record.status ?? "")}${Boolean(record.is_actief) ? " · actief" : ""}`,
                        factuurnummer: String(factuur.factuurnummer ?? "").trim() || "-",
                        factuurdatum: String(factuur.factuurdatum ?? "").trim() || "-",
                        regels: getFactuurTotals(factuur).regels,
                        liters: getFactuurTotals(factuur).liters,
                        bedrag: getFactuurTotals(factuur).bedrag
                      }))
                    );

                    return (
                      <Fragment key={group.key}>
                        <tr
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedBeerKey(isSelected ? "" : group.key);
                            setStatus("");
                          }}
                        >
                          <td>
                            <strong>{group.biernaam}</strong>
                            <div className="wizard-panel-text">{`${group.jaar} · ${group.stijl || "-"}`}</div>
                          </td>
                          <td>{String(activeRecord?.effectief_vanaf ?? activeRecord?.finalized_at ?? "").slice(0, 10) || "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="editor-button editor-button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedBeerKey(group.key);
                                startDraftForRecord(activeRecord);
                              }}
                            >
                              +
                            </button>
                          </td>
                        </tr>
                        {isSelected ? (
                          <tr>
                            <td colSpan={3} style={{ background: "rgba(248, 251, 255, 0.9)" }}>
                              <div className="dataset-editor-scroll" style={{ marginTop: "0.2rem" }}>
                                <table className="dataset-editor-table wizard-table-compact">
                                  <thead>
                                    <tr>
                                      <th>Versie</th>
                                      <th>Status</th>
                                      <th>Factuurnummer</th>
                                      <th>Factuurdatum</th>
                                      <th>Regels</th>
                                      <th>Liters</th>
                                      <th>Bedrag</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {factuurRows.length > 0 ? (
                                      factuurRows.map((row, index) => (
                                        <tr key={`${row.versie}-${row.factuurnummer}-${index}`}>
                                          <td>{row.versie}</td>
                                          <td>{row.status}</td>
                                          <td>{row.factuurnummer}</td>
                                          <td>{row.factuurdatum}</td>
                                          <td>{row.regels}</td>
                                          <td>{Number(row.liters).toLocaleString("nl-NL")}</td>
                                          <td>{formatCurrency(Number(row.bedrag))}</td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td className="dataset-empty" colSpan={7}>
                                          Nog geen facturen gevonden voor dit bier.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td className="dataset-empty" colSpan={3}>
                      Nog geen actieve inkoopversies gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {draftFactuur ? (
          <div className="wizard-step-card">
            <div className="wizard-step-header">
              <div>
                <div className="wizard-step-title">Nieuwe factuurversie</div>
              </div>
            </div>

            <div className="wizard-form-grid">
              {[
                { label: "Factuurnummer", key: "factuurnummer", type: "text", required: true },
                { label: "Factuurdatum", key: "factuurdatum", type: "date", required: true },
                { label: "Verzendkosten", key: "verzendkosten", type: "number", required: false },
                { label: "Overige kosten", key: "overige_kosten", type: "number", required: false }
              ].map(({ label, key, type, required }) => (
                <label key={key} className="nested-field">
                  <span>
                    {label}
                    {required ? <span style={{ color: "#c62828" }}> *</span> : null}
                  </span>
                  <input
                    className="dataset-input"
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    value={String(draftFactuur[key] ?? "")}
                    onChange={(event) =>
                      updateDraftField(
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
                    <th>Aantal *</th>
                    <th>Eenheid *</th>
                    <th>Liters *</th>
                    <th>Subfactuurbedrag *</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(draftFactuur.factuurregels) &&
                  (draftFactuur.factuurregels as GenericRecord[]).length > 0 ? (
                    (draftFactuur.factuurregels as GenericRecord[]).map((regel) => (
                      <tr key={String(regel.id)}>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={String(regel.aantal ?? "")}
                            onChange={(event) =>
                              updateDraftRegel(
                                String(regel.id),
                                "aantal",
                                event.target.value === "" ? 0 : Number(event.target.value)
                              )
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="dataset-input"
                            value={String(regel.eenheid ?? "")}
                            onChange={(event) =>
                              updateDraftRegel(String(regel.id), "eenheid", event.target.value)
                            }
                          >
                            <option value="">Selecteer product</option>
                            {unitOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="dataset-input dataset-input-readonly"
                            type="number"
                            step="any"
                            value={String(regel.liters ?? "")}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={String(regel.subfactuurbedrag ?? "")}
                            onChange={(event) =>
                              updateDraftRegel(
                                String(regel.id),
                                "subfactuurbedrag",
                                event.target.value === "" ? 0 : Number(event.target.value)
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-button-table"
                            aria-label="Factuurregel verwijderen"
                            title="Factuurregel verwijderen"
                            onClick={() =>
                              requestDelete(
                                "Factuurregel verwijderen",
                                "Weet je zeker dat je deze factuurregel wilt verwijderen?",
                                () => removeDraftRegel(String(regel.id))
                              )
                            }
                          >
                            <TrashIcon />
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
                  onClick={addDraftRegel}
                >
                  Regel toevoegen
                </button>
              </div>
              <div className="editor-actions-group">
                {status ? <span className="editor-status">{status}</span> : null}
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={cancelDraft}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={saveDraft}
                  disabled={isSaving || !isDraftValid(draftFactuur)}
                >
                  {isSaving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pendingDelete ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-inkoopfacturen-title"
            >
              <div className="confirm-modal-title" id="confirm-inkoopfacturen-title">
                {pendingDelete.title}
              </div>
              <div className="confirm-modal-text">{pendingDelete.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingDelete(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    pendingDelete.onConfirm();
                    setPendingDelete(null);
                  }}
                >
                  Verwijderen
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
