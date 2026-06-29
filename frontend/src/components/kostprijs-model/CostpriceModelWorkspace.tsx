"use client";

import { useEffect, useState } from "react";

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

function euro(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? formatMoneyEUR(num) : "-";
}

export function CostpriceModelWorkspace() {
  const [year, setYear] = useState("2025");
  const [basis, setBasis] = useState<"invoice" | "order">("invoice");
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<GenericRecord | null>(null);
  const [review, setReview] = useState<GenericRecord | null>(null);
  const [plans, setPlans] = useState<GenericRecord[]>([]);
  const [planRevenue, setPlanRevenue] = useState("");
  const [planContribution, setPlanContribution] = useState("");
  const [planLiters, setPlanLiters] = useState("");
  const [planUnits, setPlanUnits] = useState("");
  const [planPriceChangePct, setPlanPriceChangePct] = useState("");
  const [planVolumeChangePct, setPlanVolumeChangePct] = useState("");
  const [planMixAssumption, setPlanMixAssumption] = useState("");

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(String(payload?.detail || response.statusText));
    }
    return payload;
  }

  async function load() {
    setBusy(true);
    setTone("");
    try {
      const [auditPayload, reviewPayload, plansPayload] = await Promise.all([
        request(`/meta/audit/costprice-planning-state?year=${encodeURIComponent(year)}`),
        request("/integrations/break-even/model-review"),
        request(`/integrations/break-even/plans?year=${encodeURIComponent(year)}&include_archived=true`),
      ]);
      setAudit(auditPayload?.result ?? null);
      setReview(reviewPayload?.result ?? null);
      setPlans(Array.isArray(plansPayload?.items) ? plansPayload.items : []);
      setStatus("Modelstatus bijgewerkt.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resetPlanning(dryRun: boolean) {
    const confirmed = dryRun || window.confirm("Planning-kostprijzen en activaties verwijderen voor dit jaar? LOT-data blijft behouden.");
    if (!confirmed) return;
    setBusy(true);
    setTone("");
    try {
      const payload = await request(
        `/meta/reset/costprice-planning-state?year=${encodeURIComponent(year)}&dry_run=${dryRun ? "true" : "false"}`,
        { method: "POST", body: "{}" }
      );
      setAudit(payload?.result?.after ?? payload?.result?.before ?? null);
      setStatus(dryRun ? "Reset preview gereed." : "Planning-kostprijzen opgeschoond.");
      setTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function createPlan() {
    setBusy(true);
    setTone("");
    try {
      await request("/integrations/break-even/plans", {
        method: "POST",
        body: JSON.stringify({
          year: Number(year),
          scenario_name: `Basis ${year}`,
          replace_active: true,
          targets: {
            revenue: Number(planRevenue || 0),
            contribution: Number(planContribution || 0),
            liters: Number(planLiters || 0),
            units: Number(planUnits || 0),
            price_change_pct: Number(planPriceChangePct || 0),
            volume_change_pct: Number(planVolumeChangePct || 0),
            mix_assumption: planMixAssumption,
          },
        }),
      });
      setStatus("Break-even plansnapshot opgeslagen.");
      setTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function actualizeForecast() {
    setBusy(true);
    setTone("");
    try {
      const activePlan = plans.find((row) => String(row.status || "") === "active") ?? plans[0];
      await request("/integrations/break-even/reforecast", {
        method: "POST",
        body: JSON.stringify({ year: Number(year), basis, plan_snapshot_id: activePlan?.id || "" }),
      });
      setStatus("Prognose geactualiseerd op basis van actuele verkopen.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function closeYear() {
    if (!window.confirm("Jaarafsluiting vastleggen? Dit maakt een snapshot van de actuele realisatie.")) return;
    setBusy(true);
    setTone("");
    try {
      await request("/integrations/break-even/close-year", {
        method: "POST",
        body: JSON.stringify({ year: Number(year), basis, overwrite: true }),
      });
      setStatus("Jaarafsluiting vastgelegd.");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  const counts = audit?.counts ?? {};
  const duplicateActivations = Array.isArray(audit?.duplicate_activations) ? audit.duplicate_activations : [];
  const duplicateVersions = Array.isArray(audit?.duplicate_versions) ? audit.duplicate_versions : [];
  const theory = review?.theory_check ?? {};
  const datamodel = review?.datamodel_review ?? {};

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Kostprijs modelcontrole</div>
        <div className="module-card-text">
          Controleer planning versus actuele LOT-kosten, maak snapshots en ruim ontwikkeldata veilig op.
        </div>
      </div>

      <div className="editor-actions" style={{ marginTop: 12 }}>
        <label className="form-field" style={{ maxWidth: 140 }}>
          <span>Jaar</span>
          <input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" />
        </label>
        <div className="segmented-control" aria-label="Basis">
          <button type="button" className={basis === "invoice" ? "active" : ""} onClick={() => setBasis("invoice")}>
            Facturen
          </button>
          <button type="button" className={basis === "order" ? "active" : ""} onClick={() => setBasis("order")}>
            Orders
          </button>
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={load} disabled={busy}>
            Controleren
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => resetPlanning(true)} disabled={busy}>
            Reset preview
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => resetPlanning(false)} disabled={busy}>
            Planning opschonen
          </button>
        </div>
      </div>

      {status ? <div className={`status-banner ${tone ? `status-${tone}` : ""}`}>{status}</div> : null}

      <div className="record-card-grid" style={{ marginTop: 14 }}>
        <div className="wizard-toggle-card">
          <span>
            <strong>Kostprijsversies</strong>
            <small>{counts.cost_versions ?? 0}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>SKU regels</strong>
            <small>{counts.cost_version_sku_rows ?? 0}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>Activaties</strong>
            <small>{counts.kostprijs_sku_activations ?? 0}</small>
          </span>
        </div>
        <div className="wizard-toggle-card">
          <span>
            <strong>Duplicate groepen</strong>
            <small>{duplicateActivations.length + duplicateVersions.length}</small>
          </span>
        </div>
      </div>

      <section className="module-card" style={{ marginTop: 16 }}>
        <div className="module-card-header">
          <div className="module-card-title">Frozen plan targets</div>
          <div className="module-card-text">
            Leg expliciet vast waar het jaarplan op stuurt. Leeg laten mag, maar dan blijft Break-even next eerlijk waarschuwen dat planwaarden ontbreken.
          </div>
        </div>
        <div className="wizard-form-grid">
          <label className="form-field">
            <span>Plan omzet</span>
            <input value={planRevenue} onChange={(event) => setPlanRevenue(event.target.value)} inputMode="decimal" placeholder="bijv. 100000" />
          </label>
          <label className="form-field">
            <span>Plan contributie</span>
            <input value={planContribution} onChange={(event) => setPlanContribution(event.target.value)} inputMode="decimal" placeholder="bijv. 65000" />
          </label>
          <label className="form-field">
            <span>Plan liters</span>
            <input value={planLiters} onChange={(event) => setPlanLiters(event.target.value)} inputMode="decimal" placeholder="bijv. 40000" />
          </label>
          <label className="form-field">
            <span>Plan units</span>
            <input value={planUnits} onChange={(event) => setPlanUnits(event.target.value)} inputMode="decimal" placeholder="optioneel" />
          </label>
          <label className="form-field">
            <span>Prijsaanname %</span>
            <input value={planPriceChangePct} onChange={(event) => setPlanPriceChangePct(event.target.value)} inputMode="decimal" placeholder="bijv. 3" />
          </label>
          <label className="form-field">
            <span>Volumeaanname %</span>
            <input value={planVolumeChangePct} onChange={(event) => setPlanVolumeChangePct(event.target.value)} inputMode="decimal" placeholder="bijv. 5" />
          </label>
          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>Mix-aanname</span>
            <input value={planMixAssumption} onChange={(event) => setPlanMixAssumption(event.target.value)} placeholder="bijv. 2025 realisatie als basis, extra groei op fust" />
          </label>
        </div>
        <div className="editor-actions" style={{ marginTop: 16 }}>
          <div className="editor-actions-group">
            <button type="button" className="editor-button" onClick={createPlan} disabled={busy}>
              Plansnapshot maken
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={actualizeForecast} disabled={busy}>
              Actualiseer prognose
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={closeYear} disabled={busy}>
              Jaar afsluiten
            </button>
          </div>
        </div>
      </section>

      <div className="data-table" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Plansnapshot</th>
              <th>Jaar</th>
              <th>Status</th>
              <th>Vaste kosten</th>
              <th>Plan omzet</th>
              <th>Plan contributie</th>
              <th>SKU regels</th>
              <th>Aangemaakt</th>
            </tr>
          </thead>
          <tbody>
            {plans.length ? (
              plans.map((row) => (
                <tr key={String(row.id)}>
                  <td>{row.scenario_name || row.id}</td>
                  <td>{row.jaar}</td>
                  <td><span className="pill">{row.status || "-"}</span></td>
                  <td>{euro(row.payload?.fixed_cost_total)}</td>
                  <td>{euro(row.payload?.targets?.revenue)}</td>
                  <td>{euro(row.payload?.targets?.contribution)}</td>
                  <td>{row.payload?.summary?.sku_count ?? 0}</td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString("nl-NL") : "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>Nog geen plansnapshots.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Controle</th>
              <th>Uitkomst</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Planning versus actual</td><td>{theory.planning_vs_actual || "-"}</td></tr>
            <tr><td>Actual kostprijsformule</td><td>{theory.cost_formula_actual || "-"}</td></tr>
            <tr><td>Snapshot beleid</td><td>{theory.snapshot_policy || "-"}</td></tr>
            <tr><td>Normalisatie</td><td>{datamodel.normalization || "-"}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
