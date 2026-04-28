"use client";

import { useEffect, useMemo, useState } from "react";

import { SectionCard } from "@/components/SectionCard";

type DouanoProduct = {
  product_id: number;
  name: string;
  sku: string;
  gtin: string;
};

type ActiveCombo = {
  bier_id: string;
  product_id: string;
  label: string;
};

type Mapping = {
  douano_product_id: number;
  bier_id: string;
  product_id: string;
  updated_at: string;
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

async function writeJson(path: string, method: "PUT" | "DELETE", body?: any) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M19 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v4h8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

export function DouanoProductMappingCard() {
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [filter, setFilter] = useState<string>("");
  const [products, setProducts] = useState<DouanoProduct[]>([]);
  const [combos, setCombos] = useState<ActiveCombo[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const mappingsById = useMemo(() => {
    const map = new Map<number, Mapping>();
    mappings.forEach((m) => {
      if (m?.douano_product_id) map.set(Number(m.douano_product_id), m);
    });
    return map;
  }, [mappings]);

  const filteredProducts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const hay = `${p.name ?? ""} ${p.sku ?? ""} ${p.gtin ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, filter]);

  async function refreshAll() {
    setStatus("Laden…");
    setTone("");
    try {
      const [p, c, m] = await Promise.all([
        readJson("/api/integrations/douano/products?limit=2000"),
        readJson(`/api/integrations/douano/active-cost-combos?year=${encodeURIComponent(String(year))}`),
        readJson("/api/integrations/douano/product-mappings?limit=10000")
      ]);
      setProducts(Array.isArray(p?.items) ? p.items : []);
      setCombos(Array.isArray(c?.items) ? c.items : []);
      setMappings(Array.isArray(m?.items) ? m.items : []);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setProducts([]);
      setCombos([]);
      setMappings([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function save(productId: number) {
    const selected = String(draft[productId] ?? "").trim();
    const [bier_id, product_id] = selected.split("::");
    if (!bier_id || !product_id) {
      setStatus("Selecteer eerst een bier — verpakking combinatie.");
      setTone("error");
      return;
    }
    setStatus("Opslaan…");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-mappings/${productId}`, "PUT", { bier_id, product_id });
      await refreshAll();
      setStatus("Opgeslagen");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function remove(productId: number) {
    setStatus("Verwijderen…");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-mappings/${productId}`, "DELETE");
      await refreshAll();
      setStatus("Verwijderd");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  return (
    <SectionCard
      title="Productkoppeling (Douano → Kostprijs)"
      description="Koppel Douano producten aan een actieve (bier + verpakking) combinatie. Dit is nodig voor kostprijs + marge op omzetregels."
    >
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 700, opacity: 0.85 }}>Jaar</span>
            <input
              className="editor-input"
              style={{ width: 110 }}
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))}
              inputMode="numeric"
              aria-label="Jaar"
            />
          </label>
          <input
            className="editor-input"
            style={{ width: 320 }}
            placeholder="Filter Douano producten (naam/sku/gtin)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void refreshAll()}>
            Ververs
          </button>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>ID</th>
              <th>Douano product</th>
              <th style={{ width: 160 }}>SKU</th>
              <th style={{ width: 180 }}>GTIN</th>
              <th style={{ width: 420 }}>Koppeling</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {filteredProducts.slice(0, 500).map((p) => {
              const id = Number(p.product_id || 0);
              const mapping = mappingsById.get(id);
              const mappedKey = mapping ? `${mapping.bier_id}::${mapping.product_id}` : "";
              const value = String(draft[id] ?? mappedKey ?? "");
              const isMapped = Boolean(mapping);
              return (
                <tr key={id}>
                  <td>
                    <code>{id}</code>
                  </td>
                  <td>{p.name}</td>
                  <td>
                    <code>{p.sku}</code>
                  </td>
                  <td>
                    <code>{p.gtin}</code>
                  </td>
                  <td>
                    <select
                      className="editor-input"
                      style={{ width: "100%" }}
                      value={value}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                    >
                      <option value="">{isMapped ? "—" : "Selecteer bier — verpakking"}</option>
                      {combos.map((c) => {
                        const key = `${c.bier_id}::${c.product_id}`;
                        return (
                          <option key={key} value={key}>
                            {c.label}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!isMapped ? (
                      <button
                        type="button"
                        className="editor-button editor-button-icon"
                        aria-label="Opslaan"
                        title="Opslaan"
                        onClick={() => void save(id)}
                      >
                        <SaveIcon />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="editor-button editor-button-secondary editor-button-icon"
                        aria-label="Verwijderen"
                        title="Verwijderen"
                        onClick={() => void remove(id)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ opacity: 0.75 }}>
                  Geen Douano producten geladen. Gebruik “Ververs” (en zorg dat je eerder “Sync products” hebt gedaan).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Toont max. 500 producten (filter om te zoeken). Combinaties komen uit actieve kostprijs-activaties voor het gekozen jaar.
      </div>
    </SectionCard>
  );
}

