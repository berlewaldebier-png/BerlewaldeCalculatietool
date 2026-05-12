"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  calcSellPriceFromOpslagPct,
  parseNumberLoose,
  round2
} from "@/lib/pricingEngine";
import { VerkoopstrategiePrijsinstellingenAccordion } from "@/components/verkoopstrategie/VerkoopstrategiePrijsinstellingenAccordion";
import { inputClass, money, num } from "@/components/verkoopstrategie/verkoopstrategieUi";
import type { BeerViewRow, ProductViewRow } from "@/components/verkoopstrategie/verkoopstrategieTypes";
import { useCentralSkuIndex } from "@/features/sku/useCentralSkuIndex";
import {
  DEFAULT_CHANNELS,
  STRATEGY_RECORD_TYPES,
  buildEmptyYearStrategyRow,
  computeDraftSignature,
  createUiId,
  normalizeChannels,
  normalizeLabel,
  normalizeStrategyRow,
  type ChannelRow,
  type StrategyRow,
} from "@/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import { buildArticleLabelMap, buildBasisProductParentMap, buildProductSources, stripInternal } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceDerivations";

type GenericRecord = Record<string, unknown>;
type Props = {
  endpoint: string;
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  skus?: GenericRecord[];
  articles?: GenericRecord[];
  berekeningen: GenericRecord[];
  /** Authoritative list of available years comes from productie. */
  productie?: unknown;
  channels: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  /** Wizard-only: if provided in `mode="draft"`, pricing is computed from these preview cost rows instead of activations/snapshots. */
  draftKostprijsPreviewRows?: Array<{
    bierId: string;
    biernaam: string;
    productId: string;
    productType: "basis" | "samengesteld" | "";
    productLabel: string;
    kostprijs: number;
  }>;
  initialYear?: number;
  lockYear?: boolean;
  exposeSave?: Dispatch<SetStateAction<(() => Promise<void>) | null>>;
  mode?: "server" | "draft";
  onDraftSave?: (rows: GenericRecord[]) => Promise<void> | void;
};

