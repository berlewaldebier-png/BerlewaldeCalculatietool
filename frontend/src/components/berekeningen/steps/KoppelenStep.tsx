"use client";

import { useEffect, useMemo, useState } from "react";

import type { CostProductCandidate } from "@/components/berekeningen/steps/SellableVariantsStep";
import { makeBeerSkuLabel } from "@/lib/skuLabels";

type GenericRecord = Record<string, unknown>;
type OptionRow = { id: string; label: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function douanoProductId(row: GenericRecord) {
  return text((row as any).id || (row as any).product_id || (row as any).douano_product_id);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/\*/g, "x")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function labelForSku(sku: GenericRecord, articleById: Map<string, GenericRecord>) {
  const articleId = text((sku as any).article_id || (sku as any).format_article_id);
  const article = articleId ? articleById.get(articleId) : null;
  return (
    text((sku as any).name) ||
    text((sku as any).label) ||
    text((article as any)?.name) ||
    text((article as any)?.omschrijving) ||
    text((sku as any).id)
  );
}

function labelForDouanoProduct(row: GenericRecord) {
  const code = text((row as any).code || (row as any).sku || (row as any).article_number || (row as any).number);
  const name = text((row as any).name || (row as any).description || (row as any).product_name);
  if (code && name) return `${code} - ${name}`;
  return name || code || douanoProductId(row);
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readDataset(name: string): Promise<GenericRecord[]> {
  const response = await fetch(`/api/data/${encodeURIComponent(name)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({ data: [] }));
  if (!response.ok) {
    throw new Error(String((payload as any)?.detail ?? response.statusText));
  }
  return Array.isArray((payload as any)?.data) ? ((payload as any).data as GenericRecord[]) : [];
}

function optionLabel(row: GenericRecord) {
  return text((row as any).label || (row as any).omschrijving || (row as any).naam || (row as any).name || (row as any).id);
}

function toOptions(rows: GenericRecord[]) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => (row as any)?.active !== false && (row as any)?.actief !== false)
    .map((row) => ({ id: text((row as any).id), label: optionLabel(row) }))
    .filter((row) => row.id)
    .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
}

function findOptionId(options: OptionRow[], wanted: string) {
  const normalizedWanted = normalizeSearchText(wanted);
  if (!normalizedWanted) return "";
  return (
    options.find((option) => normalizeSearchText(option.id) === normalizedWanted)?.id ||
    options.find((option) => normalizeSearchText(option.label) === normalizedWanted)?.id ||
    options.find((option) => normalizeSearchText(option.label).includes(normalizedWanted))?.id ||
    ""
  );
}

function inferAlcoholCategoryId(options: OptionRow[], alcoholPercentage: unknown) {
  const value = Number(String(alcoholPercentage ?? "").replace(",", "."));
  if (!Number.isFinite(value)) return findOptionId(options, "normaal");
  if (value === 0) return findOptionId(options, "alcoholvrij");
  if (value >= 0.1 && value <= 0.4) return findOptionId(options, "alcoholarm");
  if (value >= 0.5) return findOptionId(options, "normaal");
  return findOptionId(options, "normaal");
}

function inferPackagingTypeId(options: OptionRow[], skuLabel: string, fallback = "") {
  const normalizedSku = normalizeSearchText(skuLabel);
  const direct = options.find((option) => {
    const normalizedLabel = normalizeSearchText(option.label);
    const normalizedId = normalizeSearchText(option.id);
    return (normalizedLabel && normalizedSku.includes(normalizedLabel)) || (normalizedId && normalizedSku.includes(normalizedId));
  });
  if (direct) return direct.id;
  const countMatch = normalizedSku.match(/(?:doos|pakket)?\s*(\d+)\s*x/);
  if (countMatch?.[1]) {
    const count = countMatch[1];
    const byCount = options.find((option) => normalizeSearchText(option.label).includes(count) || normalizeSearchText(option.id).includes(count));
    if (byCount) return byCount.id;
  }
  return fallback;
}

function mergeKeepingNonEmptyDraft(nextValues: Record<string, string>, currentValues: Record<string, string>) {
  const merged = { ...nextValues };
  Object.entries(currentValues).forEach(([key, value]) => {
    const draftValue = text(value);
    if (draftValue) merged[key] = draftValue;
  });
  return merged;
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

function matchScore(internalLabel: string, product: GenericRecord) {
  const target = normalizeSearchText(internalLabel);
  const candidate = normalizeSearchText(labelForDouanoProduct(product));
  if (!target || !candidate) return 0;
  if (target === candidate) return 10_000;
  let score = candidate.includes(target) || target.includes(candidate) ? 2_000 : 0;
  const targetTokens = searchTokens(target);
  const candidateTokens = new Set(searchTokens(candidate));
  for (const token of targetTokens) {
    if (candidateTokens.has(token)) score += 120;
    else if ([...candidateTokens].some((candidateToken) => candidateToken.includes(token) || token.includes(candidateToken))) score += 40;
  }
  return score;
}

function SearchableDouanoProductSelect({
  rowId,
  rowLabel,
  products,
  selected,
  disabled,
  onChange,
  onOpen,
}: {
  rowId: string;
  rowLabel: string;
  products: GenericRecord[];
  selected: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onOpen?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const selectedProduct = useMemo(
    () => products.find((product) => douanoProductId(product) === selected) ?? null,
    [products, selected]
  );
  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    const options = [...products]
      .map((product) => {
        const label = labelForDouanoProduct(product);
        const normalizedLabel = normalizeSearchText(label);
        const queryMatch = !normalizedQuery || normalizedLabel.includes(normalizedQuery);
        return {
          product,
          id: douanoProductId(product),
          label,
          score: matchScore(rowLabel, product),
          queryMatch,
        };
      })
      .filter((option) => option.id && option.queryMatch)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.label.localeCompare(b.label, "nl-NL");
      })
      .slice(0, 30);
    if (selected && !options.some((option) => option.id === selected)) {
      const selectedOption = products.find((product) => douanoProductId(product) === selected);
      if (selectedOption) {
        return [
          {
            product: selectedOption,
            id: selected,
            label: labelForDouanoProduct(selectedOption),
            score: matchScore(rowLabel, selectedOption),
            queryMatch: true,
          },
          ...options,
        ];
      }
    }
    return options;
  }, [products, query, rowLabel, selected]);

  function selectOption(id: string) {
    onChange(id);
    setQuery("");
    setIsOpen(false);
  }

  const inputValue = isOpen ? query : selectedProduct ? labelForDouanoProduct(selectedProduct) : query;

  return (
    <div style={{ position: "relative", minWidth: 280 }}>
      <input
        className="dataset-input"
        value={inputValue}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setIsOpen(true);
          onOpen?.();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setQuery("");
            setIsOpen(false);
          }
          if (event.key === "Enter" && filteredProducts[0]?.id) {
            event.preventDefault();
            selectOption(filteredProducts[0].id);
          }
        }}
        placeholder={selectedProduct ? labelForDouanoProduct(selectedProduct) : "Zoek Douano product..."}
        disabled={disabled}
        autoComplete="off"
      />
      {isOpen && !disabled ? (
        <div
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 280,
            overflowY: "auto",
            border: "1px solid var(--border-color, #d7deea)",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 14px 35px rgba(15, 23, 42, 0.16)",
          }}
        >
          {products.length === 0 && isOpen ? (
            <div className="dataset-muted" style={{ padding: "10px 12px" }}>
              Geen Douano producten geladen.
            </div>
          ) : null}
          {products.length > 0 && filteredProducts.length === 0 ? (
            <div className="dataset-muted" style={{ padding: "10px 12px" }}>
              Geen Douano producten gevonden.
            </div>
          ) : null}
          {filteredProducts.map((option) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                selectOption(option.id);
              }}
              style={{
                width: "100%",
                display: "block",
                padding: "9px 12px",
                border: 0,
                borderBottom: "1px solid #edf1f7",
                background: option.id === selected ? "#eef4ff" : "#fff",
                color: "#07183a",
                textAlign: "left",
                cursor: "pointer",
                fontWeight: option.score > 0 ? 700 : 500,
              }}
            >
              {option.score > 0 ? "(match) " : ""}
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function saveDouanoMapping({
  douanoProductId,
  skuId,
  productGroup,
  alcoholCategory,
  packagingType,
}: {
  douanoProductId: string;
  skuId: string;
  productGroup: string;
  alcoholCategory: string;
  packagingType: string;
}) {
  if (!douanoProductId || !skuId) return;
  const response = await fetch(`/api/integrations/douano/product-mappings/${encodeURIComponent(douanoProductId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sku_id: skuId,
      product_group: productGroup,
      alcohol_category: alcoholCategory,
      packaging_type: packagingType,
    }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "Productkoppeling opslaan mislukt.");
  }
}

export function KoppelenStep({
  current,
  skus,
  articles,
  costProductRows,
  douanoMappings,
  onRefreshMappings,
  focusUnlinkedOnly = false,
}: {
  current: GenericRecord;
  skus: GenericRecord[];
  articles: GenericRecord[];
  costProductRows: CostProductCandidate[];
  douanoMappings: Array<{ sku_id?: unknown; douano_product_id?: unknown; product_group?: unknown; alcohol_category?: unknown; packaging_type?: unknown }>;
  onRefreshMappings: () => Promise<void>;
  focusUnlinkedOnly?: boolean;
}) {
  const basis = ((current as any).basisgegevens ?? {}) as GenericRecord;
  const beerId = text((current as any).bier_id || (basis as any).bier_id);
  const beerName = text((basis as any).biernaam) || "Nieuw artikel";
  const productGroup = text((basis as any).product_group) || "drank";
  const alcoholCategory = text((basis as any).alcohol_category);
  const packagingType = text((basis as any).packaging_type);
  const [douanoProducts, setDouanoProducts] = useState<GenericRecord[]>([]);
  const [selectedBySkuId, setSelectedBySkuId] = useState<Record<string, string>>({});
  const [productGroupBySkuId, setProductGroupBySkuId] = useState<Record<string, string>>({});
  const [alcoholBySkuId, setAlcoholBySkuId] = useState<Record<string, string>>({});
  const [packagingBySkuId, setPackagingBySkuId] = useState<Record<string, string>>({});
  const [productGroupOptions, setProductGroupOptions] = useState<OptionRow[]>([]);
  const [alcoholOptions, setAlcoholOptions] = useState<OptionRow[]>([]);
  const [packagingOptions, setPackagingOptions] = useState<OptionRow[]>([]);
  const [status, setStatus] = useState("");
  const [savingSkuId, setSavingSkuId] = useState("");
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isSyncingProducts, setIsSyncingProducts] = useState(false);

  const articleById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(articles) ? articles : []).forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [articles]);

  function displaySkuLabel(sku: GenericRecord) {
    return makeBeerSkuLabel(beerName, labelForSku(sku, articleById));
  }

  const relevantSkus = useMemo(() => {
    return (Array.isArray(skus) ? skus : [])
      .filter((sku) => {
        const kind = text((sku as any).kind).toLowerCase();
        const skuBeerId = text((sku as any).beer_id);
        if (!skuBeerId || skuBeerId !== beerId) return false;
        return kind === "beer_format" || kind === "article";
      })
      .map((sku) => ({
        sku,
        id: text((sku as any).id),
        label: displaySkuLabel(sku),
      }))
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [articleById, beerId, beerName, skus]);

  const defaultProductGroup = useMemo(
    () => findOptionId(productGroupOptions, productGroup) || productGroupOptions[0]?.id || productGroup,
    [productGroup, productGroupOptions]
  );

  const defaultAlcoholCategory = useMemo(
    () => alcoholCategory || inferAlcoholCategoryId(alcoholOptions, (basis as any).alcoholpercentage),
    [alcoholCategory, alcoholOptions, basis]
  );

  const skuByFormatId = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((sku) => {
      const kind = text((sku as any).kind).toLowerCase();
      const skuBeerId = text((sku as any).beer_id);
      const formatId = text((sku as any).format_article_id);
      if (kind === "beer_format" && skuBeerId === beerId && formatId) {
        map.set(formatId, sku);
      }
    });
    return map;
  }, [beerId, skus]);

  const missingCostProducts = useMemo(() => {
    return (Array.isArray(costProductRows) ? costProductRows : []).filter((row) => {
      const productId = text(row.productId);
      return productId && !skuByFormatId.has(productId);
    });
  }, [costProductRows, skuByFormatId]);

  const mappedDouanoBySkuId = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(douanoMappings) ? douanoMappings : []).forEach((row) => {
      const skuId = text(row?.sku_id);
      const productId = text(row?.douano_product_id);
      if (skuId && productId) map.set(skuId, productId);
    });
    return map;
  }, [douanoMappings]);

  const mappingBySkuId = useMemo(() => {
    const map = new Map<string, any>();
    (Array.isArray(douanoMappings) ? douanoMappings : []).forEach((row: any) => {
      const skuId = text(row?.sku_id);
      if (skuId) map.set(skuId, row);
    });
    return map;
  }, [douanoMappings]);

  const visibleSkus = useMemo(
    () => relevantSkus.filter((row) => !focusUnlinkedOnly || !mappedDouanoBySkuId.get(row.id)),
    [focusUnlinkedOnly, mappedDouanoBySkuId, relevantSkus]
  );
  const hiddenMappedCount = focusUnlinkedOnly ? relevantSkus.length - visibleSkus.length : 0;

  async function loadDouanoProducts(cancelledRef?: { cancelled: boolean }) {
    if (isLoadingProducts) return;
    setIsLoadingProducts(true);
    try {
      const response = await fetch(`/api/integrations/douano/products?limit=2000`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({ items: [] }));
      if (!response.ok) {
        throw new Error(String((payload as any)?.detail ?? response.statusText));
      }
      if (!cancelledRef?.cancelled) {
        setDouanoProducts(Array.isArray(payload?.items) ? payload.items : []);
      }
    } catch (error) {
      if (!cancelledRef?.cancelled) {
        setDouanoProducts([]);
        setStatus(`Douano producten laden mislukt: ${errorMessage(error)}`);
      }
    } finally {
      if (!cancelledRef?.cancelled) setIsLoadingProducts(false);
    }
  }

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    void loadDouanoProducts(cancelledRef);
    return () => {
      cancelledRef.cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadClassificationOptions() {
      try {
        const [groups, alcohol, packaging] = await Promise.all([
          readDataset("productgroepen"),
          readDataset("alcoholcategorieen"),
          readDataset("verpakkingstypen"),
        ]);
        if (cancelled) return;
        setProductGroupOptions(toOptions(groups));
        setAlcoholOptions(toOptions(alcohol));
        setPackagingOptions(toOptions(packaging));
      } catch (error) {
        if (!cancelled) setStatus(`Classificatie laden mislukt: ${errorMessage(error)}`);
      }
    }
    void loadClassificationOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const next: Record<string, string> = {};
    relevantSkus.forEach((row) => {
      const mapped = mappedDouanoBySkuId.get(row.id);
      if (mapped) next[row.id] = mapped;
    });
    setSelectedBySkuId((currentSelection) => mergeKeepingNonEmptyDraft(next, currentSelection));
  }, [mappedDouanoBySkuId, relevantSkus]);

  useEffect(() => {
    const nextGroups: Record<string, string> = {};
    const nextAlcohol: Record<string, string> = {};
    const nextPackaging: Record<string, string> = {};
    relevantSkus.forEach((row) => {
      const mapping = mappingBySkuId.get(row.id) ?? {};
      const skuPackagingType = text((row.sku as any).packaging_type);
      nextGroups[row.id] = text(mapping.product_group) || defaultProductGroup;
      nextAlcohol[row.id] = text(mapping.alcohol_category) || defaultAlcoholCategory;
      nextPackaging[row.id] =
        text(mapping.packaging_type) ||
        skuPackagingType ||
        inferPackagingTypeId(packagingOptions, row.label, packagingType);
    });
    setProductGroupBySkuId((current) => mergeKeepingNonEmptyDraft(nextGroups, current));
    setAlcoholBySkuId((current) => mergeKeepingNonEmptyDraft(nextAlcohol, current));
    setPackagingBySkuId((current) => mergeKeepingNonEmptyDraft(nextPackaging, current));
  }, [defaultAlcoholCategory, defaultProductGroup, mappingBySkuId, packagingOptions, packagingType, relevantSkus]);

  async function syncProducts() {
    setIsSyncingProducts(true);
    setStatus("");
    try {
      const response = await fetch(`/api/integrations/douano/sync/products`, { method: "POST" });
      if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(message || "Products API synchroniseren mislukt.");
      }
      await loadDouanoProducts();
      setStatus("Douano producten gesynchroniseerd.");
    } catch (error) {
      setStatus(`Synchroniseren mislukt: ${String((error as any)?.message ?? error)}`);
    } finally {
      setIsSyncingProducts(false);
    }
  }

  async function saveOne(row: { id: string; sku: GenericRecord }) {
    const skuId = row.id;
    const douanoProductId = text(selectedBySkuId[skuId]);
    if (!douanoProductId) {
      setStatus("Selecteer eerst een Douano product.");
      return;
    }
    const nextProductGroup = text(productGroupBySkuId[skuId]) || defaultProductGroup;
    const nextAlcoholCategory = text(alcoholBySkuId[skuId]) || defaultAlcoholCategory;
    const nextPackagingType = text(packagingBySkuId[skuId]) || inferPackagingTypeId(packagingOptions, labelForSku(row.sku, articleById), packagingType);
    if (!nextProductGroup || !nextAlcoholCategory || !nextPackagingType) {
      setStatus("Vul productgroep, alcohol en verpakkingstype in voordat je de koppeling opslaat.");
      return;
    }
    setSavingSkuId(skuId);
    setStatus("");
    try {
      await saveDouanoMapping({
        douanoProductId,
        skuId,
        productGroup: nextProductGroup,
        alcoholCategory: nextAlcoholCategory,
        packagingType: nextPackagingType,
      });
      setSelectedBySkuId((current) => ({ ...current, [skuId]: douanoProductId }));
      setProductGroupBySkuId((current) => ({ ...current, [skuId]: nextProductGroup }));
      setAlcoholBySkuId((current) => ({ ...current, [skuId]: nextAlcoholCategory }));
      setPackagingBySkuId((current) => ({ ...current, [skuId]: nextPackagingType }));
      await onRefreshMappings();
      setStatus("Koppeling opgeslagen.");
    } catch (error) {
      setStatus(`Opslaan mislukt: ${String((error as any)?.message ?? error)}`);
    } finally {
      setSavingSkuId("");
    }
  }

  return (
    <div className="wizard-stack">
      <div className="module-card compact-card">
        <div className="module-card-title">Koppelen met Douano</div>
        <div className="module-card-text">
          Koppel iedere verkoopbare SKU uit deze kostprijs aan het product dat uit Douano komt. Daarna kan Omzet en Marge de juiste kostprijs vinden.
        </div>
      </div>

      {douanoProducts.length === 0 ? (
        <div className="module-card compact-card">
          <div className="module-card-title">Geen Douano producten geladen</div>
          <div className="module-card-text">
            Synchroniseer eerst de Products API zodat de dropdowns hieronder gevuld kunnen worden.
          </div>
          <div className="editor-actions" style={{ marginTop: 12 }}>
            <button type="button" className="editor-button" onClick={() => void syncProducts()} disabled={isSyncingProducts || isLoadingProducts}>
              {isSyncingProducts ? "Synchroniseren..." : "Products API synchroniseren"}
            </button>
          </div>
        </div>
      ) : null}

      {focusUnlinkedOnly && hiddenMappedCount > 0 ? (
        <div className="module-card compact-card">
          <div className="module-card-title">{hiddenMappedCount} bestaande SKU's al gekoppeld</div>
          <div className="module-card-text">
            Deze inkoopfactuur toont hier alleen nieuwe of nog ongekoppelde SKU's. Bestaande koppelingen blijven beschikbaar via Beheer &gt; Productkoppeling.
          </div>
        </div>
      ) : null}

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table wizard-table-compact">
          <thead>
            <tr>
              <th>Verkoopbare SKU</th>
              <th>Douano product</th>
              <th>Productgroep</th>
              <th>Alcohol</th>
              <th>Verpakkingstype</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleSkus.length === 0 && missingCostProducts.length === 0 ? (
              <tr>
                <td colSpan={7} className="dataset-empty">
                  {focusUnlinkedOnly
                    ? "Alle verkoopbare SKU's voor deze factuur zijn al gekoppeld."
                    : "Nog geen verkoopbare SKU's voor deze stijl. Maak eerst een basis-SKU of variant in de vorige stap."}
                </td>
              </tr>
            ) : null}
            {missingCostProducts.map((row) => (
              <tr key={`missing-${row.id}`}>
                <td style={{ fontWeight: 700 }}>{row.label}</td>
                <td>
                  <span className="dataset-muted">Nog geen SKU om te koppelen</span>
                </td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>
                  <span className="status-pill status-warning">maak SKU in stap 5</span>
                </td>
                <td />
              </tr>
            ))}
            {visibleSkus.map((row) => {
              const mapped = mappedDouanoBySkuId.get(row.id);
              const selected = text(selectedBySkuId[row.id] ?? mapped ?? "");
              return (
                <tr key={row.id}>
                  <td style={{ fontWeight: 700 }}>{row.label}</td>
                  <td>
                    <SearchableDouanoProductSelect
                      rowId={row.id}
                      rowLabel={row.label}
                      products={douanoProducts}
                      selected={selected}
                      disabled={false}
                      onOpen={() => {
                        if (douanoProducts.length === 0 && !isLoadingProducts) {
                          void loadDouanoProducts();
                        }
                      }}
                      onChange={(value) =>
                        setSelectedBySkuId((currentSelection) => ({
                          ...currentSelection,
                          [row.id]: value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="dataset-input"
                      value={text(productGroupBySkuId[row.id])}
                      onChange={(event) => setProductGroupBySkuId((current) => ({ ...current, [row.id]: event.target.value }))}
                    >
                      <option value="">Selecteer...</option>
                      {productGroupOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="dataset-input"
                      value={text(alcoholBySkuId[row.id])}
                      onChange={(event) => setAlcoholBySkuId((current) => ({ ...current, [row.id]: event.target.value }))}
                    >
                      <option value="">Selecteer...</option>
                      {alcoholOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="dataset-input"
                      value={text(packagingBySkuId[row.id])}
                      onChange={(event) => setPackagingBySkuId((current) => ({ ...current, [row.id]: event.target.value }))}
                    >
                      <option value="">Selecteer...</option>
                      {packagingOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{mapped ? <span className="status-pill status-ok">gekoppeld</span> : <span className="status-pill status-warning">open</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="icon-button-table" title="Koppeling opslaan" aria-label="Koppeling opslaan" disabled={savingSkuId === row.id} onClick={() => void saveOne(row)}>
                      <SaveIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {status ? <div className={status.includes("mislukt") || status.includes("Selecteer") ? "form-error" : "form-success"}>{status}</div> : null}
    </div>
  );
}
