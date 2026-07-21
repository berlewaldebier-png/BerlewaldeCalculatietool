"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { API_BASE_URL } from "@/lib/api";
import { reconcileDatasetItems } from "@/lib/datasetItems";
import {
  calcSellPriceFromOpslagPct,
  round2
} from "@/lib/pricingEngine";
import type { BeerViewRow, ProductViewRow } from "@/components/verkoopstrategie/verkoopstrategieTypes";
import { buildActiveRows } from "@/components/kostprijsbeheer/kostprijsBeheerDerivations";
import { useCentralSkuIndex } from "@/features/sku/useCentralSkuIndex";
import { normalizeSkuLabel } from "@/lib/skuLabels";
import {
  STRATEGY_RECORD_TYPES,
  buildEmptyYearStrategyRow,
  computeDraftSignature,
  createUiId,
  normalizeChannels,
  normalizeStrategyRow,
  type StrategyRow,
} from "@/components/verkoopstrategie/verkoopstrategieWorkspaceUtils";
import { buildArticleLabelMap, buildProductSources } from "@/components/verkoopstrategie/verkoopstrategieWorkspaceDerivations";
import {
  buildMissingSalesStrategyYearStatus,
  buildSalesStrategySavePayload,
  buildStrategySkuLookups,
  filterAndGroupSalesStrategyRows,
  getDefaultSalesStrategyYear,
  getProductionYears,
  getSalesStrategyStatusForSelectedYear,
  getSalesStrategyYearOptions,
  hasSalesStrategyForYear,
  SALES_STRATEGY_DRAFT_SUCCESS,
  SALES_STRATEGY_SAVE_ERROR,
  SALES_STRATEGY_SERVER_SUCCESS,
} from "@/features/sales-strategy/salesStrategyFormModel";
import { SalesStrategyWorkspaceView } from "@/features/sales-strategy/SalesStrategyWorkspaceView";

