"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL } from "@/lib/api";

type Settings = {
  handling_default_shipments: number;
  handling_picks_per_orderline: number;
  handling_shipments_multiplier: number;
  handling_orderlines_mode: "unique_products";
};

function clampNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function CostManagementSettingsClient({ initial }: { initial: Partial<Settings> }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [isSaving, setIsSaving] = useState(false);

  const defaults: Settings = useMemo(
    () => ({
      handling_default_shipments: 1,
      handling_picks_per_orderline: 1,
      handling_shipments_multiplier: 1,
      handling_orderlines_mode: "unique_products",
    }),
    []
  );

  const [form, setForm] = useState<Settings>(() => ({
    ...defaults,
    ...initial,
    handling_default_shipments: clampNumber((initial as any)?.handling_default_shipments, defaults.handling_default_shipments),
    handling_picks_per_orderline: clampNumber((initial as any)?.handling_picks_per_orderline, defaults.handling_picks_per_orderline),
    handling_shipments_multiplier: clampNumber((initial as any)?.handling_shipments_multiplier, defaults.handling_shipments_multiplier),
    handling_orderlines_mode: "unique_products",
  }));

  useEffect(() => {
    setForm((prev) => ({ ...prev, ...defaults, ...initial } as Settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setIsSaving(true);
    setStatus("");
    setTone("");
    try {
      const payload = {
        handling_default_shipments: Math.max(0, Math.round(clampNumber(form.handling_default_shipments, 1))),
        handling_picks_per_orderline: Math.max(0, clampNumber(form.handling_picks_per_orderline, 1)),
        handling_shipments_multiplier: Math.max(0, clampNumber(form.handling_shipments_multiplier, 1)),
        handling_orderlines_mode: "unique_products",
      };

      const response = await fetch(`${API_BASE_URL}/data/cost-management-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Opslaan mislukt");
      }
      setStatus("Opgeslagen.");
      setTone("success");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Opslaan mislukt.");
      setTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Handelingskosten (quote)</div>
          <div className="module-card-text">
            Defaults voor de berekening van handelingskosten in offertes. Dit beïnvloedt de regel “Handelingskosten (ex)”.
          </div>
        </div>

        <div className="dataset-editor-scroll" style={{ padding: 16 }}>
          <div className="editor-toolbar" style={{ padding: 0, marginBottom: 12 }}>
            <div className="editor-toolbar-meta">
              <span className="muted">Orderlines mode</span>
              <span className="editor-pill" title="MVP: orderlines worden afgeleid als het aantal unieke producten in de offerte.">
                unique_products (MVP)
              </span>
            </div>
          </div>

          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div className="stat-card">
              <div className="stat-label">Default shipments</div>
              <div className="stat-value small">
                <input
                  className="dataset-input"
                  type="number"
                  step="1"
                  min="0"
                  value={String(form.handling_default_shipments ?? 1)}
                  onChange={(e) => setForm((prev) => ({ ...prev, handling_default_shipments: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Wordt gebruikt als er geen shipments in de offerte worden opgegeven.
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Picks per orderregel</div>
              <div className="stat-value small">
                <input
                  className="dataset-input"
                  type="number"
                  step="any"
                  min="0"
                  value={String(form.handling_picks_per_orderline ?? 1)}
                  onChange={(e) => setForm((prev) => ({ ...prev, handling_picks_per_orderline: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Vermenigvuldigt het aantal orderregels (voor afwijkende pick-complexiteit).
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Shipments multiplier</div>
              <div className="stat-value small">
                <input
                  className="dataset-input"
                  type="number"
                  step="any"
                  min="0"
                  value={String(form.handling_shipments_multiplier ?? 1)}
                  onChange={(e) => setForm((prev) => ({ ...prev, handling_shipments_multiplier: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Correctiefactor als 1 shipment niet 1-op-1 overeenkomt met jullie “handeling”.
              </div>
            </div>
          </div>
        </div>

        <div className="editor-actions">
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            {status ? <span className={`editor-status ${tone}`}>{status}</span> : null}
            <button type="button" className="editor-button" disabled={isSaving} onClick={handleSave}>
              {isSaving ? "Opslaan..." : "Opslaan"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

