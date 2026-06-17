"use client";

import { Fragment, type RefObject } from "react";
import { useMemo, useState } from "react";

import { ActivationModal, type PendingActivationState } from "@/components/kostprijsbeheer/ActivationModal";
import { ActivateIcon, InfoIcon, WarningIcon } from "@/components/kostprijsbeheer/KostprijsBeheerParts";
import { SortButton } from "@/components/table/TableControls";

type VersionOption = {
  id: string;
  label: string;
  cost: number | null;
  deltaEuro: number | null;
  deltaPct: number | null;
  sortKey: string;
};

export type ActiveCostRow = {
  key: string;
  artikelNaam: string;
  bierNaam?: string;
  groupLabel?: string;
  categorie: string;
  effectiefVanaf: string;
  versieLabel: string;
  versieTimestamp?: number;
  currentCost: number | null;
  hasUpdate: boolean;
  isWarning: boolean;
  recommendedVersionId?: string;
  definitiveOptions?: VersionOption[];
};

export function ActiveKostprijzenSection({
  activeCostsRef,
  selectedYear,
  setSelectedYear,
  yearOptions,
  search,
  setSearch,
  activeSort,
  setActiveSort,
  activeRows,
  formatEuro,
  pendingActivation,
  activationStatus,
  setPendingActivation,
  setActivationStatus,
  onActivateVersion,
}: {
  activeCostsRef: RefObject<HTMLDivElement | null>;
  selectedYear: number;
  setSelectedYear: (next: number) => void;
  yearOptions: number[];
  search: string;
  setSearch: (next: string) => void;
  activeSort: { key: "bron" | "artikel" | "categorie" | "since" | "kostprijs"; direction: "asc" | "desc" };
  setActiveSort: (updater: (current: { key: "bron" | "artikel" | "categorie" | "since" | "kostprijs"; direction: "asc" | "desc" }) => { key: "bron" | "artikel" | "categorie" | "since" | "kostprijs"; direction: "asc" | "desc" }) => void;
  activeRows: ActiveCostRow[];
  formatEuro: (value: number) => string;
  pendingActivation: PendingActivationState | null;
  activationStatus: string;
  setPendingActivation: (next: PendingActivationState | null) => void;
  setActivationStatus: (next: string) => void;
  onActivateVersion: (versionId: string) => Promise<void>;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [showVersions, setShowVersions] = useState(false);
  const [openVersionRows, setOpenVersionRows] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; bierNaam: string; categorie: string; rows: ActiveCostRow[] }>();
    activeRows.forEach((row) => {
      const bierNaam = String(row.groupLabel || row.bierNaam || row.categorie || "Zonder bier").trim();
      const categorie = String(row.categorie || "").trim();
      const key = `${bierNaam.toLowerCase()}|${categorie.toLowerCase()}`;
      const group = map.get(key) ?? { key, bierNaam, categorie, rows: [] };
      group.rows.push(row);
      map.set(key, group);
    });
    return Array.from(map.values()).sort((a, b) => a.bierNaam.localeCompare(b.bierNaam, "nl-NL"));
  }, [activeRows]);

  const allOpen = useMemo(() => Object.fromEntries(groups.map((group) => [group.key, true])), [groups]);

  function toggleSort(key: "bron" | "artikel" | "categorie" | "since" | "kostprijs") {
    setActiveSort((cur) => ({ key, direction: cur.key === key && cur.direction === "desc" ? "asc" : "desc" }));
  }

  function openActivationModal(row: ActiveCostRow, selectedOptionId?: string) {
    const options = Array.isArray(row.definitiveOptions) ? row.definitiveOptions : [];
    setActivationStatus("");
    setPendingActivation({
      artikelNaam: row.artikelNaam,
      categorie: row.categorie,
      jaar: selectedYear,
      currentVersionLabel: row.versieLabel,
      currentCost: row.currentCost,
      options,
      selectedOptionId: selectedOptionId || String(row.recommendedVersionId ?? ""),
    });
  }

  function formatDelta(option: VersionOption) {
    if (option.deltaEuro == null) return "-";
    const pct = option.deltaPct == null ? "-" : `${option.deltaPct.toFixed(1)}%`;
    return `${formatEuro(option.deltaEuro)} / ${pct}`;
  }

  return (
    <section className="module-card" ref={activeCostsRef}>
      <div className="module-card-header">
        <div className="module-card-title">Actieve kostprijzen</div>
        <div className="module-card-text">
          Overzicht van de actieve kostprijsversie per artikel, product en jaar (bron: activaties).
        </div>
      </div>

      <div className="wizard-form-grid" style={{ alignItems: "end" }}>
        <label className="nested-field">
          <span>Jaar</span>
          <select className="dataset-input" value={String(selectedYear)} onChange={(event) => setSelectedYear(Number(event.target.value))}>
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
            placeholder="Zoek artikel, categorie of bron..."
          />
        </label>
      </div>

      <div className="editor-actions" style={{ marginTop: 12, marginBottom: 12 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups(allOpen)}>
            Alles openen
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenGroups({})}>
            Alles sluiten
          </button>
          <button
            type="button"
            className={`editor-button ${showVersions ? "" : "editor-button-secondary"}`}
            onClick={() => {
              setShowVersions((current) => !current);
              setOpenVersionRows({});
            }}
          >
            {showVersions ? "Alleen actief" : "Versies tonen"}
          </button>
        </div>
        <div className="editor-toolbar-actions" style={{ gap: 8, display: "flex", alignItems: "center" }}>
          <SortButton label="Artikel" active={activeSort.key === "artikel"} dir={activeSort.direction} onClick={() => toggleSort("artikel")} />
          <SortButton label="Bron" active={activeSort.key === "bron"} dir={activeSort.direction} onClick={() => toggleSort("bron")} />
          <SortButton label="Kostprijs" active={activeSort.key === "kostprijs"} dir={activeSort.direction} onClick={() => toggleSort("kostprijs")} />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="dataset-empty" style={{ padding: "1rem" }}>
          Geen actieve kostprijzen gevonden voor {selectedYear}.
        </div>
      ) : (
        <div className="wizard-stack">
          {groups.map((group) => {
            const isOpen = openGroups[group.key] ?? false;
            return (
              <section key={group.key} className="module-card compact-card">
                <button
                  type="button"
                  className="module-card-title"
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: "transparent", border: 0, padding: 0, textAlign: "left" }}
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                >
                  <span>{isOpen ? "v" : ">"} {group.bierNaam}</span>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {group.categorie ? <span className="pill">{group.categorie}</span> : null}
                    <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
                  </span>
                </button>

                {isOpen ? (
                  <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                    <table className="dataset-editor-table">
                      <thead>
                        <tr>
                          <th>Artikel</th>
                          <th>Actief sinds</th>
                          <th>Kostprijsversie (bron)</th>
                          <th>Kostprijs</th>
                          <th />
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const options = Array.isArray(row.definitiveOptions) ? row.definitiveOptions : [];
                          const versionRowOpen = Boolean(openVersionRows[row.key]);
                          return (
                            <Fragment key={row.key}>
                              <tr>
                                <td>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    {showVersions ? (
                                      <button
                                        type="button"
                                        className="icon-button-table icon-button-neutral"
                                        aria-label={versionRowOpen ? "Versies inklappen" : "Versies uitklappen"}
                                        title={versionRowOpen ? "Versies inklappen" : "Versies uitklappen"}
                                        onClick={() =>
                                          setOpenVersionRows((current) => ({
                                            ...current,
                                            [row.key]: !versionRowOpen,
                                          }))
                                        }
                                      >
                                        {versionRowOpen ? "v" : ">"}
                                      </button>
                                    ) : null}
                                    <span>{row.artikelNaam}</span>
                                  </span>
                                </td>
                                <td>{row.effectiefVanaf || "-"}</td>
                                <td>{row.versieLabel}</td>
                                <td style={{ whiteSpace: "nowrap" }}>{row.currentCost == null ? "-" : formatEuro(row.currentCost)}</td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {row.hasUpdate ? (
                                    <span style={{ display: "inline-flex", gap: 6 }}>
                                      <button type="button" className="icon-button-table icon-button-neutral" aria-label="Info" title="Nieuwe definitieve versie is beschikbaar">
                                        <InfoIcon />
                                      </button>
                                      {row.isWarning ? (
                                        <button type="button" className="icon-button-table" aria-label="Waarschuwing" title="Nieuwe versie is 10% hoger!">
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
                                      onClick={() => openActivationModal(row)}
                                    >
                                      <ActivateIcon />
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                              {showVersions && versionRowOpen ? (
                                <tr>
                                  <td colSpan={6} style={{ padding: 0 }}>
                                    <div className="nested-card" style={{ margin: "8px 0 12px 0" }}>
                                      <table className="dataset-editor-table">
                                        <thead>
                                          <tr>
                                            <th>Versie</th>
                                            <th>Status</th>
                                            <th>Kostprijs</th>
                                            <th>Verschil</th>
                                            <th />
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr>
                                            <td>{row.versieLabel}</td>
                                            <td><span className="status-pill status-ok">actief</span></td>
                                            <td>{row.currentCost == null ? "-" : formatEuro(row.currentCost)}</td>
                                            <td>-</td>
                                            <td />
                                          </tr>
                                          {options.length === 0 ? (
                                            <tr>
                                              <td colSpan={5} className="muted">Geen kandidaatversies voor dit artikel.</td>
                                            </tr>
                                          ) : (
                                            options.map((option) => (
                                              <tr key={option.id}>
                                                <td>{option.label}</td>
                                                <td><span className="status-pill">kandidaat</span></td>
                                                <td>{option.cost == null ? "-" : formatEuro(option.cost)}</td>
                                                <td>{formatDelta(option)}</td>
                                                <td style={{ textAlign: "right" }}>
                                                  <button
                                                    type="button"
                                                    className="icon-button-table"
                                                    aria-label="Maak actief"
                                                    title="Maak deze versie actief"
                                                    onClick={() => openActivationModal(row, option.id)}
                                                  >
                                                    <ActivateIcon />
                                                  </button>
                                                </td>
                                              </tr>
                                            ))
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10, opacity: 0.75 }}>Totaal {activeRows.length} actieve kostprijsregels.</div>

      {pendingActivation ? (
        <ActivationModal
          pendingActivation={pendingActivation}
          activationStatus={activationStatus}
          setPendingActivation={setPendingActivation}
          setActivationStatus={setActivationStatus}
          onActivateVersion={onActivateVersion}
        />
      ) : null}
    </section>
  );
}
