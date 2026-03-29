"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type PackagingRow = {
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

type BeerOverviewRow = {
  biernaam: string;
  stijl: string;
  alcoholpercentage: number | string;
  belastingsoort: string;
  tarief_accijns: string;
};

type PackagingSource = {
  key: string;
  label: string;
  jaar: number;
  type: "basis" | "samengesteld";
};

type VerkoopstrategieWorkspaceProps = {
  endpoint: string;
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  berekeningen: GenericRecord[];
};

const CHANNELS = ["particulier", "zakelijk", "retail", "horeca", "slijterij"] as const;

function createUiId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMargins(raw: unknown): Record<string, number> {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(CHANNELS.map((channel) => [channel, Number(source[channel] ?? 50)])) as Record<
    string,
    number
  >;
}

function toPackagingKey(kind: "basis" | "samengesteld", label: string) {
  return `${kind}|${label.trim().toLowerCase()}`;
}

function normalizeVerkoopstrategieRow(row: GenericRecord): PackagingRow {
  return {
    id: String(row.id ?? ""),
    record_type: String(row.record_type ?? "verkoopstrategie_verpakking"),
    jaar: Number(row.jaar ?? new Date().getFullYear()),
    bron_jaar: Number(row.bron_jaar ?? new Date().getFullYear()),
    verpakking_key: String(row.verpakking_key ?? ""),
    verpakking: String(row.verpakking ?? ""),
    bron_verkoopstrategie_id: String(row.bron_verkoopstrategie_id ?? ""),
    strategie_type: String(row.strategie_type ?? "handmatig"),
    kanaalmarges: normalizeMargins(row.kanaalmarges),
    _uiId: String(row.id ?? createUiId())
  };
}

function stripInternal(row: PackagingRow) {
  const { _uiId, ...rest } = row;
  return rest;
}

function buildPackagingSources(
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
): PackagingSource[] {
  const basis = basisproducten.map((row) => ({
    key: toPackagingKey("basis", String(row.omschrijving ?? "")),
    label: String(row.omschrijving ?? ""),
    jaar: Number(row.jaar ?? 0),
    type: "basis" as const
  }));

  const samengesteld = samengesteldeProducten.map((row) => ({
    key: toPackagingKey("samengesteld", String(row.omschrijving ?? "")),
    label: String(row.omschrijving ?? ""),
    jaar: Number(row.jaar ?? 0),
    type: "samengesteld" as const
  }));

  return [...basis, ...samengesteld].sort((left, right) => left.label.localeCompare(right.label));
}

function buildBeerOverview(
  selectedYear: number,
  berekeningen: GenericRecord[],
  bieren: GenericRecord[]
): BeerOverviewRow[] {
  const bierByName = new Map(
    bieren.map((bier) => [String(bier.biernaam ?? "").trim().toLowerCase(), bier])
  );

  const unique = new Map<string, BeerOverviewRow>();
  for (const record of berekeningen) {
    if (String(record.status ?? "").trim().toLowerCase() !== "definitief") {
      continue;
    }

    const basisgegevens =
      typeof record.basisgegevens === "object" && record.basisgegevens !== null
        ? (record.basisgegevens as GenericRecord)
        : {};
    const jaar = Number(basisgegevens.jaar ?? 0);
    if (jaar !== selectedYear) {
      continue;
    }

    const biernaam = String(basisgegevens.biernaam ?? "").trim();
    if (!biernaam || unique.has(biernaam.toLowerCase())) {
      continue;
    }

    const stamdata = bierByName.get(biernaam.toLowerCase()) ?? {};
    unique.set(biernaam.toLowerCase(), {
      biernaam,
      stijl: String(stamdata.stijl ?? ""),
      alcoholpercentage:
        stamdata.alcoholpercentage === undefined || stamdata.alcoholpercentage === null
          ? ""
          : Number(stamdata.alcoholpercentage),
      belastingsoort: String(stamdata.belastingsoort ?? ""),
      tarief_accijns: String(stamdata.tarief_accijns ?? "")
    });
  }

  return [...unique.values()].sort((left, right) => left.biernaam.localeCompare(right.biernaam));
}

