"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import { formatMoneyEUR } from "@/lib/formatters";

type GenericRecord = Record<string, any>;

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text };
  }
}

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? formatMoneyEUR(num) : "-";
}

export function JaarAfsluitenWizard({ initialYear = "" }: { initialYear?: string | number }) {
  const [year, setYear] = useState(String(initialYear || new Date().getFullYear() - 1));
  const [basis, setBasis] = useState<"invoice" | "order">("invoice");
  const [step, setStep] = useState<"checks" | "review" | "done">("checks");
  const [preview, setPreview] = useState<GenericRecord | null>(null);
  const [closed, setClosed] = useState<GenericRecord | null>(null);
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [busy, setBusy] = useState(false);

  const totals = preview?.actuals?.totals ?? {};
  const checks = preview?.checks ?? {};
  const warnings = useMemo(() => {
    const out: string[] = [];
    if (Number(checks.missing_cost_lines ?? 0) > 0) out.push(`${checks.missing_cost_lines} verkoopregels missen kostprijs.`);
    if (Number(checks.unmapped_revenue ?? 0) > 0) out.push(`${money(checks.unmapped_revenue)} omzet is nog niet gekoppeld.`);
    if (!preview) out.push("Controleer eerst de jaarafsluiting.");
    return out;
  }, [checks, preview]);

  async function loadPreview() {
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/integrations/break-even/year-close-preview?year=${encodeURIComponent(year)}&basis=${encodeURIComponent(basis)}`,
        { credentials: "include", cache: "no-store" }
      );
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setPreview(payload.preview ?? null);
      setClosed(null);
      setStep("review");
      setStatus("Controle gereed.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function closeYear() {
    if (!preview) return;
    const ok = window.confirm("Jaar definitief afsluiten? Je kunt opnieuw afsluiten met overschrijven zolang dit een ontwikkelomgeving is.");
    if (!ok) return;
    setBusy(true);
    setStatus("");
    setTone("");
    try {
      const response = await fetch(`${API_BASE_URL}/integrations/break-even/close-year`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(year), basis, overwrite: true }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || response.statusText));
      setClosed(payload.item ?? null);
      setStep("done");
      setStatus("Jaarafsluiting opgeslagen.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Jaar afsluiten</div>
        <div className="module-card-text">
          Controleer de realisatie, leg een jaarafsluiting vast en ga daarna door naar Nieuw jaar voorbereiden.
        </div>
      </div>

      <div className="tab-row" style={{ marginBottom: 14 }}>
        <button type="button" className={`tab-button ${step === "checks" ? "active" : ""}`} onClick={() => setStep("checks")}>1. Checks</button>
        <button type="button" className={`tab-button ${step === "review" ? "active" : ""}`} onClick={() => preview && setStep("review")}>2. Review</button>
        <button type="button" className={`tab-button ${step === "done" ? "active" : ""}`} onClick={() => closed && setStep("done")}>3. Afronden</button>
        <div className="tab-spacer" />
      </div>

      {status ? <div className={`status-banner ${tone ? `status-${tone}` : ""}`}>{status}</div> : null}

      {step === "checks" ? (
        <div className="wizard-stack">
          <div className="editor-actions">
            <label className="nested-field" style={{ maxWidth: 180 }}>
              <span>Jaar</span>
              <input className="dataset-input" value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" />
            </label>
            <div className="segmented-control" aria-label="Basis">
              <button type="button" className={basis === "invoice" ? "active" : ""} onClick={() => setBasis("invoice")}>Facturen</button>
              <button type="button" className={basis === "order" ? "active" : ""} onClick={() => setBasis("order")}>Orders</button>
            </div>
            <button type="button" className="editor-button" onClick={loadPreview} disabled={busy}>Controleer jaar</button>
          </div>
          <div className="placeholder-block">
            <strong>Controlepunten</strong>
            <div className="muted">Ontbrekende kostprijzen, ongekoppelde omzet, vaste kosten en gerealiseerde marge worden gecontroleerd voordat je afsluit.</div>
          </div>
        </div>
      ) : null}

      {step === "review" && preview ? (
        <div className="wizard-stack">
          <div className="record-card-grid">
            <div className="wizard-toggle-card"><span><strong>Omzet</strong><small>{money(totals.revenue)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Variabele kosten</strong><small>{money(totals.variable_cost)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Contributie</strong><small>{money(totals.contribution)}</small></span></div>
            <div className="wizard-toggle-card"><span><strong>Vaste kosten</strong><small>{money(preview.fixed_cost_total)}</small></span></div>
          </div>

          <div className="data-table">
            <table>
              <thead><tr><th>Check</th><th>Status</th><th>Waarde</th></tr></thead>
              <tbody>
                <tr><td>Ontbrekende kostprijsregels</td><td>{Number(checks.missing_cost_lines ?? 0) === 0 ? "OK" : "Aandacht nodig"}</td><td>{checks.missing_cost_lines ?? 0}</td></tr>
                <tr><td>Ongekoppelde omzet</td><td>{Number(checks.unmapped_revenue ?? 0) === 0 ? "OK" : "Aandacht nodig"}</td><td>{money(checks.unmapped_revenue)}</td></tr>
              </tbody>
            </table>
          </div>

          {warnings.length ? (
            <div className="placeholder-block">
              <strong>Waarschuwingen</strong>
              <ul>
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="editor-actions">
            <button type="button" className="editor-button editor-button-secondary" onClick={() => setStep("checks")}>Terug</button>
            <button type="button" className="editor-button" onClick={closeYear} disabled={busy}>Jaarafsluiting opslaan</button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="wizard-stack">
          <div className="placeholder-block">
            <strong>Jaar is afgesloten</strong>
            <div className="muted">Snapshot: <code>{closed?.id ?? "-"}</code></div>
          </div>
          <div className="editor-actions">
            <Link className="editor-button" href={`/nieuw-jaar-voorbereiden?source_year=${encodeURIComponent(year)}&target_year=${encodeURIComponent(String(Number(year) + 1))}`}>
              Ga naar Nieuw jaar voorbereiden
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
