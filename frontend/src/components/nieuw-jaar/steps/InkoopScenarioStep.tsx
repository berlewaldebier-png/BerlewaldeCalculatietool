"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type InkoopScenarioRow = {
  skuId?: string;
  bierId: string;
  biernaam: string;
  productId: string;
  productType: string;
  isDerived?: boolean;
  canEdit?: boolean;
  productLabel: string;
  sourceCost: number;
  sourcePrimaryCost: number;
  estimatedTargetCost: number;
  sourceLabel?: string;
  supplierLabel?: string;
};

type InkoopScenarioStepProps = {
  sourceYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;
  inkoopScenarioRows: InkoopScenarioRow[];
  scenarioPrimaryCosts: Record<string, number>;
  setScenarioPrimaryCosts: (setter: (current: Record<string, number>) => Record<string, number>) => void;
};

type ScenarioGroup = {
  key: string;
  label: string;
  rows: InkoopScenarioRow[];
  editableRows: InkoopScenarioRow[];
  readOnlyRows: InkoopScenarioRow[];
  averageDeltaPct: number;
};

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function formatScenarioInput(value: number) {
  return roundMoney(value).toFixed(2);
}

export function InkoopScenarioStep({
  sourceYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  inkoopScenarioRows,
  scenarioPrimaryCosts,
  setScenarioPrimaryCosts,
}: InkoopScenarioStepProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});

  function scenarioKeyFor(row: InkoopScenarioRow) {
    const skuId = String(row.skuId ?? "").trim();
    return skuId;
  }

  function scenarioValueFor(row: InkoopScenarioRow) {
    const key = scenarioKeyFor(row);
    if (!key) return row.sourcePrimaryCost;
    return Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, key)
      ? Number(scenarioPrimaryCosts[key] ?? 0)
      : row.sourcePrimaryCost;
  }

  function rowDeltaPct(row: InkoopScenarioRow) {
    const source = Number(row.sourcePrimaryCost ?? 0);
    if (source <= 0) return 0;
    return ((scenarioValueFor(row) - source) / source) * 100;
  }

  const groups = useMemo<ScenarioGroup[]>(() => {
    const byBeer = new Map<string, { label: string; rows: InkoopScenarioRow[] }>();
    inkoopScenarioRows.forEach((row) => {
      const label = String(row.biernaam || row.bierId || "Zonder stijl").trim() || "Zonder stijl";
      const key = label.toLowerCase();
      const current = byBeer.get(key) ?? { label, rows: [] };
      current.rows.push(row);
      byBeer.set(key, current);
    });

    return Array.from(byBeer.entries())
      .map(([key, group]) => {
        const rows = group.rows;
        const editableRows = rows
          .filter((row) => Boolean(row.canEdit))
          .sort((a, b) => a.productLabel.localeCompare(b.productLabel, "nl-NL"));
        const readOnlyRows = rows
          .filter((row) => !row.canEdit)
          .sort((a, b) => a.productLabel.localeCompare(b.productLabel, "nl-NL"));
        const averageDeltaPct =
          editableRows.length > 0
            ? editableRows.reduce((sum, row) => sum + rowDeltaPct(row), 0) / editableRows.length
            : 0;
        return {
          key,
          label: group.label,
          rows,
          editableRows,
          readOnlyRows,
          averageDeltaPct,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [inkoopScenarioRows, scenarioPrimaryCosts]);

  function setAllGroups(open: boolean) {
    setOpenGroups(Object.fromEntries(groups.map((group) => [group.key, open])));
  }

  function inheritedValue(row: InkoopScenarioRow, group: ScenarioGroup) {
    const editableAverage =
      group.editableRows.length > 0
        ? group.editableRows.reduce((sum, editable) => sum + rowDeltaPct(editable), 0) / group.editableRows.length
        : 0;
    return roundMoney(Number(row.sourcePrimaryCost ?? 0) * (1 + editableAverage / 100));
  }

  function commitScenarioValue(row: InkoopScenarioRow, group: ScenarioGroup, raw: string) {
    const key = scenarioKeyFor(row);
    if (!key) return;
    const clean = raw.trim().replace(",", ".");
    if (clean === "") {
      setDraftInputs((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setScenarioPrimaryCosts((current) => {
        const next = { ...current };
        delete next[key];
        group.readOnlyRows.forEach((child) => {
          const childKey = scenarioKeyFor(child);
          if (childKey) delete next[childKey];
        });
        return next;
      });
      return;
    }

    const parsed = Number(clean);
    if (!Number.isFinite(parsed)) return;
    const rounded = roundMoney(parsed);
    const source = Number(row.sourcePrimaryCost ?? 0);
    const deltaPct = source > 0 ? (rounded - source) / source : 0;

    setDraftInputs((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setScenarioPrimaryCosts((current) => {
      const next = { ...current, [key]: rounded };
      group.readOnlyRows.forEach((child) => {
        const childKey = scenarioKeyFor(child);
        if (childKey) next[childKey] = roundMoney(Number(child.sourcePrimaryCost ?? 0) * (1 + deltaPct));
      });
      return next;
    });
  }

  return (
    <div>
      <div className="editor-status" style={{ marginBottom: 14 }}>
        <strong>Scenario</strong>: deze inkoopprijzen zijn alleen voor de preview in deze wizard en worden niet opgeslagen.
        De echte inkoopprijzen komen later via inkoopfacturen.
      </div>

      <div className="editor-actions" style={{ paddingTop: 0 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setAllGroups(true)}>
            Alles openen
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => setAllGroups(false)}>
            Alles sluiten
          </button>
        </div>
      </div>

      <div className="wizard-stack">
        {groups.map((group) => {
          const isOpen = Boolean(openGroups[group.key]);
          const deltaLabel =
            group.averageDeltaPct === 0
              ? "0,0%"
              : `${group.averageDeltaPct > 0 ? "+" : ""}${group.averageDeltaPct.toFixed(1).replace(".", ",")}%`;
          return (
            <section key={group.key} className="module-card compact-card">
              <button
                type="button"
                className="module-card-title"
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  textAlign: "left",
                }}
                onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                aria-expanded={isOpen}
              >
                <span>{isOpen ? "v" : ">"} {group.label}</span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span className="editor-pill">{group.rows.length} SKU&apos;s</span>
                  <span className="pill">gem. delta {deltaLabel}</span>
                </span>
              </button>

              {isOpen ? (
                <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
                  <table className="dataset-editor-table">
                    <thead>
                      <tr>
                        <th>Artikel</th>
                        <th>Type</th>
                        <th>Bron</th>
                        <th>Bron kostprijs</th>
                        <th>Bron inkoop</th>
                        <th>Scenario inkoop</th>
                        <th>Scenario kostprijs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...group.editableRows, ...group.readOnlyRows].map((row) => {
                        const scenarioKey = scenarioKeyFor(row);
                        const editable = group.editableRows.some((editableRow) => scenarioKeyFor(editableRow) === scenarioKey);
                        const roundedScenarioValue = editable ? roundMoney(scenarioValueFor(row)) : inheritedValue(row, group);
                        const scenarioEstimatedCost = row.estimatedTargetCost + (roundedScenarioValue - row.sourcePrimaryCost);
                        const inputValue = Object.prototype.hasOwnProperty.call(draftInputs, scenarioKey)
                          ? draftInputs[scenarioKey]
                          : formatScenarioInput(roundedScenarioValue);
                        const typeLabel =
                          row.productType === "samengesteld"
                            ? "Samengesteld"
                            : row.isDerived
                              ? "Afgeleid"
                              : row.productType === "basis" || row.productType === "sku"
                                ? "Basisproduct"
                                : "Artikel";

                        return (
                          <tr key={scenarioKey}>
                            <td>{row.productLabel}</td>
                            <td className="muted">{typeLabel}</td>
                            <td>
                              <div>{row.supplierLabel || "-"}</div>
                              <div className="module-card-text">{row.sourceLabel || "-"}</div>
                            </td>
                            <td>{formatEur(row.sourceCost)}</td>
                            <td>{formatEur(row.sourcePrimaryCost)}</td>
                            <td>
                              {editable ? (
                                <input
                                  className="dataset-input"
                                  type="number"
                                  step="0.01"
                                  value={inputValue}
                                  placeholder="(bron)"
                                  onChange={(event) =>
                                    setDraftInputs((current) => ({ ...current, [scenarioKey]: event.target.value }))
                                  }
                                  onBlur={(event) => commitScenarioValue(row, group, event.target.value)}
                                />
                              ) : (
                                <span className="muted">{formatEur(roundedScenarioValue)}</span>
                              )}
                            </td>
                            <td>{formatEur(scenarioEstimatedCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}
        {inkoopScenarioRows.length === 0 ? (
          <div className="dataset-empty" style={{ padding: "1rem" }}>
            Geen actieve kostprijsregels gevonden voor {sourceYear}.
          </div>
        ) : null}
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(5)}
            disabled={isRunning}
          >
            Vorige
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => {
              setDraftInputs({});
              setScenarioPrimaryCosts(() => ({}));
            }}
            disabled={isRunning}
          >
            Reset scenario
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(7)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}
