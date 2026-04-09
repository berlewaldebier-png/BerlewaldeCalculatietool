"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { usePageShellHeader } from "@/components/PageShell";
import { API_BASE_URL } from "@/lib/api";

type PlanRow = {
  bier_id: string;
  biernaam: string;
  product_id: string;
  product_type: string;
  product_label: string;
  source_version_id: string;
  source_cost: number;
  source_primary: number;
  scenario_primary: number;
  target_cost: number;
  delta: number;
};

type PlanResponse = {
  source_year: number;
  target_year: number;
  rows: PlanRow[];
};

function formatEur(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

export function KostprijsActivatieClient({ initialPlan }: { initialPlan: PlanResponse }) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanResponse>(initialPlan);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [scenarioOverrides, setScenarioOverrides] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const sourceYear = Number(plan.source_year ?? 0);
  const targetYear = Number(plan.target_year ?? 0);

  usePageShellHeader(
    useMemo(
      () => ({
        title: `Kostprijzen activeren ${targetYear || ""}`.trim(),
        subtitle:
          sourceYear > 0 && targetYear > 0
            ? `Maak op basis van ${sourceYear} (en jouw scenario/jaar-data) nieuwe kostprijsversies en activaties voor ${targetYear}.`
            : "Kies bronjaar en doeljaar via de link vanuit Nieuw jaar voorbereiden."
      }),
      [sourceYear, targetYear]
    )
  );

  const rows = Array.isArray(plan.rows) ? plan.rows : [];

  useEffect(() => {
    const nextSelected: Record<string, boolean> = {};
    const nextOverrides: Record<string, number> = {};
    rows.forEach((row) => {
      const key = `${row.bier_id}::${row.product_id}`;
      nextSelected[key] = true;
      nextOverrides[key] = Number(row.scenario_primary ?? row.source_primary ?? 0);
    });
    setSelected(nextSelected);
    setScenarioOverrides(nextOverrides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceYear, targetYear]);

  async function refreshPlan(message?: string) {
    if (!sourceYear || !targetYear) return;
    setIsBusy(true);
    setStatus("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/meta/kostprijs-activatie-plan?source_year=${encodeURIComponent(String(sourceYear))}&target_year=${encodeURIComponent(
          String(targetYear)
        )}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) throw new Error(await response.text());
      const json = (await response.json()) as PlanResponse;
      setPlan(json);
      setStatus(message ?? "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Kon plan niet laden.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveDraft(message?: string) {
    if (!sourceYear || !targetYear) return false;
    setIsBusy(true);
    setStatus("");
    try {
      const payload = {
        source_year: sourceYear,
        target_year: targetYear,
        payload: {
          scenario_primary_costs: scenarioOverrides,
          selections: Object.entries(selected)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key)
        }
      };
      const response = await fetch(`${API_BASE_URL}/meta/kostprijs-activatie-draft`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      setStatus(message ?? "Concept opgeslagen.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Concept opslaan mislukt.");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function activate() {
    if (!sourceYear || !targetYear) return;
    const selectedKeys = Object.entries(selected).filter(([, value]) => Boolean(value)).map(([key]) => key);
    if (selectedKeys.length === 0) {
      setStatus("Selecteer minimaal 1 product.");
      return;
    }
    const confirmText = `Weet je zeker dat je kostprijzen wilt activeren voor ${targetYear}? Dit maakt nieuwe definitieve kostprijsversies en zet activaties voor ${targetYear}.`;
    if (!confirm(confirmText)) return;

    const ok = await saveDraft("Concept opgeslagen. Activering starten...");
    if (!ok) return;

    setIsBusy(true);
    setStatus("");
    try {
      const selections = selectedKeys.map((key) => {
        const [bier_id, product_id] = key.split("::");
        return { bier_id, product_id };
      });
      const response = await fetch(`${API_BASE_URL}/meta/activate-kostprijzen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_year: sourceYear,
          target_year: targetYear,
          selections,
          dry_run: false
        })
      });
      if (!response.ok) throw new Error(await response.text());
      setStatus(`Kostprijzen geactiveerd voor ${targetYear}.`);
      router.push(`/nieuwe-kostprijsberekening?mode=landing&focus=activations&year=${encodeURIComponent(String(targetYear))}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Activeren mislukt.");
    } finally {
      setIsBusy(false);
    }
  }

  const totalSelected = Object.values(selected).filter(Boolean).length;

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Kostprijzen activeren {targetYear}</div>
        <div className="module-card-text">
          Op basis van het bronjaar en de ingevulde jaar-data maken we nieuwe kostprijsversies en zetten we activaties voor het doeljaar.
          Verkoopprijzen worden hierbij niet automatisch aangepast.
        </div>
      </div>

      {status ? <div className="editor-status" style={{ marginBottom: 14 }}>{status}</div> : null}

      <div className="editor-actions" style={{ marginBottom: 12 }}>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => router.push("/beheer/jaarsets")} disabled={isBusy}>
            Terug
          </button>
          <span className="editor-pill">{totalSelected} geselecteerd</span>
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void saveDraft()} disabled={isBusy}>
            Opslaan
          </button>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void refreshPlan("Plan ververst.")} disabled={isBusy}>
            Preview verversen
          </button>
          <button type="button" className="editor-button" onClick={() => void activate()} disabled={isBusy}>
            Activeren
          </button>
        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: "60px" }} />
              <th style={{ width: "220px" }}>Bier</th>
              <th style={{ width: "220px" }}>Product</th>
              <th style={{ width: "160px" }}>Bron kostprijs</th>
              <th style={{ width: "160px" }}>Bron inkoop</th>
              <th style={{ width: "200px" }}>Scenario inkoop</th>
              <th style={{ width: "160px" }}>Doel kostprijs</th>
              <th style={{ width: "140px" }}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.bier_id}::${row.product_id}`;
              const scenarioValue = scenarioOverrides[key] ?? Number(row.scenario_primary ?? row.source_primary ?? 0);
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[key])}
                      onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                  </td>
                  <td>{row.biernaam}</td>
                  <td>{row.product_label}</td>
                  <td>{formatEur(Number(row.source_cost ?? 0))}</td>
                  <td>{formatEur(Number(row.source_primary ?? 0))}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      value={String(Number.isFinite(scenarioValue) ? scenarioValue : 0)}
                      onChange={(event) =>
                        setScenarioOverrides((current) => ({
                          ...current,
                          [key]: Number(event.target.value)
                        }))
                      }
                    />
                  </td>
                  <td>{formatEur(Number(row.target_cost ?? 0))}</td>
                  <td>{formatEur(Number(row.delta ?? 0))}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  Geen rijen gevonden. Controleer of er actieve kostprijzen zijn in bronjaar {sourceYear}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

