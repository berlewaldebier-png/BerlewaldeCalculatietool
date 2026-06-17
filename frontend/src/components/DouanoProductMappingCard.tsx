"use client";

import { useEffect, useMemo, useState } from "react";

import { SectionCard } from "@/components/SectionCard";
import { PageSizeSelect, PaginationBar, SortButton, type PageSizeValue } from "@/components/table/TableControls";
import { normalizeSkuLabel } from "@/lib/skuLabels";
import { clampPage, compareNullableNumber, compareText, computeTotalPages, slicePage } from "@/lib/tableControls";
import { useRouter } from "next/navigation";

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

function normalizePackLabel(value: unknown): string {
  return normalizeSkuLabel(value);
}

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

async function postJson(path: string, body?: any) {
  const response = await fetch(path, {
    method: "POST",
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

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 7h-9" />
      <path d="M14 17H4" />
      <path d="M20 7l-3-3" />
      <path d="M20 7l-3 3" />
      <path d="M4 17l3-3" />
      <path d="M4 17l3 3" />
    </svg>
  );
}

type ViewMode = "douano" | "skus" | "rules";
type SkuRow = { id: string; name: string; kind: string; active: boolean };
type UnmappedRuleRow = {
  rule_id: number;
  match_type: string;
  douano_product_id: number;
  line_description: string;
  action: string;
  sku_id: string;
  category?: string;
  include_revenue?: boolean;
  include_liters?: boolean;
  include_break_even?: boolean;
  note?: string;
  updated_at: string;
};

const RULE_CATEGORIES: Array<{ id: string; label: string; defaults: Partial<UnmappedRuleRow> }> = [
  { id: "Afronding", label: "Afronding", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Emballage/Borg", label: "Emballage/Borg", defaults: { include_revenue: true, include_liters: false, include_break_even: false } },
  { id: "Proeverij/Rondleiding", label: "Proeverij/Rondleiding", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Voorschot/Aanbetaling", label: "Voorschot/Aanbetaling", defaults: { include_revenue: false, include_liters: false, include_break_even: false } },
  { id: "Eten", label: "Eten", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Service", label: "Service", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Correctie", label: "Correctie", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
  { id: "Overig", label: "Overig", defaults: { include_revenue: true, include_liters: false, include_break_even: true } },
];

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="cpq-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cpq-modal">
        <div className="cpq-modal-header">
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button type="button" className="editor-button editor-button-secondary" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cpq-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function DouanoProductMappingCard({
  initialFilter = "",
  initialSkuId = "",
}: {
  initialFilter?: string;
  initialSkuId?: string;
}) {
  const router = useRouter();
  const initialViewMode: ViewMode = String(initialSkuId ?? "").trim() ? "skus" : "douano";
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [filter, setFilter] = useState<string>(String(initialFilter ?? ""));
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [showIgnored, setShowIgnored] = useState<boolean>(false);
  const [showGekoppeld, setShowGekoppeld] = useState<boolean>(true);
  const [showOngekoppeld, setShowOngekoppeld] = useState<boolean>(initialViewMode === "skus");
  const [products, setProducts] = useState<DouanoProduct[]>([]);
  const [combos, setCombos] = useState<ActiveCombo[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [ignored, setIgnored] = useState<Array<{ douano_product_id: number; reason: string }>>([]);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [ruleMappings, setRuleMappings] = useState<UnmappedRuleRow[]>([]);
  const [rulesActionFilter, setRulesActionFilter] = useState<string>("all");
  const [rulesMatchFilter, setRulesMatchFilter] = useState<string>("product0_description");
  const [editRule, setEditRule] = useState<UnmappedRuleRow | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<UnmappedRuleRow>>({});
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [groupDraft, setGroupDraft] = useState<Record<number, string>>({});
  const [alcoholDraft, setAlcoholDraft] = useState<Record<number, string>>({});
  const [packagingDraft, setPackagingDraft] = useState<Record<number, string>>({});
  const [packagingOptIn, setPackagingOptIn] = useState<Record<number, boolean>>({});
  const [skuProductDraft, setSkuProductDraft] = useState<Record<string, string>>({});
  const [pageSize, setPageSize] = useState<PageSizeValue>(20);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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

  const mappingsBySkuId = useMemo(() => {
    const map = new Map<string, Mapping>();
    mappings.forEach((row) => {
      const skuId = String((row as any)?.sku_id ?? "").trim();
      if (skuId) map.set(skuId, row);
    });
    return map;
  }, [mappings]);

  const mappedSkuIds = useMemo(() => {
    const set = new Set<string>();
    mappings.forEach((row) => {
      const skuId = String((row as any)?.sku_id ?? "").trim();
      if (skuId) set.add(skuId);
    });
    return set;
  }, [mappings]);

  const filteredProducts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const ignoredSet = new Set(ignored.map((i) => Number(i?.douano_product_id ?? 0)).filter((id) => id > 0));
    const visible = showIgnored ? products : products.filter((p) => !ignoredSet.has(Number(p.product_id ?? 0)));
    const byQuery = !q
      ? visible
      : visible.filter((p) => {
          const hay = `${p.product_id ?? ""} ${p.name ?? ""} ${p.sku ?? ""} ${p.gtin ?? ""}`.toLowerCase();
          return hay.includes(q);
        });

    return byQuery.filter((p) => {
      const id = Number(p.product_id ?? 0);
      const mapping = mappingsById.get(id);
      const skuId = String((mapping as any)?.sku_id ?? "").trim();
      const productGroup = String(groupDraft[id] ?? (mapping as any)?.product_group ?? "").trim();
      const alcoholCategory = String(alcoholDraft[id] ?? (mapping as any)?.alcohol_category ?? "").trim();
      const packagingType = String(packagingDraft[id] ?? (mapping as any)?.packaging_type ?? "").trim();
      const requiresPackaging = productGroup === "drank" || productGroup === "giftset";
      const fullyCoupled = Boolean(skuId && productGroup && (!requiresPackaging || packagingType));

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

  const filteredSkus = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const candidates = skus.filter((row) => row.active && row.kind === "article");
    const byQuery = !q ? candidates : candidates.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(q));
    return byQuery.filter((row) => {
      const isMapped = mappedSkuIds.has(row.id);
      if (isMapped && !showGekoppeld) return false;
      if (!isMapped && !showOngekoppeld) return false;
      return true;
    });
  }, [filter, mappedSkuIds, showGekoppeld, showOngekoppeld, skus]);

  const sortedProducts = useMemo(() => {
    const copy = [...filteredProducts];
    const dir = sortDir;
    const key = sortKey;
    copy.sort((a, b) => {
      if (key === "sku") return compareText((a as any)?.sku, (b as any)?.sku, dir);
      if (key === "gtin") return compareText((a as any)?.gtin, (b as any)?.gtin, dir);
      if (key === "mapped") {
        const aid = Number((a as any)?.product_id ?? 0);
        const bid = Number((b as any)?.product_id ?? 0);
        const aMap = mappingsById.get(aid);
        const bMap = mappingsById.get(bid);
        const aSku = String((aMap as any)?.sku_id ?? "").trim();
        const bSku = String((bMap as any)?.sku_id ?? "").trim();
        const aGroup = String(groupDraft[aid] ?? (aMap as any)?.product_group ?? "").trim();
        const bGroup = String(groupDraft[bid] ?? (bMap as any)?.product_group ?? "").trim();
        const aPkg = String(packagingDraft[aid] ?? (aMap as any)?.packaging_type ?? "").trim();
        const bPkg = String(packagingDraft[bid] ?? (bMap as any)?.packaging_type ?? "").trim();
        const aRequires = aGroup === "drank" || aGroup === "giftset";
        const bRequires = bGroup === "drank" || bGroup === "giftset";
        const aFull = Boolean(aSku && aGroup && (!aRequires || aPkg));
        const bFull = Boolean(bSku && bGroup && (!bRequires || bPkg));
        return compareNullableNumber(aFull ? 1 : 0, bFull ? 1 : 0, dir);
      }
      return compareText((a as any)?.name, (b as any)?.name, dir);
    });
    return copy;
  }, [alcoholDraft, compareText, filteredProducts, groupDraft, mappingsById, packagingDraft, sortDir, sortKey]);

  const sortedSkus = useMemo(() => {
    const copy = [...filteredSkus];
    const dir = sortDir;
    const key = sortKey;
    copy.sort((a, b) => {
      if (key === "sku_name") return compareText(a.name, b.name, dir);
      if (key === "mapped") return compareNullableNumber(mappedSkuIds.has(a.id) ? 1 : 0, mappedSkuIds.has(b.id) ? 1 : 0, dir);
      return compareText(a.id, b.id, dir);
    });
    return copy;
  }, [filteredSkus, mappedSkuIds, sortDir, sortKey]);

  const totalPages = useMemo(() => {
    const total = viewMode === "douano" ? sortedProducts.length : viewMode === "skus" ? sortedSkus.length : 0;
    return computeTotalPages(total, pageSize);
  }, [pageSize, sortedProducts.length, sortedSkus.length, viewMode]);

  const currentPage = clampPage(page, totalPages);

  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  const pageProducts = useMemo(() => slicePage(sortedProducts, currentPage, pageSize), [currentPage, pageSize, sortedProducts]);
  const pageSkus = useMemo(() => slicePage(sortedSkus, currentPage, pageSize), [currentPage, pageSize, sortedSkus]);

  const filteredRules = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = Array.isArray(ruleMappings) ? ruleMappings : [];
    const out = !q
      ? base
      : base.filter((r) => {
          const hay = `${r.line_description ?? ""} ${r.sku_id ?? ""} ${r.category ?? ""}`.toLowerCase();
          return hay.includes(q);
        });
    return [...out].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }, [filter, ruleMappings]);

  const totalPagesRules = useMemo(() => computeTotalPages(filteredRules.length, pageSize), [filteredRules.length, pageSize]);
  const currentRulesPage = clampPage(page, totalPagesRules);
  const pageRules = useMemo(
    () => slicePage(filteredRules, currentRulesPage, pageSize),
    [filteredRules, currentRulesPage, pageSize]
  );

  useEffect(() => {
    if (viewMode !== "rules") return;
    if (currentRulesPage !== page) setPage(currentRulesPage);
  }, [currentRulesPage, page, viewMode]);

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
      const [p, c, m, ig, pg, ac, vt, skuRows] = await Promise.all([
        readJson("/api/integrations/douano/products?limit=2000"),
        readJson("/api/integrations/douano/cost-combos"),
        readJson("/api/integrations/douano/product-mappings?limit=10000"),
        readJson("/api/integrations/douano/product-ignored?limit=50000"),
        readDataset<Productgroep>("productgroepen"),
        readDataset<AlcoholCategorie>("alcoholcategorieen"),
        readDataset<Verpakkingstype>("verpakkingstypen"),
        readDataset<any>("skus"),
      ]);
      setProducts(
        (Array.isArray(p?.items) ? p.items : []).map((row: any) => ({
          ...row,
          name: normalizePackLabel(row?.name),
        }))
      );
      setCombos(
        (Array.isArray(c?.items) ? c.items : []).map((row: any) => ({
          ...row,
          label: normalizePackLabel(row?.label),
          naam: normalizePackLabel(row?.naam),
        }))
      );
      setMappings(Array.isArray(m?.items) ? m.items : []);
      setIgnored(Array.isArray(ig?.items) ? ig.items : []);
      setProductgroepen(pg);
      setAlcoholcategorieen(ac);
      setVerpakkingstypen(
        (Array.isArray(vt) ? vt : []).map((row: any) => ({
          ...row,
          label: normalizePackLabel(row?.label),
        }))
      );
      setSkus(
        (Array.isArray(skuRows) ? skuRows : [])
          .map((row: any) => ({
            id: String(row?.id ?? "").trim(),
            name: normalizePackLabel(row?.name ?? row?.naam ?? ""),
            kind: String(row?.kind ?? "").trim().toLowerCase(),
            active: row?.active !== false && row?.actief !== false,
          }))
          .filter((row) => row.id && row.kind)
      );
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
      setSkus([]);
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

  useEffect(() => {
    const sid = String(initialSkuId ?? "").trim();
    if (!sid) return;
    setViewMode("skus");
    setFilter(sid);
  }, [initialSkuId]);

  useEffect(() => {
    setPage(1);
  }, [filter, pageSize, sortDir, sortKey, showGekoppeld, showOngekoppeld, showIgnored, viewMode]);

  async function createServiceSkuAndMap(douanoProductId: number, name: string) {
    const id = Number(douanoProductId ?? 0);
    const safeName = String(name ?? "").trim();
    if (id <= 0 || !safeName) return;
    setStatus("Dienst-SKU aanmaken...");
    setTone("");
    try {
      await postJson("/api/integrations/douano/create-service-sku", {
        douano_product_id: id,
        name: safeName,
        uom: "stuk",
      });
      await refreshAll();
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function loadRuleMappings() {
    setStatus("Laden...");
    setTone("");
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "50000");
      if (rulesActionFilter && rulesActionFilter !== "all") qs.set("action", rulesActionFilter);
      if (rulesMatchFilter && rulesMatchFilter !== "all") qs.set("match_type", rulesMatchFilter);
      const payload = await readJson(`/api/integrations/douano/unmapped-rules?${qs.toString()}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setRuleMappings(items);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setRuleMappings([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function saveRuleEdits() {
    if (!editRule) return;
    const nextAction = String(editDraft.action ?? editRule.action ?? "").trim();
    const match_type = String(editRule.match_type ?? "").trim();
    const douano_product_id = Number(editRule.douano_product_id ?? 0) || 0;
    const line_description = String(editRule.line_description ?? "").trim();

    const payload: any = {
      match_type,
      douano_product_id,
      line_description,
      action: nextAction,
    };
    if (nextAction === "map_to_sku") {
      payload.sku_id = String(editDraft.sku_id ?? editRule.sku_id ?? "").trim();
    } else if (nextAction === "categorize") {
      payload.category = String(editDraft.category ?? editRule.category ?? "").trim();
      payload.include_revenue = Boolean(editDraft.include_revenue ?? editRule.include_revenue ?? true);
      payload.include_liters = Boolean(editDraft.include_liters ?? editRule.include_liters ?? false);
      payload.include_break_even = Boolean(editDraft.include_break_even ?? editRule.include_break_even ?? true);
    } else if (nextAction === "ignore") {
      payload.note = String(editDraft.note ?? editRule.note ?? "").trim();
    }

    setStatus("Opslaan...");
    setTone("");
    try {
      await writeJson("/api/integrations/douano/unmapped-rules", "PUT", payload);
      setEditRule(null);
      setEditDraft({});
      await loadRuleMappings();
      setStatus("Opgeslagen");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  async function deleteRule() {
    if (!editRule) return;
    setStatus("Verwijderen...");
    setTone("");
    try {
      await writeJson("/api/integrations/douano/unmapped-rules", "PUT", {
        action: "delete",
        match_type: String(editRule.match_type ?? ""),
        douano_product_id: Number(editRule.douano_product_id ?? 0) || 0,
        line_description: String(editRule.line_description ?? ""),
      });
      setEditRule(null);
      setEditDraft({});
      await loadRuleMappings();
      setStatus("Verwijderd");
      setTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  function toggleSort(nextKey: string) {
    if (sortKey === nextKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "name" || nextKey === "sku_name" ? "asc" : "desc");
  }

  async function saveSkuMapping(skuId: string) {
    const normalizedSkuId = String(skuId ?? "").trim();
    if (!normalizedSkuId) return;

    const productIdRaw = String(skuProductDraft[normalizedSkuId] ?? "").trim();
    const productId = Number(productIdRaw || 0);
    if (!productId) {
      setStatus("Selecteer eerst een Douano product.");
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
      setStatus("Zet eerst '+ verpakkingstype' aan om dit veld te gebruiken.");
      setTone("error");
      return;
    }

    setStatus("Opslaan...");
    setTone("");
    try {
      await writeJson(`/api/integrations/douano/product-mappings/${productId}`, "PUT", {
        sku_id: normalizedSkuId,
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

  async function save(productId: number) {
    const mappedKey = String((mappingsById.get(Number(productId || 0)) as any)?.sku_id ?? "").trim();
    const selected = String(draft[productId] ?? mappedKey ?? "").trim();
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
      setStatus("Zet eerst '+ verpakkingstype' aan om dit veld te gebruiken.");
      setTone("error");
      return;
    }

    setStatus("Opslaan...");
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
    setStatus("Verwijderen...");
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
    setStatus("Negeren...");
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
    setStatus("Tonen...");
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
      title="Productkoppeling (Douano -> SKU)"
      description="Koppel Douano producten aan SKUs. Dit is nodig voor Douano-export, omzetregels en dashboards."
    >
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className={`editor-button editor-button-secondary${viewMode === "skus" ? " active" : ""}`}
              onClick={() => {
                setViewMode("skus");
                setShowOngekoppeld(true);
              }}
              title="Koppel SKUs die nog niet aan Douano gekoppeld zijn."
            >
              SKUs
            </button>
            <button
              type="button"
              className={`editor-button editor-button-secondary${viewMode === "douano" ? " active" : ""}`}
              onClick={() => setViewMode("douano")}
              title="Bekijk Douano producten en hun koppeling."
            >
              Douano producten
            </button>
            <button
              type="button"
              className={`editor-button editor-button-secondary${viewMode === "rules" ? " active" : ""}`}
              onClick={() => {
                setViewMode("rules");
                void loadRuleMappings();
              }}
              title="Toon koppelingen die zijn opgelost via Ongekoppelde regels (product0 omschrijvingen)."
            >
              Via regels
            </button>
          </div>
          {viewMode === "rules" ? (
            <>
              <input
                className="editor-input"
                style={{ width: 320 }}
                placeholder="Filter regels (omschrijving/sku)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select
                className="editor-input"
                style={{ width: 180 }}
                value={rulesActionFilter}
                onChange={(e) => setRulesActionFilter(e.target.value)}
                title="Filter op type regel."
              >
                <option value="all">Alle acties</option>
                <option value="map_to_sku">map_to_sku</option>
                <option value="categorize">categorize</option>
                <option value="ignore">ignore</option>
              </select>
              <select
                className="editor-input"
                style={{ width: 220 }}
                value={rulesMatchFilter}
                onChange={(e) => setRulesMatchFilter(e.target.value)}
                title="Filter op match type."
              >
                <option value="all">Alle match types</option>
                <option value="product0_description">product0_description</option>
                <option value="douano_product_id">douano_product_id</option>
              </select>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => void loadRuleMappings()}
              >
                Zoeken
              </button>
            </>
          ) : (
            <>
              <input
                className="editor-input"
                style={{ width: 320 }}
                placeholder={viewMode === "skus" ? "Filter SKUs (naam/id)" : "Filter Douano producten (naam/sku/gtin)"}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                <input type="checkbox" checked={showGekoppeld} onChange={(e) => setShowGekoppeld(e.target.checked)} />
                Gekoppelde producten tonen
              </label>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                <input type="checkbox" checked={showOngekoppeld} onChange={(e) => setShowOngekoppeld(e.target.checked)} />
                Ongekoppelde producten tonen
              </label>
              {viewMode === "douano" ? (
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                  <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
                  Toon genegeerde
                </label>
              ) : null}
            </>
          )}
        </div>
        <div className="editor-actions-group">
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void refreshAll()}>
            Ververs
          </button>
        </div>
      </div>

      <div className="module-card-text" style={{ marginTop: 8 }}>
        {mappings.length} echte productkoppelingen op {products.length} Douano producten. Productgroep is leidend voor het dashboard.
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      {editRule ? (
        <Modal title="Regel bewerken" onClose={() => setEditRule(null)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.85 }}>
              <div>
                <strong>Match</strong>: <code>{String(editRule.match_type)}</code>
              </div>
              <div>
                <strong>Omschrijving</strong>: <code>{String(editRule.line_description || "") || "-"}</code>
              </div>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 800 }}>Actie</span>
              <select
                className="editor-input"
                value={String(editDraft.action ?? editRule.action ?? "")}
                onChange={(e) => {
                  const next = e.target.value;
                  setEditDraft((prev) => ({ ...prev, action: next }));
                  if (next === "categorize") {
                    const cat = String(editDraft.category ?? editRule.category ?? "Overig");
                    const preset = RULE_CATEGORIES.find((c) => c.id === cat);
                    if (preset?.defaults) setEditDraft((prev) => ({ ...prev, ...preset.defaults, category: cat }));
                  }
                }}
              >
                <option value="map_to_sku">map_to_sku</option>
                <option value="categorize">categorize</option>
                <option value="ignore">ignore</option>
              </select>
            </label>

            {String(editDraft.action ?? editRule.action ?? "") === "map_to_sku" ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 800 }}>SKU</span>
                <select
                  className="editor-input"
                  value={String(editDraft.sku_id ?? editRule.sku_id ?? "")}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, sku_id: e.target.value }))}
                >
                  <option value="">Selecteer SKU...</option>
                  {skus
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.id})
                      </option>
                    ))}
                </select>
              </label>
            ) : null}

            {String(editDraft.action ?? editRule.action ?? "") === "categorize" ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>Categorie</span>
                  <select
                    className="editor-input"
                    value={String(editDraft.category ?? editRule.category ?? "Overig")}
                    onChange={(e) => {
                      const next = e.target.value;
                      const preset = RULE_CATEGORIES.find((c) => c.id === next);
                      setEditDraft((prev) => ({
                        ...prev,
                        category: next,
                        ...(preset?.defaults ?? {}),
                      }));
                    }}
                  >
                    {RULE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(editDraft.include_revenue ?? editRule.include_revenue ?? true)}
                      onChange={(e) => setEditDraft((prev) => ({ ...prev, include_revenue: e.target.checked }))}
                    />
                    Neem mee in omzet
                  </label>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(editDraft.include_liters ?? editRule.include_liters ?? false)}
                      onChange={(e) => setEditDraft((prev) => ({ ...prev, include_liters: e.target.checked }))}
                    />
                    Neem mee in liters
                  </label>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(editDraft.include_break_even ?? editRule.include_break_even ?? true)}
                      onChange={(e) => setEditDraft((prev) => ({ ...prev, include_break_even: e.target.checked }))}
                    />
                    Neem mee in break-even
                  </label>
                </div>
              </>
            ) : null}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
              <button type="button" className="editor-button editor-button-secondary" onClick={() => void deleteRule()}>
                Verwijderen
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => {
                    const yearGuess = new Date().getFullYear() - 1;
                    const qs = new URLSearchParams();
                    qs.set("tab", "unmapped");
                    qs.set("unmapped_basis", "invoice");
                    qs.set("unmapped_year", String(yearGuess));
                    qs.set("unmapped_match_type", String(editRule.match_type || ""));
                    if (editRule.match_type === "product0_description") {
                      qs.set("unmapped_line_description", String(editRule.line_description || ""));
                    }
                    router.push(`/beheer/productkoppeling?${qs.toString()}`);
                    setEditRule(null);
                  }}
                  title="Open Ongekoppelde regels en toon de bijbehorende regels."
                >
                  Naar regels
                </button>
                <button type="button" className="editor-button editor-button-secondary" onClick={() => setEditRule(null)}>
                  Annuleren
                </button>
                <button type="button" className="editor-button" onClick={() => void saveRuleEdits()}>
                  Opslaan
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {viewMode === "rules" ? (
        <div className="data-table" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 320 }}>Omschrijving (product0)</th>
                <th style={{ width: 160 }}>Actie</th>
                <th style={{ width: 320 }}>SKU/Categorie</th>
                <th style={{ width: 220 }}>Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {pageRules.length === 0 ? (
                <tr>
                  <td className="dataset-empty" colSpan={4}>
                    Geen regels gevonden.
                  </td>
                </tr>
              ) : null}
              {pageRules.map((r) => {
                const skuId = String((r as any)?.sku_id ?? "").trim();
                const skuName = skus.find((s) => s.id === skuId)?.name ?? "";
                const skuLabel = skuId ? (skuName ? `${skuName} (${skuId})` : skuId) : "-";
                const cat = String((r as any)?.category ?? "").trim();
                const action = String((r as any)?.action ?? "").trim() || "-";
                const rightLabel = action === "map_to_sku" ? skuLabel : action === "categorize" ? cat || "-" : "-";
                return (
                  <tr
                    key={String((r as any)?.rule_id ?? "") || `${skuId}-${String((r as any)?.line_description ?? "")}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setEditRule(r);
                      setEditDraft({});
                    }}
                    title="Klik om te bewerken"
                  >
                    <td style={{ fontWeight: 700 }}>{String((r as any)?.line_description ?? "") || "-"}</td>
                    <td>
                      <code>{action}</code>
                    </td>
                    <td>{rightLabel ? <code>{rightLabel}</code> : "-"}</td>
                    <td>{String((r as any)?.updated_at ?? "") || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : viewMode === "douano" ? (
        <>
      <div className="data-table" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>ID</th>
              <th>
                <SortButton label="Douano product" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
              </th>
              <th style={{ width: 160 }}>
                <SortButton label="SKU" active={sortKey === "sku"} dir={sortDir} onClick={() => toggleSort("sku")} />
              </th>
              <th style={{ width: 180 }}>
                <SortButton label="GTIN" active={sortKey === "gtin"} dir={sortDir} onClick={() => toggleSort("gtin")} />
              </th>
              <th style={{ width: 420 }}>Koppeling</th>
              <th style={{ width: 220 }}>Productgroep</th>
              <th style={{ width: 220 }}>Alcohol</th>
              <th style={{ width: 260 }}>Verpakkingstype</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {pageProducts.map((p) => {
              const id = Number(p.product_id || 0);
              const mapping = mappingsById.get(id);
              const mappedKey = mapping ? String((mapping as any).sku_id ?? "").trim() : "";
              const value = String(draft[id] ?? mappedKey ?? "");
              const isMapped = Boolean(mapping);
              const mappedLabel = mappedKey
                ? ((combosByKey.get(mappedKey) as any)?.naam ?? combosByKey.get(mappedKey)?.label ?? mappedKey)
                : "";
              const isIgnored = ignoredById.has(id);
              const heuristicServiceGroup =
                !mapping && !groupDraft[id] && /verzending|proeverij|rondleiding|dienst|service/i.test(String(p?.name ?? ""))
                  ? "dienst"
                  : "";
              const groupValue = String(
                groupDraft[id] ?? (mapping as any)?.product_group ?? heuristicServiceGroup ?? ""
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
                      {!isMapped && !isIgnored && groupValue === "dienst" ? (
                        <button
                          type="button"
                          className="editor-button editor-button-secondary editor-button-icon"
                          aria-label="Maak dienst-SKU"
                          title="Maak dienst-SKU (service) en koppel automatisch"
                          onClick={() => void createServiceSkuAndMap(id, String((p as any)?.name ?? "").trim())}
                        >
                          <ServiceIcon />
                        </button>
                      ) : null}
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
            {pageProducts.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ opacity: 0.75 }}>
                  Geen Douano producten geladen. Gebruik "Ververs" (en zorg dat je eerder "Sync products" hebt gedaan).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Toont max. 500 producten (filter om te zoeken). Combinaties komen uit definitieve kostprijssnapshots + activaties (alle jaren).
      </div>
        </>
      ) : (
        <>
          <div className="data-table" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 320 }}>
                    <SortButton label="SKU" active={sortKey === "sku_id"} dir={sortDir} onClick={() => toggleSort("sku_id")} />
                  </th>
                  <th>
                    <SortButton label="Naam" active={sortKey === "sku_name"} dir={sortDir} onClick={() => toggleSort("sku_name")} />
                  </th>
                  <th style={{ width: 360 }}>Douano product</th>
                  <th style={{ width: 220 }}>Productgroep</th>
                  <th style={{ width: 220 }}>Alcohol</th>
                  <th style={{ width: 260 }}>Verpakkingstype</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {pageSkus.map((row) => {
                  const skuId = row.id;
                  const mapping = mappingsBySkuId.get(skuId) ?? null;
                  const mappedProductId = mapping ? Number((mapping as any)?.douano_product_id ?? 0) : 0;
                  const selectedProductId = Number(String(skuProductDraft[skuId] ?? mappedProductId ?? 0)) || 0;

                  const groupValue = selectedProductId
                    ? String(groupDraft[selectedProductId] ?? (mapping as any)?.product_group ?? "")
                    : "";
                  const alcoholValue = selectedProductId
                    ? String(alcoholDraft[selectedProductId] ?? (mapping as any)?.alcohol_category ?? "")
                    : "";
                  const packagingValue = selectedProductId
                    ? String(packagingDraft[selectedProductId] ?? (mapping as any)?.packaging_type ?? "")
                    : "";

                  const requiresPackaging = groupValue === "drank" || groupValue === "giftset";
                  const optIn = selectedProductId ? (requiresPackaging ? true : Boolean(packagingOptIn[selectedProductId])) : false;
                  const allowedPackaging = requiresPackaging
                    ? activePackaging.filter((p) => (p.allowed_product_groups ?? []).includes(groupValue))
                    : activePackaging;

                  return (
                    <tr key={skuId}>
                      <td>
                        <code>{skuId}</code>
                      </td>
                      <td>{row.name}</td>
                      <td>
                        <select
                          className="editor-input"
                          style={{ width: "100%" }}
                          value={selectedProductId ? String(selectedProductId) : ""}
                          onChange={(e) => setSkuProductDraft((prev) => ({ ...prev, [skuId]: e.target.value }))}
                        >
                          <option value="">Selecteer Douano product...</option>
                          {products.map((p) => (
                            <option key={p.product_id} value={String(p.product_id)}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="editor-input"
                          style={{ width: "100%" }}
                          value={groupValue}
                          onChange={(e) => {
                            const pid = selectedProductId;
                            if (!pid) return;
                            setGroupDraft((prev) => ({ ...prev, [pid]: e.target.value }));
                          }}
                          disabled={!selectedProductId}
                        >
                          <option value="">{selectedProductId ? "Selecteer..." : "-"}</option>
                          {activeProductgroepen.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="editor-input"
                          style={{ width: "100%" }}
                          value={alcoholValue}
                          onChange={(e) => {
                            const pid = selectedProductId;
                            if (!pid) return;
                            setAlcoholDraft((prev) => ({ ...prev, [pid]: e.target.value }));
                          }}
                          disabled={!selectedProductId || (groupValue !== "drank" && groupValue !== "giftset")}
                          title={groupValue !== "drank" && groupValue !== "giftset" ? "Alleen relevant voor drank/giftset." : ""}
                        >
                          <option value="">-</option>
                          {activeAlcohol.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
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
                                onChange={(e) => {
                                  const pid = selectedProductId;
                                  if (!pid) return;
                                  setPackagingOptIn((prev) => ({ ...prev, [pid]: e.target.checked }));
                                }}
                                disabled={!selectedProductId}
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
                            onChange={(e) => {
                              const pid = selectedProductId;
                              if (!pid) return;
                              setPackagingDraft((prev) => ({ ...prev, [pid]: e.target.value }));
                            }}
                            disabled={!selectedProductId || !optIn}
                            title={!optIn ? "Optioneel. Zet '+ verpakkingstype' aan om in te vullen." : ""}
                          >
                            <option value="">{selectedProductId && optIn ? "Selecteer..." : "-"}</option>
                            {allowedPackaging.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="editor-button editor-button-icon"
                          aria-label="Opslaan"
                          title="Opslaan"
                          onClick={() => void saveSkuMapping(skuId)}
                        >
                          <SaveIcon />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {pageSkus.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ opacity: 0.75 }}>
                      Geen SKUs gevonden (filter aanpassen of zet &quot;Gekoppelde/Ongekoppelde&quot; aan).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, opacity: 0.75 }}>
            Toont max. 500 SKUs (filter om te zoeken).
          </div>
        </>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ opacity: 0.75 }}>
          {viewMode === "rules"
            ? `Pagina ${currentRulesPage} / ${totalPagesRules} (totaal ${filteredRules.length} regels)`
            : `Pagina ${currentPage} / ${totalPages} (totaal ${viewMode === "douano" ? `${sortedProducts.length} producten` : `${sortedSkus.length} SKUs`})`}
        </div>
        <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <PageSizeSelect
            value={pageSize}
            onChange={(next) => {
              setPage(1);
              setPageSize(next);
            }}
            title="Aantal regels per pagina"
          />
          <PaginationBar
            page={viewMode === "rules" ? currentRulesPage : currentPage}
            totalPages={viewMode === "rules" ? totalPagesRules : totalPages}
            onChange={setPage}
          />
        </div>
      </div>
    </SectionCard>
  );
}
