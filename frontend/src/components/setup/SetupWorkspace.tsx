"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type GenericRecord = Record<string, any>;

type SetupCheck = {
  id: string;
  label: string;
  done: boolean;
  current: number;
  total: number;
  missing: GenericRecord[];
  group?: "setup" | "readiness" | string;
  description?: string;
  href?: string;
};

type SetupStatus = {
  year: number;
  can_complete: boolean;
  mode: string;
  summary: GenericRecord;
  checks: SetupCheck[];
};

function pct(check: SetupCheck) {
  if (!check.total) return check.done ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((Number(check.current || 0) / Number(check.total || 1)) * 100)));
}

function valuePreview(row: GenericRecord) {
  const parts = [
    row.sku_id,
    row.sku_code || row.sku,
    row.lot_number,
    row.douano_name || row.product_name,
    row.transaction_number,
    row.douano_product_id,
    row.actie,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : JSON.stringify(row);
}

export function SetupWorkspace({ initialStatus }: { initialStatus: SetupStatus }) {
  const [status, setStatus] = useState<SetupStatus>(initialStatus);
  const [openId, setOpenId] = useState<string>("");
  const [resetPreview, setResetPreview] = useState<GenericRecord | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const isComplete = Boolean(status.can_complete);
  const incomplete = useMemo(() => status.checks.filter((check) => !check.done), [status.checks]);
  const setupChecks = useMemo(() => status.checks.filter((check) => (check.group || "setup") === "setup"), [status.checks]);
  const readinessChecks = useMemo(() => status.checks.filter((check) => check.group === "readiness"), [status.checks]);

  function renderChecks(title: string, description: string, checks: SetupCheck[]) {
    return (
      <section className="module-card">
        <div className="module-card-header">
          <div>
            <div className="module-card-title">{title}</div>
            <div className="module-card-text">{description}</div>
          </div>
        </div>
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Teller</th>
                <th>Voortgang</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td style={{ fontWeight: 700 }}>
                    <div>{check.label}</div>
                    {check.description ? <div className="muted" style={{ marginTop: 4, fontWeight: 500 }}>{check.description}</div> : null}
                  </td>
                  <td>
                    <span className={`status-pill ${check.done ? "status-ok" : "status-warning"}`}>
                      {check.done ? "ok" : "actie nodig"}
                    </span>
                  </td>
                  <td>
                    {check.current} / {check.total}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct(check)}%` }} />
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
                      {check.href ? (
                        <Link className="editor-button editor-button-secondary" href={check.href as any}>
                          Open
                        </Link>
                      ) : null}
                      {check.missing?.length ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary"
                          onClick={() => setOpenId(openId === check.id ? "" : check.id)}
                        >
                          Bekijk {check.missing.length}
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {openId && checks.some((check) => check.id === openId) ? (
          <div className="module-card compact-card" style={{ marginTop: 12 }}>
            <div className="module-card-title">Ontbrekend: {checks.find((check) => check.id === openId)?.label}</div>
            <div className="data-table">
              <table>
                <tbody>
                  {(checks.find((check) => check.id === openId)?.missing ?? []).map((row, index) => (
                    <tr key={`${openId}-${index}`}>
                      <td>{valuePreview(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  async function reload() {
    setBusy("reload");
    setMessage("");
    try {
      const res = await fetch(`/api/meta/setup/status?year=${encodeURIComponent(String(status.year))}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(String(payload?.detail ?? "Setup status laden mislukt."));
      setStatus(payload.result);
    } catch (err) {
      setMessage(String((err as any)?.message ?? err));
    } finally {
      setBusy("");
    }
  }

  async function runReset(dryRun: boolean) {
    setBusy(dryRun ? "preview-reset" : "reset");
    setMessage("");
    try {
      const res = await fetch(`/api/meta/setup/reset-rebuildable?dry_run=${dryRun ? "true" : "false"}`, {
        method: "POST",
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(String(payload?.detail ?? "Setup reset mislukt."));
      setResetPreview(payload.result);
      if (!dryRun) {
        setMessage("Rebuildbare data is opgeschoond. Je kunt nu opnieuw opbouwen vanuit Douano.");
        await reload();
      }
    } catch (err) {
      setMessage(String((err as any)?.message ?? err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="wizard-stack">
      <section className="module-card">
        <div className="module-card-header">
          <div>
            <div className="module-card-title">Setup checklist ({status.year})</div>
            <div className="module-card-text">
              Doorloop de inrichting in de juiste volgorde. Setup kan pas afgerond worden wanneer elke relevante SKU en LOT volledig gekoppeld of bewust genegeerd is.
            </div>
          </div>
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={reload} disabled={Boolean(busy)}>
              Vernieuwen
            </button>
            {isComplete ? (
              <Link className="editor-button" href="/nieuw-jaar-voorbereiden">
                Naar nieuw jaar voorbereiden
              </Link>
            ) : null}
          </div>
        </div>

        <div className="stats-grid wizard-stats-grid">
          <div className="stat-card">
            <div className="stat-label">Productfamilies</div>
            <div className="stat-value small">{status.summary.product_families ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Factuurregels</div>
            <div className="stat-value small">{status.summary.sales_invoice_lines ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Verkocht gekoppeld</div>
            <div className="stat-value small">{status.summary.sold_products_mapped ?? 0}/{status.summary.sold_products ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">LOT kostdekking</div>
            <div className="stat-value small">{(status.summary.lot_pairs ?? 0) - (status.summary.lot_pairs_missing_cost ?? 0)}/{status.summary.lot_pairs ?? 0}</div>
          </div>
        </div>
      </section>

      {renderChecks(
        "Setup inrichting",
        "Deze checks bewaken dat stijlen en interne SKU's op de juiste plek ontstaan: stijl eerst, verkoopbare SKU pas na opbouw/activatie.",
        setupChecks
      )}

      {renderChecks(
        "Data readiness voor rekenen",
        "Gebruik dit als stoplicht voordat je break-even actualiseert of Omzet en marge als serieuze controle gebruikt.",
        readinessChecks
      )}

      <section className="module-card">
        <div className="module-card-header">
          <div>
            <div className="module-card-title">Fresh start</div>
            <div className="module-card-text">
              Verwijdert alleen rebuildbare data: interne SKU&apos;s, productkoppelingen, kostprijsversies/activaties, Excel LOT-imports en planning snapshots. Douano ruwe sync en masterdata blijven staan.
            </div>
          </div>
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={() => runReset(true)} disabled={Boolean(busy)}>
              Preview reset
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const ok = window.confirm("Rebuildbare data verwijderen en opnieuw beginnen?");
                if (ok) void runReset(false);
              }}
              disabled={Boolean(busy)}
            >
              Reset uitvoeren
            </button>
          </div>
        </div>
        {resetPreview ? (
          <pre className="debug-json" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(resetPreview, null, 2)}
          </pre>
        ) : null}
        {message ? <div className={message.includes("mislukt") ? "form-error" : "form-success"}>{message}</div> : null}
      </section>

      {incomplete.length ? (
        <section className="module-card compact-card">
          <div className="module-card-title">Volgende acties</div>
          <div className="module-card-text">
            Start met Douano producten synchroniseren, bouw daarna kostprijzen en verkoopbare varianten op, koppel de Douano SKU&apos;s en controleer als laatste LOT-kostdekking.
          </div>
        </section>
      ) : null}
    </div>
  );
}
