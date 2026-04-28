"use client";

import { useState } from "react";

import { SectionCard } from "@/components/SectionCard";

type SyncResult = Record<string, unknown>;

async function postJson(path: string): Promise<SyncResult> {
  const response = await fetch(path, { method: "POST", cache: "no-store" });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return (payload ?? {}) as SyncResult;
}

async function getJson(path: string): Promise<SyncResult> {
  const response = await fetch(path, { method: "GET", cache: "no-store" });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return (payload ?? {}) as SyncResult;
}

export function DouanoSyncPanel() {
  const [status, setStatus] = useState("");
  const [output, setOutput] = useState<string>("");
  const [mappingYear, setMappingYear] = useState<number>(new Date().getFullYear());
  const [productQuery, setProductQuery] = useState("");
  const [comboQuery, setComboQuery] = useState("");
  const [products, setProducts] = useState<Array<any>>([]);
  const [combos, setCombos] = useState<Array<any>>([]);
  const [mappings, setMappings] = useState<Array<any>>([]);
  const [selectedDouanoProductId, setSelectedDouanoProductId] = useState<number | null>(null);
  const [selectedComboKey, setSelectedComboKey] = useState<string>("");

  async function run(label: string, fn: () => Promise<SyncResult>) {
    setStatus(`${label}…`);
    try {
      const result = await fn();
      setOutput(JSON.stringify(result, null, 2));
      setStatus(`${label}: klaar`);
    } catch (error) {
      setOutput("");
      setStatus(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadProducts() {
    const q = productQuery.trim();
    const url = `/api/integrations/douano/products?q=${encodeURIComponent(q)}`;
    setStatus("Douano producten laden…");
    try {
      const result = (await getJson(url)) as any;
      setProducts(Array.isArray(result?.items) ? result.items : []);
      setStatus("Douano producten geladen");
    } catch (error) {
      setProducts([]);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadCombos() {
    const url = `/api/integrations/douano/active-cost-combos?year=${encodeURIComponent(String(mappingYear))}`;
    setStatus("Actieve kostprijs-combinaties laden…");
    try {
      const result = (await getJson(url)) as any;
      let items = Array.isArray(result?.items) ? result.items : [];
      const q = comboQuery.trim().toLowerCase();
      if (q) {
        items = items.filter((row: any) => String(row?.label ?? "").toLowerCase().includes(q));
      }
      setCombos(items);
      setStatus("Actieve combinaties geladen");
    } catch (error) {
      setCombos([]);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadMappings() {
    setStatus("Mappings laden…");
    try {
      const result = (await getJson("/api/integrations/douano/product-mappings")) as any;
      setMappings(Array.isArray(result?.items) ? result.items : []);
      setStatus("Mappings geladen");
    } catch (error) {
      setMappings([]);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveMapping() {
    if (!selectedDouanoProductId) {
      setStatus("Kies eerst een Douano product.");
      return;
    }
    const [bier_id, product_id] = selectedComboKey.split("::");
    if (!bier_id || !product_id) {
      setStatus("Kies eerst een bier + verpakking combinatie.");
      return;
    }
    setStatus("Mapping opslaan…");
    try {
      const response = await fetch(`/api/integrations/douano/product-mappings/${selectedDouanoProductId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bier_id, product_id })
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`${response.status} ${payload?.detail ?? response.statusText}`);
      }
      setOutput(JSON.stringify(payload, null, 2));
      setStatus("Mapping opgeslagen");
      await loadMappings();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const mappingsByDouanoId = new Map<number, any>();
  mappings.forEach((m) => {
    const id = Number(m?.douano_product_id ?? 0);
    if (id > 0) mappingsByDouanoId.set(id, m);
  });

  const selectedDouano = selectedDouanoProductId
    ? products.find((p) => Number(p?.product_id ?? 0) === selectedDouanoProductId) ?? null
    : null;
  const selectedMapping = selectedDouanoProductId ? mappingsByDouanoId.get(selectedDouanoProductId) ?? null : null;

  return (
    <SectionCard
      title="Douano sync (fase 1)"
      description="Handmatige import van companies/products/sales-orders naar PostgreSQL (raw + normalized)."
    >

      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync companies", () => postJson("/api/integrations/douano/sync/companies"))}
          >
            Sync companies
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync products", () => postJson("/api/integrations/douano/sync/products"))}
          >
            Sync products
          </button>
          <button
            type="button"
            className="editor-button"
            onClick={() => run("Sync sales-orders", () => postJson("/api/integrations/douano/sync/sales-orders"))}
          >
            Sync sales-orders
          </button>
        </div>
        <div className="editor-actions-group">
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => run("Sync status", () => getJson("/api/integrations/douano/sync-status"))}
          >
            Sync status
          </button>
          <button
            type="button"
            className="editor-button editor-button-secondary"
            onClick={() => run("Revenue summary", () => getJson("/api/integrations/douano/revenue-summary"))}
          >
            Revenue summary
          </button>
        </div>
      </div>

      {status ? <div className="editor-status" style={{ marginTop: 12 }}>{status}</div> : null}
      {output ? (
        <pre className="code-block" style={{ marginTop: 12, maxHeight: 360, overflow: "auto" }}>
          {output}
        </pre>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Fase 2: product mapping (handmatig)</div>
        <div className="editor-actions" style={{ marginTop: 8 }}>
          <div className="editor-actions-group">
            <input
              className="editor-input"
              style={{ width: 110 }}
              value={String(mappingYear)}
              onChange={(e) => setMappingYear(Number(e.target.value || new Date().getFullYear()))}
              inputMode="numeric"
              aria-label="Jaar"
            />
            <button type="button" className="editor-button editor-button-secondary" onClick={() => void loadCombos()}>
              Laad combinaties
            </button>
            <input
              className="editor-input"
              style={{ width: 240 }}
              placeholder="Filter combinaties (bv. blond doos)"
              value={comboQuery}
              onChange={(e) => setComboQuery(e.target.value)}
            />
          </div>
          <div className="editor-actions-group">
            <input
              className="editor-input"
              style={{ width: 260 }}
              placeholder="Zoek Douano product (name/sku/gtin)"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
            />
            <button type="button" className="editor-button editor-button-secondary" onClick={() => void loadProducts()}>
              Zoek producten
            </button>
            <button type="button" className="editor-button editor-button-secondary" onClick={() => void loadMappings()}>
              Laad mappings
            </button>
          </div>
        </div>

        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Douano ID</th>
                <th>Douano product</th>
                <th style={{ width: 220 }}>SKU</th>
                <th style={{ width: 220 }}>GTIN</th>
                <th style={{ width: 360 }}>Mapping (bier — verpakking)</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 50).map((row) => {
                const id = Number(row?.product_id ?? 0);
                const mapped = mappingsByDouanoId.get(id);
                return (
                  <tr key={id || row?.name}>
                    <td>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => setSelectedDouanoProductId(id)}
                        style={
                          selectedDouanoProductId === id
                            ? { background: "var(--card-accent)", borderColor: "var(--card-border)" }
                            : undefined
                        }
                      >
                        {id || "-"}
                      </button>
                    </td>
                    <td>{String(row?.name ?? "")}</td>
                    <td><code>{String(row?.sku ?? "")}</code></td>
                    <td><code>{String(row?.gtin ?? "")}</code></td>
                    <td>
                      {mapped ? (
                        <code>
                          {String(mapped?.bier_id ?? "")}::{String(mapped?.product_id ?? "")}
                        </code>
                      ) : (
                        <span className="pill">unmapped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ opacity: 0.75 }}>
                    Gebruik “Zoek producten” om Douano producten te laden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Koppel geselecteerd Douano product</div>
          <div style={{ opacity: 0.85, marginBottom: 8 }}>
            {selectedDouano ? (
              <span>
                Douano: <code>{selectedDouanoProductId}</code> — {String(selectedDouano?.name ?? "")}
                {selectedMapping ? (
                  <>
                    {" "}· huidig:{" "}
                    <code>
                      {String(selectedMapping?.bier_id ?? "")}::{String(selectedMapping?.product_id ?? "")}
                    </code>
                  </>
                ) : null}
              </span>
            ) : (
              <span>Kies eerst een Douano product in de tabel.</span>
            )}
          </div>
          <div className="editor-actions">
            <div className="editor-actions-group">
              <select
                className="editor-input"
                style={{ width: 520 }}
                value={selectedComboKey}
                onChange={(e) => setSelectedComboKey(e.target.value)}
              >
                <option value="">Selecteer bier — verpakking (actief)</option>
                {combos.slice(0, 1000).map((c) => {
                  const key = `${String(c?.bier_id ?? "")}::${String(c?.product_id ?? "")}`;
                  return (
                    <option key={key} value={key}>
                      {String(c?.label ?? key)}
                    </option>
                  );
                })}
              </select>
              <button type="button" className="editor-button" onClick={() => void saveMapping()}>
                Opslaan
              </button>
            </div>
          </div>
        </div>
      </div>

    </SectionCard>
  );
}
