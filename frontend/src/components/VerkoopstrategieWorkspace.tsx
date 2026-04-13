"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { API_BASE_URL } from "@/lib/api";
import {
  calcSellPriceFromOpslagPct,
  parseNumberLoose,
  round2
} from "@/lib/verkoopstrategieMath";
import { VerkoopstrategiePrijsinstellingenAccordion } from "@/components/verkoopstrategie/VerkoopstrategiePrijsinstellingenAccordion";
import { inputClass, money, num } from "@/components/verkoopstrategie/verkoopstrategieUi";
import type { BeerViewRow, ProductViewRow } from "@/components/verkoopstrategie/verkoopstrategieTypes";

type GenericRecord = Record<string, unknown>;
type ChannelRow = { id: string; code: string; naam: string; actief: boolean; volgorde: number; default_marge_pct: number };
type StrategyRow = {
  id: string; record_type: string; jaar: number; bier_id: string; biernaam: string; product_id: string;
  product_type: "basis" | "samengesteld" | ""; verpakking: string; strategie_type: string; kostprijs: number;
  sell_in_margins: Record<string, number>;
  sell_in_prices: Record<string, number | "">;
  _uiId: string;
};
const STRATEGY_RECORD_TYPES = new Set([
  "jaarstrategie",
  "verkoopstrategie_product",
  "verkoopstrategie_verpakking"
]);
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

const DEFAULT_CHANNELS: ChannelRow[] = [
  { id: "horeca", code: "horeca", naam: "Horeca", actief: true, volgorde: 10, default_marge_pct: 50 },
  { id: "retail", code: "retail", naam: "Supermarkt", actief: true, volgorde: 20, default_marge_pct: 30 },
  { id: "slijterij", code: "slijterij", naam: "Slijterij", actief: true, volgorde: 30, default_marge_pct: 40 },
  { id: "zakelijk", code: "zakelijk", naam: "Speciaalzaak", actief: true, volgorde: 40, default_marge_pct: 45 },
  { id: "particulier", code: "particulier", naam: "Particulier", actief: false, volgorde: 50, default_marge_pct: 50 }
];

const createUiId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
// Pricing helpers are shared with the nieuw-jaar wizard via `lib/verkoopstrategieMath.ts`.
const normalizeLabel = (value: unknown) => String(value ?? "").trim().toLowerCase();
function computeDraftSignature(records: GenericRecord[], channelCodes: string[]) {
  const mapToSortedPairs = (raw: unknown) => {
    const src = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return channelCodes
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .flatMap((code) => {
        const value = src[code];
        if (value === "" || value === null || value === undefined) return [];
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return [];
        return [[code, parsed] as const];
      });
  };

  const normalized = (Array.isArray(records) ? records : [])
    .map((row) => ({
      id: String(row.id ?? ""),
      record_type: String(row.record_type ?? ""),
      jaar: Number(row.jaar ?? 0),
      bier_id: String((row as any).bier_id ?? ""),
      product_id: String((row as any).product_id ?? ""),
      sell_in_margins: mapToSortedPairs((row as any).sell_in_margins ?? (row as any).kanaalmarges ?? {}),
      sell_in_prices: mapToSortedPairs((row as any).sell_in_prices ?? (row as any).kanaalprijzen ?? {})
    }))
    .sort((a, b) => {
      const rt = a.record_type.localeCompare(b.record_type);
      if (rt !== 0) return rt;
      const y = a.jaar - b.jaar;
      if (y !== 0) return y;
      const bi = a.bier_id.localeCompare(b.bier_id);
      if (bi !== 0) return bi;
      const pi = a.product_id.localeCompare(b.product_id);
      if (pi !== 0) return pi;
      return a.id.localeCompare(b.id);
    });

  return JSON.stringify(normalized);
}

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
    });
  });
  return [...byCode.values()].map((row) => ({
    id: String(row.id ?? row.code ?? createUiId()),
    code: String(row.code ?? row.id ?? "").trim().toLowerCase(),
    naam: String(row.naam ?? ("label" in row ? row.label : undefined) ?? row.code ?? "").trim(),
    actief: Boolean(row.actief ?? true),
    volgorde: Number(row.volgorde ?? 999),
    default_marge_pct: Number(row.default_marge_pct ?? 50),
  })).filter((row) => row.code && row.naam && row.code !== "groothandel").sort((a, b) => (a.volgorde === b.volgorde ? a.naam.localeCompare(b.naam, "nl-NL") : a.volgorde - b.volgorde));
}