export function VerkoopstrategieWorkspace({
  endpoint,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  bieren,
  berekeningen
}: VerkoopstrategieWorkspaceProps) {
  const normalizedRows = useMemo(
    () => verkoopprijzen.map((row) => normalizeVerkoopstrategieRow(row)),
    [verkoopprijzen]
  );
  const packagingSources = useMemo(
    () => buildPackagingSources(basisproducten, samengesteldeProducten),
    [basisproducten, samengesteldeProducten]
  );

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const source of packagingSources) {
      if (source.jaar) {
        years.add(source.jaar);
      }
    }
    for (const row of normalizedRows) {
      if (row.jaar) {
        years.add(row.jaar);
      }
    }
    return [...years].sort((left, right) => right - left);
  }, [normalizedRows, packagingSources]);

  const [rows, setRows] = useState<PackagingRow[]>(normalizedRows);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(availableYears[0] ?? new Date().getFullYear());
  const [activeTab, setActiveTab] = useState<"verpakkingen" | "bieren">("verpakkingen");

  const visiblePackagingRows = useMemo(() => {
    const sourcesForYear = packagingSources.filter((row) => row.jaar === selectedYear);
    const existingForYear = rows.filter((row) => row.jaar === selectedYear);

    const merged = sourcesForYear.map((source) => {
      const existing = existingForYear.find((row) => row.verpakking_key === source.key);
      if (existing) {
        return existing;
      }

      return {
        id: "",
        record_type: "verkoopstrategie_verpakking",
        jaar: selectedYear,
        bron_jaar: selectedYear,
        verpakking_key: source.key,
        verpakking: source.label,
        bron_verkoopstrategie_id: "",
        strategie_type: "handmatig",
        kanaalmarges: normalizeMargins({}),
        _uiId: createUiId()
      };
    });

    const additional = existingForYear.filter(
      (row) => !sourcesForYear.some((source) => source.key === row.verpakking_key)
    );

    return [...merged, ...additional];
  }, [packagingSources, rows, selectedYear]);

  const beerOverview = useMemo(
    () => buildBeerOverview(selectedYear, berekeningen, bieren),
    [selectedYear, berekeningen, bieren]
  );

  function syncVisibleRows(nextVisibleRows: PackagingRow[]) {
    setRows((current) => {
      const otherYears = current.filter((row) => row.jaar !== selectedYear);
      return [...otherYears, ...nextVisibleRows];
    });
  }

  function updatePackagingRow(rowId: string, field: keyof PackagingRow, value: unknown) {
    const nextVisibleRows = visiblePackagingRows.map((row) =>
      row._uiId === rowId ? { ...row, [field]: value } : row
    );
    syncVisibleRows(nextVisibleRows);
  }

  function updateMargin(rowId: string, channel: (typeof CHANNELS)[number], value: number) {
    const nextVisibleRows = visiblePackagingRows.map((row) =>
      row._uiId === rowId
        ? {
            ...row,
            kanaalmarges: {
              ...row.kanaalmarges,
              [channel]: value
            }
          }
        : row
    );
    syncVisibleRows(nextVisibleRows);
  }

  function addManualPackagingRow() {
    syncVisibleRows([
      ...visiblePackagingRows,
      {
        id: "",
        record_type: "verkoopstrategie_verpakking",
        jaar: selectedYear,
        bron_jaar: selectedYear,
        verpakking_key: "",
        verpakking: "",
        bron_verkoopstrategie_id: "",
        strategie_type: "handmatig",
        kanaalmarges: normalizeMargins({}),
        _uiId: createUiId()
      }
    ]);
  }

  function deletePackagingRow(rowId: string) {
    syncVisibleRows(visiblePackagingRows.filter((row) => row._uiId !== rowId));
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
        <div className="module-card-title">Verkoopstrategie</div>
        <div className="module-card-text">
          Verpakkingen uit Producten &amp; verpakking worden automatisch per jaar getoond. Daarnaast is er een overzicht
          van alle bieren in datzelfde jaar.
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta">
          <span className="editor-pill">{visiblePackagingRows.length} verpakkingen</span>
          <span className="muted">Jaar selecteren en daarna per tabblad beheren.</span>
        </div>
        <div className="editor-actions-group">
          <label className="nested-field">
            <span>Jaar</span>
            <select
              className="dataset-input"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="tab-strip">
        <button
          type="button"
          className={`tab-button ${activeTab === "verpakkingen" ? "active" : ""}`}
          onClick={() => setActiveTab("verpakkingen")}
        >
          Verpakkingen {selectedYear}
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === "bieren" ? "active" : ""}`}
          onClick={() => setActiveTab("bieren")}
        >
          Bieren {selectedYear}
        </button>
      </div>

      {activeTab === "verpakkingen" ? (
        <div className="nested-editor-list">
          {visiblePackagingRows.length === 0 ? (
            <div className="nested-empty">Nog geen verpakkingen gevonden voor {selectedYear}.</div>
          ) : null}
          {visiblePackagingRows.map((row) => (
            <article key={row._uiId} className="nested-editor-card">
              <div className="nested-editor-card-header">
                <div>
                  <div className="nested-editor-card-title">
                    {row.verpakking || "Nieuwe verpakking"}
                  </div>
                  <div className="nested-editor-card-meta">Key: {row.verpakking_key || "(nog leeg)"}</div>
                </div>
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => deletePackagingRow(row._uiId)}
                >
                  Verwijderen
                </button>
              </div>

              <div className="nested-editor-grid">
                <label className="nested-field">
                  <span>Verpakking</span>
                  <input
                    className="dataset-input"
                    type="text"
                    value={row.verpakking}
                    onChange={(event) => updatePackagingRow(row._uiId, "verpakking", event.target.value)}
                  />
                </label>
                <label className="nested-field">
                  <span>Verpakking key</span>
                  <input
                    className="dataset-input"
                    type="text"
                    value={row.verpakking_key}
                    onChange={(event) => updatePackagingRow(row._uiId, "verpakking_key", event.target.value)}
                  />
                </label>
                <label className="nested-field">
                  <span>Strategietype</span>
                  <input
                    className="dataset-input"
                    type="text"
                    value={row.strategie_type}
                    onChange={(event) => updatePackagingRow(row._uiId, "strategie_type", event.target.value)}
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
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Bier</th>
                <th>Stijl</th>
                <th>Alcohol %</th>
                <th>Belastingsoort</th>
                <th>Tarief accijns</th>
              </tr>
            </thead>
            <tbody>
              {beerOverview.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={5}>
                    Nog geen bieren gevonden voor {selectedYear}.
                  </td>
                </tr>
              ) : (
                beerOverview.map((row) => (
                  <tr key={row.biernaam}>
                    <td>{row.biernaam}</td>
                    <td>{row.stijl}</td>
                    <td>{row.alcoholpercentage}</td>
                    <td>{row.belastingsoort}</td>
                    <td>{row.tarief_accijns}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="editor-actions">
        <div className="editor-actions-group">
          {activeTab === "verpakkingen" ? (
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={addManualPackagingRow}
            >
              Extra verpakking toevoegen
            </button>
          ) : null}
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
