"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  availableYears: number[];
  defaultYear?: number;
};

export function ProductieDriverAutofill({ availableYears, defaultYear }: Props) {
  const router = useRouter();
  const years = useMemo(() => (availableYears ?? []).slice().filter((y) => y > 0).sort((a, b) => b - a), [availableYears]);
  const resolvedDefault = useMemo(() => {
    const y = Number(defaultYear ?? 0);
    if (y > 0 && years.includes(y)) return y;
    return years[0] ?? new Date().getFullYear();
  }, [defaultYear, years]);

  const [year, setYear] = useState<number>(resolvedDefault);
  const [overwrite, setOverwrite] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleAutofillOrders() {
    setIsBusy(true);
    setStatus("Autofill uitvoeren…");
    try {
      const params = new URLSearchParams();
      params.set("year", String(year));
      params.set("dry_run", "false");
      params.set("overwrite", overwrite ? "true" : "false");

      const response = await fetch(`/api/meta/derive-production-order-drivers?${params.toString()}`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof (payload as any)?.detail === "string" ? (payload as any).detail : response.statusText;
        throw new Error(detail || "Autofill faalde.");
      }
      const computed = (payload as any)?.result?.computed;
      setStatus(
        `Ingevuld: shipments=${Number(computed?.normal_shipments ?? 0)} / orderregels=${Number(computed?.normal_orderlines ?? 0)}`
      );
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Autofill faalde.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAutofillSalesLiters() {
    setIsBusy(true);
    setStatus("Autofill verkoopliters uitvoeren...");
    try {
      const params = new URLSearchParams();
      params.set("year", String(year));
      params.set("dry_run", "false");
      params.set("overwrite", overwrite ? "true" : "false");

      const response = await fetch(`/api/meta/derive-sales-liters?${params.toString()}`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof (payload as any)?.detail === "string" ? (payload as any).detail : response.statusText;
        throw new Error(detail || "Autofill faalde.");
      }
      const computed = (payload as any)?.result?.computed;
      setStatus(`Ingevuld: verkoop_liters=${Number(computed?.sales_l ?? 0).toFixed(0)} L`);
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Autofill faalde.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="module-card" style={{ marginBottom: 16 }}>
      <div className="module-card-header">
        <div className="module-card-title">Autofill drivers (orders)</div>
        <div className="module-card-text">
          Vult <strong>Normale shipments</strong> (distinct orders) en <strong>Normale orderregels</strong> (orderlines)
          vanuit Douano orderdata voor het gekozen jaar. Basis = order (handeling).
        </div>
      </div>

      <div className="editor-actions" style={{ paddingTop: 0 }}>
        <div className="editor-actions-group">
          <select
            className="editor-input"
            style={{ width: 180 }}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value || 0) || 0)}
            aria-label="Jaar"
          >
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>

          <label className="editor-pill" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overschrijven
          </label>
        </div>

        <div className="editor-actions-group">
          {status ? <span className="editor-status">{status}</span> : null}
          <button
            type="button"
            className="editor-button"
            onClick={handleAutofillOrders}
            disabled={isBusy || year <= 0}
            title="Vul normal shipments/orderregels op basis van orderdata"
          >
            {isBusy ? "Autofill…" : "Autofill uitvoeren"}
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={handleAutofillSalesLiters}
            disabled={isBusy || year <= 0}
            title="Vul verkoopliters op basis van factuurregels (mapped)"
          >
            {isBusy ? "Autofill…" : "Autofill verkoop (L)"}
          </button>
        </div>
      </div>
    </section>
  );
}
