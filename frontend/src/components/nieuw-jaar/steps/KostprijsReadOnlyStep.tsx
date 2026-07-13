"use client";

import { useMemo, useState, type ReactNode } from "react";

type KostprijsPreviewRow = {
  bier_id: string;
  sku_id?: string;
  product_id: string;
  biernaam: string;
  soort: string;
  cost_origin?: string;
  source_kind?: string;
  parent_sku_id?: string;
  parent_product_id?: string;
  parent_quantity?: number;
  product_type: "basis" | "samengesteld" | "article";
  verpakkingseenheid: string;
  source_kostprijs: number;
  source_primaire_kosten?: number;
  source_verpakkingskosten?: number;
  source_vaste_kosten?: number;
  source_accijns?: number;
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
  verschil: number;
  verschil_pct: number;
  status: "ok" | "warning" | "blocking";
  status_text: string;
};

type KostprijsTargetRows = {
  basisRows: KostprijsPreviewRow[];
  samengRows: KostprijsPreviewRow[];
};

type KostprijsReadOnlyStepProps = {
  sourceYear: number;
  targetYear: number;
  isRunning: boolean;
  saveAndCloseButton: ReactNode;
  navigateToStep: (nextStep: number) => Promise<void> | void;
  formatEur: (value: number) => string;
  kostprijsTargetRows: KostprijsTargetRows;
};

