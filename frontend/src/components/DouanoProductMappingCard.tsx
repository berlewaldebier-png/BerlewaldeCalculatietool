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
  sku_id: string;
  label: string;
  naam?: string;
  beer_id?: string;
  format_article_id?: string;
};

type Mapping = {
  douano_product_id: number;
  sku_id: string;
  product_group?: string;
  alcohol_category?: string;
  packaging_type?: string;
  updated_at: string;
};

type Productgroep = { id: string; label: string; sort_order?: number; active?: boolean };
type AlcoholCategorie = { id: string; label: string; sort_order?: number; active?: boolean };
type Verpakkingstype = {
  id: string;
  label: string;
  sort_order?: number;
  active?: boolean;
  allowed_product_groups?: string[];
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

async function readDataset<T>(name: string): Promise<T[]> {
  const payload = await readJson(`/api/data/${encodeURIComponent(name)}`);
  const data = (payload as any)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
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

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DouanoProductMappingCard({ initialFilter = "" }: { initialFilter?: string }) {
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [filter, setFilter] = useState<string>(String(initialFilter ?? ""));
  const [showIgnored, setShowIgnored] = useState<boolean>(false);
  const [showGekoppeld, setShowGekoppeld] = useState<boolean>(true);
  const [showOngekoppeld, setShowOngekoppeld] = useState<boolean>(true);
  const [products, setProducts] = useState<DouanoProduct[]>([]);
  const [combos, setCombos] = useState<ActiveCombo[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [ignored, setIgnored] = useState<Array<{ douano_product_id: number; reason: string }>>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [groupDraft, setGroupDraft] = useState<Record<number, string>>({});
  const [alcoholDraft, setAlcoholDraft] = useState<Record<number, string>>({});
  const [packagingDraft, setPackagingDraft] = useState<Record<number, string>>({});
  const [packagingOptIn, setPackagingOptIn] = useState<Record<number, boolean>>({});

  const [productgroepen, setProductgroepen] = useState<Productgroep[]>([]);
  const [alcoholcategorieen, setAlcoholcategorieen] = useState<AlcoholCategorie[]>([]);
  const [verpakkingstypen, setVerpakkingstypen] = useState<Verpakkingstype[]>([]);

  const mappingsById = useMemo(() => {
    const map = new Map<number, Mapping>();
    mappings.forEach((m) => {
      if (m?.douano_product_id) map.set(Number(m.douano_product_id), m);
    });
    return map;
  }, [mappings]);

  const filteredProducts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const ignoredSet = new Set(ignored.map((i) => Number(i?.douano_product_id ?? 0)).filter((id) => id > 0));
    const visible = showIgnored ? products : products.filter((p) => !ignoredSet.has(Number(p.product_id ?? 0)));
    const byQuery = !q
      ? visible
      : visible.filter((p) => {
          const hay = `${p.name ?? ""} ${p.sku ?? ""} ${p.gtin ?? ""}`.toLowerCase();
          return hay.includes(q);
        });

    return byQuery.filter((p) => {
      const id = Number(p.product_id ?? 0);
      const mapping = mappingsById.get(id);
      const skuId = String((mapping as any)?.sku_id ?? "").trim();
      const productGroup = String(groupDraft[id] ?? (mapping as any)?.product_group ?? "").trim();
      const alcoholCategory = String(alcoholDraft[id] ?? (mapping as any)?.alcohol_category ?? "").trim();
      const packagingType = String(packagingDraft[id] ?? (mapping as any)?.packaging_type ?? "").trim();
      const fullyCoupled = Boolean(skuId && productGroup && alcoholCategory && packagingType);

      if (fullyCoupled && !showGekoppeld) return false;
      if (!fullyCoupled && !showOngekoppeld) return false;
      return true;
    });
  }, [
    products,
    filter,
    ignored,
    showIgnored,
    mappingsById,
    groupDraft,
    alcoholDraft,
    packagingDraft,
    showGekoppeld,
    showOngekoppeld,
  ]);

  const combosByKey = useMemo(() => {
    const map = new Map<string, ActiveCombo>();
    combos.forEach((c) => {
      const key = String((c as any)?.sku_id ?? "").trim();
      if (key) map.set(key, c);
    });
    return map;
  }, [combos]);

  const ignoredById = useMemo(() => {
    const map = new Map<number, { douano_product_id: number; reason: string }>();
    ignored.forEach((row) => {
      const id = Number((row as any)?.douano_product_id ?? 0);
      if (id > 0) map.set(id, row);
    });
    return map;
  }, [ignored]);

  const activeProductgroepen = useMemo(() => {
    return [...productgroepen]
      .filter((row) => (row as any)?.active !== false)
      .sort((a, b) => Number((a as any)?.sort_order ?? 0) - Number((b as any)?.sort_order ?? 0));
  }, [productgroepen]);

  const activeAlcohol = useMemo(() => {
    return [...alcoholcategorieen]
      .filter((row) => (row as any)?.active !== false)
      .sort((a, b) => Number((a as any)?.sort_order ?? 0) - Number((b as any)?.sort_order ?? 0));
  }, [alcoholcategorieen]);

  const activePackaging = useMemo(() => {
    return [...verpakkingstypen]
      .filter((row) => (row as any)?.active !== false)
      .sort((a, b) => Number((a as any)?.sort_order ?? 0) - Number((b as any)?.sort_order ?? 0));
  }, [verpakkingstypen]);

  async function refreshAll() {
    setStatus("Laden...");
    setTone("");
    try {
      const [p, c, m, ig, pg, ac, vt] = await Promise.all([
        readJson("/api/integrations/douano/products?limit=2000"),
        readJson("/api/integrations/douano/cost-combos"),
        readJson("/api/integrations/douano/product-mappings?limit=10000"),
        readJson("/api/integrations/douano/product-ignored?limit=50000"),
        readDataset<Productgroep>("productgroepen"),
        readDataset<AlcoholCategorie>("alcoholcategorieen"),
        readDataset<Verpakkingstype>("verpakkingstypen")
      ]);
      setProducts(Array.isArray(p?.items) ? p.items : []);
      setCombos(Array.isArray(c?.items) ? c.items : []);
      setMappings(Array.isArray(m?.items) ? m.items : []);
      setIgnored(Array.isArray(ig?.items) ? ig.items : []);
      setProductgroepen(pg);
      setAlcoholcategorieen(ac);
      setVerpakkingstypen(vt);
      setGroupDraft(() => {
        const next: Record<number, string> = {};
        (Array.isArray(m?.items) ? m.items : []).forEach((row: any) => {
          const id = Number(row?.douano_product_id ?? 0);
          if (id > 0) next[id] = String(row?.product_group ?? "").trim();
        });
        return next;
      });
      setAlcoholDraft(() => {
        const next: Record<number, string> = {};
        (Array.isArray(m?.items) ? m.items : []).forEach((row: any) => {
          const id = Number(row?.douano_product_id ?? 0);
          if (id > 0) next[id] = String(row?.alcohol_category ?? "").trim();
        });
        return next;
      });
      setPackagingDraft(() => {
        const next: Record<number, string> = {};
        (Array.isArray(m?.items) ? m.items : []).forEach((row: any) => {
          const id = Number(row?.douano_product_id ?? 0);
          if (id > 0) next[id] = String(row?.packaging_type ?? "").trim();
        });
        return next;
      });
      setPackagingOptIn(() => {
        const next: Record<number, boolean> = {};
        (Array.isArray(m?.items) ? m.items : []).forEach((row: any) => {
          const id = Number(row?.douano_product_id ?? 0);
          if (id <= 0) return;
          next[id] = Boolean(String(row?.packaging_type ?? "").trim());
        });
        return next;
      });
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setProducts([]);
      setCombos([]);
      setMappings([]);
      setIgnored([]);
      setProductgroepen([]);
      setAlcoholcategorieen([]);
      setVerpakkingstypen([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(productId: number) {
    const selected = String(draft[productId] ?? "").trim();
    if (!selected) {
      setStatus("Selecteer eerst een SKU-kostprijscombinatie.");
      setTone("error");
      return;
    }
    const productGroup = String(groupDraft[productId] ?? "").trim();
    const alcoholCategory = String(alcoholDraft[productId] ?? "").trim();
    const packagingType = String(packagingDraft[productId] ?? "").trim();
    const wantsPackaging = Boolean(packagingOptIn[productId]);

    if (!productGroup) {
      setStatus("Kies eerst een productgroep.");
      setTone("error");
      return;
    }

    const requiresPackaging = productGroup === "drank" || productGroup === "giftset";
    if (requiresPackaging && !packagingType) {
      setStatus("Verpakkingstype is verplicht voor Drank/Giftset.");
      setTone("error");
      return;
    }
    if (!requiresPackaging && !wantsPackaging && packagingType) {
      setStatus("Zet eerst ‘+ verpakkingstype’ aan om dit veld te gebruiken.");
      setTone("error");
      return;
    }

    setStatus("Opslaan…");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-mappings/${productId}`, "PUT", {
        sku_id: selected,
        product_group: productGroup,
        alcohol_category: alcoholCategory,
        packaging_type: packagingType
      });
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

  async function ignore(productId: number) {
    setStatus("Negeren…");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-ignored/${productId}`, "PUT", { reason: "" });
      await refreshAll();
      setStatus("Genegeerd");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function unignore(productId: number) {
    setStatus("Tonen…");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-ignored/${productId}`, "DELETE");
      await refreshAll();
      setStatus("Weer zichtbaar");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  return (
    <SectionCard
      title="Productkoppeling (Douano → Kostprijs)"
      description="Koppel Douano producten aan een actieve SKU-kostprijscombinatie. Dit is nodig voor kostprijs + marge op omzetregels."
    >
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <input
            className="editor-input"
            style={{ width: 320 }}
            placeholder="Filter Douano producten (naam/sku/gtin)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={showGekoppeld}
              onChange={(e) => setShowGekoppeld(e.target.checked)}
            />
            Gekoppelde producten tonen
          </label>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={showOngekoppeld}
              onChange={(e) => setShowOngekoppeld(e.target.checked)}
            />
            Ongekoppelde producten tonen
          </label>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => setShowIgnored(e.target.checked)}
            />
            Toon genegeerde
          </label>
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void refreshAll()}>
            Ververs
          </button>
        </div>
      </div>

      <div className="module-card-text" style={{ marginTop: 8 }}>
        Productgroep is leidend voor het dashboard. Wijzigingen werken met terugwerkende kracht (ook voor eerdere jaren).
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
              <th style={{ width: 220 }}>Productgroep</th>
              <th style={{ width: 220 }}>Alcohol</th>
              <th style={{ width: 260 }}>Verpakkingstype</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {filteredProducts.slice(0, 500).map((p) => {
              const id = Number(p.product_id || 0);
              const mapping = mappingsById.get(id);
              const mappedKey = mapping ? String((mapping as any).sku_id ?? "").trim() : "";
              const value = String(draft[id] ?? mappedKey ?? "");
              const isMapped = Boolean(mapping);
              const mappedLabel = mappedKey
                ? ((combosByKey.get(mappedKey) as any)?.naam ?? combosByKey.get(mappedKey)?.label ?? mappedKey)
                : "";
              const isIgnored = ignoredById.has(id);
              const groupValue = String(
                groupDraft[id] ?? (mapping as any)?.product_group ?? ""
              );
              const alcoholValue = String(
                alcoholDraft[id] ?? (mapping as any)?.alcohol_category ?? ""
              );
              const packagingValue = String(
                packagingDraft[id] ?? (mapping as any)?.packaging_type ?? ""
              );

              const requiresPackaging = groupValue === "drank" || groupValue === "giftset";
              const optIn = requiresPackaging ? true : Boolean(packagingOptIn[id]);
              const allowedPackaging = requiresPackaging
                ? activePackaging.filter((row) => (row.allowed_product_groups ?? []).includes(groupValue))
                : activePackaging;
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
                      <option value="">Selecteer SKU-kostprijs</option>
                      {mappedKey && !combosByKey.has(mappedKey) ? (
                        <option value={mappedKey}>{mappedLabel || mappedKey}</option>
                      ) : null}
                      {combos.map((c) => {
                        const key = String((c as any)?.sku_id ?? "").trim();
                        if (!key) return null;
                        return (
                          <option key={key} value={key}>
                            {String((c as any)?.naam ?? "").trim() || c.label}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td>
                    <select
                      className="editor-input"
                      style={{ width: "100%" }}
                      value={groupValue}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                    >
                      <option value="">Selecteer…</option>
                      {activeProductgroepen.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="editor-input"
                      style={{ width: "100%" }}
                      value={alcoholValue}
                      onChange={(e) => setAlcoholDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                      disabled={groupValue !== "drank" && groupValue !== "giftset"}
                      title={groupValue !== "drank" && groupValue !== "giftset" ? "Alleen relevant voor drank/giftset." : ""}
                    >
                      <option value="">—</option>
                      {activeAlcohol.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {!requiresPackaging ? (
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, opacity: 0.85 }}>
                          <input
                            type="checkbox"
                            checked={optIn}
                            onChange={(e) => setPackagingOptIn((prev) => ({ ...prev, [id]: e.target.checked }))}
                          />
                          + verpakkingstype
                        </label>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>verplicht</span>
                      )}
                      <select
                        className="editor-input"
                        style={{ width: "100%" }}
                        value={packagingValue}
                        onChange={(e) => setPackagingDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                        disabled={!optIn}
                        title={!optIn ? "Optioneel. Zet ‘+ verpakkingstype’ aan om in te vullen." : ""}
                      >
                        <option value="">{optIn ? "Selecteer…" : "—"}</option>
                        {allowedPackaging.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="editor-button editor-button-icon"
                        aria-label="Opslaan"
                        title="Opslaan"
                        onClick={() => void save(id)}
                        disabled={isIgnored}
                      >
                        <SaveIcon />
                      </button>
                      {isMapped ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary editor-button-icon"
                          aria-label="Verwijderen"
                          title="Verwijderen"
                          onClick={() => void remove(id)}
                        >
                          <TrashIcon />
                        </button>
                      ) : isIgnored ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary editor-button-icon"
                          aria-label="Weer tonen"
                          title="Weer tonen"
                          onClick={() => void unignore(id)}
                        >
                          <EyeIcon />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary editor-button-icon"
                          aria-label="Negeren"
                          title="Negeren"
                          onClick={() => void ignore(id)}
                        >
                          <EyeOffIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ opacity: 0.75 }}>
                  Geen Douano producten geladen. Gebruik “Ververs” (en zorg dat je eerder “Sync products” hebt gedaan).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Toont max. 500 producten (filter om te zoeken). Combinaties komen uit definitieve kostprijssnapshots + activaties (alle jaren).
      </div>
    </SectionCard>
  );
}
