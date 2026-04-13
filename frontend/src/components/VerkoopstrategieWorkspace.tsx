"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  calcMarginPctFromOpslagPct,
  calcMarginPctFromSellInPrice,
  calcOpslagPctFromMarginPct,
  calcOpslagPctFromSellInPrice,
  calcSellPrice,
  parseNumberLoose,
  round2
} from "@/lib/verkoopstrategieMath";
import { VerkoopstrategiePrijsinstellingenAccordion } from "@/components/verkoopstrategie/VerkoopstrategiePrijsinstellingenAccordion";

type GenericRecord = Record<string, unknown>;
type ChannelRow = { id: string; code: string; naam: string; actief: boolean; volgorde: number; default_marge_pct: number; default_factor: number };
type StrategyRow = {
  id: string; record_type: string; jaar: number; bier_id: string; biernaam: string; product_id: string;
  product_type: "basis" | "samengesteld" | ""; verpakking: string; strategie_type: string; kostprijs: number;
  sell_in_margins: Record<string, number>;
  sell_in_prices: Record<string, number | "">;
  sell_out_factors: Record<string, number | "">;
  sell_out_advice_prices: Record<string, number | "">;
  _uiId: string;
};
const STRATEGY_RECORD_TYPES = new Set([
  "jaarstrategie",
  "verkoopstrategie_product",
  "verkoopstrategie_verpakking"
]);
type ProductViewRow = {
  productId: string; productType: "basis" | "samengesteld"; product: string;
  marginOverrides: Record<string, number | "">; factorOverrides: Record<string, number | "">;
  sellInPriceOverrides: Record<string, number | "">;
  activeMargins: Record<string, number>; activeFactors: Record<string, number>;
  isReadOnly: boolean; followsProductId: string; followsProductLabel: string;
};
type BeerViewRow = {
  id: string; bierId: string; biernaam: string; productId: string; productType: "basis" | "samengesteld" | ""; product: string; kostprijs: number;
  productMargins: Record<string, number>;
  marginOverrides: Record<string, number | "">;
  sellInPriceOverrides: Record<string, number | "">;
  activeMargins: Record<string, number>;
  sellInPrices: Record<string, number>;
  productFactors: Record<string, number>; factorOverrides: Record<string, number | "">; activeFactors: Record<string, number>; sellOutPrices: Record<string, number>;
  isReadOnly: boolean; followsProductId: string; followsProductLabel: string;
};
type Props = {
  endpoint: string;
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  bieren: GenericRecord[];
  berekeningen: GenericRecord[];
  /** Authoritative list of available years comes from productie. */
  productie?: unknown;
  channels: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  /** Wizard-only: if provided in `mode="draft"`, sell-in/sell-out is computed from these preview cost rows instead of activations/snapshots. */
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

const DEFAULT_CHANNELS: ChannelRow[] = [
  { id: "horeca", code: "horeca", naam: "Horeca", actief: true, volgorde: 10, default_marge_pct: 50, default_factor: 3.5 },
  { id: "retail", code: "retail", naam: "Supermarkt", actief: true, volgorde: 20, default_marge_pct: 30, default_factor: 2.4 },
  { id: "slijterij", code: "slijterij", naam: "Slijterij", actief: true, volgorde: 30, default_marge_pct: 40, default_factor: 3 },
  { id: "zakelijk", code: "zakelijk", naam: "Speciaalzaak", actief: true, volgorde: 40, default_marge_pct: 45, default_factor: 3.2 },
  { id: "particulier", code: "particulier", naam: "Particulier", actief: false, volgorde: 50, default_marge_pct: 50, default_factor: 3 }
];

const createUiId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const money = (v: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const num = (v: number) => new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v);
// Pricing helpers are shared with the nieuw-jaar wizard via `lib/verkoopstrategieMath.ts`.
const normalizeLabel = (value: unknown) => String(value ?? "").trim().toLowerCase();
const normalizeMap = (raw: unknown, codes: string[]) => {
  const src = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const allowed = new Set(codes);
  const out: Record<string, number> = {};
  Object.entries(src).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (value === "" || value === null || value === undefined) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    out[key] = parsed;
  });
  return out as Record<string, number | "">;
};
const inputClass = (hasOverride: boolean) => hasOverride ? "dataset-input dataset-input-override-active" : "dataset-input";

function normalizeChannels(raw: GenericRecord[]) {
  const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_CHANNELS;
  const byCode = new Map(DEFAULT_CHANNELS.map((row) => [row.code, row]));
  source.forEach((row) => {
    const code = String(row.code ?? row.id ?? "").trim().toLowerCase();
    if (!code) return;
    byCode.set(code, {
      id: String(row.id ?? row.code ?? createUiId()),
      code,
      naam: String(row.naam ?? ("label" in row ? row.label : undefined) ?? row.code ?? "").trim(),
      actief: Boolean(row.actief ?? true),
      volgorde: Number(row.volgorde ?? 999),
      default_marge_pct: Number(row.default_marge_pct ?? byCode.get(code)?.default_marge_pct ?? 50),
      default_factor: Number(row.default_factor ?? byCode.get(code)?.default_factor ?? 3)
    });
  });
  return [...byCode.values()].map((row) => ({
    id: String(row.id ?? row.code ?? createUiId()),
    code: String(row.code ?? row.id ?? "").trim().toLowerCase(),
    naam: String(row.naam ?? ("label" in row ? row.label : undefined) ?? row.code ?? "").trim(),
    actief: Boolean(row.actief ?? true),
    volgorde: Number(row.volgorde ?? 999),
    default_marge_pct: Number(row.default_marge_pct ?? 50),
    default_factor: Number(row.default_factor ?? 3)
  })).filter((row) => row.code && row.naam && row.code !== "groothandel").sort((a, b) => (a.volgorde === b.volgorde ? a.naam.localeCompare(b.naam, "nl-NL") : a.volgorde - b.volgorde));
}

function buildEmptyYearStrategyRow({
  year,
  channelDefaults
}: {
  year: number;
  channelDefaults: Record<string, { margin: number; factor: number }>;
}): StrategyRow {
  // This is a year-specific defaults record. It becomes the single source of truth for default margins/factors per year.
  return {
    id: "",
    record_type: "jaarstrategie",
    jaar: year,
    bier_id: "",
    biernaam: "",
    product_id: "",
    product_type: "",
    verpakking: "",
    strategie_type: "default",
    kostprijs: 0,
    sell_in_margins: Object.fromEntries(Object.entries(channelDefaults).map(([code, def]) => [code, Number(def.margin ?? 50)])),
    sell_in_prices: {},
    sell_out_factors: Object.fromEntries(Object.entries(channelDefaults).map(([code, def]) => [code, Number(def.factor ?? 3)])),
    sell_out_advice_prices: {},
    _uiId: createUiId()
  };
}

