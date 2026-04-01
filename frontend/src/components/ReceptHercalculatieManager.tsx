"use client";

import { Fragment, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type ReceptHercalculatieManagerProps = {
  initialRows: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
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
  row.created_at = String(row.created_at ?? "");
  row.updated_at = String(row.updated_at ?? "");
  row.finalized_at = String(row.finalized_at ?? "");
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

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function formatEuroPerLiter(value: unknown) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value ?? 0));
}

function formatDate(value: unknown) {
  return String(value ?? "").slice(0, 10) || "-";
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

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function ReceptHercalculatieManager({
  initialRows,
  basisproducten,
  samengesteldeProducten,
  kostprijsproductactiveringen
}: ReceptHercalculatieManagerProps) {
  const initial = useMemo(() => initialRows.map((row) => normalizeBerekening(row)), [initialRows]);
  const [rows, setRows] = useState(initial);
  const [selectedBeerKey, setSelectedBeerKey] = useState("");
  const [selectedDraftSourceId, setSelectedDraftSourceId] = useState("");
  const [reason, setReason] = useState("Hercalculatie");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    body: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  const basisById = useMemo(
    () => new Map(basisproducten.map((row) => [String(row.id ?? ""), row])),
    [basisproducten]
  );
  const samengesteldById = useMemo(
    () => new Map(samengesteldeProducten.map((row) => [String(row.id ?? ""), row])),
    [samengesteldeProducten]
  );

  const sourceRows = rows.filter(
    (row) =>
      String(row.status).toLowerCase() === "definitief" &&
      String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase() ===
        "eigen productie"
  );

  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        bierId: string;
        biernaam: string;
        stijl: string;
        jaar: number;
        activeDate: string;
        sourceRows: GenericRecord[];
        hercalculaties: GenericRecord[];
      }
    >();

    rows.forEach((row) => {
      const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "")).toLowerCase();
      if (soort !== "eigen productie") {
        return;
      }
      const basis = (row.basisgegevens as GenericRecord) ?? {};
      const bierId = String(row.bier_id ?? "");
      const jaar = Number(basis.jaar ?? row.jaar ?? 0);
      const key = `${bierId}::${jaar}`;
      const current = grouped.get(key) ?? {
        key,
        bierId,
        biernaam: String(basis.biernaam ?? "Onbekend bier"),
        stijl: String(basis.stijl ?? ""),
        jaar,
        activeDate: "",
        sourceRows: [],
        hercalculaties: []
      };

      if (String(row.status).toLowerCase() === "definitief" && String(row.calculation_variant ?? "origineel") !== "hercalculatie") {
        current.sourceRows.push(row);
      }
      if (
        String(row.calculation_variant ?? "") === "hercalculatie" ||
        String(row.bron_berekening_id ?? "").trim() !== ""
      ) {
        current.hercalculaties.push(row);
      }
      grouped.set(key, current);
    });

    const activationMap = new Map<string, string>();
    (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).forEach((row) => {
      const key = `${String(row.bier_id ?? "")}::${Number(row.jaar ?? 0)}`;
      const current = activationMap.get(key);
      const next = String(row.effectief_vanaf ?? row.updated_at ?? "");
      if (!current || next.localeCompare(current) > 0) {
        activationMap.set(key, next);
      }
    });

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        sourceRows: [...group.sourceRows].sort((left, right) =>
          String(right.finalized_at ?? right.updated_at ?? "").localeCompare(
            String(left.finalized_at ?? left.updated_at ?? "")
          )
        ),
        hercalculaties: [...group.hercalculaties].sort((left, right) =>
          String(right.updated_at ?? right.created_at ?? "").localeCompare(
            String(left.updated_at ?? left.created_at ?? "")
          )
        ),
        activeDate: activationMap.get(group.key) ?? ""
      }))
      .sort((left, right) => left.biernaam.localeCompare(right.biernaam, "nl-NL"));
  }, [kostprijsproductactiveringen, rows]);

  const selectedGroup = groups.find((group) => group.key === selectedBeerKey) ?? null;

  const draftSource =
    selectedGroup?.sourceRows.find((row) => String(row.id) === selectedDraftSourceId) ??
    selectedGroup?.sourceRows[0] ??
    null;

  function requestAction(title: string, body: string, onConfirm: () => Promise<void> | void) {
    setPendingAction({ title, body, onConfirm });
  }

  function getVersionProducts(row: GenericRecord) {
    const producten =
      typeof row.resultaat_snapshot === "object" && row.resultaat_snapshot !== null
        ? ((row.resultaat_snapshot as GenericRecord).producten as GenericRecord | undefined)
        : undefined;
    const out = new Map<string, { id: string; label: string; type: "basis" | "samengesteld" }>();
    const basisRows = Array.isArray(producten?.basisproducten)
      ? (producten?.basisproducten as GenericRecord[])
      : [];
    const samengesteldeRows = Array.isArray(producten?.samengestelde_producten)
      ? (producten?.samengestelde_producten as GenericRecord[])
      : [];

    basisRows.forEach((productRow) => {
      const productId =
        String(productRow.product_id ?? "") ||
        String(
          [...basisById.values()].find(
            (item) => normalizeKey(item.omschrijving) === normalizeKey(productRow.verpakking ?? productRow.verpakkingseenheid)
          )?.id ?? ""
        );
      const label = String(productRow.verpakking ?? productRow.verpakkingseenheid ?? productRow.omschrijving ?? "");
      if (productId && label) {
        out.set(productId, { id: productId, label, type: "basis" });
      }
    });

    samengesteldeRows.forEach((productRow) => {
      const productId =
        String(productRow.product_id ?? "") ||
        String(
          [...samengesteldById.values()].find(
            (item) => normalizeKey(item.omschrijving) === normalizeKey(productRow.verpakking ?? productRow.verpakkingseenheid)
          )?.id ?? ""
        );
      const label = String(productRow.verpakking ?? productRow.verpakkingseenheid ?? productRow.omschrijving ?? "");
      if (productId && label) {
        out.set(productId, { id: productId, label, type: "samengesteld" });
      }
    });

    return [...out.values()];
  }

  function isProductActiveForVersion(row: GenericRecord, productId: string) {
    return (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).some(
      (item) =>
        String(item.kostprijsversie_id ?? "") === String(row.id ?? "") &&
        String(item.product_id ?? "") === productId
    );
  }

  async function saveRows(nextRows: GenericRecord[], successMessage: string) {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(KOSTPRIJSVERSIES_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextRows)
      });
      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }
      setRows(nextRows.map((row) => normalizeBerekening(row)));
      setStatus(successMessage);
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  async function createHercalculatie() {
    if (!draftSource) {
      return;
    }

    const draft = cloneValue(draftSource);
    const now = new Date().toISOString();
    draft.id = createId();
    draft.status = "concept";
    draft.is_actief = false;
    draft.effectief_vanaf = "";
    draft.calculation_variant = "hercalculatie";
    draft.bron_berekening_id = String(draftSource.id);
    draft.brontype = "hercalculatie";
    draft.bron_id = String(draftSource.id);
    draft.hercalculatie_reden = reason.trim() || "Hercalculatie";
    draft.hercalculatie_notitie = note.trim();
    draft.hercalculatie_timestamp = now;
    draft.finalized_at = "";
    draft.created_at = now;
    draft.updated_at = now;
    draft.last_completed_step = 1;

    const nextRows = [draft, ...rows];
    await saveRows(nextRows, "Concept-hercalculatie aangemaakt.");
    setReason("Hercalculatie");
    setNote("");
    setSelectedDraftSourceId("");
  }

  async function activateProduct(versionId: string, productId: string, productLabel: string) {
    setStatus("");
    setIsSaving(true);
    try {
      const response = await fetch(`${KOSTPRIJSVERSIES_API}/${versionId}/activate-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_ids: [productId] })
      });
      if (!response.ok) {
        throw new Error("Activeren mislukt");
      }
      const refreshed = await fetch(KOSTPRIJSVERSIES_API, { cache: "no-store" });
      const refreshedRows = refreshed.ok ? ((await refreshed.json()) as GenericRecord[]) : rows;
      setRows(refreshedRows.map((row) => normalizeBerekening(row)));
      setStatus(`${productLabel} is nu actief voor nieuwe offertes.`);
    } catch {
      setStatus("Activeren mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Recept hercalculeren</div>
        <div className="module-card-text">
          Start nieuwe concept-hercalculaties op basis van definitieve eigen-productieberekeningen.
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <div className="wizard-step-card">
          <div className="wizard-panel-header">
            <div className="wizard-panel-title">Eigen-productiebieren</div>
            <div className="wizard-panel-text">{groups.length} bieren zichtbaar</div>
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
                {groups.length > 0 ? (
                  groups.map((group) => {
                    const isSelected = group.key === selectedBeerKey;
                    return (
                      <Fragment key={group.key}>
                        <tr
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedBeerKey(isSelected ? "" : group.key);
                            setSelectedDraftSourceId("");
                            setStatus("");
                          }}
                        >
                          <td>
                            <strong>{group.biernaam}</strong>
                            <div className="wizard-panel-text">{`${group.jaar} · ${group.stijl || "-"}`}</div>
                          </td>
                          <td>{formatDate(group.activeDate)}</td>
                          <td>
                            <button
                              type="button"
                              className="editor-button editor-button-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedBeerKey(group.key);
                                setSelectedDraftSourceId(String(group.sourceRows[0]?.id ?? ""));
                                setStatus("");
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
                                      <th>Reden</th>
                                      <th>Aangemaakt op</th>
                                      <th>Producten</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.hercalculaties.length > 0 ? (
                                      group.hercalculaties.map((row) => {
                                        const products = getVersionProducts(row);
                                        return (
                                          <tr key={String(row.id ?? "")}>
                                            <td>{`v${Number(row.versie_nummer ?? 0) || 1}`}</td>
                                            <td>{String(row.status ?? "-")}</td>
                                            <td>{String(row.hercalculatie_reden ?? "-")}</td>
                                            <td>{formatDate(row.created_at ?? row.hercalculatie_timestamp)}</td>
                                            <td>
                                              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                                {products.length > 0 ? (
                                                  products.map((product) => {
                                                    const isActive = isProductActiveForVersion(row, product.id);
                                                    const isDefinitive = String(row.status ?? "").toLowerCase() === "definitief";
                                                    return (
                                                      <span
                                                        key={`${String(row.id ?? "")}:${product.id}`}
                                                        className={`status-chip${isActive ? " active" : ""}`}
                                                        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                                                      >
                                                        {product.label}
                                                        {isDefinitive && !isActive ? (
                                                          <button
                                                            type="button"
                                                            className="icon-button-table"
                                                            aria-label={`${product.label} activeren`}
                                                            title={`${product.label} activeren`}
                                                            onClick={() =>
                                                              requestAction(
                                                                "Product activeren",
                                                                `Weet je zeker dat je ${product.label} actief wilt maken voor nieuwe offertes?`,
                                                                () => activateProduct(String(row.id ?? ""), product.id, product.label)
                                                              )
                                                            }
                                                          >
                                                            <SparkIcon />
                                                          </button>
                                                        ) : null}
                                                      </span>
                                                    );
                                                  })
                                                ) : (
                                                  <span className="muted">Nog geen producten gevonden.</span>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    ) : (
                                      <tr>
                                        <td className="dataset-empty" colSpan={5}>
                                          Nog geen hercalculaties gevonden voor dit bier.
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
                      Nog geen definitieve eigen-productieberekeningen gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedBeerKey && draftSource ? (
          <div className="wizard-step-card">
            <div className="wizard-step-header">
              <div>
                <div className="wizard-step-title">Nieuwe hercalculatieversie</div>
                <div className="wizard-step-text">
                  Bron: {String(((draftSource.basisgegevens as GenericRecord)?.biernaam ?? ""))} ·{" "}
                  {String(((draftSource.basisgegevens as GenericRecord)?.jaar ?? ""))}
                </div>
              </div>
            </div>

            <div className="wizard-form-grid">
              <label className="nested-field">
                <span>Bronversie *</span>
                <select
                  className="dataset-input"
                  value={selectedDraftSourceId}
                  onChange={(event) => setSelectedDraftSourceId(event.target.value)}
                >
                  {selectedGroup?.sourceRows.map((row) => (
                    <option key={String(row.id ?? "")} value={String(row.id ?? "")}>
                      {`v${Number(row.versie_nummer ?? 0) || 1} · ${formatDate(row.finalized_at ?? row.updated_at)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nested-field">
                <span>
                  Reden
                  <span style={{ color: "#c62828" }}> *</span>
                </span>
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

            <div className="editor-actions">
              <div className="editor-actions-group" />
              <div className="editor-actions-group">
                {status ? <span className="editor-status">{status}</span> : null}
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => {
                    setSelectedDraftSourceId("");
                    setReason("Hercalculatie");
                    setNote("");
                    setStatus("");
                  }}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={createHercalculatie}
                  disabled={isSaving || !selectedDraftSourceId || !reason.trim()}
                >
                  {isSaving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pendingAction ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-hercalculatie-title"
            >
              <div className="confirm-modal-title" id="confirm-hercalculatie-title">
                {pendingAction.title}
              </div>
              <div className="confirm-modal-text">{pendingAction.body}</div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingAction(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={async () => {
                    await pendingAction.onConfirm();
                    setPendingAction(null);
                  }}
                >
                  Bevestigen
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