export function VerkoopstrategieWorkspace({
  endpoint,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  bieren,
  skus,
  articles,
  berekeningen,
  productie,
  channels,
  kostprijsproductactiveringen,
  draftKostprijsPreviewRows,
  initialYear,
  lockYear,
  exposeSave,
  mode = "server",
  onDraftSave
}: Props) {
  const normalizedChannels = useMemo(() => normalizeChannels(channels), [channels]);
  const activeChannels = useMemo(() => normalizedChannels.filter((channel) => channel.actief), [normalizedChannels]);
  const channelCodes = useMemo(() => normalizedChannels.map((channel) => channel.code), [normalizedChannels]);
  const channelMasterDefaults = useMemo(
    () =>
      Object.fromEntries(
        normalizedChannels.map((channel) => [
          channel.code,
          { opslag: Number(channel.default_marge_pct ?? 50) }
        ])
      ) as Record<string, { opslag: number }>,
    [normalizedChannels]
  );
  const verkoopPassthroughRows = useMemo(() => {
    return verkoopprijzen.filter((row) => !STRATEGY_RECORD_TYPES.has(String(row.record_type ?? "")));
  }, [verkoopprijzen]);
  const verkoopStrategyRows = useMemo(() => {
    return verkoopprijzen.filter((row) => STRATEGY_RECORD_TYPES.has(String(row.record_type ?? "")));
  }, [verkoopprijzen]);
  const formatArticleById = useMemo(() => {
    return buildArticleLabelMap(Array.isArray(articles) ? articles : [], "format");
  }, [articles]);
  const bundleArticleById = useMemo(() => {
    return buildArticleLabelMap(Array.isArray(articles) ? articles : [], "bundle");
  }, [articles]);
  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [skus]);

  // Year selection must be available before we derive SKU-driven product sources.
  const productieYears = useMemo(() => {
    const out: number[] = [];
    if (!productie) return out;
    if (Array.isArray(productie)) {
      productie.forEach((row) => {
        const year = Number((row as any)?.jaar ?? 0);
        if (Number.isFinite(year) && year > 0) out.push(year);
      });
      return Array.from(new Set(out)).sort((a, b) => a - b);
    }
    if (typeof productie === "object") {
      Object.keys(productie as Record<string, unknown>).forEach((key) => {
        const year = Number(key);
        if (Number.isFinite(year) && year > 0) out.push(year);
      });
      return Array.from(new Set(out)).sort((a, b) => a - b);
    }
    return out;
  }, [productie]);

  const computedDefaultYear = useMemo(() => {
    if (productieYears.length > 0) return Math.max(...productieYears);
    // If productie has no years yet, do not guess based on other datasets.
    // We render an explicit empty-state instead of silently selecting a future year (e.g. 2026).
    return new Date().getFullYear();
  }, [berekeningen, productieYears, verkoopprijzen]);

  const resolvedInitialYear =
    typeof initialYear === "number" && Number.isFinite(initialYear) ? initialYear : computedDefaultYear;
  const [selectedYear, setSelectedYear] = useState<number>(resolvedInitialYear);
  const effectiveSelectedYear = lockYear ? resolvedInitialYear : selectedYear;

  const centralSkuIndex = useCentralSkuIndex({
    year: effectiveSelectedYear,
    channels: Array.isArray(channels) ? channels : [],
    verkoopprijzen: Array.isArray(verkoopprijzen) ? (verkoopprijzen as any[]) : [],
    skus: Array.isArray(skus) ? skus : [],
    articles: Array.isArray(articles) ? articles : [],
    kostprijsversies: Array.isArray(berekeningen) ? (berekeningen as any[]) : [],
    kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
  });

  const serviceRows = useMemo(() => {
    return centralSkuIndex.rows
      .filter((row) => row.pricingMethod === "manual_rate")
      .filter((row) => row.subtype === "dienst")
      .filter((row) => row.manualRateEx > 0)
      .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [
    effectiveSelectedYear,
    channels,
    verkoopprijzen,
    skus,
    articles,
    berekeningen,
    kostprijsproductactiveringen,
    centralSkuIndex.rows,
  ]);
  const productSources = useMemo(() => {
    return buildProductSources({
      basisproducten,
      samengesteldeProducten,
      centralSkuRows: centralSkuIndex.rows as any,
      skuById,
      bundleArticleById,
      formatArticleById,
      kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
    });

  }, [
    basisproducten,
    berekeningen,
    channels,
    verkoopprijzen,
    skus,
    articles,
    effectiveSelectedYear,
    samengesteldeProducten,
    bundleArticleById,
    formatArticleById,
    kostprijsproductactiveringen,
    skuById,
  ]);
  const basisProductParentMap = useMemo(() => {
    return buildBasisProductParentMap(samengesteldeProducten);

  }, [samengesteldeProducten]);
  const [rows, setRows] = useState<StrategyRow[]>(() => verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);
  const isDirtyRef = useRef(false);
  const lastSyncedDraftSigRef = useRef("");
  const pendingServerSigRef = useRef("");
  const [hasPendingServerUpdate, setHasPendingServerUpdate] = useState(false);
  const markDirty = () => {
    isDirtyRef.current = true;
  };

  // In draft mode (wizard), the source rows may be replaced by the parent component when:
  // - a saved concept is loaded from the server
  // - a pricing scenario is applied programmatically
  // To keep the embedded workspace consistent, we sync local state from props only in draft mode.
  useEffect(() => {
    if (mode !== "draft") return;
    const sig = computeDraftSignature(verkoopStrategyRows, channelCodes);
    if (sig === lastSyncedDraftSigRef.current) return;

    if (isDirtyRef.current) {
      if (pendingServerSigRef.current !== sig && isMountedRef.current) {
        pendingServerSigRef.current = sig;
        setHasPendingServerUpdate(true);
        setStatus("Er is nieuwere conceptdata beschikbaar, maar je hebt lokale wijzigingen. Sla op of herlaad om te verversen.");
      }
      return;
    }

    lastSyncedDraftSigRef.current = sig;
    pendingServerSigRef.current = "";
    setHasPendingServerUpdate(false);
    isDirtyRef.current = false;
    setRows(verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
  }, [mode, verkoopStrategyRows, channelCodes]);

  function handleReloadFromServerDraft() {
    if (mode !== "draft") return;
    const sig = computeDraftSignature(verkoopStrategyRows, channelCodes);
    lastSyncedDraftSigRef.current = sig;
    pendingServerSigRef.current = "";
    setHasPendingServerUpdate(false);
    isDirtyRef.current = false;
    setOpslagDraft({});
    setRows(verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
    setStatus("Concept herladen.");
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [openChannelCodes, setOpenChannelCodes] = useState<string[]>(() => {
    const first = activeChannels[0]?.code ?? "";
    return first ? [first] : [];
  });
  const [sellFilter, setSellFilter] = useState<string>("");

  useEffect(() => {
    if (activeChannels.length > 0) {
      setOpenChannelCodes((current) => {
        const allowed = new Set(activeChannels.map((ch) => ch.code));
        const filtered = current.filter((code) => allowed.has(code));
        if (filtered.length > 0) return filtered;
        return [activeChannels[0].code];
      });
    }
  }, [activeChannels]);
  const yearStrategyRow = useMemo(() => {
    return rows.find((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear) ?? null;
  }, [rows, effectiveSelectedYear]);

  // Multi-channel accordion UI: selection is handled inside the accordion by `openChannelCodes`.

  useEffect(() => {
    if (lockYear) return;
    if (productieYears.length === 0) return;
    if (productieYears.includes(selectedYear)) return;
    setSelectedYear(Math.max(...productieYears));
  }, [lockYear, productieYears, selectedYear]);

  // Keep raw opslag inputs stable (avoid 50% => 49.99% drift from derived margin).
  const [opslagDraft, setOpslagDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setOpslagDraft({});
  }, [effectiveSelectedYear, openChannelCodes.join("|"), sellFilter]);
  const getDraft = (key: string) => opslagDraft[key];
  const setDraft = (key: string, value: string) => setOpslagDraft((current) => ({ ...current, [key]: value }));
  const clearDraft = (key: string) =>
    setOpslagDraft((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  // Ensure there is exactly one year-defaults record for the selected year.
  useEffect(() => {
    if (!Number.isFinite(effectiveSelectedYear) || effectiveSelectedYear <= 0) return;
    if (yearStrategyRow) return;

    setRows((current) => {
      const exists = current.some((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear);
      if (exists) return current;
      const seeded = buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
      return [...current, seeded];
    });
    // Make the behavior explicit: this is not a backend write until the user saves.
    setStatus(`Jaarstrategie voor ${effectiveSelectedYear} ontbreekt. Defaults zijn klaar gezet; klik Opslaan om te bewaren.`);
  }, [channelMasterDefaults, effectiveSelectedYear, yearStrategyRow]);

  const channelYearDefaults = useMemo(() => {
    const seeded = buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
    const source = yearStrategyRow ?? seeded;
    return Object.fromEntries(
      channelCodes.map((code) => [
        code,
        {
          opslag: Number(source.sell_in_margins?.[code] ?? channelMasterDefaults[code]?.opslag ?? 50)
        },
      ])
    ) as Record<string, { opslag: number }>;
  }, [channelCodes, channelMasterDefaults, effectiveSelectedYear, yearStrategyRow]);

  const basisById = useMemo(() => new Map(basisproducten.map((row) => [String(row.id ?? ""), row])), [basisproducten]);
  const samengesteldById = useMemo(() => new Map(samengesteldeProducten.map((row) => [String(row.id ?? ""), row])), [samengesteldeProducten]);
  const actieveProductActiveringen = useMemo(
    () =>
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).filter(
        (row) => Number(row.jaar ?? 0) === effectiveSelectedYear
      ),
    [kostprijsproductactiveringen, effectiveSelectedYear]
  );

  const productOverrideRows = useMemo<ProductViewRow[]>(() => {
    const relevantRows = rows.filter(
      (row) =>
        (row.jaar === 0 || row.jaar === effectiveSelectedYear) &&
        row.record_type === "verkoopstrategie_verpakking"
    );
    const byProduct = new Map<string, StrategyRow>();
    relevantRows.forEach((row) => {
      const current = byProduct.get(row.product_id);
      if (!current || current.jaar === 0) byProduct.set(row.product_id, row);
    });
    return productSources.map((product) => {
      const parentComposite = product.type === "basis" ? basisProductParentMap.get(product.id) : undefined;
      const effectiveProductId = parentComposite?.productId ?? product.id;
      const found = byProduct.get(effectiveProductId) ?? null;
      const opslagOverrides = Object.fromEntries(channelCodes.map((code) => {
        const value = found?.sell_in_margins?.[code];
        return [code, value === undefined || value === channelYearDefaults[code]?.opslag ? "" : Number(value)];
      })) as Record<string, number | "">;
      const sellInPriceOverrides = Object.fromEntries(channelCodes.map((code) => {
        const value = (found as any)?.sell_in_prices?.[code];
        if (value === "" || value === undefined || value === null) return [code, ""];
        const parsed = Number(value);
        return [code, Number.isFinite(parsed) ? parsed : ""];
      })) as Record<string, number | "">;
      return {
        productId: product.id,
        productType: product.type,
        product: product.label,
        opslagOverrides,
        sellInPriceOverrides,
        activeOpslags: Object.fromEntries(channelCodes.map((code) => [code, opslagOverrides[code] === "" ? channelYearDefaults[code]?.opslag ?? 50 : Number(opslagOverrides[code])])) as Record<string, number>,
        isReadOnly: Boolean(parentComposite),
        followsProductId: parentComposite?.productId ?? "",
        followsProductLabel: parentComposite?.label ?? ""
      };
    });
  }, [basisProductParentMap, channelCodes, channelYearDefaults, productSources, rows, effectiveSelectedYear]);

  const sellRows = useMemo<BeerViewRow[]>(() => {
    if (mode === "draft" && Array.isArray(draftKostprijsPreviewRows) && draftKostprijsPreviewRows.length > 0) {
      const productById = new Map(productOverrideRows.map((row) => [row.productId, row]));
      const beerOverrides = new Map(
        rows
          .filter((row) => row.jaar === effectiveSelectedYear && row.record_type === "verkoopstrategie_product")
          .map((row) => [`${row.bier_id}::${row.product_id}`, row])
      );

      const unique = new Map<string, (typeof draftKostprijsPreviewRows)[number]>();
      draftKostprijsPreviewRows.forEach((row) => {
        if (!row) return;
        const bierId = String(row.bierId ?? "").trim();
        const productId = String(row.productId ?? "").trim();
        if (!bierId || !productId) return;
        unique.set(`${bierId}::${productId}`, row);
      });

      const out: BeerViewRow[] = [];
      unique.forEach((row) => {
        const bierId = String(row.bierId ?? "");
        const productId = String(row.productId ?? "");
        const biernaam = String(row.biernaam ?? bierId).trim();
        const productLabel = String(row.productLabel ?? "").trim() || productId;
        const productDefaults = productById.get(productId);
        const followProductId = productDefaults?.followsProductId ?? "";

        const productOpslags =
          productDefaults?.activeOpslags ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.opslag ?? 50])) as Record<
            string,
            number
          >);

        const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
        const opslagOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = override?.sell_in_margins?.[code];
            return [code, value === undefined || value === productOpslags[code] ? "" : Number(value)];
          })
        ) as Record<string, number | "">;
        const sellInPriceOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = (override as any)?.sell_in_prices?.[code];
            if (value === "" || value === undefined || value === null) return [code, ""];
            const parsed = Number(value);
            return [code, Number.isFinite(parsed) ? parsed : ""];
          })
        ) as Record<string, number | "">;

        const activeOpslags = Object.fromEntries(
          channelCodes.map((code) => [code, opslagOverrides[code] === "" ? productOpslags[code] : Number(opslagOverrides[code])])
        ) as Record<string, number>;

        const kostprijs = Number(row.kostprijs ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPriceFromOpslagPct(kostprijs, activeOpslags[code])];
          })
        ) as Record<string, number>;

        out.push({
          id: override?.id || `${bierId}:${productId}`,
          bierId,
          biernaam,
          productId,
          productType: row.productType,
          product: productLabel,
          kostprijs,
          productOpslags,
          opslagOverrides,
          sellInPriceOverrides,
          activeOpslags,
          sellInPrices,
          isReadOnly: Boolean(productDefaults?.isReadOnly),
          followsProductId: followProductId,
          followsProductLabel: productDefaults?.followsProductLabel ?? ""
        });
      });

      return out.sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
    }

    // SKU-aanpak: in runtime mode, use the canonical CentralSkuIndex for active beer-format SKUs.
    // This avoids legacy activation/snapshot matching quirks and ensures selectors match offerte/adviesprijzen.
    const productById = new Map(productOverrideRows.map((row) => [row.productId, row]));
    const beerOverrides = new Map(
      rows
        .filter((row) => row.jaar === effectiveSelectedYear && row.record_type === "verkoopstrategie_product")
        .map((row) => [`${row.bier_id}::${row.product_id}`, row])
    );

    const out: BeerViewRow[] = [];
    centralSkuIndex.rows
      .filter((row) => row.subtype === "bier")
      .filter((row) => row.pricingMethod === "cost_plus")
      .filter((row) => row.isActive)
      .forEach((centralRow) => {
        const sku = skuById.get(centralRow.skuId) ?? null;
        const bierId = String((sku as any)?.beer_id ?? "").trim();
        const productId = String((sku as any)?.format_article_id ?? "").trim();
        if (!bierId || !productId) return;
        const biernaam = String((sku as any)?.name ?? "").split(" - ")[0]?.trim() || bierId;
        const productDefaults = productById.get(productId);
        const followProductId = productDefaults?.followsProductId ?? "";
        const productOpslags =
          productDefaults?.activeOpslags ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.opslag ?? 50])) as Record<
            string,
            number
          >);

        const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
        const opslagOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = override?.sell_in_margins?.[code];
            return [code, value === undefined || value === productOpslags[code] ? "" : Number(value)];
          })
        ) as Record<string, number | "">;
        const sellInPriceOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = (override as any)?.sell_in_prices?.[code];
            if (value === "" || value === undefined || value === null) return [code, ""];
            const parsed = Number(value);
            return [code, Number.isFinite(parsed) ? parsed : ""];
          })
        ) as Record<string, number | "">;

        const activeOpslags = Object.fromEntries(
          channelCodes.map((code) => [code, opslagOverrides[code] === "" ? productOpslags[code] : Number(opslagOverrides[code])])
        ) as Record<string, number>;

        const kostprijs = Number(centralRow.kostprijsEx ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPriceFromOpslagPct(kostprijs, activeOpslags[code])];
          })
        ) as Record<string, number>;

        const formatLabel = formatArticleById.get(productId)?.label ?? productId;
        out.push({
          id: override?.id || `${bierId}:${productId}`,
          bierId,
          biernaam,
          productId,
          productType: (productDefaults?.productType ?? "basis") as any,
          product: formatLabel,
          kostprijs,
          productOpslags,
          opslagOverrides,
          sellInPriceOverrides,
          activeOpslags,
          sellInPrices,
          isReadOnly: Boolean(productDefaults?.isReadOnly),
          followsProductId: followProductId,
          followsProductLabel: productDefaults?.followsProductLabel ?? ""
        });
      });

    return out.sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
  }, [
    effectiveSelectedYear,
    mode,
    channels,
    verkoopprijzen,
    skus,
    articles,
    berekeningen,
    kostprijsproductactiveringen,
    skuById,
    formatArticleById,
    channelCodes,
    channelYearDefaults,
    draftKostprijsPreviewRows,
    productOverrideRows,
    rows,
  ]);

  const normalizedFilter = useMemo(() => sellFilter.trim().toLowerCase(), [sellFilter]);

  const filteredProductOverrideRows = useMemo(() => {
    if (!normalizedFilter) return productOverrideRows;
    return productOverrideRows.filter((row) => normalizeLabel(row.product).includes(normalizedFilter));
  }, [normalizedFilter, productOverrideRows]);

  const filteredSellRows = useMemo(() => {
    if (!normalizedFilter) return sellRows;
    return sellRows.filter((row) => {
      const hay = `${row.biernaam} ${row.product}`.trim().toLowerCase();
      return hay.includes(normalizedFilter);
    });
  }, [normalizedFilter, sellRows]);

  const groupedProductOverrideRows = useMemo(() => {
    const groups = new Map<string, ProductViewRow[]>();
    filteredProductOverrideRows.forEach((row) => {
      const label = normalizeLabel(row.product);
      const key =
        label.startsWith("doos") ? "Doos" :
        label.startsWith("fles") ? "Fles" :
        label.startsWith("fust") ? "Fust" :
        "Overig";
      const current = groups.get(key) ?? [];
      current.push(row);
      groups.set(key, current);
    });
    const orderedKeys = ["Doos", "Fles", "Fust", "Overig"];
    return orderedKeys
      .filter((key) => (groups.get(key) ?? []).length > 0)
      .map((key) => ({ key, rows: (groups.get(key) ?? []).slice().sort((a, b) => a.product.localeCompare(b.product, "nl-NL")) }));
  }, [filteredProductOverrideRows]);

  const groupedBeerRows = useMemo(() => {
    const byBeer = new Map<string, BeerViewRow[]>();
    filteredSellRows.forEach((row) => {
      const current = byBeer.get(row.biernaam) ?? [];
      current.push(row);
      byBeer.set(row.biernaam, current);
    });
    return [...byBeer.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "nl-NL"))
      .map(([biernaam, rows]) => ({
        biernaam,
        rows: rows.slice().sort((a, b) => a.product.localeCompare(b.product, "nl-NL"))
      }));
  }, [filteredSellRows]);

  const beerFormatSkuIdByScope = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const kind = String((row as any).kind ?? "").trim().toLowerCase();
      if (kind !== "beer_format") return;
      const skuId = String((row as any).id ?? "").trim();
      const beerId = String((row as any).beer_id ?? "").trim();
      const formatId = String((row as any).format_article_id ?? "").trim();
      if (!skuId || !beerId || !formatId) return;
      map.set(`${beerId}:${formatId}`, skuId);
    });
    return map;
  }, [skus]);

  const articleSkuIdByArticleId = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const kind = String((row as any).kind ?? "").trim().toLowerCase();
      if (kind !== "article") return;
      const skuId = String((row as any).id ?? "").trim();
      const articleId = String((row as any).article_id ?? "").trim();
      if (!skuId || !articleId) return;
      map.set(articleId, skuId);
    });
    return map;
  }, [skus]);

  function ensureStrategySkuId(row: StrategyRow): StrategyRow {
    const currentSkuId = String((row as any).sku_id ?? "").trim();
    if (currentSkuId) return row;

    const recordType = String(row.record_type ?? "").trim().toLowerCase();
    if (recordType === "verkoopstrategie_product") {
      const beerId = String((row as any).bier_id ?? "").trim();
      const productId = String((row as any).product_id ?? "").trim();
      const derived = beerId && productId ? beerFormatSkuIdByScope.get(`${beerId}:${productId}`) : undefined;
      return derived ? ({ ...row, sku_id: derived } as StrategyRow) : row;
    }

    if (recordType === "verkoopstrategie_verpakking") {
      const productId = String((row as any).product_id ?? "").trim();
      const derived = productId ? articleSkuIdByArticleId.get(productId) : undefined;
      return derived ? ({ ...row, sku_id: derived } as StrategyRow) : row;
    }

    return row;
  }

  function resetChannelOverrides(channelCode: string) {
    markDirty();
    setOpslagDraft({});
    setRows((current) => {
      const next = current
        .map((row) => {
          if (row.jaar !== effectiveSelectedYear) return row;
          if (row.record_type !== "verkoopstrategie_verpakking" && row.record_type !== "verkoopstrategie_product") return row;
          const nextMargins = { ...(row.sell_in_margins ?? {}) };
          const nextPrices = { ...(row.sell_in_prices ?? {}) } as Record<string, number | "">;
          delete nextMargins[channelCode];
          delete nextPrices[channelCode];
          const hasAnything =
            Object.keys(nextMargins).length > 0 ||
            Object.keys(nextPrices).length > 0;
          if (!hasAnything) return null;
          return {
            ...row,
            sell_in_margins: nextMargins,
            sell_in_prices: nextPrices
          } as StrategyRow;
        })
        .filter(Boolean) as StrategyRow[];
      return next;
    });
    setStatus(`Overrides voor kanaal ${channelCode} gereset.`);
  }

  function updateYearMargin(channel: string, value: number | "") {
    markDirty();
    setRows((current) => {
      const next = [...current];
      const idx = next.findIndex((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear);
      const base = idx >= 0 ? next[idx] : buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
      const resolvedValue =
        value === ""
          ? Number(channelMasterDefaults[channel]?.opslag ?? 50)
          : Number(value);
      const updated: StrategyRow = {
        ...base,
        jaar: effectiveSelectedYear,
        record_type: "jaarstrategie",
        sell_in_margins: { ...base.sell_in_margins, [channel]: resolvedValue }
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }

  function updateYearSellInPrice(channel: string, value: number | "") {
    markDirty();
    setRows((current) => {
      const next = [...current];
      const idx = next.findIndex((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear);
      const base = idx >= 0 ? next[idx] : buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
      const nextPrices = { ...(base.sell_in_prices ?? {}) };
      if (value === "") delete nextPrices[channel];
      else nextPrices[channel] = value;
      const updated: StrategyRow = {
        ...base,
        jaar: effectiveSelectedYear,
        record_type: "jaarstrategie",
        sell_in_prices: nextPrices
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }

  function upsertProduct(productId: string, updater: (row: StrategyRow | null) => StrategyRow | null) {
    markDirty();
    setRows((current) => {
      const existing =
        current.find(
          (row) =>
            row.jaar === effectiveSelectedYear &&
            row.record_type === "verkoopstrategie_verpakking" &&
            row.product_id === productId
        ) ?? null;
      const source = productSources.find((item) => item.id === productId);
      const next = updater(existing ?? {
        id: "",
        record_type: "verkoopstrategie_verpakking",
        jaar: effectiveSelectedYear,
        bier_id: "",
        biernaam: "",
        product_id: productId,
        product_type: source?.type ?? "",
        verpakking: source?.label ?? "",
        strategie_type: "override",
        kostprijs: 0,
        sell_in_margins: {},
        sell_in_prices: {},
        _uiId: createUiId()
      });
      return [
        ...current.filter(
          (row) =>
            !(
              row.jaar === effectiveSelectedYear &&
              row.record_type === "verkoopstrategie_verpakking" &&
              row.product_id === productId
            )
        ),
        ...(next ? [next] : [])
      ];
    });
  }

  function upsertBeer(viewRow: BeerViewRow, updater: (row: StrategyRow | null) => StrategyRow | null) {
    markDirty();
    setRows((current) => {
      const existing =
        current.find(
          (row) =>
            row.jaar === effectiveSelectedYear &&
            row.record_type === "verkoopstrategie_product" &&
            row.bier_id === viewRow.bierId &&
            row.product_id === viewRow.productId
        ) ?? null;
      const next = updater(existing ?? {
        id: "",
        record_type: "verkoopstrategie_product",
        jaar: effectiveSelectedYear,
        bier_id: viewRow.bierId,
        biernaam: viewRow.biernaam,
        product_id: viewRow.productId,
        product_type: viewRow.productType,
        verpakking: viewRow.product,
        strategie_type: "override",
        kostprijs: viewRow.kostprijs,
        sell_in_margins: {},
        sell_in_prices: {},
        _uiId: createUiId()
      });
      return [
        ...current.filter(
          (row) =>
            !(
              row.jaar === effectiveSelectedYear &&
              row.record_type === "verkoopstrategie_product" &&
              row.bier_id === viewRow.bierId &&
              row.product_id === viewRow.productId
            )
        ),
        ...(next ? [next] : [])
      ];
    });
  }

  function updateProductMargin(productId: string, channel: string, value: number | "") {
    markDirty();
    upsertProduct(productId, (row) => {
      const nextMargins = { ...row!.sell_in_margins };
      if (value === "") delete nextMargins[channel]; else nextMargins[channel] = value;
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && !hasSellInPrices
        ? null
        : { ...row!, sell_in_margins: nextMargins };
    });
  }

  function updateProductSellInPrice(productId: string, channel: string, value: number | "") {
    markDirty();
    upsertProduct(productId, (row) => {
      const nextPrices = { ...(row!.sell_in_prices ?? {}) } as Record<string, number | "">;
      if (value === "") delete nextPrices[channel]; else nextPrices[channel] = value;
      const nextMargins = { ...(row!.sell_in_margins ?? {}) } as Record<string, number>;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextPrices).length === 0
        ? null
        : { ...row!, sell_in_prices: nextPrices };
    });
  }

  function updateBeerMargin(viewRow: BeerViewRow, channel: string, value: number | "") {
    markDirty();
    upsertBeer(viewRow, (row) => {
      const nextMargins = { ...row!.sell_in_margins };
      if (value === "") delete nextMargins[channel]; else nextMargins[channel] = value;
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && !hasSellInPrices
        ? null
        : { ...row!, kostprijs: viewRow.kostprijs, sell_in_margins: nextMargins };
    });
  }

  function updateBeerSellInPrice(viewRow: BeerViewRow, channel: string, value: number | "") {
    markDirty();
    upsertBeer(viewRow, (row) => {
      const nextPrices = { ...(row!.sell_in_prices ?? {}) } as Record<string, number | "">;
      if (value === "") delete nextPrices[channel]; else nextPrices[channel] = value;
      const nextMargins = { ...(row!.sell_in_margins ?? {}) } as Record<string, number>;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextPrices).length === 0
        ? null
        : { ...row!, kostprijs: viewRow.kostprijs, sell_in_prices: nextPrices };
    });
  }

  async function handleSave() {
    if (isMountedRef.current) {
      setStatus("");
      setIsSaving(true);
    }
    try {
      const payload = [...verkoopPassthroughRows, ...rows.map(ensureStrategySkuId).map(stripInternal)];
      if (mode === "draft") {
        await onDraftSave?.(payload);
        if (isMountedRef.current) {
          lastSyncedDraftSigRef.current = computeDraftSignature(rows as unknown as GenericRecord[], channelCodes);
          pendingServerSigRef.current = "";
          setHasPendingServerUpdate(false);
          isDirtyRef.current = false;
          setStatus("Concept opgeslagen.");
        }
      } else {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Preserve non-strategy records (product_pricing etc); only strategy is edited in this screen.
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("Opslaan mislukt");
        if (isMountedRef.current) {
          isDirtyRef.current = false;
          setStatus("Opgeslagen.");
        }
      }
    } catch {
      if (isMountedRef.current) {
        setStatus("Opslaan mislukt.");
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  // Expose a stable save callback to parent wizards without causing render loops
  // (i.e. avoid setting parent state on every render because `handleSave` identity changes).
  const saveRef = useRef<null | (() => Promise<void>)>(null);
  useEffect(() => {
    saveRef.current = handleSave;
  });

  useEffect(() => {
    if (!exposeSave) return;
    const exposed = async () => {
      const fn = saveRef.current;
      if (!fn) return;
      await fn();
    };
    // `exposeSave` is often a `useState` setter from the parent wizard.
    // Passing a function directly would be treated as an updater and executed immediately.
    exposeSave(() => exposed);
  }, [exposeSave]);

  const yearOptions = useMemo(() => {
    if (productieYears.length > 0) {
      return [...productieYears].sort((a, b) => b - a);
    }
    // No productie years: hide year selection entirely (empty-state is shown).
    return [];
  }, [berekeningen, effectiveSelectedYear, productieYears, rows]);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopstrategie</div>
        <div className="module-card-text">Kanaaldefaults vormen de basis. Daar bovenop kun je per product of per bier/product afwijken.</div>
      </div>

      {productieYears.length === 0 ? (
        <div className="module-card compact-card" style={{ marginTop: "1rem" }}>
          <div className="module-card-title">Nog geen productiejaar</div>
          <div className="module-card-text">
            Maak eerst een productiejaar aan. Zodra er een productiejaar bestaat kun je hier per jaar de verkoopprijzen instellen.
          </div>
        </div>
      ) : (
      <>
          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{productSources.length} producten</span>
              {serviceRows.length > 0 ? (
                <span className="editor-pill">{serviceRows.length} diensten</span>
              ) : null}
              <span className="muted">Actieve kanalen: {activeChannels.map((channel) => channel.naam).join(", ") || "geen"}</span>
            </div>
            <div className="editor-actions-group">
              <label className="nested-field">
                <span>Jaar</span>
                <select
                  className="dataset-input"
                  value={String(effectiveSelectedYear)}
                  disabled={Boolean(lockYear)}
                  onChange={(event) => {
                    if (lockYear) return;
                    setSelectedYear(Number(event.target.value));
                  }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nested-field">
                <span>Zoeken</span>
                <input
                  className="dataset-input"
                  type="text"
                  value={sellFilter}
                  onChange={(event) => setSellFilter(event.target.value)}
                  placeholder="Zoek bier of product..."
                />
              </label>
            </div>
          </div>

          <VerkoopstrategiePrijsinstellingenAccordion
            activeChannels={activeChannels}
            openChannelCodes={openChannelCodes}
            setOpenChannelCodes={setOpenChannelCodes}
            effectiveSelectedYear={effectiveSelectedYear}
            channelMasterDefaults={channelMasterDefaults}
            channelYearDefaults={channelYearDefaults}
            groupedProductOverrideRows={groupedProductOverrideRows}
            groupedBeerRows={groupedBeerRows}
            getDraft={getDraft}
            setDraft={setDraft}
            clearDraft={clearDraft}
            updateYearSellInPrice={updateYearSellInPrice}
            updateYearMargin={updateYearMargin}
            updateProductSellInPrice={updateProductSellInPrice}
            updateProductMargin={updateProductMargin}
            updateBeerSellInPrice={updateBeerSellInPrice}
            updateBeerMargin={updateBeerMargin}
            resetChannelOverrides={resetChannelOverrides}
          />

          {serviceRows.length > 0 ? (
            <div className="module-card compact-card" style={{ marginTop: "1rem" }}>
              <div className="module-card-title">Dienstverlening (uurtarieven)</div>
              <div className="module-card-text">
                Diensten hebben een vast tarief (ex) en worden niet via opslag% per kanaal berekend.
                Pas het tarief aan via Producten &amp; verpakking â†’ Samenstellen.
              </div>
              <div className="dataset-editor-scroll" style={{ marginTop: 12, borderRadius: 12 }}>
                <table className="dataset-editor-table">
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th>UoM</th>
                      <th>Tarief (ex)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceRows.map((row) => (
                      <tr key={row.skuId}>
                        <td>{row.label}</td>
                        <td>{row.uom}</td>
                        <td>{row.manualRateEx.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="editor-actions">
            <div className="editor-actions-group" />
            <div className="editor-actions-group">
              {status ? <span className="editor-status">{status}</span> : null}
              {mode === "draft" && hasPendingServerUpdate ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={handleReloadFromServerDraft}
                  disabled={isSaving}
                >
                  Herlaad
                </button>
              ) : null}
              <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>{isSaving ? "Opslaan..." : "Opslaan"}</button>
            </div>
          </div>

        </>
      )}
    </section>
  );
}