function pct(value: number) {
  const parsed = Number(value || 0) * 100;
  return `${parsed.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function typeLabel(value: string) {
  if (value === "samengesteld") return "Samengesteld";
  if (value === "basis") return "Basis";
  if (value === "article") return "Artikel";
  return value || "-";
}

function originLabel(row: KostprijsPreviewRow) {
  if (row.source_kind) return row.source_kind;
  if (row.cost_origin === "composed_sellable") return "Zelf samengesteld";
  if (row.cost_origin === "derived_from_parent") return "Afgeleid";
  return row.soort || "-";
}

function sourceTargetCell(formatEur: (value: number) => string, source: unknown, target: unknown) {
  return (
    <div>
      <div>{formatEur(Number(target ?? 0))}</div>
      <div className="muted" style={{ fontStyle: "italic" }}>{formatEur(Number(source ?? 0))}</div>
    </div>
  );
}

export function KostprijsReadOnlyStep({
  sourceYear,
  targetYear,
  isRunning,
  saveAndCloseButton,
  navigateToStep,
  formatEur,
  kostprijsTargetRows,
}: KostprijsReadOnlyStepProps) {
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const allRows = useMemo(
    () => [
      ...kostprijsTargetRows.samengRows.map((row) => ({ ...row, sortType: 0 })),
      ...kostprijsTargetRows.basisRows.map((row) => ({ ...row, sortType: 1 })),
    ].filter((row) => String(row.sku_id ?? "").trim()),
    [kostprijsTargetRows.basisRows, kostprijsTargetRows.samengRows]
  );
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter((row) =>
      [row.biernaam, row.soort, row.verpakkingseenheid, row.product_type, row.status_text]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [allRows, query]);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, typeof filteredRows>();
    filteredRows.forEach((row) => {
      const key = row.biernaam || "Zonder stijl";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.entries())
      .map(([name, rows]) => ({
        name,
        rows: rows.sort((a, b) => a.sortType - b.sortType || a.verpakkingseenheid.localeCompare(b.verpakkingseenheid, "nl-NL")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "nl-NL"));
  }, [filteredRows]);

  const summary = useMemo(() => {
    const count = allRows.length;
    const warnings = allRows.filter((row) => row.status !== "ok").length;
    const avgDelta = count > 0 ? allRows.reduce((sum, row) => sum + Number(row.verschil_pct || 0), 0) / count : 0;
    const biggest = allRows.reduce<KostprijsPreviewRow | null>((current, row) => {
      if (!current) return row;
      return Math.abs(row.verschil_pct) > Math.abs(current.verschil_pct) ? row : current;
    }, null);
    return { count, warnings, avgDelta, biggest };
  }, [allRows]);

  function isOpen(name: string) {
    return openGroups[name] ?? true;
  }

  function setAll(open: boolean) {
    setOpenGroups(Object.fromEntries(groupedRows.map((group) => [group.name, open])));
  }

  return (
    <div>
      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="module-card-title">Kostprijscontrole {targetYear}</div>
        <div className="module-card-text">
          Read-only controle van actieve kostprijzen {sourceYear} tegenover de concept-kostprijzen voor {targetYear}.
          Deze stap schrijft niets weg; hij gebruikt jouw doeljaarplan, vaste kosten, tarieven, verpakking, recepten en inkoopscenario.
        </div>
      </div>

      <div className="record-card-grid" style={{ marginBottom: 14 }}>
        <div className="wizard-toggle-card">
          <span><strong>Regels doorgerekend</strong><small>{summary.count}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Gemiddelde wijziging</strong><small>{pct(summary.avgDelta)}</small></span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>Grootste afwijking</strong>
            <small>{summary.biggest ? `${summary.biggest.biernaam} - ${pct(summary.biggest.verschil_pct)}` : "-"}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span><strong>Aandachtspunten</strong><small>{summary.warnings}</small></span>
        </div>
      </div>

      <div className="module-card compact-card" style={{ marginBottom: 14 }}>
        <div className="editor-grid two" style={{ marginBottom: 12 }}>
          <label className="nested-field">
            <span>Zoeken</span>
            <input
              className="dataset-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Zoek bier, artikel, bron of status..."
            />
          </label>
          <div className="editor-actions" style={{ alignItems: "end" }}>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(true)}>
              Alles openen
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setAll(false)}>
              Alles sluiten
            </button>
          </div>
        </div>

        {groupedRows.length === 0 ? (
          <div className="placeholder-block">
            <strong>Geen regels beschikbaar</strong>
            <div className="muted">
              Controleer of er actieve kostprijsactivaties zijn voor {sourceYear}. Deze stap gebruikt bronjaar-activaties als uitgangspunt.
            </div>
          </div>
        ) : null}

        <div className="wizard-stack">
          {groupedRows.map((group) => (
            <section key={group.name} className="module-card nested-module-card">
              <button
                type="button"
                className="active-cost-group-header"
                onClick={() => setOpenGroups((current) => ({ ...current, [group.name]: !isOpen(group.name) }))}
              >
                <span>{isOpen(group.name) ? "v" : ">"} {group.name}</span>
                <span className="pill">{group.rows.length} regels</span>
              </button>

              {isOpen(group.name) ? (
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Artikel / SKU</th>
                        <th>Type</th>
                        <th>Bron</th>
                        <th>Inkoop/ingred.</th>
                        <th>Verpakking</th>
                        <th>ABC</th>
                        <th>Accijns</th>
                        <th>Kostprijs {targetYear}</th>
                        <th>Verschil</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.sku_id}>
                          <td>
                            <strong>{row.verpakkingseenheid}</strong>
                            <div className="muted">{row.sku_id || row.product_id}</div>
                            {row.parent_sku_id || row.parent_product_id ? (
                              <div className="muted">
                                Moeder: {row.parent_sku_id || row.parent_product_id}
                                {row.parent_quantity ? ` / ${row.parent_quantity}` : ""}
                              </div>
                            ) : null}
                          </td>
                          <td>{typeLabel(row.product_type)}</td>
                          <td>{originLabel(row)}</td>
                          <td>{sourceTargetCell(formatEur, row.source_primaire_kosten, row.primaire_kosten)}</td>
                          <td>{sourceTargetCell(formatEur, row.source_verpakkingskosten, row.verpakkingskosten)}</td>
                          <td>{sourceTargetCell(formatEur, row.source_vaste_kosten, row.vaste_kosten)}</td>
                          <td>{sourceTargetCell(formatEur, row.source_accijns, row.accijns)}</td>
                          <td>
                            <strong>{formatEur(row.kostprijs)}</strong>
                            <div className="muted" style={{ fontStyle: "italic" }}>{formatEur(row.source_kostprijs)}</div>
                          </td>
                          <td>
                            {formatEur(row.verschil)}
                            <div className="muted">{pct(row.verschil_pct)}</div>
                          </td>
                          <td>
                            <span className={`status-pill ${row.status === "ok" ? "status-ok" : row.status === "blocking" ? "status-error" : "status-warning"}`}>
                              {row.status_text}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>

      <div className="editor-actions wizard-footer-actions">
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => void navigateToStep(7)}
            disabled={isRunning}
          >
            Vorige
          </button>
        </div>
        <div className="editor-actions-group">
          {saveAndCloseButton}
          <button type="button" className="editor-button" onClick={() => void navigateToStep(9)} disabled={isRunning}>
            Volgende
          </button>
        </div>
      </div>
    </div>
  );
}