function normalizeStrategyRow(row: GenericRecord, channelCodes: string[]): StrategyRow {
  const marginsSrcRaw = (row.sell_in_margins ?? row.kanaalmarges ?? {}) as unknown;
  const marginsSrc =
    typeof marginsSrcRaw === "object" && marginsSrcRaw !== null
      ? (marginsSrcRaw as Record<string, unknown>)
      : {};
  const pricesSrcRaw = (row.sell_in_prices ?? row.kanaalprijzen ?? {}) as unknown;
  const pricesSrc =
    typeof pricesSrcRaw === "object" && pricesSrcRaw !== null
      ? (pricesSrcRaw as Record<string, unknown>)
      : {};
  return {
    id: String(row.id ?? ""), record_type: String(row.record_type ?? "verkoopstrategie_verpakking"), jaar: Number(row.jaar ?? new Date().getFullYear()),
    bier_id: String(row.bier_id ?? ""), biernaam: String(row.biernaam ?? ""), product_id: String(row.product_id ?? ""),
    product_type: String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld" ? (String(row.product_type ?? "") as "basis" | "samengesteld") : "",
    verpakking: String(row.verpakking ?? ""), strategie_type: String(row.strategie_type ?? "default"), kostprijs: Number(row.kostprijs ?? 0),
    sell_in_margins: (() => {
      const allowed = new Set(channelCodes);
      const out: Record<string, number> = {};
      Object.entries(marginsSrc).forEach(([key, value]) => {
        if (!allowed.has(key)) return;
        if (value === "" || value === null || value === undefined) return;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        out[key] = parsed;
      });
      return out;
    })(),
    sell_in_prices: (() => {
      const allowed = new Set(channelCodes);
      const out: Record<string, number> = {};
      Object.entries(pricesSrc).forEach(([key, value]) => {
        if (!allowed.has(key)) return;
        if (value === "" || value === null || value === undefined) return;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        out[key] = parsed;
      });
      return out;
    })(),
    sell_out_factors: normalizeMap(row.sell_out_factors, channelCodes),
    sell_out_advice_prices: normalizeMap(row.sell_out_advice_prices, channelCodes),
    _uiId: String(row.id ?? createUiId())
  };
}

const stripInternal = (row: StrategyRow) => {
  const { _uiId, sell_in_margins, sell_in_prices, sell_out_factors, sell_out_advice_prices, ...rest } = row;
  return {
    ...rest,
    kanaalmarges: sell_in_margins,
    sell_in_margins,
    kanaalprijzen: sell_in_prices,
    sell_in_prices,
    sell_out_factors,
    adviesfactoren: sell_out_factors,
    sell_out_advice_prices,
    adviesprijzen: sell_out_advice_prices
  };
};

