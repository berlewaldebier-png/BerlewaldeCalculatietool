"use client";

import Link from "next/link";
import { useState } from "react";

import {
  flowHref,
  missingRowKey,
  pct,
  searchableMissingRowText,
  statusLabel,
  valuePreview,
} from "@/components/beheer/data-quality/DataQualityHelpers";
import type { GenericRecord, RowActionRenderer, SetupCheck } from "@/components/beheer/data-quality/DataQualityTypes";

export function StatusPill({ check }: { check: SetupCheck }) {
  const ok = Boolean(check.done);
  return <span className={`status-pill ${ok ? "status-ok" : "status-warning"}`}>{statusLabel(check)}</span>;
}

export function CheckCard({ check, onOpenMissing }: { check: SetupCheck; onOpenMissing: (id: string) => void }) {
  const href = flowHref(check.href);
  return (
    <div className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="module-card-title">{check.label}</div>
          {check.description ? <div className="module-card-text">{check.description}</div> : null}
        </div>
        <StatusPill check={check} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: 800 }}>
          <span>
            {check.current} / {check.total}
          </span>
          <span>{pct(check)}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct(check)}%` }} />
        </div>
        <div className="editor-actions" style={{ marginTop: 2 }}>
          <div className="editor-actions-group">
            {href ? (
              <Link className="editor-button editor-button-secondary" href={href as any}>
                Open
              </Link>
            ) : null}
            {check.missing?.length ? (
              <button type="button" className="editor-button editor-button-secondary" onClick={() => onOpenMissing(check.id)}>
                Bekijk {check.missing.length}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MissingPanel({
  checks,
  openId,
  setOpenId,
  renderRowAction,
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  renderRowAction: RowActionRenderer;
}) {
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const openCheck = checks.find((check) => check.id === openId);
  if (!openCheck || !openCheck.missing?.length) return null;
  const rows = Array.isArray(openCheck.missing) ? openCheck.missing : [];
  const query = search.trim().toLowerCase();
  const filteredRows = query ? rows.filter((row) => searchableMissingRowText(row).includes(query)) : rows;
  const visibleKeys = filteredRows.map(missingRowKey);
  const selectedSet = new Set(selectedKeys);
  const selectedRows = rows.filter((row) => selectedSet.has(missingRowKey(row)));
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedSet.has(key));

  function toggleVisibleRows(checked: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const key of visibleKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return Array.from(next);
    });
  }

  function toggleRow(row: GenericRecord, checked: boolean) {
    const key = missingRowKey(row);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return Array.from(next);
    });
  }

  return (
    <section className="module-card compact-card">
      <div className="module-card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="module-card-title">Ontbrekend: {openCheck.label}</div>
          <div className="module-card-text">Deze regels houden de datakwaliteit nog tegen.</div>
        </div>
        <button type="button" className="editor-button editor-button-secondary" onClick={() => setOpenId("")}>
          Sluiten
        </button>
      </div>
      {openCheck.id === "sales_rows_cost_source" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <input
            className="editor-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Zoek op product, SKU, LOT, transactie of oorzaak"
          />
          <span className="status-pill">{selectedRows.length ? `${selectedRows.length} geselecteerd` : `${filteredRows.length} zichtbaar`}</span>
        </div>
      ) : null}
      <div className="data-table">
        <table>
          {openCheck.id === "sales_rows_cost_source" ? (
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecteer zichtbare regels"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleVisibleRows(event.target.checked)}
                  />
                </th>
                <th>Regel</th>
                <th style={{ width: 56, textAlign: "right" }}>Actie</th>
              </tr>
            </thead>
          ) : null}
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={`${openCheck.id}-${index}`}>
                {openCheck.id === "sales_rows_cost_source" ? (
                  <td style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      aria-label="Selecteer regel"
                      checked={selectedSet.has(missingRowKey(row))}
                      onChange={(event) => toggleRow(row, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td>{valuePreview(row)}</td>
                {openCheck.id === "sales_rows_cost_source" ? (
                  <td style={{ width: 56, textAlign: "right" }}>{renderRowAction(row, selectedRows)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CheckGrid({
  checks,
  openId,
  setOpenId,
  renderRowAction,
  title = "Werkvoorraad",
  description = "Deze kaarten tonen welke data nog aandacht vraagt.",
  emptyText = "Geen openstaande regels in deze werkstroom.",
}: {
  checks: SetupCheck[];
  openId: string;
  setOpenId: (id: string) => void;
  renderRowAction: RowActionRenderer;
  title?: string;
  description?: string;
  emptyText?: string;
}) {
  return (
    <div className="wizard-stack">
      <section>
        <div className="module-card-title" style={{ marginBottom: 8 }}>{title}</div>
        <div className="module-card-text" style={{ marginBottom: 12 }}>{description}</div>
      </section>
      {checks.length ? (
        <div className="home-grid">
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} onOpenMissing={(id) => setOpenId(openId === id ? "" : id)} />
          ))}
        </div>
      ) : (
        <div className="placeholder-block">{emptyText}</div>
      )}
      <MissingPanel checks={checks} openId={openId} setOpenId={setOpenId} renderRowAction={renderRowAction} />
    </div>
  );
}