function buildEmptyYearStrategyRow({
  year,
  channelDefaults
}: {
  year: number;
  channelDefaults: Record<string, { opslag: number }>;
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
    // NOTE: despite the legacy field name `sell_in_margins`, we now persist opslag% as the source of truth.
    sell_in_margins: Object.fromEntries(Object.entries(channelDefaults).map(([code, def]) => [code, Number(def.opslag ?? 50)])),
    sell_in_prices: {},
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
    _uiId: String(row.id ?? createUiId())
  };
}

const stripInternal = (row: StrategyRow) => {
  const { _uiId, sell_in_margins, sell_in_prices, ...rest } = row;
  return {
    ...rest,
    kanaalmarges: sell_in_margins,
    sell_in_margins,
    kanaalprijzen: sell_in_prices,
    sell_in_prices
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
        const productOpslags =
          productDefaults?.activeOpslags ??
          (Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.opslag ?? 50])) as Record<string, number>);
        const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
        const opslagOverrides = Object.fromEntries(channelCodes.map((code) => {
          const value = override?.sell_in_margins?.[code];
          return [code, value === undefined || value === productOpslags[code] ? "" : Number(value)];
        })) as Record<string, number | "">;
        const sellInPriceOverrides = Object.fromEntries(
          channelCodes.map((code) => {
            const value = (override as any)?.sell_in_prices?.[code];
            if (value === "" || value === undefined || value === null) return [code, ""];
            const parsed = Number(value);
            return [code, Number.isFinite(parsed) ? parsed : ""];
          })
        ) as Record<string, number | "">;
        const activeOpslags = Object.fromEntries(channelCodes.map((code) => [code, opslagOverrides[code] === "" ? productOpslags[code] : Number(opslagOverrides[code])])) as Record<string, number>;
        const kostprijs = Number(productRow.kostprijs ?? 0);
        const sellInPrices = Object.fromEntries(
          channelCodes.map((code) => {
            const explicit = sellInPriceOverrides[code];
            if (explicit !== "") return [code, Number(explicit)];
            return [code, calcSellPriceFromOpslagPct(kostprijs, activeOpslags[code])];
          })
        ) as Record<string, number>;
        out.push({ id: override?.id || `${bierId}:${productId}`, bierId, biernaam, productId, productType: productRow.productType, product: productRow.product, kostprijs, productOpslags, opslagOverrides, sellInPriceOverrides, activeOpslags, sellInPrices, isReadOnly: Boolean(productDefaults?.isReadOnly), followsProductId: followProductId, followsProductLabel: productDefaults?.followsProductLabel ?? "" });
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
          const productOpslags = productDefaults?.activeOpslags ?? Object.fromEntries(channelCodes.map((code) => [code, channelYearDefaults[code]?.opslag ?? 50])) as Record<string, number>;
          const override = beerOverrides.get(`${bierId}::${followProductId || productId}`) ?? null;
          const opslagOverrides = Object.fromEntries(channelCodes.map((code) => {
            const value = override?.sell_in_margins?.[code];
            return [code, value === undefined || value === productOpslags[code] ? "" : Number(value)];
          })) as Record<string, number | "">;
          const sellInPriceOverrides = Object.fromEntries(
            channelCodes.map((code) => {
              const value = (override as any)?.sell_in_prices?.[code];
              if (value === "" || value === undefined || value === null) return [code, ""];
              const parsed = Number(value);
              return [code, Number.isFinite(parsed) ? parsed : ""];
            })
          ) as Record<string, number | "">;
          const activeOpslags = Object.fromEntries(channelCodes.map((code) => [code, opslagOverrides[code] === "" ? productOpslags[code] : Number(opslagOverrides[code])])) as Record<string, number>;
          const kostprijs = Number(productRow.kostprijs ?? 0);
          const sellInPrices = Object.fromEntries(
            channelCodes.map((code) => {
              const explicit = sellInPriceOverrides[code];
              if (explicit !== "") return [code, Number(explicit)];
              return [code, calcSellPriceFromOpslagPct(kostprijs, activeOpslags[code])];
            })
          ) as Record<string, number>;
          out.push({ id: override?.id || `${bierId}:${productId}`, bierId, biernaam, productId, productType: productRow.productType, product: productRow.product, kostprijs, productOpslags, opslagOverrides, sellInPriceOverrides, activeOpslags, sellInPrices, isReadOnly: Boolean(productDefaults?.isReadOnly), followsProductId: followProductId, followsProductLabel: productDefaults?.followsProductLabel ?? "" });
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
      const payload = [...verkoopPassthroughRows, ...rows.map(stripInternal)];
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
    </section>
  );
}
