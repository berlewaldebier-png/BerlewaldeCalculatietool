"use client";

import type { RefObject } from "react";

import { ActivationModal, type PendingActivationState } from "@/components/kostprijsbeheer/ActivationModal";
import { ActivateIcon, InfoIcon, SortIcon, WarningIcon } from "@/components/kostprijsbeheer/KostprijsBeheerParts";

export type ActiveCostRow = {
  key: string;
  artikelNaam: string;
  categorie: string;
  effectiefVanaf: string;
  versieLabel: string;
  currentCost: number;
  hasUpdate: boolean;
  isWarning: boolean;
  recommendedVersionId?: string;
  definitiveOptions?: unknown;
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
}: {
  activeCostsRef: RefObject<HTMLDivElement | null>;
  selectedYear: number;
  setSelectedYear: (next: number) => void;
  yearOptions: number[];
  search: string;
  setSearch: (next: string) => void;
  activeSort: { key: "bron"; direction: "asc" | "desc" };
  setActiveSort: (updater: (current: { key: "bron"; direction: "asc" | "desc" }) => { key: "bron"; direction: "asc" | "desc" }) => void;
  activeRows: ActiveCostRow[];
  formatEuro: (value: number) => string;
  pendingActivation: PendingActivationState | null;
  activationStatus: string;
  setPendingActivation: (next: PendingActivationState | null) => void;
  setActivationStatus: (next: string) => void;
}) {
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
            placeholder="Zoek artikel, categorie of bron..."
          />
        </label>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th>Artikel</th>
              <th>Categorie</th>
              <th>Actief sinds</th>
              <th
                style={{ cursor: "pointer" }}
                title="Sorteer op kostprijsversie (bron)"
                onClick={() =>
                  setActiveSort((current) => ({
                    key: "bron",
                    direction: current.direction === "desc" ? "asc" : "desc"
                  }))
                }
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Kostprijsversie (bron)
                  <SortIcon direction={activeSort.direction} />
                </span>
              </th>
              <th>Kostprijs</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {activeRows.length > 0 ? (
              activeRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.artikelNaam}</td>
                  <td>{row.categorie || "-"}</td>
                  <td>{row.effectiefVanaf || "-"}</td>
                  <td>{row.versieLabel}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatEuro(row.currentCost)}</td>
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
                            artikelNaam: row.artikelNaam,
                            categorie: row.categorie,
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
                <td className="dataset-empty" colSpan={7}>
                  Geen actieve kostprijzen gevonden voor {selectedYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingActivation ? (
        <ActivationModal
          pendingActivation={pendingActivation}
          activationStatus={activationStatus}
          setPendingActivation={setPendingActivation}
          setActivationStatus={setActivationStatus}
        />
      ) : null}
    </section>
  );
}
