"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  defaultExcludeParticulier?: boolean;
};

export function OrsDistanceRunner({ defaultExcludeParticulier = true }: Props) {
  const router = useRouter();
  const [excludeParticulier, setExcludeParticulier] = useState(defaultExcludeParticulier);
  const [overwrite, setOverwrite] = useState(false);
  const [limit, setLimit] = useState(500);
  const [dryRun, setDryRun] = useState(true);
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [isBusy, setIsBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const summary = useMemo(() => {
    const r = lastResult?.result;
    if (!r) return null;
    return {
      processed: Number(r.processed ?? 0),
      skipped: Number(r.skipped_cached ?? 0),
      updated: Number(r.updated ?? 0),
      geocodeFailed: Number(r.geocode_failed ?? 0),
      routeFailed: Number(r.route_failed ?? 0),
    };
  }, [lastResult]);

  async function run() {
    setIsBusy(true);
    setStatus(dryRun ? "Dry-run uitvoeren…" : "Afstanden berekenen…");
    setTone("");
    try {
      const params = new URLSearchParams();
      params.set("dry_run", dryRun ? "true" : "false");
      params.set("overwrite", overwrite ? "true" : "false");
      params.set("limit", String(limit));
      params.set("exclude_particulier", excludeParticulier ? "true" : "false");

      const response = await fetch(`/api/meta/ors/compute-company-distances?${params.toString()}`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof (payload as any)?.detail === "string" ? (payload as any).detail : response.statusText;
        throw new Error(detail || "ORS run faalde.");
      }
      setLastResult(payload);
      setStatus("Gereed.");
      setTone("success");
      if (!dryRun) router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "ORS run faalde.");
      setTone("error");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="module-card" style={{ marginTop: 16 }}>
      <div className="module-card-header">
        <div className="module-card-title">Afstanden (ORS)</div>
        <div className="module-card-text">
          Bereken rijafstand (km, enkele reis) van de brouwerij naar klanten op basis van Douano `invoice_address`.
          Particulieren kunnen worden overgeslagen.
        </div>
      </div>

      <div className="editor-actions" style={{ marginTop: 0 }}>
        <div className="editor-actions-group">
          <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={excludeParticulier} onChange={(e) => setExcludeParticulier(e.target.checked)} />
            Particulier overslaan
          </label>
          <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Overschrijven
          </label>
          <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Dry-run
          </label>
          <span className="muted" style={{ marginLeft: 8 }}>
            Limit
          </span>
          <input
            className="editor-input"
            style={{ width: 120 }}
            type="number"
            min="1"
            max="5000"
            step="1"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value || 0) || 1)}
          />
        </div>

        <div className="editor-actions-group">
          {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
          <button type="button" className="editor-button" disabled={isBusy} onClick={() => void run()}>
            {isBusy ? "Bezig…" : dryRun ? "Dry-run" : "Bereken afstanden"}
          </button>
        </div>
      </div>

      {summary ? (
        <div className="stats-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginTop: 12 }}>
          <div className="stat-card">
            <div className="stat-label">Processed</div>
            <div className="stat-value small">{summary.processed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Cached skip</div>
            <div className="stat-value small">{summary.skipped}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Updated</div>
            <div className="stat-value small">{summary.updated}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Geocode failed</div>
            <div className="stat-value small">{summary.geocodeFailed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Route failed</div>
            <div className="stat-value small">{summary.routeFailed}</div>
          </div>
        </div>
      ) : null}

      {Array.isArray(lastResult?.result?.sample) && lastResult.result.sample.length > 0 ? (
        <div className="dataset-editor-scroll" style={{ marginTop: 12 }}>
          <table className="dataset-editor-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>ID</th>
                <th>Klant</th>
                <th style={{ width: 140 }}>Prijsklasse</th>
                <th>Adres</th>
                <th style={{ width: 160 }}>Km (enk. reis)</th>
              </tr>
            </thead>
            <tbody>
              {lastResult.result.sample.map((row: any) => (
                <tr key={String(row.company_id)}>
                  <td>{String(row.company_id)}</td>
                  <td>{String(row.company_name ?? "")}</td>
                  <td>{String(row.sales_price_class ?? "")}</td>
                  <td>{String(row.address ?? "")}</td>
                  <td>{String(row.distance_km_one_way ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

