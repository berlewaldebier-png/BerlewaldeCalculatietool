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
  source_packaging?: number;
  source_overhead?: number;
  source_excise?: number;
  scenario_primary: number;
  target_packaging?: number;
  target_overhead?: number;
  target_excise?: number;
  target_cost: number;
  delta: number;
  engine_version?: string;
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
    rows.forEach((row) => {
      const key = `${row.bier_id}::${row.product_id}`;
      nextSelected[key] = true;
    });
    setSelected(nextSelected);
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

  async function activate() {
    if (!sourceYear || !targetYear) return;
    const selectedKeys = Object.entries(selected).filter(([, value]) => Boolean(value)).map(([key]) => key);
    if (selectedKeys.length === 0) {
      setStatus("Selecteer minimaal 1 product.");
      return;
    }
    const confirmText = `Weet je zeker dat je kostprijzen wilt activeren voor ${targetYear}? Dit maakt nieuwe definitieve kostprijsversies, zet activaties voor ${targetYear} en bevriest het break-even plan.`;
    if (!confirm(confirmText)) return;

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
          dry_run: false,
          create_break_even_plan: true
        })
      });
      if (!response.ok) throw new Error(await response.text());
      setStatus(`Kostprijzen geactiveerd en break-even plan bevroren voor ${targetYear}.`);
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
          Dit is een read-only controle van de kostprijs-engine uit Nieuw jaar voorbereiden. Hier kies je alleen welke engine-regels
          definitief geactiveerd worden; kostprijzen worden op deze pagina niet opnieuw berekend.
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
              <th style={{ width: "130px" }}>Bron inkoop</th>
              <th style={{ width: "130px" }}>Bron verpakking</th>
              <th style={{ width: "130px" }}>Bron ABC</th>
              <th style={{ width: "130px" }}>Bron accijns</th>
              <th style={{ width: "130px" }}>Bron kostprijs</th>
              <th style={{ width: "130px" }}>Doel inkoop</th>
              <th style={{ width: "130px" }}>Doel verpakking</th>
              <th style={{ width: "130px" }}>Doel ABC</th>
              <th style={{ width: "130px" }}>Doel accijns</th>
              <th style={{ width: "130px" }}>Doel kostprijs</th>
              <th style={{ width: "140px" }}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.bier_id}::${row.product_id}`;
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
                  <td>{formatEur(Number(row.source_primary ?? 0))}</td>
                  <td>{formatEur(Number(row.source_packaging ?? 0))}</td>
                  <td>{formatEur(Number(row.source_overhead ?? 0))}</td>
                  <td>{formatEur(Number(row.source_excise ?? 0))}</td>
                  <td>{formatEur(Number(row.source_cost ?? 0))}</td>
                  <td>{formatEur(Number(row.scenario_primary ?? 0))}</td>
                  <td>{formatEur(Number(row.target_packaging ?? 0))}</td>
                  <td>{formatEur(Number(row.target_overhead ?? 0))}</td>
                  <td>{formatEur(Number(row.target_excise ?? 0))}</td>
                  <td>{formatEur(Number(row.target_cost ?? 0))}</td>
                  <td>{formatEur(Number(row.delta ?? 0))}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="muted">
                  Geen engine-regels gevonden. Open Nieuw jaar voorbereiden, controleer stap Kostprijs en sla/commit het concept opnieuw op.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