export function VerkoopstrategieWorkspace({
  endpoint,
  verkoopprijzen,
  basisproducten,
  samengesteldeProducten,
  bieren,
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
          { margin: Number(channel.default_marge_pct ?? 50), factor: Number(channel.default_factor ?? 3) }
        ])
      ) as Record<string, { margin: number; factor: number }>,
    [normalizedChannels]
  );
  const verkoopPassthroughRows = useMemo(() => {
    return verkoopprijzen.filter((row) => !STRATEGY_RECORD_TYPES.has(String(row.record_type ?? "")));
  }, [verkoopprijzen]);
  const verkoopStrategyRows = useMemo(() => {
    return verkoopprijzen.filter((row) => STRATEGY_RECORD_TYPES.has(String(row.record_type ?? "")));
  }, [verkoopprijzen]);
  const productSources = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; type: "basis" | "samengesteld" }>();
    basisproducten.forEach((row) => {
      const id = String(row.id ?? "");
      const label = String(row.omschrijving ?? "");
      if (id && label) seen.set(`basis:${id}`, { id, label, type: "basis" });
    });
    samengesteldeProducten.forEach((row) => {
      const id = String(row.id ?? "");
      const label = String(row.omschrijving ?? "");
      if (id && label) seen.set(`samengesteld:${id}`, { id, label, type: "samengesteld" });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [basisproducten, samengesteldeProducten]);
  const basisProductParentMap = useMemo(() => {
    const parents = new Map<string, { productId: string; label: string; score: number }[]>();
    samengesteldeProducten.forEach((row) => {
      const compositeId = String(row.id ?? "");
      const compositeLabel = String(row.omschrijving ?? "");
      const basisRows = Array.isArray(row.basisproducten) ? (row.basisproducten as GenericRecord[]) : [];
      basisRows.forEach((basisRow) => {
        const basisId = String(basisRow.basisproduct_id ?? "");
        if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
        const current = parents.get(basisId) ?? [];
        const scoreRaw = Number((basisRow as any)?.aantal ?? 0);
        const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
        current.push({ productId: compositeId, label: compositeLabel, score });
        parents.set(basisId, current);
      });
    });

    // If a basisproduct is used in multiple composed products, pick the "primary" parent deterministically.
    // We default to the highest quantity usage (e.g. 24x33cl over 12x33cl), then fall back to label/id ordering.
    const resolved = new Map<string, { productId: string; label: string }>();
    for (const [basisId, items] of parents.entries()) {
      if (!items || items.length === 0) continue;
      const sorted = [...items].sort((left, right) => {
        const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
        if (labelDiff !== 0) return labelDiff;
        return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
      });
      resolved.set(basisId, { productId: sorted[0].productId, label: sorted[0].label });
    }
    return resolved;
  }, [samengesteldeProducten]);
  const [rows, setRows] = useState<StrategyRow[]>(() => verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);

  // In draft mode (wizard), the source rows may be replaced by the parent component when:
  // - a saved concept is loaded from the server
  // - a pricing scenario is applied programmatically
  // To keep the embedded workspace consistent, we sync local state from props only in draft mode.
  useEffect(() => {
    if (mode !== "draft") return;
    setRows(verkoopStrategyRows.map((row) => normalizeStrategyRow(row, channelCodes)));
  }, [mode, verkoopStrategyRows, channelCodes]);

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [selectedChannelCode, setSelectedChannelCode] = useState<string>(() => {
    const first = (Array.isArray(channels) ? channels : []).find((row) => Boolean((row as any)?.actief));
    return String((first as any)?.code ?? "horeca");
  });
  const [sellFilter, setSellFilter] = useState<string>("");

  useEffect(() => {
    if (!selectedChannelCode) return;
    const exists = activeChannels.some((ch) => ch.code === selectedChannelCode);
    if (exists) return;
    if (activeChannels.length > 0) {
      setSelectedChannelCode(activeChannels[0].code);
    }
  }, [activeChannels, selectedChannelCode]);
  const computedDefaultYear = useMemo(() => {
    if (productieYears.length > 0) return Math.max(...productieYears);
    return Math.max(
      new Date().getFullYear(),
      ...verkoopprijzen.map((row) => Number(row.jaar ?? 0)),
      ...berekeningen
        .map((row) => Number(((row.basisgegevens as GenericRecord | undefined)?.jaar ?? 0)))
        .filter((year) => Number.isFinite(year))
    );
  }, [berekeningen, productieYears, verkoopprijzen]);
  const resolvedInitialYear =
    typeof initialYear === "number" && Number.isFinite(initialYear) ? initialYear : computedDefaultYear;
  const [selectedYear, setSelectedYear] = useState<number>(resolvedInitialYear);
  const effectiveSelectedYear = lockYear ? resolvedInitialYear : selectedYear;
  const yearStrategyRow = useMemo(() => {
    return rows.find((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear) ?? null;
  }, [rows, effectiveSelectedYear]);

  const selectedChannel = useMemo(() => {
    if (!selectedChannelCode) return null;
    return activeChannels.find((channel) => channel.code === selectedChannelCode) ?? null;
  }, [activeChannels, selectedChannelCode]);

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
  }, [effectiveSelectedYear, selectedChannelCode, sellFilter]);
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
          margin: Number(source.sell_in_margins?.[code] ?? channelMasterDefaults[code]?.margin ?? 50),
          factor: Number((source.sell_out_factors as any)?.[code] ?? channelMasterDefaults[code]?.factor ?? 3),
        },
      ])
    ) as Record<string, { margin: number; factor: number }>;
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
      const marginOverrides = Object.fromEntries(channelCodes.map((code) => {
        const value = found?.sell_in_margins?.[code];
        return [code, value === undefined || value === channelYearDefaults[code]?.margin ? "" : Number(value)];
      })) as Record<string, number | "">;
      const sellInPriceOverrides = Object.fromEntries(channelCodes.map((code) => {
        const value = (found as any)?.sell_in_prices?.[code];
        if (value === "" || value === undefined || value === null) return [code, ""];
        const parsed = Number(value);
        return [code, Number.isFinite(parsed) ? parsed : ""];
      })) as Record<string, number | "">;
      const factorOverrides = Object.fromEntries(channelCodes.map((code) => {
        const value = found?.sell_out_factors?.[code];
        return [code, value === "" || value === undefined || Number(value) === channelYearDefaults[code]?.factor ? "" : Number(value)];
      })) as Record<string, number | "">;
      return {
        productId: product.id,
        productType: product.type,
        product: product.label,
        marginOverrides,
        sellInPriceOverrides,
        factorOverrides,
        activeMargins: Object.fromEntries(channelCodes.map((code) => [code, marginOverrides[code] === "" ? channelYearDefaults[code]?.margin ?? 50 : Number(marginOverrides[code])])) as Record<string, number>,
        activeFactors: Object.fromEntries(channelCodes.map((code) => [code, factorOverrides[code] === "" ? channelYearDefaults[code]?.factor ?? 3 : Number(factorOverrides[code])])) as Record<string, number>,
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

        const productMargins =
          productDefaults?.activeMargins ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.margin ?? 50])) as Record<
            string,
            number
          >);
        const productFactors =
          productDefaults?.activeFactors ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.factor ?? 3])) as Record<
            string,
            number
          >);

        const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
        const marginOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = override?.sell_in_margins?.[code];
            return [code, value === undefined || value === productMargins[code] ? "" : Number(value)];
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
        const factorOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = override?.sell_out_factors?.[code];
            return [code, value === "" || value === undefined || Number(value) === productFactors[code] ? "" : Number(value)];
          })
        ) as Record<string, number | "">;

        const activeMargins = Object.fromEntries(
          channelCodes.map((code) => [code, marginOverrides[code] === "" ? productMargins[code] : Number(marginOverrides[code])])
        ) as Record<string, number>;
        const activeFactors = Object.fromEntries(
          channelCodes.map((code) => [code, factorOverrides[code] === "" ? productFactors[code] : Number(factorOverrides[code])])
        ) as Record<string, number>;

        const kostprijs = Number(row.kostprijs ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPrice(kostprijs, activeMargins[code])];
          })
        ) as Record<string, number>;
        const sellOutPrices = Object.fromEntries(channelCodes.map((code) => [code, sellInPrices[code] * activeFactors[code]])) as Record<string, number>;

        out.push({
          id: override?.id || `${bierId}:${productId}`,
          bierId,
          biernaam,
          productId,
          productType: row.productType,
          product: productLabel,
          kostprijs,
          productMargins,
          marginOverrides,
          sellInPriceOverrides,
          activeMargins,
          sellInPrices,
          productFactors,
          factorOverrides,
          activeFactors,
          sellOutPrices,
          isReadOnly: Boolean(productDefaults?.isReadOnly),
          followsProductId: followProductId,
          followsProductLabel: productDefaults?.followsProductLabel ?? ""
        });
      });

      return out.sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
    }

    const bierById = new Map(bieren.map((bier) => [String(bier.id ?? ""), bier]));
    const productById = new Map(productOverrideRows.map((row) => [row.productId, row]));
    const beerOverrides = new Map(
      rows
        .filter((row) => row.jaar === effectiveSelectedYear && row.record_type === "verkoopstrategie_product")
        .map((row) => [`${row.bier_id}::${row.product_id}`, row])
    );
    const definitiveVersions = berekeningen.filter((record) => {
      const basisgegevens = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? (record.basisgegevens as GenericRecord) : {};
      return (
        String(record.status ?? "").toLowerCase() === "definitief" &&
        Number(record.jaar ?? basisgegevens.jaar ?? 0) === effectiveSelectedYear
      );
    });
    const versionById = new Map(definitiveVersions.map((record) => [String(record.id ?? ""), record]));
    const activationByBeerProduct = new Map<string, GenericRecord>();
    actieveProductActiveringen.forEach((row) => {
      const key = `${String(row.bier_id ?? "")}::${String(row.product_id ?? "")}`;
      const current = activationByBeerProduct.get(key);
      if (!current || String(row.effectief_vanaf ?? row.updated_at ?? "").localeCompare(String(current.effectief_vanaf ?? current.updated_at ?? "")) > 0) {
        activationByBeerProduct.set(key, row);
      }
    });
    const getRowsForRecord = (record: GenericRecord) => {
      const outByProduct = new Map<string, { productId: string; productType: "basis" | "samengesteld" | ""; product: string; kostprijs: number }>();
      const producten = typeof record.resultaat_snapshot === "object" && record.resultaat_snapshot !== null ? ((record.resultaat_snapshot as GenericRecord).producten as GenericRecord | undefined) : undefined;
      const productRows = [
        ...(Array.isArray(producten?.basisproducten) ? (producten?.basisproducten as GenericRecord[]) : []),
        ...(Array.isArray(producten?.samengestelde_producten) ? (producten?.samengestelde_producten as GenericRecord[]) : [])
      ];
      productRows.forEach((productRow) => {
        const rawProduct = String(productRow.verpakking ?? productRow.verpakkingseenheid ?? productRow.omschrijving ?? "").trim();
        const productType = (String(productRow.product_type ?? "") as "basis" | "samengesteld" | "") || "";
        const productId = String(productRow.product_id ?? "");
        const product = rawProduct;
        if (!productId || !product) return;
        outByProduct.set(productId, {
          productId,
          productType,
          product,
          kostprijs: Number(productRow.kostprijs ?? 0)
        });
      });
      return [...outByProduct.values()];
    };
    const out: BeerViewRow[] = [];
    if (activationByBeerProduct.size > 0) {
      activationByBeerProduct.forEach((activation) => {
        const bierId = String(activation.bier_id ?? "");
        const productId = String(activation.product_id ?? "");
        const record = versionById.get(String(activation.kostprijsversie_id ?? ""));
        if (!record || !bierId || !productId) return;
        const basisgegevens = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? (record.basisgegevens as GenericRecord) : {};
        const biernaam = String(basisgegevens.biernaam ?? "").trim() || String((bierById.get(bierId) ?? {}).biernaam ?? "").trim();
        const productRow = getRowsForRecord(record).find((row) => row.productId === productId);
        if (!biernaam || !productRow) return;
        const productDefaults = productById.get(productId);
        const followProductId = productDefaults?.followsProductId ?? "";
        const productMargins =
          productDefaults?.activeMargins ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.margin ?? 50])) as Record<string, number>);
        const productFactors =
          productDefaults?.activeFactors ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.factor ?? 3])) as Record<string, number>);
        const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
        const marginOverrides = Object.fromEntries(channelCodes.map((code) => {
          const value = override?.sell_in_margins?.[code];
          return [code, value === undefined || value === productMargins[code] ? "" : Number(value)];
        })) as Record<string, number | "">;
        const sellInPriceOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = (override as any)?.sell_in_prices?.[code];
            if (value === "" || value === undefined || value === null) return [code, ""];
            const parsed = Number(value);
            return [code, Number.isFinite(parsed) ? parsed : ""];
          })
        ) as Record<string, number | "">;
        const factorOverrides = Object.fromEntries(channelCodes.map((code) => {
          const value = override?.sell_out_factors?.[code];
          return [code, value === "" || value === undefined || Number(value) === productFactors[code] ? "" : Number(value)];
        })) as Record<string, number | "">;
        const activeMargins = Object.fromEntries(channelCodes.map((code) => [code, marginOverrides[code] === "" ? productMargins[code] : Number(marginOverrides[code])])) as Record<string, number>;
        const activeFactors = Object.fromEntries(channelCodes.map((code) => [code, factorOverrides[code] === "" ? productFactors[code] : Number(factorOverrides[code])])) as Record<string, number>;
        const kostprijs = Number(productRow.kostprijs ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPrice(kostprijs, activeMargins[code])];
          })
        ) as Record<string, number>;
        const sellOutPrices = Object.fromEntries(channelCodes.map((code) => [code, sellInPrices[code] * activeFactors[code]])) as Record<string, number>;
        out.push({ id: override?.id || `${bierId}:${productId}`, bierId, biernaam, productId, productType: productRow.productType, product: productRow.product, kostprijs, productMargins, marginOverrides, sellInPriceOverrides, activeMargins, sellInPrices, productFactors, factorOverrides, activeFactors, sellOutPrices, isReadOnly: Boolean(productDefaults?.isReadOnly), followsProductId: followProductId, followsProductLabel: productDefaults?.followsProductLabel ?? "" });
      });
    } else {
      definitiveVersions.forEach((record) => {
        const basisgegevens = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? (record.basisgegevens as GenericRecord) : {};
        const bierId = String(record.bier_id ?? "");
        const biernaam = String(basisgegevens.biernaam ?? "").trim() || String((bierById.get(bierId) ?? {}).biernaam ?? "").trim();
        if (!biernaam) return;
        getRowsForRecord(record).forEach((productRow) => {
          const productId = productRow.productId;
          const productDefaults = productById.get(productId);
          const followProductId = productDefaults?.followsProductId ?? "";
          const productMargins = productDefaults?.activeMargins ?? Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.margin ?? 50])) as Record<string, number>;
          const productFactors = productDefaults?.activeFactors ?? Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.factor ?? 3])) as Record<string, number>;
          const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
          const marginOverrides = Object.fromEntries(channelCodes.map((code) => {
            const value = override?.sell_in_margins?.[code];
            return [code, value === undefined || value === productMargins[code] ? "" : Number(value)];
          })) as Record<string, number | "">;
          const sellInPriceOverrides = Object.fromEntries(
            channelCodes.map((code) => {
              const value = (override as any)?.sell_in_prices?.[code];
              if (value === "" || value === undefined || value === null) return [code, ""];
              const parsed = Number(value);
              return [code, Number.isFinite(parsed) ? parsed : ""];
            })
          ) as Record<string, number | "">;
          const factorOverrides = Object.fromEntries(channelCodes.map((code) => {
            const value = override?.sell_out_factors?.[code];
            return [code, value === "" || value === undefined || Number(value) === productFactors[code] ? "" : Number(value)];
          })) as Record<string, number | "">;
          const activeMargins = Object.fromEntries(channelCodes.map((code) => [code, marginOverrides[code] === "" ? productMargins[code] : Number(marginOverrides[code])])) as Record<string, number>;
          const activeFactors = Object.fromEntries(channelCodes.map((code) => [code, factorOverrides[code] === "" ? productFactors[code] : Number(factorOverrides[code])])) as Record<string, number>;
          const kostprijs = Number(productRow.kostprijs ?? 0);
          const sellInPrices = Object.fromEntries(
            channelCodes.map((code) => {
              const explicit = sellInPriceOverrides[code];
              if (explicit !== "") return [code, Number(explicit)];
              return [code, calcSellPrice(kostprijs, activeMargins[code])];
            })
          ) as Record<string, number>;
          const sellOutPrices = Object.fromEntries(channelCodes.map((code) => [code, sellInPrices[code] * activeFactors[code]])) as Record<string, number>;
          out.push({ id: override?.id || `${bierId}:${productId}`, bierId, biernaam, productId, productType: productRow.productType, product: productRow.product, kostprijs, productMargins, marginOverrides, sellInPriceOverrides, activeMargins, sellInPrices, productFactors, factorOverrides, activeFactors, sellOutPrices, isReadOnly: Boolean(productDefaults?.isReadOnly), followsProductId: followProductId, followsProductLabel: productDefaults?.followsProductLabel ?? "" });
        });
      });
    }
    return out.sort((a, b) => (a.biernaam === b.biernaam ? a.product.localeCompare(b.product, "nl-NL") : a.biernaam.localeCompare(b.biernaam, "nl-NL")));
  }, [
    actieveProductActiveringen,
    basisById,
    bieren,
    berekeningen,
    channelCodes,
    channelYearDefaults,
    draftKostprijsPreviewRows,
    productOverrideRows,
    rows,
    effectiveSelectedYear,
    samengesteldById
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

  function updateYearMargin(channel: string, value: number) {
    setRows((current) => {
      const next = [...current];
      const idx = next.findIndex((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear);
      const base = idx >= 0 ? next[idx] : buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
      const updated: StrategyRow = {
        ...base,
        jaar: effectiveSelectedYear,
        record_type: "jaarstrategie",
        sell_in_margins: { ...base.sell_in_margins, [channel]: Number(value) }
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }

  function updateYearSellInPrice(channel: string, value: number | "") {
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

  function updateYearFactor(channel: string, value: number) {
    setRows((current) => {
      const next = [...current];
      const idx = next.findIndex((row) => row.record_type === "jaarstrategie" && Number(row.jaar ?? 0) === effectiveSelectedYear);
      const base = idx >= 0 ? next[idx] : buildEmptyYearStrategyRow({ year: effectiveSelectedYear, channelDefaults: channelMasterDefaults });
      const updated: StrategyRow = {
        ...base,
        jaar: effectiveSelectedYear,
        record_type: "jaarstrategie",
        sell_out_factors: { ...(base.sell_out_factors as any), [channel]: Number(value) }
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }

  function upsertProduct(productId: string, updater: (row: StrategyRow | null) => StrategyRow | null) {
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
        sell_out_factors: {},
        sell_out_advice_prices: {},
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
        sell_out_factors: {},
        sell_out_advice_prices: {},
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
    upsertProduct(productId, (row) => {
      const nextMargins = { ...row!.sell_in_margins };
      if (value === "") delete nextMargins[channel]; else nextMargins[channel] = value;
      const nextFactors = Object.fromEntries(Object.entries(row!.sell_out_factors).filter(([, factor]) => factor !== "" && factor !== null && factor !== undefined));
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && !hasSellInPrices && !hasSellOutPrices
        ? null
        : { ...row!, sell_in_margins: nextMargins, sell_out_factors: nextFactors };
    });
  }

  function updateProductSellInPrice(productId: string, channel: string, value: number | "") {
    upsertProduct(productId, (row) => {
      const nextPrices = { ...(row!.sell_in_prices ?? {}) } as Record<string, number | "">;
      if (value === "") delete nextPrices[channel]; else nextPrices[channel] = value;
      const nextMargins = { ...(row!.sell_in_margins ?? {}) } as Record<string, number>;
      const nextFactors = Object.fromEntries(Object.entries(row!.sell_out_factors).filter(([, factor]) => factor !== "" && factor !== null && factor !== undefined));
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && Object.keys(nextPrices).length === 0 && !hasSellOutPrices
        ? null
        : { ...row!, sell_in_prices: nextPrices, sell_out_factors: nextFactors };
    });
  }

  function updateProductFactor(productId: string, channel: string, value: number | "") {
    upsertProduct(productId, (row) => {
      const nextFactors = { ...row!.sell_out_factors };
      if (value === "") delete nextFactors[channel]; else nextFactors[channel] = value;
      const nextMargins = Object.fromEntries(Object.entries(row!.sell_in_margins).filter(([, margin]) => margin !== null && margin !== undefined));
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && !hasSellInPrices && !hasSellOutPrices
        ? null
        : { ...row!, sell_in_margins: nextMargins, sell_out_factors: nextFactors };
    });
  }

  function updateBeerMargin(viewRow: BeerViewRow, channel: string, value: number | "") {
    upsertBeer(viewRow, (row) => {
      const nextMargins = { ...row!.sell_in_margins };
      if (value === "") delete nextMargins[channel]; else nextMargins[channel] = value;
      const nextFactors = Object.fromEntries(Object.entries(row!.sell_out_factors).filter(([, factor]) => factor !== "" && factor !== null && factor !== undefined));
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && !hasSellInPrices && !hasSellOutPrices
        ? null
        : { ...row!, kostprijs: viewRow.kostprijs, sell_in_margins: nextMargins, sell_out_factors: nextFactors };
    });
  }

  function updateBeerSellInPrice(viewRow: BeerViewRow, channel: string, value: number | "") {
    upsertBeer(viewRow, (row) => {
      const nextPrices = { ...(row!.sell_in_prices ?? {}) } as Record<string, number | "">;
      if (value === "") delete nextPrices[channel]; else nextPrices[channel] = value;
      const nextMargins = { ...(row!.sell_in_margins ?? {}) } as Record<string, number>;
      const nextFactors = Object.fromEntries(Object.entries(row!.sell_out_factors).filter(([, factor]) => factor !== "" && factor !== null && factor !== undefined));
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && Object.keys(nextPrices).length === 0 && !hasSellOutPrices
        ? null
        : { ...row!, kostprijs: viewRow.kostprijs, sell_in_prices: nextPrices, sell_out_factors: nextFactors };
    });
  }

  function updateBeerFactor(viewRow: BeerViewRow, channel: string, value: number | "") {
    upsertBeer(viewRow, (row) => {
      const nextFactors = { ...row!.sell_out_factors };
      if (value === "") delete nextFactors[channel]; else nextFactors[channel] = value;
      const nextMargins = Object.fromEntries(Object.entries(row!.sell_in_margins).filter(([, margin]) => margin !== null && margin !== undefined));
      const hasSellInPrices = Object.keys(row!.sell_in_prices ?? {}).length > 0;
      const hasSellOutPrices = Object.keys(row!.sell_out_advice_prices ?? {}).length > 0;
      return Object.keys(nextMargins).length === 0 && Object.keys(nextFactors).length === 0 && !hasSellInPrices && !hasSellOutPrices
        ? null
        : { ...row!, kostprijs: viewRow.kostprijs, sell_in_margins: nextMargins, sell_out_factors: nextFactors };
    });
  }

  async function handleSave() {
    if (isMountedRef.current) {
      setStatus("");
      setIsSaving(true);
    }
    try {
      const payload = [...verkoopPassthroughRows, ...rows.map(stripInternal)];
      if (mode === "draft") {
        await onDraftSave?.(payload);
        if (isMountedRef.current) {
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
    return Array.from(
      new Set([
        effectiveSelectedYear,
        ...rows.map((row) => row.jaar),
        ...berekeningen.map((row) => Number(((row.basisgegevens as GenericRecord | undefined)?.jaar ?? 0)))
      ])
    )
      .filter((year) => Number.isFinite(year) && year > 0)
      .sort((a, b) => b - a);
  }, [berekeningen, effectiveSelectedYear, productieYears, rows]);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopstrategie</div>
        <div className="module-card-text">Kanaaldefaults vormen de basis. Daar bovenop kun je per product of per bier/product afwijken.</div>
      </div>

      <>
          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{productSources.length} producten</span>
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
            selectedChannelCode={selectedChannelCode}
            setSelectedChannelCode={setSelectedChannelCode}
            effectiveSelectedYear={effectiveSelectedYear}
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
          />

          {/*
          <div className="module-card compact-card">
              <div className="module-card-header" style={{ marginBottom: "0.7rem" }}>
                <div className="module-card-title">Prijsinstellingen</div>
                <div className="module-card-text">Pas prijsinstellingen aan per kanaal, producttype en bier.</div>
              </div>
              <div className="editor-actions" style={{ marginBottom: "0.75rem" }}>
                <div className="editor-actions-group">
                  <button
                    type="button"
                    className="editor-button editor-button-secondary"
                    onClick={() => setSelectedChannelCode("")}
                    disabled={!selectedChannelCode}
                  >
                    Alles inklappen
                  </button>
                </div>
              </div>
              <div className="stack" style={{ gap: "0.75rem" }}>
                {activeChannels.map((channel) => {
                  const isActive = selectedChannelCode === channel.code;
                  const opslag = calcOpslagPctFromMarginPct(channelYearDefaults[channel.code]?.margin ?? 0);
                  const opslagKey = `year:${effectiveSelectedYear}:channel:${channel.code}:defaults`;
                  const opslagDraftValue = getDraft(opslagKey);
                  return (
                    <div key={channel.code} className="module-card compact-card" style={{ padding: 0 }}>
                      <button
                        type="button"
                        className="editor-button editor-button-secondary"
                        style={{
                          justifyContent: "space-between",
                          gap: "0.75rem",
                          padding: "0.9rem 1rem",
                          width: "100%",
                          borderRadius: 0,
                          borderColor: isActive ? "#C6D5FF" : undefined,
                          background: isActive ? "#F3F7FF" : undefined
                        }}
                        onClick={() => setSelectedChannelCode((current) => (current === channel.code ? "" : channel.code))}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 750 }}>
                          <span className="muted" style={{ fontSize: "1rem" }}>{isActive ? "v" : ">"}</span>
                          {channel.naam}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                          <span className="muted">Standaard:</span>
                          <span className="muted">+</span>
                          <input
                            className="dataset-input"
                            type="number"
                            step="any"
                            value={opslagDraftValue ?? String(round2(opslag))}
                            onChange={(event) => {
                              const raw = event.target.value;
                              setDraft(opslagKey, raw);
                              const parsed = parseNumberLoose(raw);
                              if (!Number.isFinite(parsed)) return;
                              const nextMargin = calcMarginPctFromOpslagPct(parsed);
                              updateYearSellInPrice(channel.code, "");
                              updateYearMargin(channel.code, round2(nextMargin));
                            }}
                            onBlur={(event) => {
                              const raw = event.target.value;
                              const parsed = parseNumberLoose(raw);
                              if (!Number.isFinite(parsed)) {
                                clearDraft(opslagKey);
                                return;
                              }
                              setDraft(opslagKey, String(parsed));
                            }}
                            style={{ width: 96 }}
                          />
                          <span className="muted">%</span>
                        </span>
                      </button>

                      {isActive ? (
                        <div style={{ padding: "0.9rem 1rem", borderTop: "1px solid #E5EAF5" }}>
                          <div className="module-card-text" style={{ marginBottom: "0.8rem" }}>
                            Vul <strong>opslag</strong> in om een verkoopprijs te laten berekenen. Je kunt ook de verkoopprijs invullen (psychologische prijs); opslag en marge worden dan afgeleid.
                          </div>

                          <details open className="module-card compact-card" style={{ marginBottom: "0.9rem" }}>
                            <summary className="module-card-title" style={{ cursor: "pointer" }}>Producttypes</summary>
                            <div className="module-card-text" style={{ marginTop: "0.35rem", marginBottom: "0.8rem" }}>
                              Producttypes zijn generiek. We tonen een voorbeeld-kostprijs van EUR 1,00 om opslag en marge te visualiseren.
                            </div>
                            {groupedProductOverrideRows.length === 0 ? (
                              <div className="dataset-empty">Geen producttypes gevonden.</div>
                            ) : (
                              groupedProductOverrideRows.map((group) => (
                                <details key={group.key} open style={{ marginBottom: "0.75rem" }}>
                                  <summary className="muted" style={{ cursor: "pointer" }}>
                                    {group.key} ({group.rows.length})
                                  </summary>
                                  <div className="data-table" style={{ marginTop: "0.6rem" }}>
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>Product</th>
                                          <th>Opslag</th>
                                          <th>Marge</th>
                                          <th />
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.rows.map((row) => {
                                          const code = selectedChannel?.code ?? "";
                                          const effectiveMargin = code ? Number(row.activeMargins[code] ?? 0) : 0;
                                          const derivedMargin = effectiveMargin;
                                          const derivedOpslag = calcOpslagPctFromMarginPct(effectiveMargin);
                                          const opslagValue =
                                            !code ? "" :
                                            row.marginOverrides[code] === "" && row.sellInPriceOverrides[code] === "" ? "" :
                                            String(round2(derivedOpslag));
                                          const hasOverride = Boolean(code) && (row.marginOverrides[code] !== "" || row.sellInPriceOverrides[code] !== "");
                                          const opslagKey = code ? `year:${effectiveSelectedYear}:channel:${code}:product:${row.productId}:opslag` : "";
                                          const opslagDraftValue = opslagKey ? getDraft(opslagKey) : undefined;
                                          return (
                                            <tr key={row.productId}>
                                              <td>
                                                <div style={{ fontWeight: 650 }}>{row.product}</div>
                                                {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                              </td>
                                              <td>
                                                <div className="stack" style={{ gap: "0.35rem" }}>
                                                  <input
                                                    className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                                    type="number"
                                                    step="any"
                                                    placeholder={code ? String(round2(calcOpslagPctFromMarginPct(channelYearDefaults[code]?.margin ?? 0))) : ""}
                                                    value={opslagDraftValue ?? opslagValue}
                                                    readOnly={row.isReadOnly}
                                                    onChange={(event) => {
                                                      if (!code) return;
                                                      const raw = event.target.value;
                                                      if (opslagKey) setDraft(opslagKey, raw);
                                                      const parsed = parseNumberLoose(raw);
                                                      const nextOpslag = raw === "" ? "" : parsed;
                                                      if (nextOpslag === "") {
                                                        updateProductSellInPrice(row.productId, code, "");
                                                        updateProductMargin(row.productId, code, "");
                                                        clearDraft(opslagKey);
                                                        return;
                                                      }
                                                      if (!Number.isFinite(nextOpslag)) return;
                                                      const nextMargin = calcMarginPctFromOpslagPct(nextOpslag);
                                                      updateProductSellInPrice(row.productId, code, "");
                                                      updateProductMargin(row.productId, code, round2(nextMargin));
                                                    }}
                                                    onBlur={(event) => {
                                                      if (!opslagKey) return;
                                                      const raw = event.target.value;
                                                      const parsed = parseNumberLoose(raw);
                                                      if (!Number.isFinite(parsed)) {
                                                        clearDraft(opslagKey);
                                                        return;
                                                      }
                                                      setDraft(opslagKey, String(parsed));
                                                    }}
                                                  />
                                                  {!hasOverride ? <div className="muted">Erft standaard</div> : null}
                                                </div>
                                              </td>
                                              <td>{num(derivedMargin)}%</td>
                                              <td>
                                                {hasOverride && !row.isReadOnly ? (
                                                  <button
                                                    type="button"
                                                    className="editor-button editor-button-secondary"
                                                    onClick={() => {
                                                      if (!code) return;
                                                      updateProductSellInPrice(row.productId, code, "");
                                                      updateProductMargin(row.productId, code, "");
                                                    }}
                                                  >
                                                    Reset
                                                  </button>
                                                ) : null}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              ))
                            )}
                          </details>

                          <details open className="module-card compact-card">
                            <summary className="module-card-title" style={{ cursor: "pointer" }}>Bieren</summary>
                            {groupedBeerRows.length === 0 ? (
                              <div className="dataset-empty">Nog geen actieve kostprijsversies gevonden voor {effectiveSelectedYear}.</div>
                            ) : (
                              groupedBeerRows.map((beer) => (
                                <details key={beer.biernaam} open style={{ marginBottom: "0.75rem" }}>
                                  <summary style={{ cursor: "pointer", fontWeight: 650 }}>
                                    {beer.biernaam} ({beer.rows.length})
                                  </summary>
                                  <div className="data-table" style={{ marginTop: "0.6rem" }}>
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>Product</th>
                                          <th>Kostprijs</th>
                                          <th>Opslag</th>
                                          <th>Marge</th>
                                          <th>Verkoopprijs</th>
                                          <th />
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {beer.rows.map((row) => {
                                          const code = selectedChannel?.code ?? "";
                                          const explicitPrice = code && row.sellInPriceOverrides[code] !== "" ? Number(row.sellInPriceOverrides[code]) : Number.NaN;
                                          const effectiveMargin = code ? Number(row.activeMargins[code] ?? 0) : 0;
                                          const computedSellIn = Number.isFinite(explicitPrice) ? explicitPrice : calcSellPrice(row.kostprijs, effectiveMargin);
                                          const derivedMargin = calcMarginPctFromSellInPrice(row.kostprijs, computedSellIn);
                                          const derivedOpslag = calcOpslagPctFromSellInPrice(row.kostprijs, computedSellIn);
                                          const opslagValue =
                                            !code ? "" :
                                            row.marginOverrides[code] === "" && row.sellInPriceOverrides[code] === "" ? "" :
                                            String(round2(derivedOpslag));
                                          const priceValue = !code || row.sellInPriceOverrides[code] === "" ? "" : String(row.sellInPriceOverrides[code]);
                                          const hasOverride = Boolean(code) && (row.marginOverrides[code] !== "" || row.sellInPriceOverrides[code] !== "");
                                          const placeholderOpslag = code ? calcOpslagPctFromMarginPct(row.productMargins[code] ?? channelYearDefaults[code]?.margin ?? 0) : 0;
                                          const opslagKey = code ? `year:${effectiveSelectedYear}:channel:${code}:beer:${row.bierId}:product:${row.productId}:opslag` : "";
                                          const opslagDraftValue = opslagKey ? getDraft(opslagKey) : undefined;
                                          return (
                                            <tr key={`${row.bierId}::${row.productId}`}>
                                              <td>
                                                <div style={{ fontWeight: 650 }}>{row.product}</div>
                                                {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                                              </td>
                                              <td>{money(row.kostprijs)}</td>
                                              <td>
                                                <div className="stack" style={{ gap: "0.35rem" }}>
                                                  <input
                                                    className={`${inputClass(hasOverride)} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                                    type="number"
                                                    step="any"
                                                    placeholder={String(round2(placeholderOpslag))}
                                                    value={opslagDraftValue ?? opslagValue}
                                                    readOnly={row.isReadOnly}
                                                    onChange={(event) => {
                                                      if (!code) return;
                                                      const raw = event.target.value;
                                                      if (opslagKey) setDraft(opslagKey, raw);
                                                      const parsed = parseNumberLoose(raw);
                                                      const nextOpslag = raw === "" ? "" : parsed;
                                                      if (nextOpslag === "") {
                                                        updateBeerSellInPrice(row, code, "");
                                                        updateBeerMargin(row, code, "");
                                                        clearDraft(opslagKey);
                                                        return;
                                                      }
                                                      if (!Number.isFinite(nextOpslag)) return;
                                                      const nextMargin = calcMarginPctFromOpslagPct(nextOpslag);
                                                      updateBeerSellInPrice(row, code, "");
                                                      updateBeerMargin(row, code, round2(nextMargin));
                                                    }}
                                                    onBlur={(event) => {
                                                      if (!opslagKey) return;
                                                      const raw = event.target.value;
                                                      const parsed = parseNumberLoose(raw);
                                                      if (!Number.isFinite(parsed)) {
                                                        clearDraft(opslagKey);
                                                        return;
                                                      }
                                                      setDraft(opslagKey, String(parsed));
                                                    }}
                                                  />
                                                  {!hasOverride ? <div className="muted">Erft standaard</div> : null}
                                                </div>
                                              </td>
                                              <td>{num(derivedMargin)}%</td>
                                              <td>
                                                <input
                                                  className={`${inputClass(priceValue !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                                  type="number"
                                                  step="any"
                                                  placeholder={String(Math.round(computedSellIn * 100) / 100)}
                                                  value={priceValue}
                                                  readOnly={row.isReadOnly}
                                                  onChange={(event) => {
                                                    if (!code) return;
                                                    const nextPrice = event.target.value === "" ? "" : Number(event.target.value);
                                                    if (nextPrice === "") {
                                                      updateBeerSellInPrice(row, code, "");
                                                      return;
                                                    }
                                                    const nextMargin = calcMarginPctFromSellInPrice(row.kostprijs, nextPrice);
                                                    updateBeerSellInPrice(row, code, Math.round(nextPrice * 100) / 100);
                                                    updateBeerMargin(row, code, Math.round(nextMargin * 100) / 100);
                                                  }}
                                                />
                                              </td>
                                              <td>
                                                {hasOverride && !row.isReadOnly ? (
                                                  <button
                                                    type="button"
                                                    className="editor-button editor-button-secondary"
                                                    onClick={() => {
                                                      if (!code) return;
                                                      updateBeerSellInPrice(row, code, "");
                                                      updateBeerMargin(row, code, "");
                                                    }}
                                                  >
                                                    Reset
                                                  </button>
                                                ) : null}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              ))
                            )}
                          </details>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          */}

          <div className="editor-actions">
            <div className="editor-actions-group" />
            <div className="editor-actions-group">
              {status ? <span className="editor-status">{status}</span> : null}
              <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>{isSaving ? "Opslaan..." : "Opslaan"}</button>
            </div>
          </div>

          {/*
          {activeTab === "sell-in" ? (
            <div className="stack" style={{ gap: "1rem" }}>
              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Kanaaldefaults</summary>
                <div className="data-table" style={{ marginTop: "0.75rem" }}>
                  <table>
                    <thead><tr><th>Kanaal</th><th>Default marge %</th></tr></thead>
                    <tbody>
                      {activeChannels.map((channel) => (
                        <tr key={channel.code}>
                          <td>{channel.naam}</td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              step="any"
                              value={String(channelYearDefaults[channel.code]?.margin ?? 0)}
                              onChange={(event) => updateYearMargin(channel.code, Number(event.target.value))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Productoverrides</summary>
                <div className="module-card-text" style={{ marginTop: "0.5rem", marginBottom: "0.9rem" }}>Laat een cel leeg om de kanaaldefault te gebruiken.</div>
                <div className="data-table">
                  <table>
                    <thead><tr><th>Product</th><th>Type</th>{activeChannels.map((channel) => <th key={channel.code}>{channel.naam}</th>)}</tr></thead>
                    <tbody>
                      {productOverrideRows.map((row) => (
                        <tr key={row.productId}>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{row.product}</div>
                            {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                          </td>
                          <td><div className="dataset-input dataset-input-readonly">{row.productType}</div></td>
                          {activeChannels.map((channel) => (
                            <td key={`${row.productId}-${channel.code}`}>
                              <input className={`${inputClass(row.marginOverrides[channel.code] !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()} type="number" step="any" placeholder={String(channelYearDefaults[channel.code]?.margin ?? 0)} value={row.marginOverrides[channel.code] === "" ? "" : String(row.marginOverrides[channel.code])} readOnly={row.isReadOnly} onChange={(event) => updateProductMargin(row.productId, channel.code, event.target.value === "" ? "" : Number(event.target.value))} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Sell-in prijzen</summary>
                <div className="module-card-text" style={{ marginTop: "0.5rem", marginBottom: "0.9rem" }}>Actieve kostprijsversies met defaultmarge en overrides per bier/product.</div>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Bier</th><th>Product</th><th>Kostprijs</th>
                        {activeChannels.map((channel) => <th key={`${channel.code}-override`}>{channel.naam}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sellRows.length === 0 ? (
                        <tr><td className="dataset-empty" colSpan={3 + activeChannels.length}>Nog geen actieve kostprijsversies gevonden voor {effectiveSelectedYear}.</td></tr>
                      ) : sellRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.biernaam}</td>
                          <td>
                            <div>{row.product}</div>
                            {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                          </td>
                          <td>{money(row.kostprijs)}</td>
                          {activeChannels.map((channel) => (
                            <td key={`${row.id}-${channel.code}-override`}>
                              <div className="stack" style={{ gap: "0.35rem" }}>
                                <input
                                  className={`${inputClass(row.marginOverrides[channel.code] !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                  type="number"
                                  step="any"
                                  placeholder={String(row.productMargins[channel.code])}
                                  value={row.marginOverrides[channel.code] === "" ? "" : String(row.marginOverrides[channel.code])}
                                  readOnly={row.isReadOnly}
                                  onChange={(event) => updateBeerMargin(row, channel.code, event.target.value === "" ? "" : Number(event.target.value))}
                                />
                                <div className="dataset-input dataset-input-readonly">
                                  {num(row.activeMargins[channel.code])}% · {money(row.sellInPrices[channel.code])}
                                </div>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ) : null}

          {activeTab === "sell-out" ? (
            <div className="stack" style={{ gap: "1rem" }}>
              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Kanaaldefaults</summary>
                <div className="data-table" style={{ marginTop: "0.75rem" }}>
                  <table>
                    <thead><tr><th>Kanaal</th><th>Default factor</th></tr></thead>
                    <tbody>
                      {activeChannels.map((channel) => (
                        <tr key={channel.code}>
                          <td>{channel.naam}</td>
                          <td>
                            <input
                              className="dataset-input"
                              type="number"
                              step="any"
                              value={String(channelYearDefaults[channel.code]?.factor ?? 0)}
                              onChange={(event) => updateYearFactor(channel.code, Number(event.target.value))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Productoverrides</summary>
                <div className="module-card-text" style={{ marginTop: "0.5rem", marginBottom: "0.9rem" }}>Laat een cel leeg om de kanaalfactor te gebruiken.</div>
                <div className="data-table">
                  <table>
                    <thead><tr><th>Product</th><th>Type</th>{activeChannels.map((channel) => <th key={channel.code}>{channel.naam}</th>)}</tr></thead>
                    <tbody>
                      {productOverrideRows.map((row) => (
                        <tr key={`${row.productId}-factor`}>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{row.product}</div>
                            {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                          </td>
                          <td><div className="dataset-input dataset-input-readonly">{row.productType}</div></td>
                          {activeChannels.map((channel) => (
                            <td key={`${row.productId}-${channel.code}-factor`}>
                              <input className={`${inputClass(row.factorOverrides[channel.code] !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()} type="number" step="any" placeholder={String(channelYearDefaults[channel.code]?.factor ?? 0)} value={row.factorOverrides[channel.code] === "" ? "" : String(row.factorOverrides[channel.code])} readOnly={row.isReadOnly} onChange={(event) => updateProductFactor(row.productId, channel.code, event.target.value === "" ? "" : Number(event.target.value))} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              <details open className="module-card compact-card">
                <summary className="module-card-title" style={{ cursor: "pointer" }}>Sell-out prijzen</summary>
                <div className="data-table" style={{ marginTop: "0.75rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Bier</th><th>Product</th>
                        {activeChannels.map((channel) => <th key={`${channel.code}-override-factor`}>{channel.naam}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {sellRows.length === 0 ? (
                        <tr><td className="dataset-empty" colSpan={2 + activeChannels.length}>Nog geen actieve kostprijsversies gevonden voor {effectiveSelectedYear}.</td></tr>
                      ) : sellRows.map((row) => (
                        <tr key={`${row.id}-sellout`}>
                          <td>{row.biernaam}</td>
                          <td>
                            <div>{row.product}</div>
                            {row.isReadOnly ? <div className="muted">Volgt {row.followsProductLabel}</div> : null}
                          </td>
                          {activeChannels.map((channel) => (
                            <td key={`${row.id}-${channel.code}-override-factor`}>
                              <div className="stack" style={{ gap: "0.35rem" }}>
                                <input
                                  className={`${inputClass(row.factorOverrides[channel.code] !== "")} ${row.isReadOnly ? "dataset-input-readonly" : ""}`.trim()}
                                  type="number"
                                  step="any"
                                  placeholder={String(row.productFactors[channel.code])}
                                  value={row.factorOverrides[channel.code] === "" ? "" : String(row.factorOverrides[channel.code])}
                                  readOnly={row.isReadOnly}
                                  onChange={(event) => updateBeerFactor(row, channel.code, event.target.value === "" ? "" : Number(event.target.value))}
                                />
                                <div className="dataset-input dataset-input-readonly">
                                  x {num(row.activeFactors[channel.code])} · {money(row.sellOutPrices[channel.code])}
                                </div>
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>

          */}
        </>
    </section>
  );
}