type GenericRecord = Record<string, unknown>;
export type VerkoopstrategieWorkspaceProps = {
  endpoint: string;
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  skus?: GenericRecord[];
  articles?: GenericRecord[];
  bomLines?: GenericRecord[];
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
  bomLines,
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
}: VerkoopstrategieWorkspaceProps) {
  const normalizedChannels = useMemo(() => normalizeChannels(channels), [channels]);
  const channelCodes = useMemo(() => Array.from(new Set(["list", ...normalizedChannels.map((channel) => channel.code)])), [normalizedChannels]);
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
  const skuById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(skus) ? skus : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (id) map.set(id, row);
    });
    return map;
  }, [skus]);
  const beerNameById = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(bieren) ? bieren : []).forEach((row) => {
      const id = String((row as any)?.id ?? "").trim();
      if (!id) return;
      map.set(id, String((row as any)?.biernaam ?? (row as any)?.naam ?? id).trim() || id);
    });
    return map;
  }, [bieren]);
  // Year selection must be available before we derive SKU-driven product sources.
  const productieYears = useMemo(() => getProductionYears(productie), [productie]);

  const computedDefaultYear = useMemo(() => {
    // If productie has no years yet, do not guess based on other datasets.
    // We render an explicit empty-state instead of silently selecting a future year (e.g. 2026).
    return getDefaultSalesStrategyYear(productieYears);
  }, [productieYears]);

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
    bomLines,
    berekeningen,
    kostprijsproductactiveringen,
    centralSkuIndex.rows,
  ]);
  const productSources = useMemo(() => {
    return buildProductSources({
      formatArticleById,
    });

  }, [
    articles,
    formatArticleById,
  ]);
  const [rows, setRows] = useState<StrategyRow[]>(() => verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);
  const isDirtyRef = useRef(false);
  const lastSyncedDraftSigRef = useRef("");
  const pendingServerSigRef = useRef("");
  const savedYearStrategyYearsRef = useRef<Set<number>>(new Set());
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
    setRows(verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
    setStatus("Concept herladen.");
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [openPriceGroups, setOpenPriceGroups] = useState<Record<string, boolean>>({});
  const [sellFilter, setSellFilter] = useState<string>("");
  const yearStrategyRow = useMemo(() => {
    return rows.find((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear) ?? null;
  }, [rows, effectiveSelectedYear]);

  useEffect(() => {
    if (lockYear) return;
    if (productieYears.length === 0) return;
    if (productieYears.includes(selectedYear)) return;
    setSelectedYear(Math.max(...productieYears));
  }, [lockYear, productieYears, selectedYear]);

  useEffect(() => {
    const strategyMissing =
      !hasSalesStrategyForYear(verkoopStrategyRows, effectiveSelectedYear) &&
      !savedYearStrategyYearsRef.current.has(effectiveSelectedYear);
    setStatus((current) =>
      getSalesStrategyStatusForSelectedYear(current, effectiveSelectedYear, strategyMissing)
    );
  }, [effectiveSelectedYear, verkoopStrategyRows]);

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
    setStatus(buildMissingSalesStrategyYearStatus(effectiveSelectedYear));
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

  const basisLabelById = useMemo(
    () => new Map(basisproducten.map((row) => [String(row.id ?? ""), String((row as any).verpakkingseenheid ?? (row as any).omschrijving ?? (row as any).naam ?? row.id ?? "")])),
    [basisproducten]
  );
  const samengesteldLabelById = useMemo(
    () => new Map(samengesteldeProducten.map((row) => [String(row.id ?? ""), String((row as any).verpakkingseenheid ?? (row as any).omschrijving ?? (row as any).naam ?? row.id ?? "")])),
    [samengesteldeProducten]
  );
  const articleById = useMemo(() => new Map((Array.isArray(articles) ? articles : []).map((row) => [String((row as any).id ?? ""), row])), [articles]);
  const berekeningenById = useMemo(
    () => new Map((Array.isArray(berekeningen) ? berekeningen : []).map((row) => [String((row as any).id ?? ""), row])),
    [berekeningen]
  );
  const activeCostRows = useMemo(() => {
    return buildActiveRows({
      kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
      selectedYear: effectiveSelectedYear,
      search: "",
      activeSort: { key: "artikel", direction: "asc" },
      bierenById: beerNameById,
      basisById: basisLabelById,
      skuById,
      articleById,
      bomLines: Array.isArray(bomLines) ? bomLines : [],
      samengesteldById: samengesteldLabelById,
      berekeningenById,
      currentBerekeningen: Array.isArray(berekeningen) ? berekeningen : [],
    });
  }, [
    articleById,
    basisLabelById,
    beerNameById,
    berekeningen,
    berekeningenById,
    bomLines,
    effectiveSelectedYear,
    kostprijsproductactiveringen,
    samengesteldLabelById,
    skuById,
  ]);
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
      const effectiveProductId = product.id;
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
        isReadOnly: false,
        followsProductId: "",
        followsProductLabel: ""
      };
    });
  }, [channelCodes, channelYearDefaults, productSources, rows, effectiveSelectedYear]);

  const sellRows = useMemo<BeerViewRow[]>(() => {
    function applyDerivedListPrices(out: BeerViewRow[]) {
      const linesByParent = new Map<string, GenericRecord[]>();
      (Array.isArray(bomLines) ? bomLines : []).forEach((line) => {
        const parentArticleId = String((line as any)?.parent_article_id ?? "").trim();
        if (!parentArticleId) return;
        linesByParent.set(parentArticleId, [...(linesByParent.get(parentArticleId) ?? []), line]);
      });
      const rowBySku = new Map(out.map((row) => [row.skuId, row]));
      const skuByArticleId = new Map<string, string>();
      (Array.isArray(skus) ? skus : []).forEach((sku) => {
        const skuId = String((sku as any)?.id ?? "").trim();
        const articleId = String((sku as any)?.article_id ?? "").trim();
        if (skuId && articleId && !skuByArticleId.has(articleId)) skuByArticleId.set(articleId, skuId);
      });

      const derive = (row: BeerViewRow, seen: Set<string>): number | null => {
        const explicit = row.sellInPriceOverrides?.list;
        if (explicit !== "" && explicit !== undefined && explicit !== null) return Number(explicit);
        if (!row.skuId || seen.has(row.skuId)) return null;
        const componentLines = linesByParent.get(row.productId) ?? [];
        if (componentLines.length === 0) return null;
        seen.add(row.skuId);
        let total = 0;
        for (const line of componentLines) {
          const quantity = Number((line as any)?.quantity ?? (line as any)?.aantal ?? 0);
          if (!Number.isFinite(quantity) || quantity <= 0) return null;
          const componentSkuId =
            String((line as any)?.component_sku_id ?? "").trim() ||
            skuByArticleId.get(String((line as any)?.component_article_id ?? "").trim()) ||
            "";
          const componentRow = componentSkuId ? rowBySku.get(componentSkuId) : undefined;
          if (!componentRow) return null;
          const componentPrice = derive(componentRow, seen);
          if (componentPrice === null || !Number.isFinite(componentPrice)) return null;
          total += componentPrice * quantity;
        }
        seen.delete(row.skuId);
        return round2(total);
      };

      return out.map((row) => {
        if (row.sellInPriceOverrides?.list !== "" || row.productType !== "samengesteld") return row;
        const derived = derive(row, new Set<string>());
        if (derived === null || derived <= 0) return row;
        return {
          ...row,
          sellInPrices: { ...row.sellInPrices, list: derived },
          sellInPriceSources: { ...(row.sellInPriceSources ?? {}), list: "derived" as const },
        };
      });
    }

    if (mode === "draft" && Array.isArray(draftKostprijsPreviewRows) && draftKostprijsPreviewRows.length > 0) {
      const productById = new Map(productOverrideRows.map((row) => [row.productId, row]));
      const beerOverridesBySku = new Map(
        rows
          .filter((row) => row.jaar === effectiveSelectedYear && row.record_type === "verkoopstrategie_product")
          .flatMap((row) => {
            const skuId = String((row as any).sku_id ?? "").trim();
            return skuId ? [[skuId, row] as const] : [];
          })
      );

      const unique = new Map<string, (typeof draftKostprijsPreviewRows)[number]>();
      draftKostprijsPreviewRows.forEach((row) => {
        if (!row) return;
        const skuId = String((row as any).skuId ?? (row as any).sku_id ?? "").trim();
        if (!skuId) return;
        unique.set(skuId, row);
      });

      const out: BeerViewRow[] = [];
      unique.forEach((row) => {
        const bierId = String(row.bierId ?? "");
        const productId = String(row.productId ?? "");
        const skuId = String((row as any).skuId ?? (row as any).sku_id ?? "").trim();
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

        const override = skuId ? beerOverridesBySku.get(skuId) ?? null : null;
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
        const sellInPriceSources = Object.fromEntries(
          channelCodes.map((code) => [code, sellInPriceOverrides[code] !== "" ? "explicit" : "opslag"])
        ) as BeerViewRow["sellInPriceSources"];

        out.push({
          id: override?.id || `${bierId}:${productId}`,
          skuId,
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
          sellInPriceSources,
          isReadOnly: Boolean(productDefaults?.isReadOnly),
          followsProductId: followProductId,
          followsProductLabel: productDefaults?.followsProductLabel ?? ""
        });
      });

      return applyDerivedListPrices(out).sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
    }

    // SKU-aanpak: in runtime mode, use the canonical CentralSkuIndex for active beer-format SKUs.
    // This avoids legacy activation/snapshot matching quirks and ensures selectors match offerte/adviesprijzen.
    const productById = new Map(productOverrideRows.map((row) => [row.productId, row]));
    const beerOverridesBySku = new Map(
      rows
        .filter((row) => row.jaar === effectiveSelectedYear && row.record_type === "verkoopstrategie_product")
        .flatMap((row) => {
          const skuId = String((row as any).sku_id ?? "").trim();
          return skuId ? [[skuId, row] as const] : [];
        })
    );
    const out: BeerViewRow[] = [];
    activeCostRows
      .filter((row) => Number(row.currentCost ?? 0) > 0)
      .forEach((activeRow) => {
        const skuId = String(activeRow.skuId ?? "").trim();
        const productId = String(activeRow.productId ?? "").trim();
        const bierId = String(activeRow.groupLabel || activeRow.bierNaam || activeRow.categorie || "").trim();
        if (!skuId || !bierId || !productId) return;
        const biernaam = String(activeRow.groupLabel || activeRow.bierNaam || activeRow.categorie || "Zonder stijl");
        const productType = String(activeRow.productType ?? "").trim() || "basis";
        const productDefaults = productById.get(productId);
        const followProductId = productDefaults?.followsProductId ?? "";
        const productOpslags =
          productDefaults?.activeOpslags ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.opslag ?? 50])) as Record<
            string,
            number
          >);

        const override = beerOverridesBySku.get(skuId) ?? null;
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

        const kostprijs = Number(activeRow.currentCost ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPriceFromOpslagPct(kostprijs, activeOpslags[code])];
          })
        ) as Record<string, number>;
        const sellInPriceSources = Object.fromEntries(
          channelCodes.map((code) => [code, sellInPriceOverrides[code] !== "" ? "explicit" : "opslag"])
        ) as BeerViewRow["sellInPriceSources"];

        const productLabel = normalizeSkuLabel(activeRow.artikelNaam || activeRow.productNaam || productId);
        out.push({
          id: override?.id || `${bierId}:${productId}`,
          skuId,
          bierId,
          biernaam,
          productId,
          productType: (productDefaults?.productType ?? productType) as any,
          product: productLabel,
          kostprijs,
          productOpslags,
          opslagOverrides,
          sellInPriceOverrides,
          activeOpslags,
          sellInPrices,
          sellInPriceSources,
          isReadOnly: Boolean(productDefaults?.isReadOnly),
          followsProductId: followProductId,
          followsProductLabel: productDefaults?.followsProductLabel ?? ""
        });
      });

    return applyDerivedListPrices(out).sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
  }, [
    activeCostRows,
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
    beerNameById,
    channelCodes,
    channelYearDefaults,
    draftKostprijsPreviewRows,
    productOverrideRows,
    rows,
  ]);

  const groupedBeerRows = useMemo(
    () => filterAndGroupSalesStrategyRows(sellRows, sellFilter),
    [sellFilter, sellRows]
  );

  const allPriceGroupsOpen = useMemo(
    () => Object.fromEntries(groupedBeerRows.map((group) => [group.biernaam, true])),
    [groupedBeerRows]
  );

  const strategySkuLookups = useMemo(() => buildStrategySkuLookups(skus), [skus]);

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
      const payload = buildSalesStrategySavePayload({
        passthroughRows: verkoopPassthroughRows,
        strategyRows: rows,
        skuLookups: strategySkuLookups,
      });
      if (mode === "draft") {
        await onDraftSave?.(payload);
        if (isMountedRef.current) {
          lastSyncedDraftSigRef.current = computeDraftSignature(rows as unknown as GenericRecord[], channelCodes);
          pendingServerSigRef.current = "";
          setHasPendingServerUpdate(false);
          isDirtyRef.current = false;
          savedYearStrategyYearsRef.current.add(effectiveSelectedYear);
          setStatus(SALES_STRATEGY_DRAFT_SUCCESS);
        }
      } else {
        const datasetName = endpoint.match(/^\/data\/([^/]+)$/)?.[1] ?? "";
        if (datasetName) {
          await reconcileDatasetItems(decodeURIComponent(datasetName), payload);
        } else {
          const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            // Preserve non-strategy records (product_pricing etc); only strategy is edited in this screen.
            body: JSON.stringify(payload)
          });
          if (!response.ok) throw new Error("Opslaan mislukt");
        }
        if (isMountedRef.current) {
          isDirtyRef.current = false;
          savedYearStrategyYearsRef.current.add(effectiveSelectedYear);
          setStatus(SALES_STRATEGY_SERVER_SUCCESS);
        }
      }
    } catch {
      if (isMountedRef.current) {
        setStatus(SALES_STRATEGY_SAVE_ERROR);
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

  const yearOptions = useMemo(() => getSalesStrategyYearOptions(productieYears), [productieYears]);

  return (
    <SalesStrategyWorkspaceView
      hasProductionYears={productieYears.length > 0}
      sellRowCount={sellRows.length}
      serviceRows={serviceRows}
      effectiveSelectedYear={effectiveSelectedYear}
      lockYear={Boolean(lockYear)}
      yearOptions={yearOptions}
      sellFilter={sellFilter}
      groupedBeerRows={groupedBeerRows}
      openPriceGroups={openPriceGroups}
      allPriceGroupsOpen={allPriceGroupsOpen}
      status={status}
      mode={mode}
      hasPendingServerUpdate={hasPendingServerUpdate}
      isSaving={isSaving}
      onYearChange={setSelectedYear}
      onFilterChange={setSellFilter}
      onSetOpenPriceGroups={setOpenPriceGroups}
      onTogglePriceGroup={(beerName) =>
        setOpenPriceGroups((current) => ({ ...current, [beerName]: !(current[beerName] ?? false) }))
      }
      onListPriceChange={(row, value) => updateBeerSellInPrice(row, "list", value)}
      onReloadDraft={handleReloadFromServerDraft}
      onSave={handleSave}
    />
  );
}
