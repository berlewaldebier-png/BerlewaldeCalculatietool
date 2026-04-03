"use client";

import { useMemo, useState } from "react";

import { BerekeningenWizard } from "@/components/BerekeningenWizard";

type GenericRecord = Record<string, unknown>;

type KostprijsBeheerWorkspaceProps = {
  berekeningen: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  productie: Record<string, GenericRecord>;
  vasteKosten: Record<string, GenericRecord[]>;
  tarievenHeffingen: GenericRecord[];
};

type WorkspaceMode = "landing" | "select-existing" | "wizard-new" | "wizard-edit";
type FilterMode = "all" | "concept" | "definitief";

export function KostprijsBeheerWorkspace({
  berekeningen,
  kostprijsproductactiveringen,
  basisproducten,
  samengesteldeProducten,
  bieren,
  productie,
  vasteKosten,
  tarievenHeffingen
}: KostprijsBeheerWorkspaceProps) {
  const [currentBerekeningen, setCurrentBerekeningen] = useState<GenericRecord[]>(berekeningen);
  const [mode, setMode] = useState<WorkspaceMode>("landing");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingActivation, setPendingActivation] = useState<null | {
    bierNaam: string;
    productNaam: string;
    jaar: number;
    currentVersionLabel: string;
    currentCost: number | null;
    options: Array<{
      id: string;
      label: string;
      cost: number | null;
      deltaEuro: number | null;
      deltaPct: number | null;
      sortKey: string;
    }>;
    selectedOptionId: string;
  }>(null);
  const [activationStatus, setActivationStatus] = useState("");

  function formatEuro(value: number | null) {
    if (value === null || !Number.isFinite(value)) {
      return "-";
    }
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatPct(value: number | null) {
    if (value === null || !Number.isFinite(value)) {
      return "-";
    }
    return `${new Intl.NumberFormat("nl-NL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value)}%`;
  }

  function getSnapshotPackagingLabel(row: GenericRecord) {
    return String((row as any)?.verpakking ?? (row as any)?.verpakkingseenheid ?? (row as any)?.omschrijving ?? "");
  }

  function getSnapshotProductCost(row: GenericRecord) {
    const explicit = Number((row as any)?.kostprijs ?? Number.NaN);
    if (Number.isFinite(explicit)) {
      return explicit;
    }
    const primaire = Number((row as any)?.primaire_kosten ?? (row as any)?.variabele_kosten ?? 0);
    const verpakking = Number((row as any)?.verpakkingskosten ?? 0);
    const vaste = Number((row as any)?.vaste_kosten ?? (row as any)?.vaste_directe_kosten ?? 0);
    const accijns = Number((row as any)?.accijns ?? 0);
    return primaire + verpakking + vaste + accijns;
  }

  function buildVersionLabel(version: GenericRecord | undefined) {
    if (!version) {
      return "Onbekende kostprijsversie";
    }
    const versieNummer = Number((version as any)?.versie_nummer ?? 0) || 0;
    const type = String((version as any)?.type ?? "");
    const brontype = String((version as any)?.brontype ?? "");
    const status = String((version as any)?.status ?? "");
    const invoer = ((version as any)?.invoer ?? {}) as any;
    const factuur = (invoer?.inkoop ?? {}) as any;
    const factuurRef = factuur?.factuurnummer
      ? `${String(factuur.factuurnummer)} ${String(factuur.factuurdatum ?? "")}`.trim()
      : "";
    const bron = brontype === "factuur" && factuurRef ? `factuur ${factuurRef}` : brontype || "-";
    const statusLabel = status ? status.toLowerCase() : "";
    const parts = [`v${versieNummer || 0}`, type || "-", bron].filter(Boolean);
    if (statusLabel && statusLabel !== "definitief") {
      parts.push(statusLabel);
    }
    return parts.join(" · ");
  }

  const productionYears = useMemo(() => {
    const years = Object.keys(productie)
      .filter((value) => /^\d+$/.test(value))
      .map((value) => Number(value))
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    return years;
  }, [productie]);

  const activationYears = useMemo(() => {
    const years = new Set<number>();
    (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).forEach(
      (row) => {
        const year = Number((row as any)?.jaar ?? 0) || 0;
        if (year > 0) {
          years.add(year);
        }
      }
    );
    return Array.from(years).sort((a, b) => a - b);
  }, [kostprijsproductactiveringen]);

  const yearOptions = useMemo(() => {
    const merged = new Set<number>([...productionYears, ...activationYears]);
    return Array.from(merged).sort((a, b) => a - b);
  }, [activationYears, productionYears]);

  const defaultYear = useMemo(() => {
    const now = new Date().getFullYear();
    if (productionYears.includes(now)) {
      return now;
    }
    if (productionYears.length > 0) {
      return productionYears[productionYears.length - 1];
    }
    if (activationYears.length > 0) {
      return activationYears[activationYears.length - 1];
    }
    return now;
  }, [activationYears, productionYears]);

  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);

  const bierenById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(bieren) ? bieren : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const naam = String((row as any)?.naam ?? (row as any)?.biernaam ?? "");
      if (id && naam) {
        map.set(id, naam);
      }
    });
    return map;
  }, [bieren]);

  const basisById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(basisproducten) ? basisproducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const label = String((row as any)?.omschrijving ?? "");
      if (id && label) {
        map.set(id, label);
      }
    });
    return map;
  }, [basisproducten]);

  const samengesteldById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(samengesteldeProducten) ? samengesteldeProducten : []).forEach((row) => {
      const id = String((row as any)?.id ?? "");
      const label = String((row as any)?.omschrijving ?? "");
      if (id && label) {
        map.set(id, label);
      }
    });
    return map;
  }, [samengesteldeProducten]);

  const berekeningenById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    currentBerekeningen.forEach((row) => {
      const id = String((row as any)?.id ?? "");
      if (id) {
        map.set(id, row);
      }
    });
    return map;
  }, [currentBerekeningen]);

  const activeRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const warningThresholdPct = 10;
    const rows = (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [])
      .filter((row) => Number((row as any)?.jaar ?? 0) === selectedYear)
      .map((row) => {
        const bierId = String((row as any)?.bier_id ?? "");
        const productId = String((row as any)?.product_id ?? "");
        const productType = String((row as any)?.product_type ?? "");
        const versieId = String((row as any)?.kostprijsversie_id ?? "");
        const effectiefVanaf = String((row as any)?.effectief_vanaf ?? "");

        const bierNaam = bierenById.get(bierId) ?? bierId ?? "-";
        const productNaam =
          basisById.get(productId) ?? samengesteldById.get(productId) ?? productId ?? "-";

        const versie = versieId ? berekeningenById.get(versieId) : undefined;
        const versieNummer = Number((versie as any)?.versie_nummer ?? 0) || 0;
        const type = String((versie as any)?.type ?? "");
        const brontype = String((versie as any)?.brontype ?? "");
        const invoer = ((versie as any)?.invoer ?? {}) as any;
        const factuur = (invoer?.inkoop ?? {}) as any;
        const factuurRef = factuur?.factuurnummer
          ? `${String(factuur.factuurnummer)} ${String(factuur.factuurdatum ?? "")}`.trim()
          : "";
        const bron =
          brontype === "factuur" && factuurRef ? `factuur ${factuurRef}` : brontype || "-";

        const versieLabel = buildVersionLabel(versieId ? versie : undefined);

        const packagingLabel =
          basisById.get(productId) ?? samengesteldById.get(productId) ?? "";
        const producten =
          (versie as any)?.resultaat_snapshot && typeof (versie as any)?.resultaat_snapshot === "object"
            ? (((versie as any).resultaat_snapshot as any).producten as any)
            : undefined;
        const basisSnapshot = Array.isArray(producten?.basisproducten) ? (producten.basisproducten as GenericRecord[]) : [];
        const samengesteldSnapshot = Array.isArray(producten?.samengestelde_producten)
          ? (producten.samengestelde_producten as GenericRecord[])
          : [];
        const matchingSnapshotRow =
          packagingLabel
            ? [...basisSnapshot, ...samengesteldSnapshot].find(
                (item) => String(getSnapshotPackagingLabel(item)).trim().toLowerCase() === String(packagingLabel).trim().toLowerCase()
              )
            : undefined;
        const currentCost =
          matchingSnapshotRow && packagingLabel ? getSnapshotProductCost(matchingSnapshotRow) : null;

        const isVersionForYearAndBier = (record: GenericRecord) => {
          const recordYear = Number((record as any)?.jaar ?? (record as any)?.basisgegevens?.jaar ?? 0) || 0;
          if (recordYear !== selectedYear) return false;
          return String((record as any)?.bier_id ?? "") === bierId;
        };

        const affectsProduct = (record: GenericRecord) => {
          if (!packagingLabel) return false;
          const statusValue = String((record as any)?.status ?? "").toLowerCase();

          // Definitive versions must have a snapshot containing this packaging label.
          if (statusValue === "definitief") {
            const snapshot =
              (record as any)?.resultaat_snapshot && typeof (record as any)?.resultaat_snapshot === "object"
                ? (((record as any).resultaat_snapshot as any).producten as any)
                : undefined;
            const rows = [
              ...(Array.isArray(snapshot?.basisproducten) ? (snapshot.basisproducten as GenericRecord[]) : []),
              ...(Array.isArray(snapshot?.samengestelde_producten)
                ? (snapshot.samengestelde_producten as GenericRecord[])
                : [])
            ];
            return rows.some(
              (item) =>
                String(getSnapshotPackagingLabel(item)).trim().toLowerCase() ===
                String(packagingLabel).trim().toLowerCase()
            );
          }

          // Concept (factuur) versions don't have a snapshot; infer by invoice unit id inclusion.
          const brontypeValue = String((record as any)?.brontype ?? "").toLowerCase();
          if (brontypeValue !== "factuur") return false;
          const invoer = ((record as any)?.invoer ?? {}) as any;
          const inkoop = (invoer?.inkoop ?? {}) as any;
          const facturen = Array.isArray(inkoop?.facturen) ? inkoop.facturen : [];
          for (const factuur of facturen) {
            const regels = Array.isArray((factuur as any)?.factuurregels) ? (factuur as any).factuurregels : [];
            for (const regel of regels) {
              if (String((regel as any)?.eenheid ?? "").trim() === String(productId)) {
                return true;
              }
            }
          }
          return false;
        };

        const activeVersion = versieId ? berekeningenById.get(versieId) : undefined;
        const activeFinalized = String((activeVersion as any)?.finalized_at ?? "");
        const activeUpdated = String((activeVersion as any)?.updated_at ?? "");

        const candidates = currentBerekeningen
          .filter((record) => isVersionForYearAndBier(record))
          .filter((record) => String((record as any)?.id ?? "") !== versieId)
          .filter((record) => affectsProduct(record));

        const definitiveCandidates = candidates
          .filter((record) => String((record as any)?.status ?? "").toLowerCase() === "definitief")
          .filter((record) => {
            const finalized = String((record as any)?.finalized_at ?? "");
            const updated = String((record as any)?.updated_at ?? "");
            return finalized > activeFinalized || updated > activeUpdated;
          })
          .map((record) => {
            const snapshot =
              (record as any)?.resultaat_snapshot && typeof (record as any)?.resultaat_snapshot === "object"
                ? (((record as any).resultaat_snapshot as any).producten as any)
                : undefined;
            const rows = snapshot
              ? [
                  ...(Array.isArray(snapshot?.basisproducten) ? (snapshot.basisproducten as GenericRecord[]) : []),
                  ...(Array.isArray(snapshot?.samengestelde_producten)
                    ? (snapshot.samengestelde_producten as GenericRecord[])
                    : [])
                ]
              : [];
            const match =
              packagingLabel
                ? rows.find(
                    (item) =>
                      String(getSnapshotPackagingLabel(item)).trim().toLowerCase() ===
                      String(packagingLabel).trim().toLowerCase()
                  )
                : undefined;
            const cost = match && packagingLabel ? getSnapshotProductCost(match) : null;
            const deltaEuro = currentCost !== null && cost !== null ? cost - currentCost : null;
            const deltaPct =
              currentCost !== null && cost !== null && currentCost > 0
                ? (deltaEuro as number) / currentCost * 100
                : null;
            const versionId = String((record as any)?.id ?? "");
            const updated = String((record as any)?.updated_at ?? "");
            const finalized = String((record as any)?.finalized_at ?? "");
            const versieNummer = Number((record as any)?.versie_nummer ?? 0) || 0;
            const sortKey = `${finalized || updated}|${updated}|${String(versieNummer).padStart(6, "0")}|${versionId}`;
            return {
              id: versionId,
              label: buildVersionLabel(record),
              cost,
              deltaEuro,
              deltaPct,
              sortKey
            };
          })
          .filter((option) => option.id)
          .sort((a, b) => b.sortKey.localeCompare(a.sortKey));

        const recommended = definitiveCandidates[0];
        const recommendedVersionId = recommended?.id ?? "";
        const deltaEuro = recommended?.deltaEuro ?? null;
        const deltaPct = recommended?.deltaPct ?? null;

        const hasUpdate = Boolean(recommendedVersionId) && recommendedVersionId !== versieId;
        const isWarning = hasUpdate && deltaPct !== null && deltaPct >= warningThresholdPct;

        return {
          key: `${bierId}|${productId}`,
          bierNaam,
          productNaam,
          productType,
          effectiefVanaf,
          versieId,
          versieLabel,
          currentCost,
          recommendedVersionId,
          definitiveOptions: definitiveCandidates,
          hasUpdate,
          isWarning,
          deltaEuro,
          deltaPct
        };
      });

    if (!q) {
      return rows.sort((a, b) => (a.bierNaam + a.productNaam).localeCompare(b.bierNaam + b.productNaam));
    }

    return rows
      .filter((row) => {
        const hay = `${row.bierNaam} ${row.productNaam} ${row.versieLabel}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.bierNaam + a.productNaam).localeCompare(b.bierNaam + b.productNaam));
  }, [basisById, berekeningenById, bierenById, currentBerekeningen, kostprijsproductactiveringen, search, samengesteldById, selectedYear]);

  function InfoIcon() {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 10.5v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 7.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  function WarningIcon() {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M12 3 22 20H2L12 3Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M12 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  function ActivateIcon() {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 14v6h16v-6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  const counts = useMemo(() => {
    const concept = currentBerekeningen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "concept"
    ).length;
    const definitief = currentBerekeningen.filter(
      (row) => String(row.status ?? "").trim().toLowerCase() === "definitief"
    ).length;

    return {
      all: currentBerekeningen.length,
      concept,
      definitief
    };
  }, [currentBerekeningen]);

  const filteredRows = useMemo(() => {
    return currentBerekeningen.filter((row) => {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (filterMode === "concept") {
        return status === "concept";
      }
      if (filterMode === "definitief") {
        return status === "definitief";
      }
      return true;
    });
  }, [currentBerekeningen, filterMode]);

  if (mode === "wizard-new") {
    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        startWithNew
        onRowsChange={setCurrentBerekeningen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("landing")}
      />
    );
  }

  if (mode === "wizard-edit" && selectedId) {
    return (
      <BerekeningenWizard
        initialRows={currentBerekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        initialSelectedId={selectedId}
        onRowsChange={setCurrentBerekeningen}
        onFinish={() => setMode("landing")}
        onBackToLanding={() => setMode("select-existing")}
      />
    );
  }

  if (mode === "select-existing") {
    return (
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Bestaande kostprijsversie aanpassen</div>
          <div className="module-card-text">
            Kies een concept of definitieve kostprijsversie en open daarna de wizard.
          </div>
        </div>

        <div className="kostprijs-toolbar">
          <div className="kostprijs-filter-tabs">
            {[
              ["all", `Alles (${counts.all})`],
              ["concept", `Concept (${counts.concept})`],
              ["definitief", `Definitief (${counts.definitief})`]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`tab-button${filterMode === value ? " active" : ""}`}
                onClick={() => setFilterMode(value as FilterMode)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => setMode("landing")}
          >
            Terug
          </button>
        </div>

        <div className="kostprijs-record-grid">
          {filteredRows.map((row) => {
            const basis = (row.basisgegevens as GenericRecord) ?? {};
            const type = (row.soort_berekening as GenericRecord) ?? {};
            return (
              <button
                key={String(row.id)}
                type="button"
                className="kostprijs-record-card"
                onClick={() => {
                  setSelectedId(String(row.id));
                  setMode("wizard-edit");
                }}
              >
                <div className="kostprijs-record-title">
                  {String(basis.biernaam ?? "Onbekende berekening")}
                </div>
                <div className="kostprijs-record-meta">
                  {String(basis.jaar ?? "-")} | {String(type.type ?? "-")} | {String(row.status ?? "-")}
                  {Boolean(row.is_actief) ? " | actief" : ""}
                  {Number(row.versie_nummer ?? 0) > 0 ? ` | v${Number(row.versie_nummer)}` : ""}
                </div>
                <div className="kostprijs-record-text">
                  {String(basis.stijl ?? "Geen stijl opgegeven")}
                </div>
              </button>
            );
          })}
          {filteredRows.length === 0 ? (
            <div className="empty-state-card">
              Geen berekeningen gevonden voor deze selectie.
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Kostprijs beheren</div>
          <div className="module-card-text">
          Kies of je een nieuwe kostprijsversie wilt starten of een bestaande versie wilt aanpassen.
          </div>
        </div>

      <div className="kostprijs-choice-grid">
        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("wizard-new")}
        >
          <div className="dashboard-quick-card-title">Nieuwe berekening</div>
          <div className="dashboard-quick-card-text">
            Start direct een nieuwe kostprijswizard voor een bier of productflow.
          </div>
        </button>

        <button
          type="button"
          className="dashboard-quick-card kostprijs-choice-card"
          onClick={() => setMode("select-existing")}
        >
          <div className="dashboard-quick-card-title">Bestaande aanpassen</div>
          <div className="dashboard-quick-card-text">
            Open een concept of definitieve kostprijsversie en werk deze verder uit in de wizard.
          </div>
        </button>
      </div>

      <div style={{ marginTop: 18 }} />

      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Actieve kostprijzen</div>
          <div className="module-card-text">
            Overzicht van de actieve kostprijsversie per bier, product en jaar (bron: activaties).
          </div>
        </div>

        <div className="wizard-form-grid" style={{ alignItems: "end" }}>
          <label className="nested-field">
            <span>Jaar</span>
            <select
              className="dataset-input"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="nested-field">
            <span>Zoeken</span>
            <input
              className="dataset-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Zoek bier, product of bron..."
            />
          </label>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Actief sinds</th>
                <th>Kostprijsversie (bron)</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {activeRows.length > 0 ? (
                activeRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.bierNaam}</td>
                    <td>
                      {row.productNaam}
                      {row.productType ? ` (${row.productType})` : ""}
                    </td>
                    <td>{row.effectiefVanaf || "-"}</td>
                    <td>{row.versieLabel}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {row.hasUpdate ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button
                            type="button"
                            className="icon-button-table icon-button-neutral"
                            aria-label="Info"
                            title="Nieuwe definitieve versie is beschikbaar"
                          >
                            <InfoIcon />
                          </button>
                          {row.isWarning ? (
                            <button
                              type="button"
                              className="icon-button-table"
                              aria-label="Waarschuwing"
                              title="Nieuwe versie is 10% hoger!"
                            >
                              <WarningIcon />
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {row.hasUpdate ? (
                        <button
                          type="button"
                          className="icon-button-table"
                          aria-label="Activeer nieuwe versie"
                          title="Activeer nieuwe versie"
                          onClick={() => {
                            setActivationStatus("");
                            setPendingActivation({
                              bierNaam: row.bierNaam,
                              productNaam: row.productNaam,
                              jaar: selectedYear,
                              currentVersionLabel: row.versieLabel,
                              currentCost: row.currentCost,
                              options: Array.isArray((row as any).definitiveOptions)
                                ? ((row as any).definitiveOptions as any[])
                                : [],
                              selectedOptionId: String(row.recommendedVersionId ?? "")
                            });
                          }}
                        >
                          <ActivateIcon />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="dataset-empty" colSpan={6}>
                    Geen actieve kostprijzen gevonden voor {selectedYear}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pendingActivation ? (
          <div className="confirm-modal-overlay" role="presentation">
            <div
              className="confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-activate-title"
            >
              <div className="confirm-modal-title" id="confirm-activate-title">
                Activeer nieuwe kostprijsversie
              </div>
              <div className="confirm-modal-text">
                <strong>
                  {pendingActivation.bierNaam} · {pendingActivation.productNaam} · {pendingActivation.jaar}
                </strong>
                <div style={{ marginTop: 10 }} />
                <div>
                  <div>
                    <strong>Huidig actief</strong>: {pendingActivation.currentVersionLabel}
                  </div>
                  <div>Kostprijs: {formatEuro(pendingActivation.currentCost)}</div>
                </div>
                <div style={{ marginTop: 10 }} />
                <div>
                  <div>
                    <strong>Nieuwe definitieve versie</strong>
                  </div>
                  <select
                    className="dataset-input"
                    value={pendingActivation.selectedOptionId}
                    onChange={(event) =>
                      setPendingActivation({
                        ...pendingActivation,
                        selectedOptionId: event.target.value
                      })
                    }
                  >
                    {pendingActivation.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}{" "}
                        {option.cost !== null
                          ? `— ${formatEuro(option.cost)} (${formatEuro(option.deltaEuro)} / ${formatPct(option.deltaPct)})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginTop: 10 }} />
                {(() => {
                  const selected = pendingActivation.options.find(
                    (option) => option.id === pendingActivation.selectedOptionId
                  );
                  return (
                    <div>
                      Verschil: {formatEuro(selected?.deltaEuro ?? null)} ({formatPct(selected?.deltaPct ?? null)})
                    </div>
                  );
                })()}
                <div style={{ marginTop: 10 }} />
                <div className="muted">
                  Nieuwe berekeningen/offertes voor dit product gaan na activatie deze nieuwe kostprijsversie gebruiken.
                  Bestaande offertes blijven ongewijzigd.
                </div>
                {activationStatus ? (
                  <div style={{ marginTop: 10 }} className="editor-status">
                    {activationStatus}
                  </div>
                ) : null}
              </div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setPendingActivation(null)}
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => {
                    setActivationStatus(
                      "Doorzetten is nog een placeholder. Gebruik voorlopig Nieuw jaar voorbereiden > Kostprijs activeren."
                    );
                    setTimeout(() => setPendingActivation(null), 900);
                  }}
                >
                  Doorzetten
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
