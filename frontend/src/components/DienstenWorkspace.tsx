"use client";

import { useEffect, useMemo, useState } from "react";

import { SectionCard } from "@/components/SectionCard";

type SkuRow = {
  id: string;
  kind?: string;
  article_id?: string;
  name?: string;
  naam?: string;
  active?: boolean;
  actief?: boolean;
  product_group?: string;
  productgroep?: string;
};

type ArticleRow = {
  id: string;
  name?: string;
  naam?: string;
  kind?: string;
  sellable_subtype?: string;
  active?: boolean;
  actief?: boolean;
};

type MappingRow = {
  douano_product_id: number;
  sku_id: string;
  product_group?: string;
  alcohol_category?: string;
  packaging_type?: string;
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

export function DienstenWorkspace({ skus, articles }: { skus: SkuRow[]; articles: ArticleRow[] }) {
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [mappings, setMappings] = useState<MappingRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setTone("");
        setStatus("Laden…");
        const payload = await readJson(`/api/integrations/douano/product-mappings?limit=10000`);
        const items = Array.isArray((payload as any)?.items) ? ((payload as any).items as MappingRow[]) : [];
        if (!cancelled) {
          setMappings(items);
          setTone("success");
          setStatus("Gereed.");
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setTone("error");
        setStatus(message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const articleById = useMemo(() => {
    const map = new Map<string, ArticleRow>();
    for (const row of Array.isArray(articles) ? articles : []) {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    }
    return map;
  }, [articles]);

  const mappingCountBySkuId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of mappings) {
      const skuId = String((row as any)?.sku_id ?? "").trim();
      if (!skuId) continue;
      map.set(skuId, (map.get(skuId) ?? 0) + 1);
    }
    return map;
  }, [mappings]);

  const serviceSkus = useMemo(() => {
    const rows = Array.isArray(skus) ? skus : [];
    const out: Array<SkuRow & { service_reason: string }> = [];
    for (const row of rows) {
      const skuId = String((row as any)?.id ?? "").trim();
      if (!skuId) continue;
      const kind = String((row as any)?.kind ?? "").trim().toLowerCase();
      if (kind !== "article") continue;
      const productGroup = String((row as any)?.product_group ?? (row as any)?.productgroep ?? "").trim();
      const articleId = String((row as any)?.article_id ?? "").trim();
      const article = articleId ? articleById.get(articleId) : undefined;
      const subtype = String((article as any)?.sellable_subtype ?? "").trim().toLowerCase();
      if (productGroup === "dienst") out.push({ ...row, service_reason: "productgroep=dienst" });
      else if (subtype === "dienst") out.push({ ...row, service_reason: "article.sellable_subtype=dienst" });
    }
    out.sort((a, b) => String(a.name ?? a.naam ?? "").localeCompare(String(b.name ?? b.naam ?? "")));
    return out;
  }, [skus, articleById]);

  return (
    <SectionCard title="Diensten (service-SKU’s)">
      {status ? (
        <div className={`status-banner ${tone ? `status-${tone}` : ""}`} style={{ marginBottom: 12 }}>
          {status}
        </div>
      ) : null}

      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 320 }}>SKU</th>
              <th>Naam</th>
              <th style={{ width: 260 }}>Article</th>
              <th style={{ width: 160 }}>Koppelingen</th>
              <th style={{ width: 220 }}>Herkomst</th>
            </tr>
          </thead>
          <tbody>
            {serviceSkus.map((row) => {
              const skuId = String((row as any)?.id ?? "").trim();
              const name = String((row as any)?.name ?? (row as any)?.naam ?? "").trim();
              const articleId = String((row as any)?.article_id ?? "").trim();
              const cnt = mappingCountBySkuId.get(skuId) ?? 0;
              return (
                <tr key={skuId}>
                  <td>{skuId}</td>
                  <td>{name || "—"}</td>
                  <td>{articleId || "—"}</td>
                  <td>{cnt}</td>
                  <td style={{ opacity: 0.75 }}>{row.service_reason}</td>
                </tr>
              );
            })}
            {serviceSkus.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ opacity: 0.75 }}>
                  Geen service-SKU’s gevonden. Maak er één via Beheer → Productkoppeling (“Maak dienst-SKU”).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

