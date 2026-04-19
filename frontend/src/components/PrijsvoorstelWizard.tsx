"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import { usePageShellWizardSidebar } from "@/components/PageShell";
import UitgangspuntenStep from "@/components/UitgangspuntenStep";
import { API_BASE_URL } from "@/lib/api";
import { formatMoneyEUR, formatNumber0to2, formatPercent0to2, toFiniteNumber } from "@/lib/formatters";
import { calcMarginPctFromRevenueCost, calcOfferLineTotals, calcOfferLineTotalsWithGratis, calcSellInExFromOpslagPct, computeGratisFreeByRefFromPaidRows, parseNumberLoose, round2 } from "@/lib/pricingEngine";

type GenericRecord = Record<string, unknown>;

type QuoteLineRow = GenericRecord & {
  id: string;
  kostprijsversie_id: string;
  included: boolean;
  cost_at_quote: number;
  sales_price_at_quote: number;
  revenue_at_quote: number;
  margin_at_quote: number;
  target_margin_pct_at_quote: number;
  channel_at_quote: string;
  verpakking_label: string;
  korting_pct: number;
  korting_pct_p1?: number;
  korting_pct_p2?: number;
  sell_in_price_override_p1?: number;
  sell_in_price_override_p2?: number;
};

type QuoteVariantPeriod = {
  id: string;
  period_index: 1 | 2;
  label: string;
  start_date: string;
  end_date: string;
};

type QuoteVariant = {
  id: string;
  name: string;
  channel_code: string;
  return_pct: number;
  sort_index: number;
  periods: QuoteVariantPeriod[];
  product_rows: QuoteLineRow[];
  beer_rows: QuoteLineRow[];
  staffels: GenericRecord[];
};

type ScenarioCompareRow = {
  scenarioId: string;
  scenarioName: string;
  channelLabel: string;
  periodIndex: 1 | 2;
  periodLabel: string;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
  transportMode?: "charge" | "cost";
  transportAmountEx?: number;
  extrasOmzet?: number;
  extrasKosten?: number;
  activeRuleLabel?: string;
};

type QuoteBuilderContext = {
  postcode: string;
  distance_km: number;
  transport_threshold_ex: number;
  transport_km_threshold?: number;
  transport_rate_ex?: number;
  transport_deliveries?: number;
};

type QuoteBuilderBlock = {
  id: string;
  type: "discount_pct" | "intro" | "staffel" | "xy_gratis" | "transport" | "extras";
  // intro block config
  start_date?: string;
  end_date?: string;
  korting_pct?: number;
  applies_to_periods?: "both" | "intro" | "standard";
  // x+y gratis config (products-mode only for now)
  required_qty?: number;
  free_qty?: number;
  eligible_product_refs?: string[]; // ["samengesteld|<id>", ...] ; empty => all
  // transport config (per delivery; amounts are ex VAT, transport VAT is always 21%)
  postcode?: string;
  distance_km?: number;
  km_threshold?: number; // default 40
  threshold_amount_ex?: number; // if set: charge transport only when base omzet_ex < this threshold
  deliveries?: number;
  rate_ex?: number;
  // extras / services (always 21% VAT for display; prices/costs are ex VAT)
  extra_label?: string;
  extra_qty?: number;
  extra_unit_price_ex?: number;
  extra_unit_cost_ex?: number;
  extra_is_free?: boolean;
  extra_threshold_amount_ex?: number; // optional: only apply when base omzet_ex >= threshold
};

type PrijsvoorstelWizardProps = {
  initialRows: GenericRecord[];
  yearOptions: number[];
  bieren: GenericRecord[];
  berekeningen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  channels: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  catalogusproducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  initialSelectedId?: string;
  startWithNew?: boolean;
  onBackToLanding?: () => void;
  onRowsChange?: (rows: GenericRecord[]) => void;
  onFinish?: () => void;
};

type StepDefinition = {
  id: string;
  label: string;
  description: string;
};

type SelectOption = {
  value: string;
  label: string;
};

type ChannelOption = {
  value: string;
  label: string;
  defaultMarginPct: number;
};

const DEFAULT_CHANNEL_OPTIONS: ChannelOption[] = [
  { value: "horeca", label: "Horeca", defaultMarginPct: 50 },
  { value: "retail", label: "Supermarkt", defaultMarginPct: 30 },
  { value: "slijterij", label: "Slijterij", defaultMarginPct: 40 },
  { value: "zakelijk", label: "Speciaalzaak", defaultMarginPct: 45 }
];

type ProductDefinition = {
  id: string;
  key: string;
  label: string;
  kind: "basis" | "samengesteld";
};

type ProductSnapshotRow = {
  bierKey: string;
  biernaam: string;
  kostprijsversieId: string;
  productId: string;
  productType: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  litersPerProduct: number;
  costPerPiece: number;
  sourcePackaging: string;
  derivedFromProductId?: string;
  derivedFromProductType?: "basis" | "samengesteld";
  derivedFromProductKey?: string;
  derivedFromPackaging?: string;
  derivedFromAantal?: number;
};

type LitersDisplayRow = {
  id: string;
  bierKey: string;
  biernaam: string;
  kostprijsversieId: string;
  included: boolean;
  productId?: string;
  productType?: "basis" | "samengesteld";
  productKey: string;
  verpakking: string;
  liters: number;
  kortingPct: number;
  kostprijsPerLiter: number;
  offerPrijs: number;
  sellInPrijs: number;
  sellInMargePct: number;
  offerByChannel: Record<string, number>;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
};

type ProductDisplayRow = {
  id: string;
  bierKey: string;
  biernaam: string;
  kostprijsversieId: string;
  included: boolean;
  productId: string;
  productType: "basis" | "samengesteld" | "catalog";
  productKey: string;
  verpakking: string;
  aantal: number;
  kortingPct: number;
  litersPerProduct: number;
  kostprijsPerStuk: number;
  offerPrijs: number;
  sellInPrijs: number;
  sellInMargePct: number;
  offerByChannel: Record<string, number>;
  omzet: number;
  kosten: number;
  kortingEur: number;
  margeEur: number;
  margePct: number;
};

const LITERS_BASIS_OPTIONS = [
  {
    value: "een_bier",
    label: "Een bier",
    description: "Gebruik de hoogste bekende kostprijs van een geselecteerd bier."
  },
  {
    value: "meerdere_bieren",
    label: "Meerdere bieren",
    description: "Vergelijk meerdere bieren naast elkaar op basis van literkostprijs."
  },
  {
    value: "hoogste_kostprijs",
    label: "Hoogste kostprijs algemeen",
    description: "Gebruik de hoogste bekende kostprijs van alle actieve kostprijsversies in dit jaar."
  }
];

const steps: StepDefinition[] = [
  {
    id: "basis",
    label: "Basisgegevens",
    description: "Vul de basisinformatie van het prijsvoorstel in."
  },
  {
    id: "producten",
    label: "Producten & aantallen",
    description: "Selecteer producten en vul aantallen (of liters) in."
  },
  {
    id: "offerte_maken",
    label: "Offerte maken",
    description: "Bouw de offerte op met scenario's en (optionele) prijsblokken."
  },
  {
    id: "vergelijken",
    label: "Vergelijken",
    description: "Vergelijk scenario's en controleer de uitkomst."
  }
];

const wizardSteps: StepDefinition[] = [
  ...steps,
  {
    id: "afronden",
    label: "Afronden",
    description: "Voeg een opmerking toe, vraag een concept-PDF op en rond het voorstel definitief af."
  }
];

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeStrategyKey(value: unknown) {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return "";
  }
  const pipeIndex = normalized.indexOf("|");
  return pipeIndex >= 0 ? normalized.slice(pipeIndex + 1) : normalized;
}

function getCompositeProductRef(productType: string, productId: string, productKey: string) {
  if (productId) {
    return `${productType}|${productId}`;
  }
  return "";
}

function getStoredProductRef(row: GenericRecord) {
  return getCompositeProductRef(
    String(row.product_type ?? ""),
    String(row.product_id ?? ""),
    ""
  );
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function getEnrichedInkoopFactuurregels(berekening: GenericRecord) {
  const inkoop = (((berekening.invoer as GenericRecord | undefined)?.inkoop as GenericRecord | undefined) ??
    {}) as GenericRecord;
  const topLevelFactuurregels = Array.isArray(inkoop.factuurregels)
    ? (inkoop.factuurregels as GenericRecord[])
    : [];
  const facturen = Array.isArray(inkoop.facturen) ? (inkoop.facturen as GenericRecord[]) : [];
  const factuurRegelsUitFacturen = facturen.flatMap((factuur) => {
    const regels = Array.isArray(factuur.factuurregels) ? (factuur.factuurregels as GenericRecord[]) : [];
    const extraPerRegel =
      regels.length > 0
        ? (toNumber(factuur.verzendkosten, 0) + toNumber(factuur.overige_kosten, 0)) / regels.length
        : 0;
    return regels.map((regel) => ({ regel, extraKostenPerRegel: extraPerRegel }));
  });

  if (factuurRegelsUitFacturen.length > 0) {
    return factuurRegelsUitFacturen;
  }

  const topLevelExtraPerRegel =
    topLevelFactuurregels.length > 0
      ? (toNumber(inkoop.verzendkosten, 0) + toNumber(inkoop.overige_kosten, 0)) /
        topLevelFactuurregels.length
      : 0;

  return topLevelFactuurregels.map((regel) => ({
    regel,
    extraKostenPerRegel: topLevelExtraPerRegel
  }));
}

function formatEuro(value: unknown) {
  return formatMoneyEUR(toFiniteNumber(value, 0));
}

function formatNumber(value: unknown, digits = 2) {
  if (digits === 2) {
    // Keep existing behaviour, but ensure consistent formatting with other tables.
    return formatNumber0to2(toFiniteNumber(value, 0));
  }
  return new Intl.NumberFormat("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    toFiniteNumber(value, 0)
  );
}

function formatPercentage(value: unknown) {
  // Keep one-decimal output as before, but use shared percent formatting rules.
  const rounded = Math.round(toFiniteNumber(value, 0) * 10) / 10;
  return formatPercent0to2(rounded);
}

function isIncluded(value: unknown) {
  return value !== false;
}

function getSnapshotPackagingLabel(row: GenericRecord) {
  return String(row.verpakking ?? row.verpakkingseenheid ?? row.omschrijving ?? "");
}

function getSnapshotProductCost(row: GenericRecord) {
  const explicitCost = Number(row.kostprijs ?? Number.NaN);
  if (Number.isFinite(explicitCost)) {
    return explicitCost;
  }

  return (
    toNumber(row.primaire_kosten ?? row.variabele_kosten, 0) +
    toNumber(row.verpakkingskosten, 0) +
    toNumber(row.vaste_kosten ?? row.vaste_directe_kosten, 0) +
    toNumber(row.accijns, 0)
  );
}

function pickLatestKnownProductRows(rows: GenericRecord[], targetYear: number) {
  const rowsWithYear = rows.filter((row) => {
    const yearValue = Number(row.jaar ?? 0);
    return Number.isFinite(yearValue) && yearValue > 0;
  });

  if (rowsWithYear.length === 0) {
    const byId = new Map<string, GenericRecord>();
    rows.forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    });
    return [...byId.values()];
  }

  const byId = new Map<string, GenericRecord>();

  [...rowsWithYear]
    .filter((row) => Number(row.jaar ?? 0) <= targetYear)
    .sort((left, right) => Number(right.jaar ?? 0) - Number(left.jaar ?? 0))
    .forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !byId.has(id)) {
        byId.set(id, row);
      }
    });

  if (byId.size > 0) {
    return [...byId.values()];
  }

  const fallback = new Map<string, GenericRecord>();
  [...rowsWithYear]
    .sort((left, right) => Number(right.jaar ?? 0) - Number(left.jaar ?? 0))
    .forEach((row) => {
      const id = String(row.id ?? "");
      if (id && !fallback.has(id)) {
        fallback.set(id, row);
      }
    });

  return [...fallback.values()];
}

// Pricing math is centralized in `lib/pricingEngine.ts`.

function toPeriodIndex(value: unknown, fallback: 1 | 2): 1 | 2 {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 ? numeric : fallback;
}

function ensureVariantPeriods(raw: unknown): QuoteVariantPeriod[] {
  const periods = Array.isArray(raw) ? (raw as GenericRecord[]) : [];
  const normalized = periods
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => ({
      id: String((row as any).id ?? createId()),
      period_index: toPeriodIndex((row as any).period_index, 1),
      label: String((row as any).label ?? ""),
      start_date: String((row as any).start_date ?? ""),
      end_date: String((row as any).end_date ?? "")
    }))
    .filter((row) => row.period_index === 1 || row.period_index === 2);

  const byIndex = new Map<1 | 2, QuoteVariantPeriod>();
  normalized.forEach((row) => {
    if (!byIndex.has(row.period_index)) {
      byIndex.set(row.period_index, row);
    }
  });

  const p1 = byIndex.get(1) ?? { id: createId(), period_index: 1, label: "Introductie", start_date: "", end_date: "" };
  const p2 = byIndex.get(2) ?? { id: createId(), period_index: 2, label: "Standaard", start_date: "", end_date: "" };
  return [p1, p2];
}

function getBuilderBlocksByVariant(quote: GenericRecord): Record<string, QuoteBuilderBlock[]> {
  const raw = (quote as any).builder_blocks_by_variant;
  if (typeof raw !== "object" || raw === null) return {};
  return raw as Record<string, QuoteBuilderBlock[]>;
}

function getVariantBlocks(quote: GenericRecord, variantId: string): QuoteBuilderBlock[] {
  const blocks = getBuilderBlocksByVariant(quote)[String(variantId)] ?? [];
  return Array.isArray(blocks) ? (blocks as QuoteBuilderBlock[]) : [];
}

function hasIntroBlock(quote: GenericRecord, variantId: string) {
  return getVariantBlocks(quote, variantId).some((block) => String((block as any).type) === "intro");
}

function hasStaffelBlock(quote: GenericRecord, variantId: string) {
  return getVariantBlocks(quote, variantId).some((block) => String((block as any).type) === "staffel");
}

function hasXyGratisBlock(quote: GenericRecord, variantId: string) {
  return getVariantBlocks(quote, variantId).some((block) => String((block as any).type) === "xy_gratis");
}

function hasTransportBlock(quote: GenericRecord, variantId: string) {
  return getVariantBlocks(quote, variantId).some((block) => String((block as any).type) === "transport");
}

function hasExtrasBlock(quote: GenericRecord, variantId: string) {
  return getVariantBlocks(quote, variantId).some((block) => String((block as any).type) === "extras");
}

function isBlockActiveForPeriod(block: QuoteBuilderBlock, periodIndex: 1 | 2) {
  const applies = String((block as any).applies_to_periods ?? "both");
  if (applies === "both") return true;
  if (applies === "intro") return periodIndex === 1;
  if (applies === "standard") return periodIndex === 2;
  return true;
}

function getStaffelTiers(raw: unknown): Array<{ id: string; product_id: string; product_type: string; liters: number; korting_pct: number }> {
  const list = Array.isArray(raw) ? (raw as GenericRecord[]) : [];
  return list
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => ({
      id: String((row as any).id ?? createId()),
      product_id: String((row as any).product_id ?? ""),
      product_type: String((row as any).product_type ?? ""),
      liters: toNumber((row as any).liters, 0),
      korting_pct: toNumber((row as any).korting_pct, 0)
    }))
    .filter((row) => row.liters > 0 && row.korting_pct > 0);
}

function computeStaffelKortingByProductRef({
  rows,
  tiers
}: {
  rows: Array<{ included: boolean; productType: string; productId: string; aantal?: number; liters?: number; litersPerProduct?: number }>;
  tiers: Array<{ product_id: string; product_type: string; liters: number; korting_pct: number }>;
}) {
  const tiersList = Array.isArray(tiers) ? tiers : [];
  if (tiersList.length === 0) return new Map<string, number>();

  const totalsByRef = new Map<string, number>();
  for (const row of rows) {
    if (!row.included) continue;
    if (row.productType === "catalog") continue;
    const productId = String(row.productId ?? "");
    const productType = String(row.productType ?? "");
    if (!productId || !productType) continue;
    const liters =
      typeof row.liters === "number" && Number.isFinite(row.liters)
        ? Math.max(0, row.liters)
        : Math.max(0, toFiniteNumber(row.aantal, 0)) * Math.max(0, toFiniteNumber(row.litersPerProduct, 0));
    if (liters <= 0) continue;
    const ref = `${productType}|${productId}`;
    totalsByRef.set(ref, (totalsByRef.get(ref) ?? 0) + liters);
  }

  const kortingByRef = new Map<string, number>();
  for (const [ref, liters] of totalsByRef.entries()) {
    const [productType, productId] = ref.split("|");
    let best = 0;
    for (const tier of tiersList) {
      const matches =
        (!tier.product_id && !tier.product_type) ||
        (String(tier.product_id) === String(productId) && String(tier.product_type) === String(productType));
      if (!matches) continue;
      if (liters >= toFiniteNumber(tier.liters, 0)) {
        best = Math.max(best, toFiniteNumber(tier.korting_pct, 0));
      }
    }
    kortingByRef.set(ref, best);
  }

  return kortingByRef;
}

function computeGratisUnitsByProductRef({
  rows,
  requiredQty,
  freeQty,
  eligibleRefs
}: {
  rows: Array<{ included: boolean; productType: string; productId: string; aantal: number; offerPrijs: number }>;
  requiredQty: number;
  freeQty: number;
  eligibleRefs: string[];
}) {
  const mapped = rows
    .filter((row) => row.productType !== "catalog")
    .map((row) => ({
      included: row.included,
      ref: `${row.productType}|${row.productId}`,
      qtyPaid: row.aantal,
      unitPriceEx: row.offerPrijs
    }));
  const result = computeGratisFreeByRefFromPaidRows({
    rows: mapped,
    requiredQty,
    freeQty,
    eligibleRefs
  });
  return { freeByRef: result.freeByRef, totalFree: result.totalFree };
}

function normalizeVariantLineRows(raw: unknown): QuoteLineRow[] {
  const rows = Array.isArray(raw) ? (raw as GenericRecord[]) : [];
  return rows
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => {
      const kortingPct = toNumber((row as any).korting_pct, 0);
      return {
        ...row,
        id: String((row as any).id ?? createId()),
        kostprijsversie_id: String((row as any).kostprijsversie_id ?? ""),
        included: isIncluded((row as any).included),
        cost_at_quote: toNumber((row as any).cost_at_quote, 0),
        sales_price_at_quote: toNumber((row as any).sales_price_at_quote, 0),
        revenue_at_quote: toNumber((row as any).revenue_at_quote, 0),
        margin_at_quote: toNumber((row as any).margin_at_quote, 0),
        target_margin_pct_at_quote: toNumber((row as any).target_margin_pct_at_quote, 0),
        channel_at_quote: String((row as any).channel_at_quote ?? ""),
        verpakking_label: String((row as any).verpakking_label ?? ""),
        // Base korting_pct is the active-period view; period fields hold the truth.
        korting_pct: kortingPct,
        korting_pct_p1: toNumber((row as any).korting_pct_p1, kortingPct),
        korting_pct_p2: toNumber((row as any).korting_pct_p2, kortingPct),
        sell_in_price_override_p1: toNumber((row as any).sell_in_price_override_p1, 0),
        sell_in_price_override_p2: toNumber((row as any).sell_in_price_override_p2, 0)
      } as QuoteLineRow;
    });
}

function normalizeQuoteVariant(raw: GenericRecord, fallbackChannel: string): QuoteVariant {
  return {
    id: String(raw.id ?? createId()),
    name: String(raw.name ?? "Scenario"),
    channel_code: normalizeKey(raw.channel_code) || fallbackChannel,
    return_pct: toNumber(raw.return_pct, 0),
    sort_index: Number(raw.sort_index ?? 0) || 0,
    // Periods are optional; they become relevant only when an Intro block exists.
    periods: Array.isArray((raw as any).periods) ? ensureVariantPeriods((raw as any).periods) : [],
    product_rows: normalizeVariantLineRows(raw.product_rows),
    beer_rows: normalizeVariantLineRows(raw.beer_rows),
    staffels: Array.isArray(raw.staffels) ? (raw.staffels as GenericRecord[]) : []
  };
}

function buildDefaultVariantFromLegacy(quote: GenericRecord, pricingChannel: string): QuoteVariant {
  const quoteId = String(quote.id ?? createId());
  const variantId = `${quoteId}:v1`;
  return {
    id: variantId,
    name: "Scenario A",
    channel_code: pricingChannel,
    return_pct: 0,
    sort_index: 0,
    periods: [],
    product_rows: normalizeVariantLineRows(quote.product_rows),
    beer_rows: normalizeVariantLineRows(quote.beer_rows),
    staffels: Array.isArray(quote.staffels) ? (quote.staffels as GenericRecord[]) : []
  };
}

function applyVariantPeriodToWorkingRows<T extends GenericRecord>(rows: T[], periodIndex: 1 | 2): T[] {
  return rows.map((row) => {
    const p1 = toNumber((row as any).korting_pct_p1, toNumber((row as any).korting_pct, 0));
    const p2 = toNumber((row as any).korting_pct_p2, toNumber((row as any).korting_pct, 0));
    const nextKorting = periodIndex === 1 ? p1 : p2;
    return { ...row, korting_pct: nextKorting } as T;
  }) as T[];
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizePrijsvoorstel(raw: GenericRecord): GenericRecord {
  const normalizeProductRows: QuoteLineRow[] = Array.isArray(raw.product_rows)
    ? (raw.product_rows as GenericRecord[]).map((row) => ({
        ...row,
        kostprijsversie_id: String(row.kostprijsversie_id ?? ""),
        included: isIncluded(row.included),
        cost_at_quote: toNumber(row.cost_at_quote, 0),
        sales_price_at_quote: toNumber(row.sales_price_at_quote, 0),
        revenue_at_quote: toNumber(row.revenue_at_quote, 0),
        margin_at_quote: toNumber(row.margin_at_quote, 0),
        target_margin_pct_at_quote: toNumber(row.target_margin_pct_at_quote, 0),
        channel_at_quote: String(row.channel_at_quote ?? ""),
        verpakking_label: String(row.verpakking_label ?? "")
      })) as QuoteLineRow[]
    : [];
  const normalizeBeerRows: QuoteLineRow[] = Array.isArray(raw.beer_rows)
    ? (raw.beer_rows as GenericRecord[]).map((row) => ({
        ...row,
        kostprijsversie_id: String(row.kostprijsversie_id ?? ""),
        included: isIncluded(row.included),
        cost_at_quote: toNumber(row.cost_at_quote, 0),
        sales_price_at_quote: toNumber(row.sales_price_at_quote, 0),
        revenue_at_quote: toNumber(row.revenue_at_quote, 0),
        margin_at_quote: toNumber(row.margin_at_quote, 0),
        target_margin_pct_at_quote: toNumber(row.target_margin_pct_at_quote, 0),
        channel_at_quote: String(row.channel_at_quote ?? ""),
        verpakking_label: String(row.verpakking_label ?? "")
      })) as QuoteLineRow[]
    : [];

  const nowYear = new Date().getFullYear();
  const rawYear = toNumber(raw.jaar, 0);
  const jaar = rawYear > 0 ? rawYear : nowYear;
  const kanaal = normalizeKey(raw.kanaal) || "horeca";
  const pricingChannel = normalizeKey(raw.pricing_channel) || kanaal;

  const base = {
    ...cloneRecord(raw),
    schema_version: toNumber((raw as any).schema_version, 1),
    id: String(raw.id ?? createId()),
    offertenummer: String(raw.offertenummer ?? ""),
    status: String(raw.status ?? "concept"),
    klantnaam: String(raw.klantnaam ?? ""),
    contactpersoon: String(raw.contactpersoon ?? ""),
    referentie: String(raw.referentie ?? ""),
    datum_text: String(raw.datum_text ?? ""),
    verloopt_op: String(raw.verloopt_op ?? ""),
    opmerking: String(raw.opmerking ?? ""),
    jaar,
    voorsteltype: String(raw.voorsteltype ?? "Op basis van producten"),
    offer_level: String(raw.offer_level ?? "samengesteld"),
    liters_basis: String(raw.liters_basis ?? "een_bier"),
    kanaal,
    pricing_channel: pricingChannel,
    selected_kanalen: Array.isArray(raw.selected_kanalen)
      ? raw.selected_kanalen.map((value) => normalizeKey(value)).filter(Boolean)
      : [],
    reference_channels: Array.isArray(raw.reference_channels)
      ? raw.reference_channels.map((value) => normalizeKey(value)).filter(Boolean)
      : [],
    bier_id: String(raw.bier_id ?? ""),
    selected_bier_ids: Array.isArray(raw.selected_bier_ids)
      ? raw.selected_bier_ids.map((value) => String(value ?? ""))
      : [],
    selected_catalog_product_ids: Array.isArray(raw.selected_catalog_product_ids)
      ? raw.selected_catalog_product_ids.map((value) => String(value ?? "")).filter(Boolean)
      : [],
    kostprijsversie_ids: Array.isArray(raw.kostprijsversie_ids)
      ? raw.kostprijsversie_ids.map((value) => String(value ?? "")).filter(Boolean)
      : [],
    deleted_product_refs: Array.isArray(raw.deleted_product_refs) ? raw.deleted_product_refs : [],
    staffels: Array.isArray(raw.staffels) ? raw.staffels : [],
    product_rows: normalizeProductRows,
    beer_rows: normalizeBeerRows,
    catalog_product_rows: Array.isArray(raw.catalog_product_rows) ? raw.catalog_product_rows : [],
    builder_context: {
      postcode: String(((raw as any).builder_context as QuoteBuilderContext | undefined)?.postcode ?? ""),
      distance_km: toNumber(((raw as any).builder_context as QuoteBuilderContext | undefined)?.distance_km ?? 0, 0),
      transport_threshold_ex: toNumber(
        ((raw as any).builder_context as QuoteBuilderContext | undefined)?.transport_threshold_ex ?? 0,
        0
      ),
      transport_km_threshold: toNumber(
        ((raw as any).builder_context as QuoteBuilderContext | undefined)?.transport_km_threshold ?? 40,
        40
      ),
      transport_rate_ex: toNumber(
        ((raw as any).builder_context as QuoteBuilderContext | undefined)?.transport_rate_ex ?? 0,
        0
      ),
      transport_deliveries: Math.max(
        0,
        Math.floor(
          toNumber(((raw as any).builder_context as QuoteBuilderContext | undefined)?.transport_deliveries ?? 1, 1)
        )
      )
    } satisfies QuoteBuilderContext,
    builder_blocks_by_variant:
      typeof (raw as any).builder_blocks_by_variant === "object" && (raw as any).builder_blocks_by_variant !== null
        ? (raw as any).builder_blocks_by_variant
        : {},
    variants: Array.isArray((raw as any).variants)
      ? ((raw as any).variants as GenericRecord[])
          .filter((row) => typeof row === "object" && row !== null)
          .map((row) => normalizeQuoteVariant(row, pricingChannel))
      : [],
    active_variant_id: String((raw as any).active_variant_id ?? ""),
    active_period_index: toPeriodIndex((raw as any).active_period_index, 2),
    last_step: Number(raw.last_step ?? 1),
    finalized_at: String(raw.finalized_at ?? "")
  };

  // Ensure at least one scenario exists; if not present, derive one from legacy rows.
  const variants = (base as any).variants as QuoteVariant[];
  if (variants.length === 0) {
    variants.push(buildDefaultVariantFromLegacy(base, pricingChannel));
  }

  const activeVariantId = String((base as any).active_variant_id ?? "").trim() || String(variants[0]?.id ?? "");
  (base as any).active_variant_id = activeVariantId;
  // Periods are only enabled when an Intro block exists for the active scenario.
  // Without Intro we keep the model in "simple" mode and force period index = 2 (standard).
  const introEnabled = hasIntroBlock(base as any, activeVariantId);
  if (!introEnabled) {
    (base as any).active_period_index = 2;
    variants.forEach((variant) => {
      const vid = String(variant.id ?? "");
      variant.periods = hasIntroBlock(base as any, vid) ? ensureVariantPeriods(variant.periods) : [];
    });
  } else {
    variants.forEach((variant) => {
      const vid = String(variant.id ?? "");
      variant.periods = hasIntroBlock(base as any, vid) ? ensureVariantPeriods(variant.periods) : [];
    });
  }

  // Materialize the active scenario into the legacy working rows (so existing wizard logic stays intact).
  const activePeriod = toPeriodIndex((base as any).active_period_index, 2);
  const activeVariant = variants.find((row) => String(row.id) === activeVariantId) ?? variants[0];
  if (activeVariant) {
    base.product_rows = applyVariantPeriodToWorkingRows(activeVariant.product_rows, activePeriod);
    base.beer_rows = applyVariantPeriodToWorkingRows(activeVariant.beer_rows, activePeriod);
    base.staffels = Array.isArray(activeVariant.staffels) ? activeVariant.staffels : [];
  }

  (base as any).variants = variants;
  return base;
}

function createEmptyPrijsvoorstel(defaultYear?: number): GenericRecord {
  const fallbackYear = Number.isFinite(Number(defaultYear)) && Number(defaultYear) > 0
    ? Number(defaultYear)
    : new Date().getFullYear();
  return normalizePrijsvoorstel({
    schema_version: 2,
    id: createId(),
    offertenummer: "",
    status: "concept",
    klantnaam: "",
    contactpersoon: "",
    referentie: "",
    datum_text: "",
    verloopt_op: "",
    opmerking: "",
    jaar: fallbackYear,
    voorsteltype: "Op basis van producten",
    offer_level: "samengesteld",
    liters_basis: "een_bier",
    kanaal: "horeca",
    pricing_channel: "horeca",
    selected_kanalen: [],
    reference_channels: [],
    bier_id: "",
    selected_bier_ids: [],
    selected_catalog_product_ids: [],
    kostprijsversie_ids: [],
    deleted_product_refs: [],
    staffels: [],
    product_rows: [],
    beer_rows: [],
    catalog_product_rows: [],
    builder_context: {
      postcode: "",
      distance_km: 0,
      transport_threshold_ex: 0,
      transport_km_threshold: 40,
      transport_rate_ex: 0,
      transport_deliveries: 1
    },
    builder_blocks_by_variant: {},
    last_step: 1,
    finalized_at: ""
  });
}

function getDateInputValue(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function addDays(dateText: string, days: number) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function PrijsvoorstelWizard({
  initialRows,
  yearOptions,
  bieren,
  berekeningen,
  verkoopprijzen,
  channels,
  kostprijsproductactiveringen,
  catalogusproducten,
  verpakkingsonderdelen,
  verpakkingsonderdeelPrijzen,
  basisproducten,
  samengesteldeProducten,
  initialSelectedId,
  startWithNew = false,
  onBackToLanding,
  onRowsChange,
  onFinish
}: PrijsvoorstelWizardProps) {
  const defaultYearOption = useMemo(() => {
    const years = Array.isArray(yearOptions) ? yearOptions : [];
    const parsed = years
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    return parsed.length ? Math.max(...parsed) : new Date().getFullYear();
  }, [yearOptions]);

  const emptyPrijsvoorstel = useMemo(() => createEmptyPrijsvoorstel(defaultYearOption), [defaultYearOption]);

  const initialState = useMemo(() => {
    const normalizedRows = initialRows.map((row) => normalizePrijsvoorstel(row));

    if (startWithNew || normalizedRows.length === 0) {
      const next = createEmptyPrijsvoorstel(defaultYearOption);
      return {
        rows: [next, ...normalizedRows],
        selectedId: String(next.id)
      };
    }

    const matchedRow = initialSelectedId
      ? normalizedRows.find((row) => String(row.id) === String(initialSelectedId))
      : normalizedRows[0];

    return {
      rows: normalizedRows,
      selectedId: String(matchedRow?.id ?? normalizedRows[0]?.id ?? emptyPrijsvoorstel.id)
    };
  }, [defaultYearOption, emptyPrijsvoorstel.id, initialRows, initialSelectedId, startWithNew]);

  const [rows, setRows] = useState<GenericRecord[]>(initialState.rows);
  const [selectedId, setSelectedId] = useState<string>(initialState.selectedId);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountDraftPct, setDiscountDraftPct] = useState(0);
  const [discountDraftApplies, setDiscountDraftApplies] =
    useState<QuoteBuilderBlock["applies_to_periods"]>("both");
  const [introModalOpen, setIntroModalOpen] = useState(false);
  const [introDraftStart, setIntroDraftStart] = useState("");
  const [introDraftEnd, setIntroDraftEnd] = useState("");
  const [staffelModalOpen, setStaffelModalOpen] = useState(false);
  const [staffelDraftTiers, setStaffelDraftTiers] = useState<
    Array<{ id: string; product_id: string; product_type: string; liters: number; korting_pct: number }>
  >([]);
  const [xyGratisModalOpen, setXyGratisModalOpen] = useState(false);
  const [xyDraftRequired, setXyDraftRequired] = useState(4);
  const [xyDraftFree, setXyDraftFree] = useState(1);
  const [xyDraftApplies, setXyDraftApplies] =
    useState<NonNullable<QuoteBuilderBlock["applies_to_periods"]>>("both");
  const [xyDraftEligibleRefs, setXyDraftEligibleRefs] = useState<string[]>([]);
  const [transportModalOpen, setTransportModalOpen] = useState(false);
  const [transportDraftApplies, setTransportDraftApplies] =
    useState<NonNullable<QuoteBuilderBlock["applies_to_periods"]>>("both");
  const [transportDraftPostcode, setTransportDraftPostcode] = useState("");
  const [transportDraftDistanceKm, setTransportDraftDistanceKm] = useState(0);
  const [transportDraftKmThreshold, setTransportDraftKmThreshold] = useState(40);
  const [transportDraftThresholdEx, setTransportDraftThresholdEx] = useState(0);
  const [transportDraftDeliveries, setTransportDraftDeliveries] = useState(1);
  const [transportDraftRateEx, setTransportDraftRateEx] = useState(0);
  const [extrasModalOpen, setExtrasModalOpen] = useState(false);
  const [extrasDraftApplies, setExtrasDraftApplies] =
    useState<NonNullable<QuoteBuilderBlock["applies_to_periods"]>>("both");
  const [extrasDraftRows, setExtrasDraftRows] = useState<
    Array<{
      id: string;
      label: string;
      qty: number;
      unitPriceEx: number;
      unitCostEx: number;
      isFree: boolean;
      thresholdAmountEx: number;
    }>
  >([]);

  const effectiveSelectedId = useMemo(() => {
    if (rows.some((row) => String(row.id) === String(selectedId))) {
      return String(selectedId);
    }
    return String(rows[0]?.id ?? "");
  }, [rows, selectedId]);

  useEffect(() => {
    if (effectiveSelectedId && effectiveSelectedId !== String(selectedId)) {
      setSelectedId(effectiveSelectedId);
    }
  }, [effectiveSelectedId, selectedId]);

  const current =
    rows.find((row) => String(row.id) === effectiveSelectedId) ?? rows[0] ?? emptyPrijsvoorstel;
  const isEditingExisting = !startWithNew;
  const channelOptions = useMemo<ChannelOption[]>(
    () => {
      const byCode = new Map(DEFAULT_CHANNEL_OPTIONS.map((option) => [option.value, option]));
      (Array.isArray(channels) ? channels : []).forEach((row) => {
        const value = String(row.code ?? row.id ?? "").trim().toLowerCase();
        if (!value || value === "particulier") return;
        byCode.set(value, {
          value,
          label: String(row.naam ?? row.code ?? "").trim() || value,
          defaultMarginPct: toNumber(row.default_marge_pct, byCode.get(value)?.defaultMarginPct ?? 50)
        });
      });
      return [...byCode.values()].sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
    },
    [channels]
  );
  const defaultKanaal = channelOptions[0]?.value ?? "horeca";
  const currentStep = wizardSteps[activeStepIndex] ?? wizardSteps[0];
  // Step 4 (Year as context): for pricing we always use the active year-set.
  // A "jaar" selector here is a pseudo-choice; historical selection can be reintroduced later as an advanced mode.
  const currentYear = defaultYearOption;
  const pricingChannel = normalizeKey(current.pricing_channel) || normalizeKey(current.kanaal) || defaultKanaal;
  const legacySelectedKanaalValues = Array.from(
    new Set(
      (Array.isArray(current.selected_kanalen) ? (current.selected_kanalen as string[]) : [])
        .map((value) => normalizeKey(value))
        .filter(Boolean)
    )
  );
  const effectiveSelectedKanaalValues =
    legacySelectedKanaalValues.length > 0 ? legacySelectedKanaalValues : [pricingChannel || defaultKanaal];
  const currentKanaal = effectiveSelectedKanaalValues[0] ?? defaultKanaal;
  const isMultiKanaalMode = effectiveSelectedKanaalValues.length > 1;
  const isLitersMode = String(current.voorsteltype ?? "") === "Op basis van liters";
  const offerLevel = String(current.offer_level ?? "samengesteld");
  const litersBasis = String(current.liters_basis ?? "een_bier");
  const variants = useMemo(() => {
    const raw = (current as any).variants;
    return Array.isArray(raw) ? (raw as QuoteVariant[]) : [];
  }, [current]);
  const activeVariantId = String((current as any).active_variant_id ?? "").trim() || String(variants[0]?.id ?? "");
  const activePeriodIndex = toPeriodIndex((current as any).active_period_index, 2);
  const activeVariant = useMemo(() => {
    return variants.find((row) => String(row.id) === activeVariantId) ?? variants[0] ?? null;
  }, [activeVariantId, variants]);
  const activePeriod = useMemo(() => {
    if (!activeVariant) return null;
    const periods = Array.isArray(activeVariant.periods) ? activeVariant.periods : [];
    const match = periods.find((row) => row.period_index === activePeriodIndex);
    return match ?? periods[activePeriodIndex === 1 ? 0 : 1] ?? null;
  }, [activePeriodIndex, activeVariant]);

  const bierNameMap = useMemo(() => {
    const fromMaster = new Map<string, string>();
    for (const bier of bieren) {
      fromMaster.set(String(bier.id ?? ""), String(bier.biernaam ?? ""));
    }
    for (const berekening of berekeningen) {
      const bierId = String(berekening.bier_id ?? "");
      const biernaam = String((berekening.basisgegevens as GenericRecord | undefined)?.biernaam ?? "");
      if (bierId && biernaam && !fromMaster.has(bierId)) {
        fromMaster.set(bierId, biernaam);
      }
    }
    return fromMaster;
  }, [bieren, berekeningen]);

  const channelOptionMap = useMemo(
    () => new Map(channelOptions.map((option) => [option.value, option])),
    [channelOptions]
  );
  const selectedChannelOptions = useMemo(
    () => effectiveSelectedKanaalValues.map((value) => channelOptionMap.get(value)).filter((value): value is ChannelOption => Boolean(value)),
    [channelOptionMap, effectiveSelectedKanaalValues]
  );

  const productDefinitionMap = useMemo(() => {
    const map = new Map<string, ProductDefinition>();
    for (const row of pickLatestKnownProductRows(basisproducten, currentYear)) {
      const id = String(row.id ?? "");
      const key = `basis|${normalizeKey(row.omschrijving)}`;
      const definition = {
        id,
        key,
        label: String(row.omschrijving ?? ""),
        kind: "basis"
      } satisfies ProductDefinition;
      if (id) {
        map.set(`id|${id}`, definition);
      }
      map.set(key, definition);
    }
    for (const row of pickLatestKnownProductRows(samengesteldeProducten, currentYear)) {
      const id = String(row.id ?? "");
      const key = `samengesteld|${normalizeKey(row.omschrijving)}`;
      const definition = {
        id,
        key,
        label: String(row.omschrijving ?? ""),
        kind: "samengesteld"
      } satisfies ProductDefinition;
      if (id) {
        map.set(`id|${id}`, definition);
      }
      map.set(key, definition);
    }
    return map;
  }, [basisproducten, samengesteldeProducten, currentYear]);

  const definitieveKostprijsversies = useMemo(
    () => berekeningen.filter((record) => normalizeKey(record.status) === "definitief"),
    [berekeningen]
  );

  const definitieveKostprijsversiesCurrentYear = useMemo(
    () =>
      definitieveKostprijsversies.filter((record) => {
        const jaar = Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? 0);
        return jaar === currentYear;
      }),
    [definitieveKostprijsversies, currentYear]
  );

  const kostprijsproductActiveringenCurrentYear = useMemo(
    () =>
      (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : []).filter((row) => {
        const jaar = Number(row.jaar ?? 0);
        return jaar === currentYear;
      }),
    [kostprijsproductactiveringen, currentYear]
  );

  const actieveKostprijsversieIdsCurrentYear = useMemo(() => {
    const ids = new Set<string>();
    for (const row of kostprijsproductActiveringenCurrentYear) {
      const id = String(row.kostprijsversie_id ?? "");
      if (id) {
        ids.add(id);
      }
    }
    if (ids.size === 0) {
      for (const record of definitieveKostprijsversiesCurrentYear) {
        if (Boolean(record.is_actief)) {
          ids.add(String(record.id ?? ""));
        }
      }
    }
    if (ids.size === 0) {
      const latestByBeer = new Map<string, GenericRecord>();
      for (const record of [...definitieveKostprijsversiesCurrentYear].sort((left, right) =>
        String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
          String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
        )
      )) {
        const bierId = String(record.bier_id ?? "");
        if (!bierId || latestByBeer.has(bierId)) {
          continue;
        }
        latestByBeer.set(bierId, record);
      }
      for (const record of latestByBeer.values()) {
        ids.add(String(record.id ?? ""));
      }
    }
    return ids;
  }, [kostprijsproductActiveringenCurrentYear, definitieveKostprijsversiesCurrentYear]);

  const actieveKostprijsversiesCurrentYear = useMemo(
    () =>
      definitieveKostprijsversiesCurrentYear.filter((record) =>
        actieveKostprijsversieIdsCurrentYear.has(String(record.id ?? ""))
      ),
    [actieveKostprijsversieIdsCurrentYear, definitieveKostprijsversiesCurrentYear]
  );

  const bierOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const options = actieveKostprijsversiesCurrentYear
      .map((record) => {
        const bierKey = String(record.bier_id ?? "");
        if (!bierKey || seen.has(bierKey)) {
          return null;
        }
        seen.add(bierKey);
        const biernaam =
          normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
          bierNameMap.get(bierKey) ||
          bierKey;
        return { value: bierKey, label: biernaam };
      })
      .filter((value): value is SelectOption => value !== null)
      .sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));

    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const currentBeerId = String(current.bier_id ?? "");
    for (const bierId of [currentBeerId, ...selectedBeerIds]) {
      if (!bierId || seen.has(bierId)) {
        continue;
      }
      options.push({
        value: bierId,
        label: bierNameMap.get(bierId) || bierId
      });
      seen.add(bierId);
    }

    return options.sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
  }, [actieveKostprijsversiesCurrentYear, bierNameMap, current.bier_id, current.selected_bier_ids]);

  const catalogProductOptionMap = useMemo(() => {
    const map = new Map<string, { id: string; naam: string; actief: boolean; bom_lines: GenericRecord[] }>();
    for (const raw of Array.isArray(catalogusproducten) ? catalogusproducten : []) {
      if (!raw || typeof raw !== "object") continue;
      const id = String((raw as any).id ?? "");
      if (!id) continue;
      const naam = String((raw as any).naam ?? (raw as any).name ?? "").trim();
      const actief = Boolean((raw as any).actief ?? (raw as any).active ?? true);
      const bom_lines = Array.isArray((raw as any).bom_lines) ? ((raw as any).bom_lines as GenericRecord[]) : [];
      map.set(id, { id, naam, actief, bom_lines });
    }
    return map;
  }, [catalogusproducten]);

  const catalogProductOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [];
    for (const row of catalogProductOptionMap.values()) {
      if (!row.actief) continue;
      if (!row.naam) continue;
      options.push({ value: row.id, label: row.naam });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  }, [catalogProductOptionMap]);

  const packagingPriceById = useMemo(() => {
    const map = new Map<string, number>();
    const prices = Array.isArray(verpakkingsonderdeelPrijzen) ? verpakkingsonderdeelPrijzen : [];
    for (const raw of prices) {
      if (!raw || typeof raw !== "object") continue;
      const jaar = toNumber((raw as any).jaar ?? 0, 0);
      if (jaar !== currentYear) continue;
      const id = String((raw as any).verpakkingsonderdeel_id ?? (raw as any).packaging_component_id ?? "");
      if (!id) continue;
      const prijs = toNumber((raw as any).prijs_per_stuk ?? (raw as any).price_per_piece ?? 0, 0);
      map.set(id, prijs);
    }
    return map;
  }, [verpakkingsonderdeelPrijzen, currentYear]);

  const activeBeerCostByKey = useMemo(() => {
    const beerIds = new Set<string>();
    for (const row of kostprijsproductActiveringenCurrentYear) {
      const bierId = String((row as any).bier_id ?? "");
      if (bierId) beerIds.add(bierId);
    }
    const map = new Map<string, number>();
    for (const bierId of beerIds) {
      for (const snapshotRow of getSnapshotProductRowsForBier(bierId)) {
        map.set(`${bierId}|${snapshotRow.productType}|${snapshotRow.productId}`, snapshotRow.costPerPiece);
      }
    }
    return map;
  }, [
    kostprijsproductActiveringenCurrentYear,
    actieveKostprijsversiesCurrentYear,
    definitieveKostprijsversiesCurrentYear,
    currentYear,
    bierNameMap,
    productDefinitionMap
  ]);

  const catalogProductCostById = useMemo(() => {
    const out = new Map<string, number>();

    for (const product of catalogProductOptionMap.values()) {
      if (!product.actief) continue;
      let total = 0;
      for (const line of product.bom_lines) {
        if (!line || typeof line !== "object") continue;
        const lineKind = String((line as any).line_kind ?? (line as any).type ?? "").trim().toLowerCase();
        const qty = toNumber((line as any).quantity ?? (line as any).aantal ?? 0, 0);
        if (qty <= 0) continue;

        let unitCost = 0;
        if (lineKind === "beer") {
          const bierId = String((line as any).bier_id ?? "");
          const productId = String((line as any).product_id ?? "");
          const productType = String((line as any).product_type ?? "basis").trim().toLowerCase();
          unitCost = activeBeerCostByKey.get(`${bierId}|${productType}|${productId}`) ?? 0;
        } else if (lineKind === "packaging_component") {
          const pcId = String((line as any).packaging_component_id ?? (line as any).verpakkingsonderdeel_id ?? "");
          unitCost = packagingPriceById.get(pcId) ?? 0;
        } else if (lineKind === "labor" || lineKind === "other") {
          unitCost = toNumber((line as any).unit_cost_ex ?? 0, 0);
        }

        total += qty * unitCost;
      }
      out.set(product.id, total);
    }

    return out;
  }, [activeBeerCostByKey, catalogProductOptionMap, packagingPriceById]);

  const verkoopstrategieWindow = useMemo(
    () => verkoopprijzen.filter((row) => Number(row.jaar ?? 0) <= currentYear),
    [verkoopprijzen, currentYear]
  );

  function getKostprijsversieById(kostprijsversieId: string) {
    return berekeningen.find((record) => String(record.id ?? "") === String(kostprijsversieId ?? ""));
  }

  function getActiveProductActivation(bierId: string, productId: string) {
    const matches = kostprijsproductActiveringenCurrentYear.filter(
      (row) =>
        String(row.bier_id ?? "") === String(bierId ?? "") &&
        String(row.product_id ?? "") === String(productId ?? "")
    );
    if (matches.length === 0) {
      return null;
    }
    return [...matches].sort((left, right) =>
      String(right.effectief_vanaf ?? right.updated_at ?? "").localeCompare(
        String(left.effectief_vanaf ?? left.updated_at ?? "")
      )
    )[0];
  }

  function getActiveKostprijsversieForBier(bierId: string) {
    const activationVersionIds = kostprijsproductActiveringenCurrentYear
      .filter((row) => String(row.bier_id ?? "") === bierId)
      .map((row) => String(row.kostprijsversie_id ?? ""))
      .filter(Boolean);
    if (activationVersionIds.length > 0) {
      const activationSet = new Set(activationVersionIds);
      return definitieveKostprijsversies
        .filter((record) => activationSet.has(String(record.id ?? "")))
        .sort((left, right) =>
          String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
            String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
          )
        )[0];
    }
    return actieveKostprijsversiesCurrentYear
      .filter((record) => String(record.bier_id ?? "") === bierId)
      .sort((left, right) =>
        String(right.effectief_vanaf ?? right.finalized_at ?? right.updated_at ?? "").localeCompare(
          String(left.effectief_vanaf ?? left.finalized_at ?? left.updated_at ?? "")
        )
      )[0];
  }

  function getEffectiveKostprijsversieForBier(bierId: string, kostprijsversieId?: string) {
    if (kostprijsversieId) {
      const fixed = getKostprijsversieById(kostprijsversieId);
      if (fixed) {
        return fixed;
      }
    }
    return getActiveKostprijsversieForBier(bierId);
  }

  function getEffectiveKostprijsversieForProduct(
    bierId: string,
    productId: string,
    fallbackKostprijsversieId?: string
  ) {
    if (fallbackKostprijsversieId) {
      const fixed = getKostprijsversieById(fallbackKostprijsversieId);
      if (fixed) {
        return fixed;
      }
    }
    const activation = getActiveProductActivation(bierId, productId);
    if (activation) {
      const activeVersion = getKostprijsversieById(String(activation.kostprijsversie_id ?? ""));
      if (activeVersion) {
        return activeVersion;
      }
    }
    return getActiveKostprijsversieForBier(bierId);
  }

  function getBerekeningTypeForBier(bierId: string) {
    const berekening = getActiveKostprijsversieForBier(bierId);
    return normalizeKey((berekening?.soort_berekening as GenericRecord | undefined)?.type);
  }

  function sortLatestStrategy(left: GenericRecord, right: GenericRecord) {
    const yearDiff = Number(right.jaar ?? 0) - Number(left.jaar ?? 0);
    if (yearDiff !== 0) {
      return yearDiff;
    }

    return String(right.updated_at ?? right.created_at ?? "").localeCompare(
      String(left.updated_at ?? left.created_at ?? "")
    );
  }

  function getChannelDefaultMargin(channelCode: string) {
    return channelOptionMap.get(channelCode)?.defaultMarginPct ?? 0;
  }

  function getSellInMarginForChannel(record: GenericRecord | null | undefined, channelCode: string) {
    const sellInMargins = (record?.sell_in_margins as GenericRecord | undefined) ?? {};
    const directValue = sellInMargins[channelCode];
    return directValue === undefined || directValue === null || directValue === ""
      ? getChannelDefaultMargin(channelCode)
      : toNumber(directValue, getChannelDefaultMargin(channelCode));
  }

  function getSellInPriceOverrideForChannel(record: GenericRecord | null | undefined, channelCode: string) {
    const sellInPrices = (record?.sell_in_prices as GenericRecord | undefined) ?? {};
    const directValue = sellInPrices[channelCode];
    return directValue === undefined || directValue === null || directValue === "" ? Number.NaN : toNumber(directValue, Number.NaN);
  }

  function getEffectiveVerkoopstrategieForProduct(
    bierId: string,
    productId: string,
    productType: string,
    verpakking: string
  ) {
    const normalizedPackaging = normalizeKey(verpakking);
    const bierProductStrategies = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_product") {
          return false;
        }
        if (String(record.bier_id ?? "") !== bierId) {
          return false;
        }
        const strategyType = normalizeKey(record.strategie_type);
        return strategyType === "override" || strategyType === "uitzondering" || strategyType === "";
      })
      .sort(sortLatestStrategy);

    if (productId) {
      const exactBierProductStrategy = bierProductStrategies.find(
        (record) =>
          String(record.product_id ?? "") === productId &&
          (!productType || String(record.product_type ?? "") === productType)
      );
      if (exactBierProductStrategy) {
        return exactBierProductStrategy;
      }

      const bierProductIdStrategy = bierProductStrategies.find(
        (record) => String(record.product_id ?? "") === productId
      );
      if (bierProductIdStrategy) {
        return bierProductIdStrategy;
      }
    }

    if (normalizedPackaging) {
      const bierPackagingStrategy = bierProductStrategies.find(
        (record) => normalizeKey(record.verpakking) === normalizedPackaging
      );
      if (bierPackagingStrategy) {
        return bierPackagingStrategy;
      }
    }

    const productStrategies = verkoopstrategieWindow
      .filter((record) => {
        if (String(record.record_type ?? "") !== "verkoopstrategie_verpakking") {
          return false;
        }
        return true;
      })
      .sort(sortLatestStrategy);

    if (productId) {
      const exactProductStrategy = productStrategies.find(
        (record) =>
          String(record.product_id ?? "") === productId &&
          (!productType || String(record.product_type ?? "") === productType)
      );
      if (exactProductStrategy) {
        return exactProductStrategy;
      }

      const productIdStrategy = productStrategies.find(
        (record) => String(record.product_id ?? "") === productId
      );
      if (productIdStrategy) {
        return productIdStrategy;
      }
    }

    if (normalizedPackaging) {
      const packagingStrategy = productStrategies.find(
        (record) => normalizeKey(record.verpakking) === normalizedPackaging
      );
      if (packagingStrategy) {
        return packagingStrategy;
      }
    }

    return verkoopstrategieWindow
      .filter((record) => String(record.record_type ?? "") === "jaarstrategie")
      .sort(sortLatestStrategy)[0];
  }

  function getHighestCostForBier(bierId: string) {
    return actieveKostprijsversiesCurrentYear.reduce<{
      cost: number;
      bronjaar: number;
      biernaam: string;
      kostprijsversieId: string;
    }>(
      (currentHighest, record) => {
        if (String(record.bier_id ?? "") !== bierId) {
          return currentHighest;
        }
        const cost = toNumber(
          (record.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
          0
        );
        if (cost > currentHighest.cost) {
          return {
            cost,
            bronjaar: Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear),
            biernaam:
              normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              bierNameMap.get(bierId) ||
              bierId,
            kostprijsversieId: String(record.id ?? "")
          };
        }
        return currentHighest;
      },
      { cost: 0, bronjaar: currentYear, biernaam: bierNameMap.get(bierId) || bierId, kostprijsversieId: "" }
    );
  }

  function getHighestCostOverall() {
    return actieveKostprijsversiesCurrentYear.reduce<{
      cost: number;
      bierKey: string;
      biernaam: string;
      bronjaar: number;
      kostprijsversieId: string;
    }>(
      (currentHighest, record) => {
        const bierKey = String(record.bier_id ?? "");
        const cost = toNumber(
          (record.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
          0
        );
        if (cost > currentHighest.cost) {
          return {
            cost,
            bierKey,
            biernaam:
              normalizeText((record.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              bierNameMap.get(bierKey) ||
              bierKey,
            bronjaar: Number(record.jaar ?? (record.basisgegevens as GenericRecord | undefined)?.jaar ?? currentYear),
            kostprijsversieId: String(record.id ?? "")
          };
        }
        return currentHighest;
      },
      { cost: 0, bierKey: "", biernaam: "-", bronjaar: currentYear, kostprijsversieId: "" }
    );
  }

  function getHighestLiterRowsForBier(bierId: string) {
    const highestByPackaging = new Map<string, ProductSnapshotRow>();

    for (const record of actieveKostprijsversiesCurrentYear) {
      if (String(record.bier_id ?? "") !== bierId) {
        continue;
      }

      for (const snapshotRow of getSnapshotProductRowsForBier(String(record.bier_id ?? ""), String(record.id ?? ""))) {
        if (snapshotRow.litersPerProduct <= 0) {
          continue;
        }

        const packagingKey = normalizeKey(snapshotRow.verpakking);
        if (!packagingKey) {
          continue;
        }

        const current = highestByPackaging.get(packagingKey);
        const currentCostPerLiter =
          current && current.litersPerProduct > 0 ? current.costPerPiece / current.litersPerProduct : 0;
        const nextCostPerLiter = snapshotRow.costPerPiece / snapshotRow.litersPerProduct;

        if (!current || nextCostPerLiter > currentCostPerLiter) {
          highestByPackaging.set(packagingKey, snapshotRow);
        }
      }
    }

    return [...highestByPackaging.values()];
  }

  function getSnapshotProductRowsFromBerekening(
    bierId: string,
    berekening: GenericRecord
  ): ProductSnapshotRow[] {
    const biernaam =
      normalizeText((berekening.basisgegevens as GenericRecord | undefined)?.biernaam) ||
      bierNameMap.get(bierId) ||
      bierId;
    const producten =
      (berekening.resultaat_snapshot as GenericRecord | undefined)?.producten as GenericRecord | undefined;
    const basisRows = Array.isArray(producten?.basisproducten)
      ? (producten?.basisproducten as GenericRecord[])
      : [];
    const samengesteldRows = Array.isArray(producten?.samengestelde_producten)
      ? (producten?.samengestelde_producten as GenericRecord[])
      : [];
    const basisById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const samengesteldById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );
    const invoicePriceByUnitId = new Map<
      string,
      { costPerPiece: number; litersPerProduct: number; sourcePackaging: string }
    >();
    for (const { regel, extraKostenPerRegel } of getEnrichedInkoopFactuurregels(berekening)) {
      const unitId = String(regel.eenheid ?? "").trim();
      if (!unitId) {
        continue;
      }
      const source = basisById.get(unitId) ?? samengesteldById.get(unitId);
      if (!source) {
        continue;
      }
      const aantal = toNumber(regel.aantal, 0);
      const costPerPiece =
        aantal > 0 ? (toNumber(regel.subfactuurbedrag, 0) + extraKostenPerRegel) / aantal : 0;
      if (costPerPiece <= 0) {
        continue;
      }
      const litersPerProduct = firstPositiveNumber(
        regel.liters && aantal > 0 ? toNumber(regel.liters, 0) / aantal : 0,
        source.inhoud_per_eenheid_liter,
        source.totale_inhoud_liter
      );
      const current = invoicePriceByUnitId.get(unitId);
      if (!current || costPerPiece > current.costPerPiece) {
        invoicePriceByUnitId.set(unitId, {
          costPerPiece,
          litersPerProduct,
          sourcePackaging: String(source.omschrijving ?? "")
        });
      }
    }
    const resolveProductDefinition = (
      productId: string,
      productType: string,
      verpakking: string
    ): ProductDefinition | undefined => {
      if (productId) {
        const byId = productDefinitionMap.get(`id|${productId}`);
        if (byId) {
          return byId;
        }
      }

      if (productType) {
        const byTypedPackaging = productDefinitionMap.get(`${productType}|${normalizeKey(verpakking)}`);
        if (byTypedPackaging) {
          return byTypedPackaging;
        }
      }

      return (
        productDefinitionMap.get(`basis|${normalizeKey(verpakking)}`) ??
        productDefinitionMap.get(`samengesteld|${normalizeKey(verpakking)}`)
      );
    };

    const snapshotRows = [...basisRows, ...samengesteldRows].map((row) => {
      const verpakking = getSnapshotPackagingLabel(row);
      // Normalized snapshot rows may carry both a stable row id and the actual product_id.
      // For resolving definitions and matching activations we always want the real product id.
      const productIdFromRow = String((row as any).product_id ?? (row as any).productId ?? row.id ?? "");
      const explicitSource = basisById.get(productIdFromRow) ?? samengesteldById.get(productIdFromRow);
      const definitionByPackaging = resolveProductDefinition(
        productIdFromRow || String(explicitSource?.id ?? ""),
        basisById.has(productIdFromRow) ? "basis" : samengesteldById.has(productIdFromRow) ? "samengesteld" : "",
        verpakking
      );
      const explicitKind: "basis" | "samengesteld" =
        definitionByPackaging?.kind === "basis"
          ? "basis"
          : definitionByPackaging?.kind === "samengesteld"
            ? "samengesteld"
            : normalizeKey((row as any).product_type) === "basis"
              ? "basis"
              : "samengesteld";
      return {
        bierKey: bierId,
        biernaam,
        kostprijsversieId: String(berekening.id ?? ""),
        productId: definitionByPackaging?.id ?? productIdFromRow ?? "",
        productType: explicitKind,
        productKey: `${explicitKind}|${normalizeKey(verpakking)}`,
        verpakking,
        litersPerProduct: firstPositiveNumber(
          row.liters_per_product,
          row.totale_inhoud_liter,
          row.inhoud_per_eenheid_liter,
          explicitSource?.totale_inhoud_liter,
          explicitSource?.inhoud_per_eenheid_liter
        ),
        costPerPiece: getSnapshotProductCost(row),
        sourcePackaging: verpakking
      };
    });

    if (getBerekeningTypeForBier(bierId) === "inkoop") {
      const historicalSnapshotByPackaging = new Map<string, ProductSnapshotRow>();
      for (const record of [berekening]) {

        const historicalProducten =
          (record.resultaat_snapshot as GenericRecord | undefined)?.producten as GenericRecord | undefined;
        const historicalBasisRows = Array.isArray(historicalProducten?.basisproducten)
          ? (historicalProducten.basisproducten as GenericRecord[])
          : [];
        const historicalSamengesteldeRows = Array.isArray(historicalProducten?.samengestelde_producten)
          ? (historicalProducten.samengestelde_producten as GenericRecord[])
          : [];

        for (const row of [...historicalBasisRows, ...historicalSamengesteldeRows]) {
          const verpakking = getSnapshotPackagingLabel(row);
          const packagingKey = normalizeKey(verpakking);
          if (!packagingKey) {
            continue;
          }

          const rowId = String(row.id ?? "");
          const explicitSource = basisById.get(rowId) ?? samengesteldById.get(rowId);
          const definition = resolveProductDefinition(
            rowId || String(explicitSource?.id ?? ""),
            basisById.has(rowId) ? "basis" : samengesteldById.has(rowId) ? "samengesteld" : "",
            verpakking
          );

          const candidate: ProductSnapshotRow = {
            bierKey: bierId,
            biernaam,
            kostprijsversieId: String(record.id ?? ""),
            productId: definition?.id ?? "",
            productType: definition?.kind ?? "samengesteld",
            productKey: definition?.key ?? `samengesteld|${packagingKey}`,
            verpakking,
            litersPerProduct: firstPositiveNumber(
              row.liters_per_product,
              row.totale_inhoud_liter,
              row.inhoud_per_eenheid_liter,
              explicitSource?.totale_inhoud_liter,
              explicitSource?.inhoud_per_eenheid_liter,
              definition?.kind === "samengesteld"
                ? samengesteldById.get(definition.id ?? "")?.totale_inhoud_liter
                : basisById.get(definition?.id ?? "")?.inhoud_per_eenheid_liter
            ),
            costPerPiece: getSnapshotProductCost(row),
            sourcePackaging: verpakking
          };

          const current = historicalSnapshotByPackaging.get(packagingKey);
          if (!current || candidate.costPerPiece > current.costPerPiece) {
            historicalSnapshotByPackaging.set(packagingKey, candidate);
          }
        }
      }

      const snapshotByPackaging = new Map<string, ProductSnapshotRow>(
        snapshotRows.map((row) => [normalizeKey(row.verpakking), row])
      );
      const factuurRegels = getEnrichedInkoopFactuurregels(berekening).map(({ regel }) => regel);
      if (factuurRegels.length === 0) {
        // Year-over-year activated cost versions (and some manual inkoop calculations) can be definitive without
        // any factuurregels yet. In that case we still want the UI to show the snapshot build-up.
        return snapshotRows;
      }

      const seenUnitIds = new Set<string>();
      const resultRows = new Map<string, ProductSnapshotRow>();

      factuurRegels
        .map((regel) => String(regel.eenheid ?? ""))
        .filter((unitId) => {
          if (!unitId || seenUnitIds.has(unitId)) {
            return false;
          }
          seenUnitIds.add(unitId);
          return true;
        })
        .flatMap((unitId) => {
          const basis = basisById.get(unitId);
          const samengesteld = samengesteldById.get(unitId);
          const source = basis ?? samengesteld;
          if (!source) {
            return [];
          }
          const kind = basis ? "basis" : "samengesteld";
          const verpakking = String(source.omschrijving ?? "");
          const invoicePrice = invoicePriceByUnitId.get(unitId);
          const snapshot =
            historicalSnapshotByPackaging.get(normalizeKey(verpakking)) ??
            snapshotByPackaging.get(normalizeKey(verpakking));
          const rows: ProductSnapshotRow[] = [];

          rows.push({
            bierKey: bierId,
            biernaam,
            kostprijsversieId: String(berekening.id ?? ""),
            productId: String(source.id ?? ""),
            productType: kind,
            productKey: `${kind}|${normalizeKey(verpakking)}`,
            verpakking,
            litersPerProduct: firstPositiveNumber(
              snapshot?.litersPerProduct,
              invoicePrice?.litersPerProduct,
              source.inhoud_per_eenheid_liter,
              source.totale_inhoud_liter
            ),
            costPerPiece: snapshot?.costPerPiece ?? invoicePrice?.costPerPiece ?? 0,
            sourcePackaging:
              snapshot?.sourcePackaging ?? invoicePrice?.sourcePackaging ?? verpakking
          });

          if (!basis && Array.isArray(source.basisproducten)) {
            for (const basisRow of source.basisproducten as GenericRecord[]) {
              const basisProductId = String(basisRow.basisproduct_id ?? "");
              const basisVerpakking = String(basisRow.omschrijving ?? "");
              if (basisProductId.startsWith("verpakkingsonderdeel:")) {
                continue;
              }
              if (normalizeKey(basisVerpakking) === normalizeKey(verpakking)) {
                continue;
              }
              const basisSnapshot =
                historicalSnapshotByPackaging.get(normalizeKey(basisVerpakking)) ??
                snapshotByPackaging.get(normalizeKey(basisVerpakking));
              rows.push({
                bierKey: bierId,
                biernaam,
                kostprijsversieId: String(berekening.id ?? ""),
                productId: basisProductId,
                productType: "basis",
                productKey: `basis|${normalizeKey(basisVerpakking)}`,
                verpakking: basisVerpakking,
                litersPerProduct: firstPositiveNumber(
                  basisSnapshot?.litersPerProduct,
                  basisRow.inhoud_per_eenheid_liter
                ),
                costPerPiece:
                  basisSnapshot?.costPerPiece ??
                  (invoicePrice?.costPerPiece && toNumber(basisRow.aantal, 0) > 0
                    ? invoicePrice.costPerPiece / toNumber(basisRow.aantal, 0)
                    : 0),
                sourcePackaging: basisSnapshot?.sourcePackaging ?? basisVerpakking,
                derivedFromProductId: String(source.id ?? ""),
                derivedFromProductType: kind,
                derivedFromProductKey: `${kind}|${normalizeKey(verpakking)}`,
                derivedFromPackaging: verpakking,
                derivedFromAantal: toNumber(basisRow.aantal, 0)
              });
            }
          }

          return rows;
        })
        .forEach((row) => {
          if (!resultRows.has(row.productKey)) {
            resultRows.set(row.productKey, row);
          }
        });

      if (resultRows.size === 0) {
        return snapshotRows;
      }
      return [...resultRows.values()];
    }

    const snapshotMap = new Map<string, ProductSnapshotRow>(
      snapshotRows.map((row) => [normalizeKey(row.verpakking), row])
    );
    const allKnownProducts = [
      ...pickLatestKnownProductRows(basisproducten, currentYear).map((row) => ({
          id: String(row.id ?? ""),
          key: `basis|${normalizeKey(row.omschrijving)}`,
          kind: "basis" as const,
          verpakking: String(row.omschrijving ?? ""),
          litersPerProduct: toNumber(row.inhoud_per_eenheid_liter, 0)
        })),
      ...pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => ({
          id: String(row.id ?? ""),
          key: `samengesteld|${normalizeKey(row.omschrijving)}`,
          kind: "samengesteld" as const,
          verpakking: String(row.omschrijving ?? ""),
          litersPerProduct: toNumber(row.totale_inhoud_liter, 0)
        }))
    ];
    const uniqueProductsByPackaging = new Map<
      string,
      { id: string; key: string; kind: "basis" | "samengesteld"; verpakking: string; litersPerProduct: number }
    >();
    for (const product of allKnownProducts) {
      const packagingKey = normalizeKey(product.verpakking);
      const current = uniqueProductsByPackaging.get(packagingKey);
      if (!current) {
        uniqueProductsByPackaging.set(packagingKey, product);
        continue;
      }

      const currentIsBasis = current.key.startsWith("basis|");
      const nextIsBasis = product.key.startsWith("basis|");
      if (!currentIsBasis && nextIsBasis) {
        uniqueProductsByPackaging.set(packagingKey, product);
      }
    }

    return [...uniqueProductsByPackaging.values()].map((product) => {
      const existing = snapshotMap.get(normalizeKey(product.verpakking));
      return {
        bierKey: bierId,
        biernaam,
        kostprijsversieId: String(berekening.id ?? ""),
        productId: existing?.productId ?? product.id,
        productType: existing?.productType ?? product.kind,
        productKey: product.key,
        verpakking: product.verpakking,
        litersPerProduct: firstPositiveNumber(existing?.litersPerProduct, product.litersPerProduct),
        costPerPiece:
          existing?.costPerPiece ??
          toNumber(
            (berekening.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
            0
          ) * product.litersPerProduct,
        sourcePackaging: existing?.sourcePackaging ?? product.verpakking
      };
    });
  }

  function getSnapshotProductRowsForBier(bierId: string, fixedKostprijsversieId = ""): ProductSnapshotRow[] {
    if (fixedKostprijsversieId) {
      const fixed = getEffectiveKostprijsversieForBier(bierId, fixedKostprijsversieId);
      return fixed ? getSnapshotProductRowsFromBerekening(bierId, fixed) : [];
    }

    const activeProductActivations = kostprijsproductActiveringenCurrentYear.filter(
      (row) => String(row.bier_id ?? "") === String(bierId ?? "")
    );
    if (activeProductActivations.length === 0) {
      const fallback = getActiveKostprijsversieForBier(bierId);
      return fallback ? getSnapshotProductRowsFromBerekening(bierId, fallback) : [];
    }

    const basisById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );
    const samengesteldById = new Map<string, GenericRecord>(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [
        String(row.id ?? ""),
        row
      ])
    );

    const rowsByProductKey = new Map<string, ProductSnapshotRow>();
    for (const activation of activeProductActivations) {
      const productId = String(activation.product_id ?? "");
      const activationType =
        normalizeKey(activation.product_type) === "samengesteld" ? "samengesteld" : "basis";
      const version = getEffectiveKostprijsversieForProduct(
        bierId,
        productId,
        String(activation.kostprijsversie_id ?? "")
      );
      if (!version) {
        continue;
      }
      const versionRows = getSnapshotProductRowsFromBerekening(bierId, version);
      const matchingRow =
        versionRows.find((row) => String(row.productId ?? "") === productId) ??
        versionRows.find((row) => normalizeKey(row.verpakking) === normalizeKey(String(activation.verpakking ?? "")));
      if (matchingRow) {
        rowsByProductKey.set(matchingRow.productKey, matchingRow);
        continue;
      }

      // If the kostprijsversie snapshot / factuurregels are incomplete, fall back to the master product definitions.
      // We do not "hide" the issue; we ensure activations remain the source of truth for visible products.
      const source =
        (activationType === "basis" ? basisById.get(productId) : samengesteldById.get(productId)) ??
        basisById.get(productId) ??
        samengesteldById.get(productId);
      if (!source) {
        continue;
      }
      const verpakking = String(source.omschrijving ?? "") || productId;
      const litersPerProduct = firstPositiveNumber(
        source.inhoud_per_eenheid_liter,
        source.totale_inhoud_liter
      );
      const costPerLiter = toNumber(
        (version.resultaat_snapshot as GenericRecord | undefined)?.integrale_kostprijs_per_liter,
        0
      );
      const costPerPiece = litersPerProduct > 0 ? costPerLiter * litersPerProduct : 0;
      const productKey = `${activationType}|${normalizeKey(verpakking)}`;
      rowsByProductKey.set(productKey, {
        bierKey: bierId,
        biernaam:
          normalizeText((version.basisgegevens as GenericRecord | undefined)?.biernaam) ||
          bierNameMap.get(bierId) ||
          bierId,
        kostprijsversieId: String(version.id ?? ""),
        productId,
        productType: activationType,
        productKey,
        verpakking,
        litersPerProduct,
        costPerPiece,
        sourcePackaging: verpakking
      });
    }

    return [...rowsByProductKey.values()];
  }

  function buildPricingForChannel(
    cost: number,
    bierId: string,
    productId: string,
    productType: string,
    verpakking: string,
    channelCode: string
  ) {
    const strategy = getEffectiveVerkoopstrategieForProduct(
      bierId,
      productId,
      productType,
      verpakking
    );
    const sellInMarginPct = getSellInMarginForChannel(strategy, channelCode);
    const explicitSellInPrice = getSellInPriceOverrideForChannel(strategy, channelCode);
    // `sell_in_margins` is now opslag% (markup) as the source of truth.
    const sellInPrice =
      Number.isFinite(explicitSellInPrice) && explicitSellInPrice > 0
        ? explicitSellInPrice
        : calcSellInExFromOpslagPct(cost, sellInMarginPct);
    const offerPrice = sellInPrice;

    return { sellInMarginPct, sellInPrice, offerPrice };
  }

  function getActiveRuleLabelForPeriod(blocks: QuoteBuilderBlock[], periodIndex: 1 | 2) {
    const xy = blocks.find((b) => String((b as any).type) === "xy_gratis" && isBlockActiveForPeriod(b as any, periodIndex));
    if (xy) {
      const x = toNumber((xy as any).required_qty, 0);
      const y = toNumber((xy as any).free_qty, 0);
      return `X+Y gratis (${formatNumber(x, 0)} + ${formatNumber(y, 0)})`;
    }
    const staffel = blocks.find((b) => String((b as any).type) === "staffel");
    if (staffel) return "Staffel";
    const disc = blocks.find((b) => String((b as any).type) === "discount_pct" && isBlockActiveForPeriod(b as any, periodIndex));
    if (disc) {
      const k = toNumber((disc as any).korting_pct ?? (disc as any).discount_pct ?? 0, 0);
      return `% korting (${formatNumber(k, 0)}%)`;
    }
    return "Handmatig";
  }

  function computeTransportForVariantPeriod(variantId: string, periodIndex: 1 | 2, baseOmzetEx: number) {
    const blocks = getVariantBlocks(current, variantId);
    const transportBlock = blocks.find(
      (b) => String((b as any).type) === "transport" && isBlockActiveForPeriod(b as any, periodIndex)
    ) as QuoteBuilderBlock | undefined;
    if (!transportBlock) return null;

    const ctx = ((current as any).builder_context as QuoteBuilderContext | undefined) ?? {
      postcode: "",
      distance_km: 0,
      transport_threshold_ex: 0,
      transport_km_threshold: 40,
      transport_deliveries: 1,
      transport_rate_ex: 0
    };
    const postcode = normalizeText((transportBlock as any).postcode ?? ctx.postcode ?? "");
    const distanceKm = Math.max(0, toNumber((transportBlock as any).distance_km ?? ctx.distance_km ?? 0, 0));
    const kmThreshold = Math.max(0, toNumber((transportBlock as any).km_threshold ?? ctx.transport_km_threshold ?? 40, 40));
    const thresholdAmountEx = Math.max(0, toNumber((transportBlock as any).threshold_amount_ex ?? ctx.transport_threshold_ex ?? 0, 0));
    const deliveries = Math.max(0, Math.floor(toNumber((transportBlock as any).deliveries ?? ctx.transport_deliveries ?? 1, 1)));
    const rateEx = Math.max(0, toNumber((transportBlock as any).rate_ex ?? ctx.transport_rate_ex ?? 0, 0));

    const isValid = Boolean(postcode) && distanceKm > 0 && deliveries > 0 && rateEx > 0;
    if (!isValid) {
      return { isValid: false as const, message: "Transport mist gegevens.", mode: "cost" as const, omzet: 0, kosten: 0, amountEx: 0, deliveries, rateEx };
    }

    const shouldCharge = distanceKm > kmThreshold && (thresholdAmountEx <= 0 || baseOmzetEx < thresholdAmountEx);
    const amountEx = deliveries * rateEx;
    const omzet = shouldCharge ? amountEx : 0;
    const kosten = amountEx;
    return { isValid: true as const, message: "", mode: shouldCharge ? ("charge" as const) : ("cost" as const), omzet, kosten, amountEx, deliveries, rateEx };
  }

  function computeExtrasForVariantPeriod(variantId: string, periodIndex: 1 | 2, baseOmzetEx: number) {
    const blocks = getVariantBlocks(current, variantId);
    const extraBlocks = blocks.filter(
      (b) => String((b as any).type) === "extras" && isBlockActiveForPeriod(b as any, periodIndex)
    ) as QuoteBuilderBlock[];
    if (extraBlocks.length === 0) return [];

    return extraBlocks.map((block) => {
      const label = normalizeText((block as any).extra_label ?? "Extra");
      const qty = Math.max(0, toNumber((block as any).extra_qty ?? 1, 1));
      const unitPriceEx = Math.max(0, toNumber((block as any).extra_unit_price_ex ?? 0, 0));
      const unitCostEx = Math.max(0, toNumber((block as any).extra_unit_cost_ex ?? 0, 0));
      const isFree = Boolean((block as any).extra_is_free ?? false);
      const thresholdAmountEx = Math.max(0, toNumber((block as any).extra_threshold_amount_ex ?? 0, 0));
      const meetsThreshold = thresholdAmountEx <= 0 || baseOmzetEx >= thresholdAmountEx;
      const effectiveIsFree = isFree || !meetsThreshold;
      const omzet = effectiveIsFree ? 0 : qty * unitPriceEx;
      const kosten = qty * unitCostEx;
      return { id: String(block.id ?? createId()), label, qty, unitPriceEx, unitCostEx, isFree: effectiveIsFree, omzet, kosten };
    });
  }

  function computeOfferTotalsForVariantPeriod(variant: QuoteVariant, periodIndex: 1 | 2) {
    const blocks = getVariantBlocks(current, variant.id);
    const workingProductRows = applyVariantPeriodToWorkingRows(variant.product_rows, periodIndex);
    const workingBeerRows = applyVariantPeriodToWorkingRows(variant.beer_rows, periodIndex);

    const selectedChannelOptions = isMultiKanaalMode
      ? channelOptions.filter((opt) => effectiveSelectedKanaalValues.includes(opt.value))
      : channelOptions.filter((opt) => opt.value === normalizeKey(variant.channel_code || currentKanaal) || opt.value === currentKanaal);
    const channelCode = normalizeKey(variant.channel_code) || currentKanaal;

    const beerProductRows: ProductDisplayRow[] = workingProductRows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const bierId = String((row as any).bier_id ?? "");
      const biernaam = bierNameMap.get(bierId) || normalizeText((row as any).biernaam) || bierId || "-";
      const fixedKostprijsversieId = String((row as any).kostprijsversie_id ?? "");
      const snapshotRows = getSnapshotProductRowsForBier(bierId, fixedKostprijsversieId);
      const productId = String((row as any).product_id ?? "");
      const productType = normalizeKey((row as any).product_type) === "basis" ? ("basis" as const) : ("samengesteld" as const);
      const snapshot =
        snapshotRows.find((item) => String(item.productId) === productId && String(item.productType) === productType) ??
        snapshotRows.find((item) => normalizeKey(item.verpakking) === normalizeKey(String((row as any).verpakking_label ?? "")));
      if (!snapshot) return [];

      const kostprijsPerStuk = snapshot.costPerPiece;
      const pricingByChannel = Object.fromEntries(
        selectedChannelOptions.map((option) => [
          option.value,
          buildPricingForChannel(kostprijsPerStuk, bierId, productId, productType, snapshot.verpakking, option.value)
        ])
      ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
      const pricing = pricingByChannel[channelCode] ?? pricingByChannel[currentKanaal] ?? pricingByChannel[selectedChannelOptions[0]?.value ?? currentKanaal];
      const offerPrijs = pricing?.offerPrice ?? 0;

      const kortingPct = toNumber((row as any).korting_pct, 0);
      const aantal = toNumber((row as any).aantal, 0);
      const totals = calcOfferLineTotals({
        kostprijsEx: kostprijsPerStuk,
        offerPriceEx: offerPrijs,
        qty: aantal,
        kortingPct
      });

      return [
        {
          id: String((row as any).id ?? createId()),
          bierKey: bierId,
          biernaam,
          kostprijsversieId: fixedKostprijsversieId,
          included: isIncluded((row as any).included),
          productId,
          productType,
          productKey: `${productType}|${productId}`,
          verpakking: snapshot.verpakking,
          aantal,
          kortingPct,
          litersPerProduct: snapshot.litersPerProduct,
          kostprijsPerStuk,
          offerPrijs,
          sellInPrijs: pricing?.sellInPrice ?? 0,
          sellInMargePct: pricing?.sellInMarginPct ?? 0,
          offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value]?.offerPrice ?? 0])),
          omzet: totals.omzet,
          kosten: totals.kosten,
          kortingEur: totals.kortingEur,
          margeEur: totals.winst,
          margePct: totals.margePct
        } as ProductDisplayRow
      ];
    });

    const currentCatalogRows = Array.isArray((current as any).catalog_product_rows)
      ? (((current as any).catalog_product_rows as GenericRecord[]) ?? [])
      : [];
    const catalogRows: ProductDisplayRow[] = currentCatalogRows.map((row) => {
      const catalogProductId = String((row as any).catalog_product_id ?? "");
      const naam =
        String((row as any).naam ?? "") ||
        catalogProductOptionMap.get(catalogProductId)?.naam ||
        catalogProductId ||
        "-";
      const kostprijsPerStuk = catalogProductCostById.get(catalogProductId) ?? 0;
      const pricingByChannel = Object.fromEntries(
        selectedChannelOptions.map((option) => [
          option.value,
          buildPricingForChannel(kostprijsPerStuk, "", `catalog:${catalogProductId}`, "catalog", naam, option.value)
        ])
      ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
      const pricing = pricingByChannel[channelCode] ?? pricingByChannel[currentKanaal] ?? pricingByChannel[selectedChannelOptions[0]?.value ?? currentKanaal];
      const offerPrijs = pricing?.offerPrice ?? 0;
      const kortingPct = toNumber((row as any).korting_pct, 0);
      const aantal = toNumber((row as any).aantal, 0);
      const totals = calcOfferLineTotals({
        kostprijsEx: kostprijsPerStuk,
        offerPriceEx: offerPrijs,
        qty: aantal,
        kortingPct
      });
      return {
        id: String((row as any).id ?? ""),
        bierKey: "",
        biernaam: "Artikel",
        kostprijsversieId: "",
        included: isIncluded((row as any).included),
        productId: `catalog:${catalogProductId}`,
        productType: "catalog" as const,
        productKey: `catalog|${catalogProductId}`,
        verpakking: naam,
        aantal,
        kortingPct,
        litersPerProduct: 0,
        kostprijsPerStuk,
        offerPrijs,
        sellInPrijs: pricing?.sellInPrice ?? 0,
        sellInMargePct: pricing?.sellInMarginPct ?? 0,
        offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value]?.offerPrice ?? 0])),
        omzet: totals.omzet,
        kosten: totals.kosten,
        kortingEur: totals.kortingEur,
        margeEur: totals.winst,
        margePct: totals.margePct
      };
    });

    const allRows = [...beerProductRows, ...catalogRows].filter((row) => row.included);

    // Apply pricing rule exclusivity to totals (same precedence as the active view).
    const xyBlock = blocks.find((b) => String((b as any).type) === "xy_gratis" && isBlockActiveForPeriod(b as any, periodIndex)) as QuoteBuilderBlock | undefined;
    const staffelActive = blocks.some((b) => String((b as any).type) === "staffel");

    let totals = { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 };

    if (xyBlock) {
      const requiredQty = toNumber((xyBlock as any).required_qty, 4);
      const freeQty = toNumber((xyBlock as any).free_qty, 1);
      const eligibleRefs = Array.isArray((xyBlock as any).eligible_product_refs) ? ((xyBlock as any).eligible_product_refs as string[]) : [];
      const gratis = computeGratisUnitsByProductRef({ rows: allRows as any, requiredQty, freeQty, eligibleRefs });
      for (const row of allRows) {
        if (row.productType === "catalog") {
          totals.omzet += row.omzet;
          totals.kosten += row.kosten;
          totals.kortingEur += row.kortingEur;
          totals.margeEur += row.margeEur;
          continue;
        }
        const ref = `${row.productType}|${row.productId}`;
        const freeUnits = gratis.freeByRef.get(ref) ?? 0;
        const lineTotals = calcOfferLineTotalsWithGratis({
          kostprijsEx: row.kostprijsPerStuk,
          offerPriceEx: row.offerPrijs,
          qty: row.aantal + freeUnits,
          freeQty: freeUnits
        });
        totals.omzet += lineTotals.omzet;
        totals.kosten += lineTotals.kosten;
        totals.kortingEur += lineTotals.kortingEur;
        totals.margeEur += lineTotals.winst;
      }
    } else if (staffelActive) {
      const tiers = getStaffelTiers(current.staffels);
      const kortingByRef = computeStaffelKortingByProductRef({ rows: allRows as any, tiers });
      for (const row of allRows) {
        if (row.productType === "catalog") {
          totals.omzet += row.omzet;
          totals.kosten += row.kosten;
          totals.kortingEur += row.kortingEur;
          totals.margeEur += row.margeEur;
          continue;
        }
        const ref = `${row.productType}|${row.productId}`;
        const k = kortingByRef.get(ref) ?? 0;
        const lineTotals = calcOfferLineTotals({
          kostprijsEx: row.kostprijsPerStuk,
          offerPriceEx: row.offerPrijs,
          qty: row.aantal,
          kortingPct: k
        });
        totals.omzet += lineTotals.omzet;
        totals.kosten += lineTotals.kosten;
        totals.kortingEur += lineTotals.kortingEur;
        totals.margeEur += lineTotals.winst;
      }
    } else {
      totals = allRows.reduce(
        (acc, row) => ({
          omzet: acc.omzet + row.omzet,
          kosten: acc.kosten + row.kosten,
          kortingEur: acc.kortingEur + row.kortingEur,
          margeEur: acc.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      );
    }

    const transport = computeTransportForVariantPeriod(variant.id, periodIndex, totals.omzet);
    const extras = computeExtrasForVariantPeriod(variant.id, periodIndex, totals.omzet);
    const extrasTotals = extras.reduce(
      (acc, row) => ({ omzet: acc.omzet + row.omzet, kosten: acc.kosten + row.kosten }),
      { omzet: 0, kosten: 0 }
    );

    const omzet = totals.omzet + (transport?.isValid ? transport.omzet : 0) + extrasTotals.omzet;
    const kosten = totals.kosten + (transport?.isValid ? transport.kosten : 0) + extrasTotals.kosten;
    const margeEur = totals.margeEur + (transport?.isValid ? transport.omzet - transport.kosten : 0) + (extrasTotals.omzet - extrasTotals.kosten);
    const kortingEur = totals.kortingEur;
    const margePct = calcMarginPctFromRevenueCost(omzet, kosten);

    return {
      omzet,
      kosten,
      kortingEur,
      margeEur,
      margePct,
      transportMode: transport?.isValid ? transport.mode : undefined,
      transportAmountEx: transport?.isValid ? transport.amountEx : undefined,
      extrasOmzet: extrasTotals.omzet,
      extrasKosten: extrasTotals.kosten,
      activeRuleLabel: getActiveRuleLabelForPeriod(blocks, periodIndex)
    };
  }

  const currentKanaalLabel = channelOptionMap.get(currentKanaal)?.label ?? currentKanaal;
  const selectedKanaalLabels = selectedChannelOptions.map((option) => option.label).join(", ");
  const costPriceLabel = "Kostprijs";
  const offerPriceLabel = "Verkoopprijs";
  const discountAmountLabel = "Korting";

  function syncBeerRowsForSingleBeer(bierId: string, existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return getSnapshotProductRowsForBier(bierId).map((snapshotRow) => {
      const existing = existingMap.get(
        getCompositeProductRef(snapshotRow.productType, snapshotRow.productId, snapshotRow.productKey)
      );
      return {
        id: String(existing?.id ?? createId()),
        product_id: snapshotRow.productId,
        product_type: snapshotRow.productType,
        bier_id: bierId,
        kostprijsversie_id: String(existing?.kostprijsversie_id ?? snapshotRow.kostprijsversieId ?? ""),
        verpakking_label: snapshotRow.verpakking,
        liters: toNumber(existing?.liters, 0),
        korting_pct: toNumber(existing?.korting_pct, 0),
        included: isIncluded(existing?.included)
      };
    });
  }

  function syncBeerRowsFromProductRows(
    bierId: string,
    productRows: GenericRecord[],
    existingRows: GenericRecord[]
  ) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [getStoredProductRef(row), row])
    );

    return productRows
      .filter((row) => String(row.bier_id ?? "") === bierId)
      .map((row) => {
        const productId = String(row.product_id ?? "");
        const productType = String(row.product_type ?? "");
        const compositeRef = getCompositeProductRef(productType, productId, "");
        const existing = existingMap.get(compositeRef);
        const verpakkingLabel =
          String(row.verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${productId}`)?.label ||
          "";

        return {
          id: String(existing?.id ?? createId()),
          bier_id: bierId,
          product_id: productId,
          product_type: productType,
          kostprijsversie_id: String(existing?.kostprijsversie_id ?? row.kostprijsversie_id ?? ""),
          verpakking_label: verpakkingLabel,
          liters: toNumber(existing?.liters, 0),
          korting_pct: toNumber(existing?.korting_pct, toNumber(row.korting_pct, 0)),
          included: isIncluded(existing?.included)
        };
      });
  }

  function syncBeerRowsForMultipleBieren(selectedBeerIds: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [String(row.bier_id ?? ""), row])
    );

    return selectedBeerIds.map((bierId) => {
      const existing = existingMap.get(bierId);
      return {
        id: String(existing?.id ?? createId()),
        bier_id: bierId,
        kostprijsversie_id: String(existing?.kostprijsversie_id ?? getActiveKostprijsversieForBier(bierId)?.id ?? ""),
        product_id: "",
        product_type: "",
        liters: toNumber(existing?.liters, 0),
        korting_pct: toNumber(existing?.korting_pct, 0),
        included: isIncluded(existing?.included)
      };
    });
  }

  function syncHighestOverallRows(existingRows: GenericRecord[]) {
    const first = existingRows[0] ?? {};
    return [
      {
        id: String(first.id ?? createId()),
        bier_id: "",
        kostprijsversie_id: String(first.kostprijsversie_id ?? ""),
        product_id: "",
        product_type: "",
        liters: toNumber(first.liters, 0),
        korting_pct: toNumber(first.korting_pct, 0),
        included: isIncluded(first.included)
      }
    ];
  }

  function syncProductRowsForBieren(selectedBeerIds: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [`${row.bier_id}|${getStoredProductRef(row)}`, row])
    );

    return selectedBeerIds.flatMap((bierId) =>
      getSnapshotProductRowsForBier(bierId).map((snapshotRow) => {
        const rows: GenericRecord[] = [];
        const compositeKey = `${bierId}|${getCompositeProductRef(
          snapshotRow.productType,
          snapshotRow.productId,
          snapshotRow.productKey
        )}`;
        const existing = existingMap.get(compositeKey);

        rows.push({
          id: String(existing?.id ?? createId()),
          product_id: snapshotRow.productId,
          product_type: snapshotRow.productType,
          bier_id: bierId,
          kostprijsversie_id: String(existing?.kostprijsversie_id ?? snapshotRow.kostprijsversieId ?? ""),
          verpakking_label: snapshotRow.verpakking,
          aantal: toNumber(existing?.aantal, 0),
          korting_pct: toNumber(existing?.korting_pct, 0),
          included: isIncluded(existing?.included)
        });
        return rows[0];
      })
    );
  }

  function syncCatalogProductRows(selectedIds: string[], existingRows: GenericRecord[]) {
    const existingMap = new Map<string, GenericRecord>(
      existingRows.map((row) => [String((row as any).catalog_product_id ?? ""), row])
    );

    return selectedIds.map((catalogProductId) => {
      const existing = existingMap.get(catalogProductId);
      const naam = catalogProductOptionMap.get(catalogProductId)?.naam ?? String((existing as any)?.naam ?? "");
      return {
        id: String((existing as any)?.id ?? createId()),
        catalog_product_id: catalogProductId,
        naam,
        aantal: toNumber((existing as any)?.aantal, 0),
        korting_pct: toNumber((existing as any)?.korting_pct, 0),
        included: isIncluded((existing as any)?.included)
      };
    });
  }

  const litersDisplayRows = useMemo<LitersDisplayRow[]>(() => {
    const currentBeerRows = Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : [];

    if (!isLitersMode) {
      return [];
    }

    if (litersBasis === "een_bier") {
      const bierId = String(current.bier_id ?? "");
      const sourceRows = bierId
        ? (() => {
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(bierId, currentProductRows, currentBeerRows);
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierId, currentBeerRows);
          })()
        : currentBeerRows;

      return sourceRows.map((row) => {
        const bierId = String(row.bier_id ?? current.bier_id ?? "");
        const kostprijsversieId = String(row.kostprijsversie_id ?? "");
        const rowProductId = String(row.product_id ?? "");
        const snapshots = kostprijsversieId
          ? getSnapshotProductRowsForBier(bierId, kostprijsversieId)
          : getHighestLiterRowsForBier(bierId);
        const snapshot = snapshots.find(
          (item) =>
            (rowProductId && item.productId === rowProductId) ||
            normalizeKey(item.verpakking) ===
              normalizeKey(String((row as GenericRecord).verpakking_label ?? ""))
        );
        const kostprijsPerLiter =
          snapshot && snapshot.litersPerProduct > 0 ? snapshot.costPerPiece / snapshot.litersPerProduct : 0;
        const verpakking =
          snapshot?.verpakking ||
          String((row as GenericRecord).verpakking_label ?? "") ||
          productDefinitionMap.get(`id|${rowProductId}`)?.label ||
          "-";
        const kortingPct = toNumber(row.korting_pct, 0);
        const pricingByChannel = Object.fromEntries(
          selectedChannelOptions.map((option) => [
            option.value,
            buildPricingForChannel(
              kostprijsPerLiter,
              bierId,
              snapshot?.productId ?? rowProductId,
              snapshot?.productType ??
                (String(row.product_type ?? "") as "basis" | "samengesteld" | ""),
              verpakking,
              option.value
            )
          ])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
        const pricing = pricingByChannel[currentKanaal];
        const offerPrijs = pricing.offerPrice;
        const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const totals = calcOfferLineTotals({
          kostprijsEx: kostprijsPerLiter,
          offerPriceEx: offerPrijs,
          qty: liters,
          kortingPct
        });
        return {
          id: String(row.id ?? ""),
          bierKey: bierId,
          biernaam: bierNameMap.get(bierId) || "-",
          kostprijsversieId: snapshot?.kostprijsversieId ?? kostprijsversieId,
          included: isIncluded(row.included),
          productId: snapshot?.productId ?? rowProductId,
          productType:
            snapshot?.productType ??
            (String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
              ? (String(row.product_type ?? "") as "basis" | "samengesteld")
              : "basis"),
          productKey: snapshot?.productKey ?? "",
          verpakking,
          liters,
          kortingPct,
          kostprijsPerLiter,
          offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
          offerPrijs,
          sellInPrijs: pricing.sellInPrice,
          sellInMargePct: pricing.sellInMarginPct,
          omzet: totals.omzet,
          kosten: totals.kosten,
          kortingEur: totals.kortingEur,
          margeEur: totals.winst,
          margePct: totals.margePct
        };
      });
    }

    if (litersBasis === "meerdere_bieren") {
      return currentBeerRows.map((row) => {
        const bierId = String(row.bier_id ?? "");
        const fixedVersion = String(row.kostprijsversie_id ?? "");
        const highest = fixedVersion
          ? {
              ...getHighestCostForBier(bierId),
              cost: toNumber(
                (getKostprijsversieById(fixedVersion)?.resultaat_snapshot as GenericRecord | undefined)
                  ?.integrale_kostprijs_per_liter,
                0
              ),
              kostprijsversieId: fixedVersion
            }
          : getHighestCostForBier(bierId);
        const kortingPct = toNumber(row.korting_pct, 0);
        const pricingByChannel = Object.fromEntries(
          selectedChannelOptions.map((option) => [option.value, buildPricingForChannel(highest.cost, bierId, "", "", "liter", option.value)])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
        const pricing = pricingByChannel[currentKanaal];
        const offerPrijs = pricing.offerPrice;
        const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
        const liters = toNumber(row.liters, 0);
        const totals = calcOfferLineTotals({
          kostprijsEx: highest.cost,
          offerPriceEx: offerPrijs,
          qty: liters,
          kortingPct
        });
        return {
          id: String(row.id ?? ""),
          bierKey: bierId,
          biernaam: highest.biernaam,
          kostprijsversieId: highest.kostprijsversieId,
          included: isIncluded(row.included),
          productKey: "",
          verpakking: "Literregel",
          liters,
          kortingPct,
          kostprijsPerLiter: highest.cost,
          offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
          offerPrijs,
          sellInPrijs: pricing.sellInPrice,
          sellInMargePct: pricing.sellInMarginPct,
          omzet: totals.omzet,
          kosten: totals.kosten,
          kortingEur: totals.kortingEur,
          margeEur: totals.winst,
          margePct: totals.margePct
        };
      });
    }

    const overall = getHighestCostOverall();
    return currentBeerRows.map((row) => {
      const fixedVersion = String(row.kostprijsversie_id ?? "");
      const effectiveOverall = fixedVersion
        ? {
            ...overall,
            cost: toNumber(
              (getKostprijsversieById(fixedVersion)?.resultaat_snapshot as GenericRecord | undefined)
                ?.integrale_kostprijs_per_liter,
              0
            ),
            bierKey: String(getKostprijsversieById(fixedVersion)?.bier_id ?? overall.bierKey),
            biernaam:
              normalizeText((getKostprijsversieById(fixedVersion)?.basisgegevens as GenericRecord | undefined)?.biernaam) ||
              overall.biernaam,
            kostprijsversieId: fixedVersion
          }
        : overall;
      const kortingPct = toNumber(row.korting_pct, 0);
      const pricingByChannel = Object.fromEntries(
        selectedChannelOptions.map((option) => [option.value, buildPricingForChannel(effectiveOverall.cost, effectiveOverall.bierKey, "", "", "liter", option.value)])
      ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
      const pricing = pricingByChannel[currentKanaal];
      const offerPrijs = pricing.offerPrice;
      const verkoopprijs = offerPrijs * Math.max(0, 1 - kortingPct / 100);
      const liters = toNumber(row.liters, 0);
      const totals = calcOfferLineTotals({
        kostprijsEx: effectiveOverall.cost,
        offerPriceEx: offerPrijs,
        qty: liters,
        kortingPct
      });
      return {
          id: String(row.id ?? ""),
        bierKey: effectiveOverall.bierKey,
        biernaam: effectiveOverall.biernaam,
        kostprijsversieId: effectiveOverall.kostprijsversieId,
          included: isIncluded(row.included),
        productKey: "",
        verpakking: "Algemene literregel",
        liters,
        kortingPct,
        kostprijsPerLiter: effectiveOverall.cost,
        offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
        offerPrijs,
        sellInPrijs: pricing.sellInPrice,
        sellInMargePct: pricing.sellInMarginPct,
        omzet: totals.omzet,
        kosten: totals.kosten,
        kortingEur: totals.kortingEur,
        margeEur: totals.winst,
        margePct: totals.margePct
      };
    });
  }, [
    current.beer_rows,
    current.bier_id,
    bierNameMap,
    currentKanaal,
    selectedChannelOptions,
    isLitersMode,
    litersBasis,
    verkoopstrategieWindow
  ]);

  const litersTotals = useMemo(
    () =>
      litersDisplayRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [litersDisplayRows]
  );

  const offerteLitersRows = useMemo(() => {
    if (offerLevel === "basis") {
      const basisRows = litersDisplayRows.filter((row) => row.productType === "basis");
      return basisRows.length > 0 ? basisRows : litersDisplayRows;
    }
    const compositeRows = litersDisplayRows.filter((row) => row.productType === "samengesteld");
    return compositeRows.length > 0 ? compositeRows : litersDisplayRows;
  }, [offerLevel, litersDisplayRows]);

  const offerteLitersTotals = useMemo(
    () =>
      offerteLitersRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [offerteLitersRows]
  );

  const derivedBasisLitersRows = useMemo(() => {
    if (!isLitersMode || offerLevel !== "samengesteld") {
      return [];
    }
    return litersDisplayRows.filter((row) => row.productType === "basis");
  }, [isLitersMode, offerLevel, litersDisplayRows]);

  const staffelProductOptions = useMemo<SelectOption[]>(() => {
    const currentProductRows = Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : [];
    const byRef = new Map<string, SelectOption>();
    for (const row of currentProductRows) {
      const bierId = String(row.bier_id ?? "");
      const fixedKostprijsversieId = String(row.kostprijsversie_id ?? "");
      const snapshotRowsForBier = getSnapshotProductRowsForBier(bierId, fixedKostprijsversieId);
      const rowProductId = String(row.product_id ?? "");
      const rowProductType = String(row.product_type ?? "");
      const explicitLabel = String(row.verpakking_label ?? "");
      const rowLabel =
        explicitLabel ||
        productDefinitionMap.get(`id|${rowProductId}`)?.label ||
        rowProductId;
      const snapshot = snapshotRowsForBier.find(
        (item) =>
          (rowProductId && item.productId === rowProductId) ||
          normalizeKey(item.verpakking) === normalizeKey(rowLabel) ||
          normalizeKey(item.sourcePackaging) === normalizeKey(rowLabel)
      );
      const productId = snapshot?.productId ?? rowProductId;
      const productType = snapshot?.productType ?? (rowProductType === "basis" || rowProductType === "samengesteld" ? rowProductType : "");
      if (!productId || !productType) continue;
      const ref = `${productType}|${productId}`;
      if (!byRef.has(ref)) {
        byRef.set(ref, {
          value: ref,
          label: snapshot?.verpakking ?? productDefinitionMap.get(`id|${productId}`)?.label ?? productId
        });
      }
    }
    return [
      { value: "", label: "Alle producten" },
      ...[...byRef.values()].sort((a, b) => a.label.localeCompare(b.label, "nl-NL"))
    ];
  }, [current.product_rows, productDefinitionMap, currentYear]);

  const xyEligibleProductOptions = useMemo<SelectOption[]>(() => {
    // Reuse same product refs as staffel, but without the "alle producten" option.
    return staffelProductOptions.filter((option) => option.value);
  }, [staffelProductOptions]);

  const productDisplayRows = useMemo<ProductDisplayRow[]>(() => {
    const currentProductRows = Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : [];

    const beerProductRows = currentProductRows.map((row) => {
      const bierId = String(row.bier_id ?? "");
      const fixedKostprijsversieId = String(row.kostprijsversie_id ?? "");
      const snapshotRowsForBier = getSnapshotProductRowsForBier(bierId, fixedKostprijsversieId);
      const explicitLabel = String(row.verpakking_label ?? "");
      const rowProductId = String(row.product_id ?? "");
      const rowProductType =
        String(row.product_type ?? "") === "basis" || String(row.product_type ?? "") === "samengesteld"
          ? (String(row.product_type ?? "") as "basis" | "samengesteld")
          : "";
      const rowLabel =
        explicitLabel ||
        productDefinitionMap.get(`id|${rowProductId}`)?.label ||
        rowProductId;
      const snapshot = snapshotRowsForBier.find(
        (item) =>
          (rowProductId && item.productId === rowProductId) ||
          normalizeKey(item.verpakking) === normalizeKey(rowLabel) ||
          normalizeKey(item.sourcePackaging) === normalizeKey(rowLabel)
      );
      const definition = rowProductId ? productDefinitionMap.get(`id|${rowProductId}`) : undefined;
      const verpakking = snapshot?.verpakking ?? definition?.label ?? "-";
      const kostprijsPerStuk = snapshot?.costPerPiece ?? 0;
      const buildPricingSet = (
        targetCost: number,
        targetProductId: string,
        targetProductType: "basis" | "samengesteld" | "",
        targetPackaging: string
      ) =>
        Object.fromEntries(
          selectedChannelOptions.map((option) => [
            option.value,
            buildPricingForChannel(
              targetCost,
              bierId,
              targetProductId,
              targetProductType,
              targetPackaging,
              option.value
            )
          ])
        ) as Record<string, ReturnType<typeof buildPricingForChannel>>;

      let pricingByChannel = buildPricingSet(
        kostprijsPerStuk,
        snapshot?.productId ?? rowProductId,
        snapshot?.productType ?? rowProductType,
        verpakking
      );
      let pricing = pricingByChannel[currentKanaal];
      const hasDirectStrategyPricing = pricing.sellInPrice > 0 || pricing.sellInMarginPct > 0;

      if (
        !hasDirectStrategyPricing &&
        snapshot?.derivedFromProductKey &&
        snapshot.derivedFromPackaging &&
        toNumber(snapshot.derivedFromAantal, 0) > 0
      ) {
        const parentSnapshot = snapshotRowsForBier.find(
          (item) =>
            item.productId === snapshot.derivedFromProductId ||
            normalizeKey(item.verpakking) === normalizeKey(snapshot.derivedFromPackaging)
        );

        if (parentSnapshot) {
          const divisor = toNumber(snapshot.derivedFromAantal, 0);
          const parentPricingByChannel = buildPricingSet(
            parentSnapshot.costPerPiece,
            parentSnapshot.productId,
            parentSnapshot.productType,
            parentSnapshot.verpakking
          );
          pricingByChannel = Object.fromEntries(
            selectedChannelOptions.map((option) => {
              const channelPricing = parentPricingByChannel[option.value];
              return [
                option.value,
                {
                  sellInMarginPct: channelPricing.sellInMarginPct,
                  sellInPrice: channelPricing.sellInPrice / divisor,
                  offerPrice: channelPricing.offerPrice / divisor
                }
              ];
            })
          ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
          pricing = pricingByChannel[currentKanaal];
        }
      }

      const offerPrijs = pricing.offerPrice;
      const kortingPctRaw = toNumber(row.korting_pct, 0);
      const aantal = toNumber(row.aantal, 0);
      const litersPerProduct = firstPositiveNumber(snapshot?.litersPerProduct, 0);
      const totals = calcOfferLineTotals({
        kostprijsEx: kostprijsPerStuk,
        offerPriceEx: offerPrijs,
        qty: aantal,
        kortingPct: kortingPctRaw
      });
      return {
        id: String(row.id ?? ""),
        bierKey: bierId,
        biernaam: bierNameMap.get(bierId) || "-",
        kostprijsversieId: snapshot?.kostprijsversieId ?? fixedKostprijsversieId,
        included: isIncluded(row.included),
        productId: snapshot?.productId ?? rowProductId,
        productType: snapshot?.productType ?? (rowProductType || "basis"),
        productKey: snapshot?.productKey ?? "",
        verpakking,
        aantal,
        kortingPct: kortingPctRaw,
        litersPerProduct,
        kostprijsPerStuk,
        offerPrijs,
        sellInPrijs: pricing.sellInPrice,
        sellInMargePct: pricing.sellInMarginPct,
        offerByChannel: Object.fromEntries(selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])),
        omzet: totals.omzet,
        kosten: totals.kosten,
        kortingEur: totals.kortingEur,
        margeEur: totals.winst,
        margePct: totals.margePct
      };
    });

    const currentCatalogRows = Array.isArray((current as any).catalog_product_rows)
      ? (((current as any).catalog_product_rows as GenericRecord[]) ?? [])
      : [];
    const catalogRows = currentCatalogRows.map((row) => {
      const catalogProductId = String((row as any).catalog_product_id ?? "");
      const naam =
        String((row as any).naam ?? "") ||
        catalogProductOptionMap.get(catalogProductId)?.naam ||
        catalogProductId ||
        "-";
      const kostprijsPerStuk = catalogProductCostById.get(catalogProductId) ?? 0;

      const pricingByChannel = Object.fromEntries(
        selectedChannelOptions.map((option) => [
          option.value,
          buildPricingForChannel(kostprijsPerStuk, "", `catalog:${catalogProductId}`, "catalog", naam, option.value)
        ])
      ) as Record<string, ReturnType<typeof buildPricingForChannel>>;
      const pricing = pricingByChannel[currentKanaal];

      const offerPrijs = pricing.offerPrice;
      const kortingPct = toNumber((row as any).korting_pct, 0);
      const aantal = toNumber((row as any).aantal, 0);
      const totals = calcOfferLineTotals({
        kostprijsEx: kostprijsPerStuk,
        offerPriceEx: offerPrijs,
        qty: aantal,
        kortingPct
      });

      return {
        id: String((row as any).id ?? ""),
        bierKey: "",
        biernaam: "Artikel",
        kostprijsversieId: "",
        included: isIncluded((row as any).included),
        productId: `catalog:${catalogProductId}`,
        productType: "catalog" as const,
        productKey: `catalog|${catalogProductId}`,
        verpakking: naam,
        aantal,
        kortingPct,
        litersPerProduct: 0,
        kostprijsPerStuk,
        offerPrijs,
        sellInPrijs: pricing.sellInPrice,
        sellInMargePct: pricing.sellInMarginPct,
        offerByChannel: Object.fromEntries(
          selectedChannelOptions.map((option) => [option.value, pricingByChannel[option.value].offerPrice])
        ),
        omzet: totals.omzet,
        kosten: totals.kosten,
        kortingEur: totals.kortingEur,
        margeEur: totals.winst,
        margePct: totals.margePct
      };
    });

    const rows = [...beerProductRows, ...catalogRows];

    const activeBlocks = getVariantBlocks(current, activeVariantId);
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const effectivePeriod: 1 | 2 = introEnabled ? toPeriodIndex((current as any).active_period_index, 2) : 2;

    // Exclusivity: only one pricing rule can be active per period.
    // If xy_gratis applies to this period, it wins. Else staffel wins. Else manual korting_pct stays.
    const xyBlock = activeBlocks.find((b) => String((b as any).type) === "xy_gratis" && isBlockActiveForPeriod(b as any, effectivePeriod)) as
      | QuoteBuilderBlock
      | undefined;
    const staffelActive = activeBlocks.some((b) => String((b as any).type) === "staffel");

    if (xyBlock) {
      const requiredQty = toNumber((xyBlock as any).required_qty, 4);
      const freeQty = toNumber((xyBlock as any).free_qty, 1);
      const eligibleRefs = Array.isArray((xyBlock as any).eligible_product_refs) ? ((xyBlock as any).eligible_product_refs as string[]) : [];
      const gratis = computeGratisUnitsByProductRef({
        rows: rows as any,
        requiredQty,
        freeQty,
        eligibleRefs
      });

      return rows.map((row) => {
        if (row.productType === "catalog") {
          return row;
        }
        const ref = `${row.productType}|${row.productId}`;
        const freeUnits = gratis.freeByRef.get(ref) ?? 0;
        const totals = calcOfferLineTotalsWithGratis({
          kostprijsEx: row.kostprijsPerStuk,
          offerPriceEx: row.offerPrijs,
          // `aantal` is PAID qty; free units are delivered on top of that.
          qty: row.aantal + freeUnits,
          freeQty: freeUnits
        });
        return {
          ...row,
          kortingPct: 0,
          omzet: totals.omzet,
          kosten: totals.kosten,
          kortingEur: totals.kortingEur,
          margeEur: totals.winst,
          margePct: totals.margePct
        };
      });
    }

    if (!staffelActive) {
      return rows;
    }

    const tiers = getStaffelTiers(current.staffels);
    const kortingByRef = computeStaffelKortingByProductRef({ rows, tiers });
    return rows.map((row) => {
      if (row.productType === "catalog") {
        return { ...row, kortingPct: 0 };
      }
      const ref = `${row.productType}|${row.productId}`;
      const nextKorting = kortingByRef.get(ref) ?? 0;
      const totals = calcOfferLineTotals({
        kostprijsEx: row.kostprijsPerStuk,
        offerPriceEx: row.offerPrijs,
        qty: row.aantal,
        kortingPct: nextKorting
      });
      return {
        ...row,
        kortingPct: nextKorting,
        omzet: totals.omzet,
        kosten: totals.kosten,
        kortingEur: totals.kortingEur,
        margeEur: totals.winst,
        margePct: totals.margePct
      };
    });
  }, [
    current.product_rows,
    (current as any).catalog_product_rows,
    bierNameMap,
    currentKanaal,
    activeVariantId,
    productDefinitionMap,
    selectedChannelOptions,
    verkoopstrategieWindow,
    catalogProductOptionMap,
    catalogProductCostById
  ]);

  const productTotals = useMemo(
    () =>
      productDisplayRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [productDisplayRows]
  );

  const offerteProductRows = useMemo(() => {
    if (offerLevel === "basis") {
      return productDisplayRows.filter((row) => row.productType === "basis" || row.productType === "catalog");
    }
    const compositeRows = productDisplayRows.filter((row) => row.productType === "samengesteld");
    if (compositeRows.length === 0) {
      return productDisplayRows;
    }

    // When offering "samengestelde producten", we still want to show standalone basisproducten
    // (e.g. fusten) in the main table, while keeping derived basisproducten under the derived section.
    const compositeDefinitions = new Map(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const derivedBaseIds = new Set<string>();
    for (const row of compositeRows) {
      const composite = compositeDefinitions.get(row.productId);
      const components = Array.isArray(composite?.basisproducten) ? (composite?.basisproducten as GenericRecord[]) : [];
      for (const component of components) {
        const basisId = String(component.basisproduct_id ?? "");
        if (basisId && !basisId.startsWith("verpakkingsonderdeel:")) {
          derivedBaseIds.add(basisId);
        }
      }
    }

    return productDisplayRows.filter((row) => {
      if (row.productType === "catalog") {
        return true;
      }
      if (row.productType === "samengesteld") {
        return true;
      }
      if (row.productType === "basis") {
        return !derivedBaseIds.has(row.productId);
      }
      return false;
    });
  }, [offerLevel, productDisplayRows]);

  const offerteProductTotals = useMemo(
    () =>
      offerteProductRows.filter((row) => row.included).reduce(
        (totals, row) => ({
          omzet: totals.omzet + row.omzet,
          kosten: totals.kosten + row.kosten,
          kortingEur: totals.kortingEur + row.kortingEur,
          margeEur: totals.margeEur + row.margeEur
        }),
        { omzet: 0, kosten: 0, kortingEur: 0, margeEur: 0 }
      ),
    [offerteProductRows]
  );

  const transportEffect = useMemo(() => {
    const blocks = getVariantBlocks(current, activeVariantId);
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const effectivePeriod: 1 | 2 = introEnabled ? activePeriodIndex : 2;
    const transportBlock = blocks.find(
      (b) => String((b as any).type) === "transport" && isBlockActiveForPeriod(b as any, effectivePeriod)
    ) as QuoteBuilderBlock | undefined;
    if (!transportBlock) {
      return null;
    }

    const ctx = ((current as any).builder_context as QuoteBuilderContext | undefined) ?? {
      postcode: "",
      distance_km: 0,
      transport_threshold_ex: 0
    };
    const postcode = normalizeText((transportBlock as any).postcode ?? ctx.postcode ?? "");
    const distanceKm = Math.max(0, toNumber((transportBlock as any).distance_km ?? ctx.distance_km ?? 0, 0));
    const kmThreshold = Math.max(0, toNumber((transportBlock as any).km_threshold ?? ctx.transport_km_threshold ?? 40, 40));
    const thresholdAmountEx = Math.max(
      0,
      toNumber((transportBlock as any).threshold_amount_ex ?? ctx.transport_threshold_ex ?? 0, 0)
    );
    const deliveries = Math.max(0, Math.floor(toNumber((transportBlock as any).deliveries ?? ctx.transport_deliveries ?? 1, 1)));
    const rateEx = Math.max(0, toNumber((transportBlock as any).rate_ex ?? ctx.transport_rate_ex ?? 0, 0));

    const baseOmzetEx = isLitersMode ? offerteLitersTotals.omzet : offerteProductTotals.omzet;

    const isValid = Boolean(postcode) && distanceKm > 0 && deliveries > 0 && rateEx > 0;
    if (!isValid) {
      return {
        isValid: false as const,
        message: "Transport mist postcode, afstand, leveringen of tarief.",
        mode: "cost" as const,
        omzet: 0,
        kosten: 0,
        btwPct: 21,
        amountEx: 0,
        deliveries,
        rateEx,
        distanceKm,
        kmThreshold,
        thresholdAmountEx
      };
    }

    // Rule: within km threshold -> cost. Above threshold:
    // - if thresholdAmountEx <= 0: always charge transport
    // - else: charge only when base omzet_ex < thresholdAmountEx; otherwise it's a cost (free shipping)
    const shouldCharge =
      distanceKm > kmThreshold && (thresholdAmountEx <= 0 || baseOmzetEx < thresholdAmountEx);

    const amountEx = deliveries * rateEx;
    const omzet = shouldCharge ? amountEx : 0;
    // Conservative: when charging transport we assume it is neutral (cost equals charged amount).
    const kosten = amountEx;

    return {
      isValid: true as const,
      message: "",
      mode: shouldCharge ? ("charge" as const) : ("cost" as const),
      omzet,
      kosten,
      btwPct: 21,
      amountEx,
      deliveries,
      rateEx,
      distanceKm,
      kmThreshold,
      thresholdAmountEx
    };
  }, [activePeriodIndex, activeVariantId, current, isLitersMode, offerteLitersTotals.omzet, offerteProductTotals.omzet]);

  const extrasEffects = useMemo(() => {
    const blocks = getVariantBlocks(current, activeVariantId);
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const effectivePeriod: 1 | 2 = introEnabled ? activePeriodIndex : 2;
    const extraBlocks = blocks.filter(
      (b) => String((b as any).type) === "extras" && isBlockActiveForPeriod(b as any, effectivePeriod)
    ) as QuoteBuilderBlock[];

    if (extraBlocks.length === 0) return [];

    const baseOmzetEx = isLitersMode ? offerteLitersTotals.omzet : offerteProductTotals.omzet;

    return extraBlocks
      .map((block) => {
        const label = normalizeText((block as any).extra_label ?? "Extra");
        const qty = Math.max(0, toNumber((block as any).extra_qty ?? 1, 1));
        const unitPriceEx = Math.max(0, toNumber((block as any).extra_unit_price_ex ?? 0, 0));
        const unitCostEx = Math.max(0, toNumber((block as any).extra_unit_cost_ex ?? 0, 0));
        const isFree = Boolean((block as any).extra_is_free ?? false);
        const thresholdAmountEx = Math.max(0, toNumber((block as any).extra_threshold_amount_ex ?? 0, 0));
        const meetsThreshold = thresholdAmountEx <= 0 || baseOmzetEx >= thresholdAmountEx;

        const effectiveIsFree = isFree || !meetsThreshold;
        const omzet = effectiveIsFree ? 0 : qty * unitPriceEx;
        const kosten = qty * unitCostEx;
        return {
          id: String(block.id ?? createId()),
          label,
          qty,
          unitPriceEx,
          unitCostEx,
          isFree: effectiveIsFree,
          thresholdAmountEx,
          meetsThreshold,
          omzet,
          kosten
        };
      })
      .filter((row) => row.qty > 0 && (row.unitPriceEx > 0 || row.unitCostEx > 0 || row.isFree));
  }, [activePeriodIndex, activeVariantId, current, isLitersMode, offerteLitersTotals.omzet, offerteProductTotals.omzet]);

  const derivedBasisRows = useMemo(() => {
    if (isLitersMode || offerLevel !== "samengesteld") {
      return [];
    }

    const compositeDefinitions = new Map(
      pickLatestKnownProductRows(samengesteldeProducten, currentYear).map((row) => [String(row.id ?? ""), row])
    );
    const baseLabels = new Map(
      pickLatestKnownProductRows(basisproducten, currentYear).map((row) => [String(row.id ?? ""), String(row.omschrijving ?? "")])
    );

    return offerteProductRows.flatMap((row) => {
      const composite = compositeDefinitions.get(row.productId);
      const components = Array.isArray(composite?.basisproducten) ? (composite?.basisproducten as GenericRecord[]) : [];
      return components
        .filter((component) => {
          const basisId = String(component.basisproduct_id ?? "");
          return Boolean(basisId) && !basisId.startsWith("verpakkingsonderdeel:");
        })
        .map((component) => {
          const basisId = String(component.basisproduct_id ?? "");
          const factor = Math.max(1, toNumber(component.aantal, 1));
          return {
            id: `${row.id}-${basisId}`,
            biernaam: row.biernaam,
            product: baseLabels.get(basisId) ?? basisId,
            aantal: row.aantal * factor,
            offerPrijs: row.offerPrijs / factor,
            sellInPrijs: row.sellInPrijs / factor
          };
        });
    });
  }, [basisproducten, currentYear, isLitersMode, offerLevel, offerteProductRows, samengesteldeProducten]);

  const wizardSidebar = useMemo(
    () => ({
      title: "Wizard",
      steps: wizardSteps,
      activeIndex: activeStepIndex,
      onStepSelect: setActiveStepIndex
    }),
    [activeStepIndex]
  );

  usePageShellWizardSidebar(wizardSidebar);

  function syncActiveVariantFromWorkingRows(next: GenericRecord) {
    const nextVariants = Array.isArray((next as any).variants) ? (((next as any).variants as unknown[]) as QuoteVariant[]) : [];
    if (nextVariants.length === 0) {
      nextVariants.push(buildDefaultVariantFromLegacy(next, normalizeKey(next.pricing_channel) || normalizeKey(next.kanaal) || defaultKanaal));
    }

    const nextActiveVariantId =
      String((next as any).active_variant_id ?? "").trim() || String(nextVariants[0]?.id ?? "");
    const nextPeriodIndex = toPeriodIndex((next as any).active_period_index, 2);

    let active = nextVariants.find((row) => String(row.id) === nextActiveVariantId);
    if (!active) {
      active = nextVariants[0];
      (next as any).active_variant_id = String(active?.id ?? "");
    }

    const mergeRows = (working: unknown, existing: unknown): QuoteLineRow[] => {
      const workingRows = Array.isArray(working) ? (working as GenericRecord[]) : [];
      const existingRows = Array.isArray(existing) ? (existing as GenericRecord[]) : [];
      const byId = new Map(existingRows.map((row) => [String((row as any).id ?? ""), row]));

      return workingRows
        .filter((row) => typeof row === "object" && row !== null)
        .map((row) => {
          const id = String((row as any).id ?? "");
          const prev = byId.get(id) ?? {};
          const kortingNow = toNumber((row as any).korting_pct, 0);

          const fallbackKorting = toNumber((prev as any).korting_pct, kortingNow);
          let p1 = toNumber((prev as any).korting_pct_p1, toNumber((row as any).korting_pct_p1, fallbackKorting));
          let p2 = toNumber((prev as any).korting_pct_p2, toNumber((row as any).korting_pct_p2, fallbackKorting));
          if (nextPeriodIndex === 1) {
            p1 = kortingNow;
          } else {
            p2 = kortingNow;
          }

          return {
            ...prev,
            ...row,
            id: id || String((prev as any).id ?? createId()),
            included: isIncluded((row as any).included),
            verpakking_label: String((row as any).verpakking_label ?? ""),
            kostprijsversie_id: String((row as any).kostprijsversie_id ?? ""),
            cost_at_quote: toNumber((row as any).cost_at_quote, toNumber((prev as any).cost_at_quote, 0)),
            sales_price_at_quote: toNumber((row as any).sales_price_at_quote, toNumber((prev as any).sales_price_at_quote, 0)),
            revenue_at_quote: toNumber((row as any).revenue_at_quote, toNumber((prev as any).revenue_at_quote, 0)),
            margin_at_quote: toNumber((row as any).margin_at_quote, toNumber((prev as any).margin_at_quote, 0)),
            target_margin_pct_at_quote: toNumber(
              (row as any).target_margin_pct_at_quote,
              toNumber((prev as any).target_margin_pct_at_quote, 0)
            ),
            channel_at_quote: String((row as any).channel_at_quote ?? (prev as any).channel_at_quote ?? ""),
            korting_pct: kortingNow,
            korting_pct_p1: p1,
            korting_pct_p2: p2,
            sell_in_price_override_p1: toNumber((prev as any).sell_in_price_override_p1, toNumber((row as any).sell_in_price_override_p1, 0)),
            sell_in_price_override_p2: toNumber((prev as any).sell_in_price_override_p2, toNumber((row as any).sell_in_price_override_p2, 0))
          } as QuoteLineRow;
        });
    };

    if (active) {
      active.product_rows = mergeRows((next as any).product_rows, (active as any).product_rows);
      active.beer_rows = mergeRows((next as any).beer_rows, (active as any).beer_rows);
      active.staffels = Array.isArray((next as any).staffels) ? ((next as any).staffels as GenericRecord[]) : [];
      active.channel_code = normalizeKey((active as any).channel_code) || normalizeKey((next as any).pricing_channel) || normalizeKey((next as any).kanaal) || defaultKanaal;
      active.periods = hasIntroBlock(next, String(active.id)) ? ensureVariantPeriods((active as any).periods) : [];
    }

    (next as any).variants = nextVariants;
    (next as any).active_variant_id = nextActiveVariantId;
    (next as any).active_period_index = nextPeriodIndex;
  }

  function selectVariant(variantId: string) {
    updateCurrent((draft) => {
      const list = Array.isArray((draft as any).variants) ? (((draft as any).variants as unknown[]) as QuoteVariant[]) : [];
      const target = list.find((row) => String(row.id) === String(variantId));
      if (!target) {
        return;
      }
      (draft as any).active_variant_id = String(target.id);
      const introEnabled = hasIntroBlock(draft, String(target.id));
      const periodIndex = introEnabled ? toPeriodIndex((draft as any).active_period_index, 2) : 2;
      if (!introEnabled) {
        (draft as any).active_period_index = 2;
      }
      draft.product_rows = applyVariantPeriodToWorkingRows(target.product_rows, periodIndex);
      draft.beer_rows = applyVariantPeriodToWorkingRows(target.beer_rows, periodIndex);
      draft.staffels = Array.isArray(target.staffels) ? target.staffels : [];
      draft.pricing_channel = normalizeKey(target.channel_code) || normalizeKey(draft.pricing_channel) || normalizeKey(draft.kanaal) || defaultKanaal;
    });
  }

  function selectPeriod(periodIndex: 1 | 2) {
    updateCurrent((draft) => {
      const list = Array.isArray((draft as any).variants) ? (((draft as any).variants as unknown[]) as QuoteVariant[]) : [];
      const activeId = String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
      if (!activeId || !hasIntroBlock(draft, activeId)) {
        // Period switching is disabled in simple mode.
        (draft as any).active_period_index = 2;
        return;
      }
      (draft as any).active_period_index = periodIndex;
      draft.product_rows = applyVariantPeriodToWorkingRows(
        Array.isArray(draft.product_rows) ? (draft.product_rows as GenericRecord[]) : [],
        periodIndex
      );
      draft.beer_rows = applyVariantPeriodToWorkingRows(
        Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : [],
        periodIndex
      );
    });
  }

  function addScenarioFromActive() {
    updateCurrent((draft) => {
      const quoteId = String(draft.id ?? createId());
      const list = Array.isArray((draft as any).variants) ? (((draft as any).variants as unknown[]) as QuoteVariant[]) : [];
      const existing = list.map((row) => String(row.id));
      const usedNumbers = existing
        .map((id) => {
          const match = id.match(/:v(\d+)$/);
          return match ? Number(match[1]) : NaN;
        })
        .filter((value) => Number.isFinite(value)) as number[];
      const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : list.length + 1;
      const nextId = `${quoteId}:v${nextNumber}`;

      const activeId = String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
      const source = list.find((row) => String(row.id) === activeId) ?? list[0] ?? buildDefaultVariantFromLegacy(draft, normalizeKey(draft.pricing_channel) || defaultKanaal);
      const nextName = `Scenario ${String.fromCharCode(64 + Math.min(26, nextNumber))}`; // A,B,C...

      const cloned: QuoteVariant = {
        id: nextId,
        name: nextName,
        channel_code: normalizeKey(source.channel_code) || normalizeKey(draft.pricing_channel) || defaultKanaal,
        return_pct: toNumber(source.return_pct, 0),
        sort_index: nextNumber - 1,
        periods: ensureVariantPeriods(source.periods),
        product_rows: normalizeVariantLineRows(source.product_rows),
        beer_rows: normalizeVariantLineRows(source.beer_rows),
        staffels: Array.isArray(source.staffels) ? (source.staffels as GenericRecord[]) : []
      };

      const nextList = [...list, cloned].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
      (draft as any).variants = nextList;
      (draft as any).active_variant_id = nextId;

      const periodIndex = toPeriodIndex((draft as any).active_period_index, 2);
      draft.product_rows = applyVariantPeriodToWorkingRows(cloned.product_rows, periodIndex);
      draft.beer_rows = applyVariantPeriodToWorkingRows(cloned.beer_rows, periodIndex);
      draft.staffels = cloned.staffels;
    });
  }

  function deleteActiveScenario() {
    updateCurrent((draft) => {
      const list = Array.isArray((draft as any).variants) ? (((draft as any).variants as unknown[]) as QuoteVariant[]) : [];
      if (list.length <= 1) {
        return;
      }
      const activeId = String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
      const nextList = list.filter((row) => String(row.id) !== activeId);
      (draft as any).variants = nextList;
      const nextActive = nextList[0];
      (draft as any).active_variant_id = String(nextActive?.id ?? "");
      const periodIndex = toPeriodIndex((draft as any).active_period_index, 2);
      if (nextActive) {
        draft.product_rows = applyVariantPeriodToWorkingRows(nextActive.product_rows, periodIndex);
        draft.beer_rows = applyVariantPeriodToWorkingRows(nextActive.beer_rows, periodIndex);
        draft.staffels = Array.isArray(nextActive.staffels) ? nextActive.staffels : [];
      }
    });
  }

  function updateActiveVariantMeta(field: "name" | "channel_code", value: string) {
    updateCurrent((draft) => {
      const list = Array.isArray((draft as any).variants) ? (((draft as any).variants as unknown[]) as QuoteVariant[]) : [];
      const activeId = String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
      const index = list.findIndex((row) => String(row.id) === activeId);
      if (index < 0) return;
      const next = [...list];
      next[index] = { ...next[index], [field]: value };
      (draft as any).variants = next;
      if (field === "channel_code") {
        draft.pricing_channel = normalizeKey(value) || normalizeKey(draft.pricing_channel) || normalizeKey(draft.kanaal) || defaultKanaal;
      }
    });
  }

  function updateCurrent(updater: (draft: GenericRecord) => void) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (String(row.id) !== String(current.id)) {
          return row;
        }
        const next = cloneRecord(row);
        updater(next);
        syncActiveVariantFromWorkingRows(next);
        next.last_step = activeStepIndex + 1;
        return next;
      })
    );
  }

  function requestDelete(title: string, body: string, onConfirm: () => void) {
    setPendingDelete({ title, body, onConfirm });
  }

  function withFrozenPricing(row: GenericRecord): GenericRecord {
    if (String(row.id ?? "") !== String(current.id)) {
      return row;
    }

    const next = cloneRecord(row);
    const productDisplayMap = new Map(productDisplayRows.map((item) => [item.id, item]));
    const litersDisplayMap = new Map(litersDisplayRows.map((item) => [item.id, item]));

    next.product_rows = (Array.isArray(next.product_rows) ? (next.product_rows as GenericRecord[]) : []).map(
      (item) => {
        const display = productDisplayMap.get(String(item.id ?? ""));
        if (!display) {
          return item;
        }
        return {
          ...item,
          included: display.included,
          kostprijsversie_id: display.kostprijsversieId,
          cost_at_quote: display.kostprijsPerStuk,
          sales_price_at_quote: display.offerPrijs,
          revenue_at_quote: display.omzet,
          margin_at_quote: display.margeEur,
          target_margin_pct_at_quote: display.sellInMargePct,
          channel_at_quote: currentKanaal,
          verpakking_label: display.verpakking
        };
      }
    );

    (next as any).catalog_product_rows = (Array.isArray((next as any).catalog_product_rows)
      ? ((next as any).catalog_product_rows as GenericRecord[])
      : []).map((item) => {
      const display = productDisplayMap.get(String((item as any).id ?? ""));
      if (!display || display.productType !== "catalog") {
        return item;
      }
      return {
        ...item,
        included: display.included,
        naam: display.verpakking,
        cost_at_quote: display.kostprijsPerStuk,
        sales_price_at_quote: display.offerPrijs,
        revenue_at_quote: display.omzet,
        margin_at_quote: display.margeEur,
        target_margin_pct_at_quote: display.sellInMargePct,
        channel_at_quote: currentKanaal
      };
    });

    next.beer_rows = (Array.isArray(next.beer_rows) ? (next.beer_rows as GenericRecord[]) : []).map((item) => {
      const display = litersDisplayMap.get(String(item.id ?? ""));
      if (!display) {
        return item;
      }
      return {
        ...item,
        included: display.included,
        kostprijsversie_id: display.kostprijsversieId,
        cost_at_quote: display.kostprijsPerLiter,
        sales_price_at_quote: display.offerPrijs,
        revenue_at_quote: display.omzet,
        margin_at_quote: display.margeEur,
        target_margin_pct_at_quote: display.sellInMargePct,
        channel_at_quote: currentKanaal,
        verpakking_label: display.verpakking
      };
    });

    next.kostprijsversie_ids = [
      ...new Set(
        [
          ...(Array.isArray(next.product_rows) ? (next.product_rows as GenericRecord[]).map((item) => String(item.kostprijsversie_id ?? "")) : []),
          ...(Array.isArray(next.beer_rows) ? (next.beer_rows as GenericRecord[]).map((item) => String(item.kostprijsversie_id ?? "")) : [])
        ].filter(Boolean)
      )
    ];

    return next;
  }

  async function handleSave(finalize = false) {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);

    try {
      const payload = rows.map((row) => {
        const next = cloneRecord(row);
        if (String(next.id ?? "").trim() === "") {
          next.id = createId();
        }
        // Year is context-only: persist as the active year set.
        next.jaar = currentYear;
        const frozen = withFrozenPricing(next);
        if (String(frozen.id ?? "") === String(current.id)) {
          frozen.status = finalize ? "definitief" : "concept";
          frozen.finalized_at = finalize ? new Date().toISOString() : "";
        }
        // Ensure variants/period values are persisted (not just the legacy working rows).
        // This makes scenario switching stable after save + refresh.
        syncActiveVariantFromWorkingRows(frozen);
        return frozen;
      });

      const response = await fetch(`${API_BASE_URL}/data/prijsvoorstellen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setRows(payload);
      onRowsChange?.(payload);
      setStatus(finalize ? "Prijsvoorstel definitief gemaakt." : "Prijsvoorstel opgeslagen.");
      setStatusTone("success");
      return true;
    } catch {
      setStatus("Opslaan mislukt.");
      setStatusTone("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteCurrent() {
    setStatus("");
    setStatusTone(null);
    setIsSaving(true);

    try {
      const payload = rows.filter((row) => String(row.id) !== String(current.id));
      const response = await fetch(`${API_BASE_URL}/data/prijsvoorstellen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Verwijderen mislukt");
      }

      setRows(payload);
      onRowsChange?.(payload);
      setStatus("Prijsvoorstel verwijderd.");
      setStatusTone("success");
      onBackToLanding?.();
    } catch {
      setStatus("Verwijderen mislukt.");
      setStatusTone("error");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSingleBeerChange(bierId: string) {
    updateCurrent((draft) => {
      draft.bier_id = bierId;
      draft.selected_bier_ids = bierId ? [bierId] : [];
      draft.beer_rows = bierId
        ? syncBeerRowsForSingleBeer(
            bierId,
            Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
          )
        : [];
    });
  }

  function handleBeerMultiSelection(selectedBeerIds: string[]) {
    updateCurrent((draft) => {
      draft.selected_bier_ids = selectedBeerIds;
      draft.bier_id = selectedBeerIds[0] ?? "";

      if (String(draft.voorsteltype ?? "") === "Op basis van producten") {
        draft.product_rows = syncProductRowsForBieren(
          selectedBeerIds,
          Array.isArray(draft.product_rows) ? (draft.product_rows as GenericRecord[]) : []
        );
      } else {
        draft.beer_rows = syncBeerRowsForMultipleBieren(
          selectedBeerIds,
          Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
        );
      }
    });
  }

  function handleCatalogMultiSelection(selectedCatalogIds: string[]) {
    updateCurrent((draft) => {
      (draft as any).selected_catalog_product_ids = selectedCatalogIds;
      (draft as any).catalog_product_rows = selectedCatalogIds.length
        ? syncCatalogProductRows(
            selectedCatalogIds,
            Array.isArray((draft as any).catalog_product_rows) ? ((draft as any).catalog_product_rows as GenericRecord[]) : []
          )
        : [];
    });
  }

  function handleHighestOverallSetup() {
    updateCurrent((draft) => {
      draft.bier_id = "";
      draft.selected_bier_ids = [];
      draft.beer_rows = syncHighestOverallRows(
        Array.isArray(draft.beer_rows) ? (draft.beer_rows as GenericRecord[]) : []
      );
    });
  }

  function updateBeerRow(
    rowId: string,
    field: "liters" | "korting_pct" | "included",
    value: number | boolean
  ) {
    updateCurrent((draft) => {
      const nextRows = Array.isArray(draft.beer_rows) ? [...(draft.beer_rows as GenericRecord[])] : [];
      const index = nextRows.findIndex((row) => String(row.id ?? "") === rowId);
      if (index < 0) {
        return;
      }
      const nextRow = { ...nextRows[index], [field]: value };
      if (field === "korting_pct") {
        (nextRow as any)[activePeriodIndex === 1 ? "korting_pct_p1" : "korting_pct_p2"] = value;
      }
      nextRows[index] = nextRow;
      draft.beer_rows = nextRows;
    });
  }

  function updateProductRow(
    rowId: string,
    field: "aantal" | "korting_pct" | "included",
    value: number | boolean
  ) {
    updateCurrent((draft) => {
      const nextRows = Array.isArray(draft.product_rows) ? [...(draft.product_rows as GenericRecord[])] : [];
      const index = nextRows.findIndex((row) => String(row.id ?? "") === rowId);
      if (index < 0) {
        return;
      }
      const nextRow = { ...nextRows[index], [field]: value };
      if (field === "korting_pct") {
        (nextRow as any)[activePeriodIndex === 1 ? "korting_pct_p1" : "korting_pct_p2"] = value;
      }
      nextRows[index] = nextRow;
      draft.product_rows = nextRows;
    });
  }

  function updateCatalogProductRow(
    rowId: string,
    field: "aantal" | "korting_pct" | "included",
    value: number | boolean
  ) {
    updateCurrent((draft) => {
      const nextRows = Array.isArray((draft as any).catalog_product_rows)
        ? [...((draft as any).catalog_product_rows as GenericRecord[])]
        : [];
      const index = nextRows.findIndex((row) => String(row.id ?? "") === rowId);
      if (index < 0) {
        return;
      }
      const nextRow = { ...nextRows[index], [field]: value };
      if (field === "korting_pct") {
        (nextRow as any)[activePeriodIndex === 1 ? "korting_pct_p1" : "korting_pct_p2"] = value;
      }
      nextRows[index] = nextRow;
      (draft as any).catalog_product_rows = nextRows;
    });
  }

  useEffect(() => {
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];

    if (!isLitersMode) {
      const desiredRows = selectedBeerIds.length
        ? syncProductRowsForBieren(
            selectedBeerIds,
            Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []
          )
        : [];

      const currentSignature = JSON.stringify(
        (Array.isArray(current.product_rows) ? (current.product_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.product_rows = desiredRows;
        });
      }
      return;
    }

    if (litersBasis === "een_bier") {
      const bierId = String(current.bier_id ?? "");
      const desiredRows = bierId
        ? (() => {
            const currentBeerRows = Array.isArray(current.beer_rows)
              ? (current.beer_rows as GenericRecord[])
              : [];
            const currentProductRows = Array.isArray(current.product_rows)
              ? (current.product_rows as GenericRecord[])
              : [];
            const fromProducts = syncBeerRowsFromProductRows(
              bierId,
              currentProductRows,
              currentBeerRows
            );
            return fromProducts.length > 0
              ? fromProducts
              : syncBeerRowsForSingleBeer(bierId, currentBeerRows);
          })()
        : [];
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? ""),
          product_id: String(row.product_id ?? ""),
          product_type: String(row.product_type ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.selected_bier_ids = bierId ? [bierId] : [];
          draft.beer_rows = desiredRows;
        });
      }
      return;
    }

    if (litersBasis === "meerdere_bieren") {
      const desiredRows = syncBeerRowsForMultipleBieren(
        selectedBeerIds,
        Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []
      );
      const currentSignature = JSON.stringify(
        (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
          bier_id: String(row.bier_id ?? "")
        }))
      );
      const desiredSignature = JSON.stringify(
        desiredRows.map((row) => ({
          bier_id: String(row.bier_id ?? "")
        }))
      );

      if (currentSignature !== desiredSignature) {
        updateCurrent((draft) => {
          draft.beer_rows = desiredRows;
        });
      }
      return;
    }

    const desiredRows = syncHighestOverallRows(
      Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []
    );
    const currentSignature = JSON.stringify(
      (Array.isArray(current.beer_rows) ? (current.beer_rows as GenericRecord[]) : []).map((row) => ({
        bier_id: String(row.bier_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? "")
      }))
    );
    const desiredSignature = JSON.stringify(
      desiredRows.map((row) => ({
        bier_id: String(row.bier_id ?? ""),
        product_id: String(row.product_id ?? ""),
        product_type: String(row.product_type ?? "")
      }))
    );

    if (currentSignature !== desiredSignature) {
      updateCurrent((draft) => {
        draft.beer_rows = desiredRows;
      });
    }
  }, [
    current.bier_id,
    current.beer_rows,
    current.selected_bier_ids,
    current.product_rows,
    currentYear,
    isLitersMode,
    litersBasis
  ]);

  useEffect(() => {
    if (isLitersMode) {
      return;
    }
    const selectedCatalogIds = Array.isArray((current as any).selected_catalog_product_ids)
      ? ((current as any).selected_catalog_product_ids as string[]).filter(Boolean)
      : [];
    const desiredRows = selectedCatalogIds.length
      ? syncCatalogProductRows(
          selectedCatalogIds,
          Array.isArray((current as any).catalog_product_rows) ? ((current as any).catalog_product_rows as GenericRecord[]) : []
        )
      : [];

    const currentSignature = JSON.stringify(
      (Array.isArray((current as any).catalog_product_rows) ? ((current as any).catalog_product_rows as GenericRecord[]) : []).map((row) => ({
        catalog_product_id: String((row as any).catalog_product_id ?? "")
      }))
    );
    const desiredSignature = JSON.stringify(
      desiredRows.map((row) => ({
        catalog_product_id: String((row as any).catalog_product_id ?? "")
      }))
    );

    if (currentSignature !== desiredSignature) {
      updateCurrent((draft) => {
        (draft as any).catalog_product_rows = desiredRows;
      });
    }
  }, [current.selected_catalog_product_ids, current.catalog_product_rows, isLitersMode, catalogProductOptionMap]);

  function renderBasisStep() {
    const offerteDatum = getDateInputValue(current.datum_text);
    const verloopOp = getDateInputValue(current.verloopt_op);

    return (
      <div className="wizard-form-grid">
        <label className="nested-field">
          <span>Klantnaam</span>
          <input
            className="dataset-input"
            value={String(current.klantnaam ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.klantnaam = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Status</span>
          <input
            className="dataset-input"
            value={String(current.status ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.status = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Offertenummer</span>
          <input
            className="dataset-input"
            value={String(current.offertenummer ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.offertenummer = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Offertedatum</span>
          <input
            className="dataset-input"
            type="date"
            value={offerteDatum}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.datum_text = event.target.value;
                const huidigeVerlooptOp = normalizeText(draft.verloopt_op);
                if (!huidigeVerlooptOp || huidigeVerlooptOp === verloopOp) {
                  draft.verloopt_op = event.target.value ? addDays(event.target.value, 30) : "";
                }
              })
            }
          />
        </label>
        <label className="nested-field">
          <span>Verloopt op</span>
          <input
            className="dataset-input"
            type="date"
            value={verloopOp || (offerteDatum ? addDays(offerteDatum, 30) : "")}
            onChange={(event) => updateCurrent((draft) => void (draft.verloopt_op = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Jaar</span>
          <div className="dataset-input dataset-input-readonly">{String(currentYear)}</div>
        </label>
        <label className="nested-field">
          <span>Contactpersoon</span>
          <input
            className="dataset-input"
            value={String(current.contactpersoon ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => void (draft.contactpersoon = event.target.value))
            }
          />
        </label>
        <label className="nested-field">
          <span>Referentie</span>
          <input
            className="dataset-input"
            value={String(current.referentie ?? "")}
            onChange={(event) => updateCurrent((draft) => void (draft.referentie = event.target.value))}
          />
        </label>
        <label className="nested-field">
          <span>Postcode</span>
          <input
            className="dataset-input"
            value={String(((current as any).builder_context as QuoteBuilderContext | undefined)?.postcode ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                const ctx = ((draft as any).builder_context as QuoteBuilderContext | undefined) ?? {
                  postcode: "",
                  distance_km: 0,
                  transport_threshold_ex: 0
                };
                (draft as any).builder_context = { ...ctx, postcode: event.target.value };
              })
            }
            placeholder="1234AB"
          />
        </label>
        <label className="nested-field">
          <span>Afstand (km)</span>
          <input
            className="dataset-input"
            type="number"
            inputMode="decimal"
            value={String(((current as any).builder_context as QuoteBuilderContext | undefined)?.distance_km ?? 0)}
            onChange={(event) => {
              const next = parseNumberLoose(event.target.value);
              updateCurrent((draft) => {
                const ctx = ((draft as any).builder_context as QuoteBuilderContext | undefined) ?? {
                  postcode: "",
                  distance_km: 0,
                  transport_threshold_ex: 0
                };
                (draft as any).builder_context = { ...ctx, distance_km: Number.isFinite(next) ? next : 0 };
              });
            }}
          />
        </label>
        <label className="nested-field">
          <span>Transport drempel (ex)</span>
          <input
            className="dataset-input"
            type="number"
            inputMode="decimal"
            value={String(
              ((current as any).builder_context as QuoteBuilderContext | undefined)?.transport_threshold_ex ?? 0
            )}
            onChange={(event) => {
              const next = parseNumberLoose(event.target.value);
              updateCurrent((draft) => {
                const ctx = ((draft as any).builder_context as QuoteBuilderContext | undefined) ?? {
                  postcode: "",
                  distance_km: 0,
                  transport_threshold_ex: 0
                };
                (draft as any).builder_context = {
                  ...ctx,
                  transport_threshold_ex: Number.isFinite(next) ? next : 0
                };
              });
            }}
          />
        </label>
      </div>
    );
  }

  function renderUitgangspuntenStep() {
    return (
      <UitgangspuntenStep
        row={current}
        kanaalOptions={channelOptions}
        litersBasisOptions={LITERS_BASIS_OPTIONS}
        onChange={updateCurrent}
      />
    );
  }

  function renderBeerSelectionList(
    selectedValues: string[],
    onToggle: (nextValues: string[]) => void
  ) {
    return (
      <SearchableMultiSelect
        label="Bieren"
        options={bierOptions}
        selectedValues={selectedValues}
        onChange={onToggle}
      />
    );
  }

  function renderCatalogSelectionList(
    selectedValues: string[],
    onToggle: (nextValues: string[]) => void
  ) {
    return (
      <SearchableMultiSelect
        label="Verkoopbare artikelen"
        options={catalogProductOptions}
        selectedValues={selectedValues}
        onChange={onToggle}
      />
    );
  }

  function renderIncludeToggle(
    included: boolean,
    onToggle: () => void,
    label: string
  ) {
    return (
      <button
        type="button"
        className={`visibility-toggle-button ${included ? "is-included" : "is-excluded"}`}
        onClick={onToggle}
        aria-label={label}
        title={label}
      >
        {included ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="visibility-toggle-icon">
            <path
              d="M2.2 12s3.6-6 9.8-6 9.8 6 9.8 6-3.6 6-9.8 6-9.8-6-9.8-6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="visibility-toggle-icon">
            <path
              d="M2.2 12s3.6-6 9.8-6c2.2 0 4.1.7 5.6 1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M21.8 12s-3.6 6-9.8 6c-2.2 0-4.1-.7-5.6-1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 4 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    );
  }

  function renderLitersOfferte(editPricing: boolean = true) {
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const kanaalLabel = currentKanaalLabel;
    const transportForStep = editPricing ? transportEffect : null;
    const extrasForStep = editPricing ? extrasEffects : [];
    const extrasTotals = extrasForStep.reduce(
      (totals, row) => ({
        omzet: totals.omzet + row.omzet,
        kosten: totals.kosten + row.kosten
      }),
      { omzet: 0, kosten: 0 }
    );
    const totalsWithAdjustments = {
      omzet: offerteLitersTotals.omzet + (transportForStep?.isValid ? transportForStep.omzet : 0) + extrasTotals.omzet,
      kosten: offerteLitersTotals.kosten + (transportForStep?.isValid ? transportForStep.kosten : 0) + extrasTotals.kosten,
      kortingEur: offerteLitersTotals.kortingEur,
      margeEur:
        offerteLitersTotals.margeEur +
        (transportForStep?.isValid ? transportForStep.omzet - transportForStep.kosten : 0) +
        (extrasTotals.omzet - extrasTotals.kosten)
    };
    const totalMargePct = calcMarginPctFromRevenueCost(totalsWithAdjustments.omzet, totalsWithAdjustments.kosten);
    const activeBlocks = getVariantBlocks(current, activeVariantId);
    const pricingRuleActive = activeBlocks.some((block) =>
      ["discount_pct", "staffel", "xy_gratis"].includes(String((block as any).type))
    );

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Selectie</div>
          <div className="module-card-text">
            Kies hieronder het bier of de bieren waarop deze liters-offerte moet worden gebaseerd.
          </div>

          {litersBasis === "een_bier" ? (
            <div className="wizard-form-grid prijs-uitgangspunten-form-grid">
              <label className="nested-field">
                <span>Bier</span>
                <select
                  className="dataset-input"
                  value={String(current.bier_id ?? "")}
                  onChange={(event) => handleSingleBeerChange(event.target.value)}
                >
                  <option value="">Kies een bier...</option>
                  {bierOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : litersBasis === "meerdere_bieren" ? (
            renderBeerSelectionList(selectedBeerIds, handleBeerMultiSelection)
          ) : (
            <div className="editor-actions-group">
              <span className="muted">
                Gebruik de hoogste bekende kostprijs van alle actieve kostprijsversies in {currentYear}.
              </span>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={handleHighestOverallSetup}
              >
                Literregel opbouwen
              </button>
            </div>
          )}
        </div>

        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{isMultiKanaalMode ? selectedKanaalLabels : kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(totalsWithAdjustments.margeEur)} ({formatPercentage(totalMargePct)})
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Liters</th>
                <th>Korting %</th>
                <th>{costPriceLabel}</th>
                {isMultiKanaalMode
                  ? selectedChannelOptions.map((option) => (
                      <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                    ))
                  : <th>{offerPriceLabel}</th>}
                {!isMultiKanaalMode ? (
                  <>
                    <th>Omzet</th>
                    <th>Kosten</th>
                    <th>{discountAmountLabel}</th>
                    <th>Winst</th>
                    <th>Onze marge</th>
                  </>
                ) : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offerteLitersRows.map((row) => (
                <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.01"
                      style={{ minWidth: "8.5rem" }}
                      value={String(row.liters)}
                      onChange={(event) =>
                        updateBeerRow(row.id, "liters", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dataset-input"
                      type="number"
                      min={0}
                      step="0.1"
                      style={{ minWidth: "8rem" }}
                      value={String(row.kortingPct)}
                      disabled={!editPricing || pricingRuleActive}
                      onChange={(event) =>
                        updateBeerRow(row.id, "korting_pct", Number(event.target.value || 0))
                      }
                    />
                  </td>
                  <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerLiter)}</div></td>
                  {isMultiKanaalMode
                    ? selectedChannelOptions.map((option) => (
                        <td key={`${option.value}-offer`}>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(row.offerByChannel[option.value] ?? 0)}
                          </div>
                        </td>
                      ))
                    : (
                      <>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.offerPrijs)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.omzet)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kosten)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.kortingEur)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatEuro(row.margeEur)}</div></td>
                        <td><div className="dataset-input dataset-input-readonly">{formatPercentage(row.margePct)}</div></td>
                      </>
                    )}
                  <td>
                    {renderIncludeToggle(
                      row.included,
                      () => updateBeerRow(row.id, "included", !row.included),
                      row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                    )}
                  </td>
                </tr>
              ))}
              {editPricing && !isMultiKanaalMode && transportEffect ? (
                transportEffect.isValid ? (
                  <tr key="transport-line-liters" className="is-derived-row">
                    <td style={{ color: "var(--muted-text)" }}>-</td>
                    <td style={{ fontWeight: 600 }}>
                      Transport{" "}
                      <span style={{ color: "var(--muted-text)", fontWeight: 400 }}>
                        ({transportEffect.deliveries} levering{transportEffect.deliveries === 1 ? "" : "en"}
                        {transportEffect.mode === "charge" ? ", doorbelast" : ", kosten"})
                      </span>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">-</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">-</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.rateEx)}</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">
                        {formatEuro(transportEffect.mode === "charge" ? transportEffect.rateEx : 0)}
                      </div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.omzet)}</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.kosten)}</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">
                        {formatEuro(transportEffect.omzet - transportEffect.kosten)}
                      </div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">-</div>
                    </td>
                    <td />
                  </tr>
                ) : (
                  <tr key="transport-line-liters-invalid">
                    <td colSpan={12} className="prijs-empty-cell">
                      Transport blok is ingesteld maar mist gegevens: {transportEffect.message}
                    </td>
                  </tr>
                )
              ) : null}
              {editPricing && !isMultiKanaalMode
                ? extrasEffects.map((extra) => (
                    <tr key={`extra-${extra.id}`} className="is-derived-row">
                      <td style={{ color: "var(--muted-text)" }}>-</td>
                      <td style={{ fontWeight: 600 }}>
                        {extra.label}{" "}
                        <span style={{ color: "var(--muted-text)", fontWeight: 400 }}>
                          (extra{extra.isFree ? ", gratis" : ""})
                        </span>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">-</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">-</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.unitCostEx)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">
                          {formatEuro(extra.isFree ? 0 : extra.unitPriceEx)}
                        </div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.omzet)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.kosten)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">
                          {formatEuro(extra.omzet - extra.kosten)}
                        </div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">-</div>
                      </td>
                      <td />
                    </tr>
                  ))
                : null}
              {offerteLitersRows.length === 0 ? (
                <tr>
                  <td colSpan={isMultiKanaalMode ? 6 + selectedChannelOptions.length : 12} className="prijs-empty-cell">
                    Kies eerst een bier of zet een literscenario klaar om de offerte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {offerLevel === "samengesteld" && derivedBasisLitersRows.length > 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-title">Afgeleide basisproducten</div>
            <div className="module-card-text">
              Deze basisproducten volgen readonly het samengestelde product en tellen niet mee in omzet of winst.
            </div>
            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Bier</th>
                    <th>Basisproduct</th>
                    <th>Liters</th>
                    <th>{offerPriceLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedBasisLitersRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.biernaam}</td>
                      <td>{row.verpakking}</td>
                      <td>{formatNumber(row.liters)}</td>
                      <td>{formatEuro(row.offerPrijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProductOfferte(editPricing: boolean = true) {
    const selectedBeerIds = Array.isArray(current.selected_bier_ids)
      ? (current.selected_bier_ids as string[]).filter(Boolean)
      : [];
    const selectedCatalogIds = Array.isArray((current as any).selected_catalog_product_ids)
      ? (((current as any).selected_catalog_product_ids as string[]) ?? []).filter(Boolean)
      : [];
    const kanaalLabel = currentKanaalLabel;
    const transportForStep = editPricing ? transportEffect : null;
    const extrasForStep = editPricing ? extrasEffects : [];
    const extrasTotals = extrasForStep.reduce(
      (totals, row) => ({
        omzet: totals.omzet + row.omzet,
        kosten: totals.kosten + row.kosten
      }),
      { omzet: 0, kosten: 0 }
    );
    const totalsWithAdjustments = {
      omzet: offerteProductTotals.omzet + (transportForStep?.isValid ? transportForStep.omzet : 0) + extrasTotals.omzet,
      kosten: offerteProductTotals.kosten + (transportForStep?.isValid ? transportForStep.kosten : 0) + extrasTotals.kosten,
      kortingEur: offerteProductTotals.kortingEur,
      margeEur:
        offerteProductTotals.margeEur +
        (transportForStep?.isValid ? transportForStep.omzet - transportForStep.kosten : 0) +
        (extrasTotals.omzet - extrasTotals.kosten)
    };
    const totalMargePct = calcMarginPctFromRevenueCost(totalsWithAdjustments.omzet, totalsWithAdjustments.kosten);
    const activeBlocks = getVariantBlocks(current, activeVariantId);
    const pricingRuleActive = activeBlocks.some((block) =>
      ["discount_pct", "staffel", "xy_gratis"].includes(String((block as any).type))
    );
    const gratisContext = editPricing ? getGratisContextForCurrentPeriod() : null;

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Selectie</div>
          <div className="module-card-text">
            Kies één of meer bieren met een actieve kostprijsversie. De app haalt daarna automatisch de gekoppelde
            producten en kostprijzen op uit de actieve kostprijsversies.
          </div>
          {renderBeerSelectionList(selectedBeerIds, handleBeerMultiSelection)}
          <div className="module-card-text" style={{ marginTop: "0.75rem" }}>
            Optioneel: voeg verkoopbare artikelen toe (bijv. geschenkverpakkingen). De kostprijs wordt live afgeleid uit
            de onderliggende regels (bieren en verpakkingsonderdelen) voor {currentYear}.
          </div>
          {catalogProductOptions.length > 0 ? (
            renderCatalogSelectionList(selectedCatalogIds, handleCatalogMultiSelection)
          ) : (
            <div className="dataset-empty">Nog geen verkoopbare artikelen beschikbaar.</div>
          )}
        </div>

        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{isMultiKanaalMode ? selectedKanaalLabels : kanaalLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale omzet</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.omzet)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale kosten</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.kosten)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale korting</div>
            <div className="stat-value small">{formatEuro(totalsWithAdjustments.kortingEur)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Totale marge</div>
            <div className="stat-value small">
              {formatEuro(totalsWithAdjustments.margeEur)} ({formatPercentage(totalMargePct)})
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Aantal</th>
                <th>Korting %</th>
                <th>{costPriceLabel}</th>
                {isMultiKanaalMode
                  ? selectedChannelOptions.map((option) => (
                      <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                    ))
                  : <th>{offerPriceLabel}</th>}
                {!isMultiKanaalMode ? (
                  <>
                    <th>Omzet</th>
                    <th>Kosten</th>
                    <th>{discountAmountLabel}</th>
                    <th>Winst</th>
                    <th>Onze marge</th>
                  </>
                ) : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offerteProductRows.flatMap((row) => {
                const output: ReactNode[] = [];
                const ref = `${row.productType}|${row.productId}`;
                const freeUnits =
                  gratisContext && row.productType !== "catalog" ? (gratisContext.freeByRef.get(ref) ?? 0) : 0;

                // When X+Y applies we show the paid line + an explicit gratis line.
                // We keep totals correct by splitting cost/discount across these 2 rows.
                const paidTotals =
                  freeUnits > 0 && !isMultiKanaalMode
                    ? calcOfferLineTotals({
                        kostprijsEx: row.kostprijsPerStuk,
                        offerPriceEx: row.offerPrijs,
                        qty: row.aantal,
                        kortingPct: 0
                      })
                    : null;
                const freeKortingEur = freeUnits > 0 ? freeUnits * Math.max(0, toFiniteNumber(row.offerPrijs, 0)) : 0;
                const freeKosten = freeUnits > 0 ? freeUnits * Math.max(0, toFiniteNumber(row.kostprijsPerStuk, 0)) : 0;

                output.push(
                  <tr key={row.id} className={row.included ? "" : "is-excluded"}>
                    <td>{row.biernaam}</td>
                    <td>{row.verpakking}</td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        min={0}
                        step="1"
                        style={{ minWidth: "8rem" }}
                        value={String(row.aantal)}
                        onChange={(event) =>
                          (row.productType === "catalog" ? updateCatalogProductRow : updateProductRow)(
                            row.id,
                            "aantal",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dataset-input"
                        type="number"
                        min={0}
                        step="0.1"
                        style={{ minWidth: "8rem" }}
                        value={String(row.kortingPct)}
                        disabled={!editPricing || pricingRuleActive}
                        onChange={(event) =>
                          (row.productType === "catalog" ? updateCatalogProductRow : updateProductRow)(
                            row.id,
                            "korting_pct",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerStuk)}</div>
                    </td>
                    {isMultiKanaalMode ? (
                      selectedChannelOptions.map((option) => (
                        <td key={`${option.value}-offer`}>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(row.offerByChannel[option.value] ?? 0)}
                          </div>
                        </td>
                      ))
                    ) : (
                      <>
                        <td>
                          <div className="dataset-input dataset-input-readonly">{formatEuro(row.offerPrijs)}</div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(paidTotals ? paidTotals.omzet : row.omzet)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(paidTotals ? paidTotals.kosten : row.kosten)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(paidTotals ? 0 : row.kortingEur)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(paidTotals ? paidTotals.winst : row.margeEur)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatPercentage(paidTotals ? paidTotals.margePct : row.margePct)}
                          </div>
                        </td>
                      </>
                    )}
                    <td>
                      {renderIncludeToggle(
                        row.included,
                        () =>
                          (row.productType === "catalog" ? updateCatalogProductRow : updateProductRow)(
                            row.id,
                            "included",
                            !row.included
                          ),
                        row.included ? "Niet meenemen in offerte" : "Wel meenemen in offerte"
                      )}
                    </td>
                  </tr>
                );

                if (freeUnits > 0) {
                  const freeId = `${row.id}:gratis`;
                  output.push(
                    <tr key={freeId} className={row.included ? "" : "is-excluded"}>
                      <td style={{ color: "var(--muted-text)" }}>{row.biernaam}</td>
                      <td style={{ color: "var(--muted-text)" }}>{row.verpakking} (gratis)</td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatNumber(freeUnits, 0)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">gratis</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(row.kostprijsPerStuk)}</div>
                      </td>
                      {isMultiKanaalMode ? (
                        selectedChannelOptions.map((option) => (
                          <td key={`${freeId}-${option.value}-offer`}>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                          </td>
                        ))
                      ) : (
                        <>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                          </td>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                          </td>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(freeKosten)}</div>
                          </td>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(freeKortingEur)}</div>
                          </td>
                          <td>
                            <div className="dataset-input dataset-input-readonly">{formatEuro(-freeKosten)}</div>
                          </td>
                          <td>
                            <div className="dataset-input dataset-input-readonly">-</div>
                          </td>
                        </>
                      )}
                      <td />
                    </tr>
                  );
                }

                return output;
              })}
              {editPricing && !isMultiKanaalMode && transportEffect ? (
                transportEffect.isValid ? (
                  <tr key="transport-line" className="is-derived-row">
                    <td style={{ color: "var(--muted-text)" }}>-</td>
                    <td style={{ fontWeight: 600 }}>
                      Transport{" "}
                      <span style={{ color: "var(--muted-text)", fontWeight: 400 }}>
                        ({transportEffect.deliveries} levering{transportEffect.deliveries === 1 ? "" : "en"}
                        {transportEffect.mode === "charge" ? ", doorbelast" : ", kosten"})
                      </span>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">
                        {formatNumber(transportEffect.deliveries, 0)}
                      </div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">-</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.rateEx)}</div>
                    </td>
                    {isMultiKanaalMode ? null : (
                      <>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(transportEffect.mode === "charge" ? transportEffect.rateEx : 0)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.omzet)}</div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">{formatEuro(transportEffect.kosten)}</div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">
                            {formatEuro(transportEffect.omzet - transportEffect.kosten)}
                          </div>
                        </td>
                        <td>
                          <div className="dataset-input dataset-input-readonly">-</div>
                        </td>
                      </>
                    )}
                    <td />
                  </tr>
                ) : (
                  <tr key="transport-line-invalid">
                    <td colSpan={12} className="prijs-empty-cell">
                      Transport blok is ingesteld maar mist gegevens: {transportEffect.message}
                    </td>
                  </tr>
                )
              ) : null}
              {editPricing && !isMultiKanaalMode
                ? extrasEffects.map((extra) => (
                    <tr key={`extra-${extra.id}`} className="is-derived-row">
                      <td style={{ color: "var(--muted-text)" }}>-</td>
                      <td style={{ fontWeight: 600 }}>
                        {extra.label}{" "}
                        <span style={{ color: "var(--muted-text)", fontWeight: 400 }}>
                          (extra{extra.isFree ? ", gratis" : ""})
                        </span>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatNumber(extra.qty, 0)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">-</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.unitCostEx)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">
                          {formatEuro(extra.isFree ? 0 : extra.unitPriceEx)}
                        </div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.omzet)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(extra.kosten)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">{formatEuro(0)}</div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">
                          {formatEuro(extra.omzet - extra.kosten)}
                        </div>
                      </td>
                      <td>
                        <div className="dataset-input dataset-input-readonly">-</div>
                      </td>
                      <td />
                    </tr>
                  ))
                : null}
              {offerteProductRows.length === 0 ? (
                <tr>
                  <td colSpan={isMultiKanaalMode ? 6 + selectedChannelOptions.length : 12} className="prijs-empty-cell">
                    Kies eerst een of meer bieren om de productofferte op te bouwen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {offerLevel === "samengesteld" && derivedBasisRows.length > 0 ? (
          <div className="module-card compact-card">
            <div className="module-card-title">Afgeleide basisproducten</div>
            <div className="module-card-text">
              Deze basisproducten volgen readonly het samengestelde product en tellen niet mee in omzet of winst.
            </div>
            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Bier</th>
                    <th>Basisproduct</th>
                    <th>Aantal</th>
                    <th>{offerPriceLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedBasisRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.biernaam}</td>
                      <td>{row.product}</td>
                      <td>{formatNumber(row.aantal, 0)}</td>
                      <td>{formatEuro(row.offerPrijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderOfferteStep() {
    const canDeleteScenario = variants.length > 1;
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const effectivePeriodIndex: 1 | 2 = introEnabled ? activePeriodIndex : 2;
    const periodLabel = introEnabled
      ? (activePeriod?.label || (effectivePeriodIndex === 1 ? "Introductie" : "Standaard"))
      : "Standaard";
    const scenarioLabel = activeVariant?.name || "Scenario";
    const activeKanaalLabel = channelOptionMap.get(normalizeKey(activeVariant?.channel_code) || currentKanaal)?.label ?? currentKanaalLabel;

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Bouwblokken</div>
          <div className="module-card-text">
            Voeg optionele prijsblokken toe aan het actieve scenario. Voor nu is alleen <strong>% korting</strong>{" "}
            beschikbaar als proof-of-concept.
          </div>
          <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
            <div className="editor-actions-group">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  setIntroDraftStart(getDateInputValue(activePeriod?.start_date) || "");
                  setIntroDraftEnd(getDateInputValue(activePeriod?.end_date) || "");
                  setIntroModalOpen(true);
                }}
              >
                Introductie
              </button>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  const existing = getStaffelTiers(current.staffels);
                  setStaffelDraftTiers(existing);
                  setStaffelModalOpen(true);
                }}
                disabled={hasXyGratisBlock(current, activeVariantId)}
              >
                Staffel
              </button>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  setXyDraftRequired(4);
                  setXyDraftFree(1);
                  setXyDraftApplies(effectivePeriodIndex === 1 ? "intro" : "standard");
                  setXyDraftEligibleRefs([]);
                  setXyGratisModalOpen(true);
                }}
                disabled={isLitersMode || hasStaffelBlock(current, activeVariantId)}
                title={isLitersMode ? "X+Y gratis werkt nu alleen in productenmodus." : undefined}
              >
                X+Y gratis
              </button>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  setDiscountDraftPct(0);
                  setDiscountDraftApplies(effectivePeriodIndex === 1 ? "intro" : "standard");
                  setDiscountModalOpen(true);
                }}
                disabled={hasStaffelBlock(current, activeVariantId) || hasXyGratisBlock(current, activeVariantId)}
              >
                % korting
              </button>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  const blocks = getVariantBlocks(current, activeVariantId);
                  const existing = blocks.find((b) => String((b as any).type) === "transport") as QuoteBuilderBlock | undefined;
                  const ctx = ((current as any).builder_context as QuoteBuilderContext | undefined) ?? {
                    postcode: "",
                    distance_km: 0,
                    transport_threshold_ex: 0
                  };
                  setTransportDraftApplies(
                    (existing?.applies_to_periods as any) ?? (effectivePeriodIndex === 1 ? "intro" : "standard")
                  );
                  setTransportDraftPostcode(String((existing as any)?.postcode ?? ctx.postcode ?? ""));
                  setTransportDraftDistanceKm(
                    toNumber((existing as any)?.distance_km ?? ctx.distance_km ?? 0, 0)
                  );
                  setTransportDraftKmThreshold(
                    toNumber((existing as any)?.km_threshold ?? ctx.transport_km_threshold ?? 40, 40)
                  );
                  setTransportDraftThresholdEx(
                    toNumber((existing as any)?.threshold_amount_ex ?? ctx.transport_threshold_ex ?? 0, 0)
                  );
                  setTransportDraftDeliveries(
                    Math.max(
                      1,
                      Math.floor(toNumber((existing as any)?.deliveries ?? ctx.transport_deliveries ?? 1, 1))
                    )
                  );
                  setTransportDraftRateEx(
                    toNumber((existing as any)?.rate_ex ?? ctx.transport_rate_ex ?? 0, 0)
                  );
                  setTransportModalOpen(true);
                }}
                disabled={isMultiKanaalMode}
                title={isMultiKanaalMode ? "Transport werkt nu alleen voor 1 kanaal per scenario." : undefined}
              >
                Transport
              </button>
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  const blocks = getVariantBlocks(current, activeVariantId);
                  const existing = blocks.filter((b) => String((b as any).type) === "extras") as QuoteBuilderBlock[];
                  const effectivePeriodIndex: 1 | 2 = hasIntroBlock(current, activeVariantId) ? activePeriodIndex : 2;

                  setExtrasDraftApplies(
                    (existing[0]?.applies_to_periods as any) ?? (effectivePeriodIndex === 1 ? "intro" : "standard")
                  );
                  setExtrasDraftRows(
                    existing.map((block) => ({
                      id: String(block.id ?? createId()),
                      label: normalizeText((block as any).extra_label ?? ""),
                      qty: Math.max(0, toNumber((block as any).extra_qty ?? 1, 1)),
                      unitPriceEx: Math.max(0, toNumber((block as any).extra_unit_price_ex ?? 0, 0)),
                      unitCostEx: Math.max(0, toNumber((block as any).extra_unit_cost_ex ?? 0, 0)),
                      isFree: Boolean((block as any).extra_is_free ?? false),
                      thresholdAmountEx: Math.max(0, toNumber((block as any).extra_threshold_amount_ex ?? 0, 0))
                    }))
                  );
                  setExtrasModalOpen(true);
                }}
                disabled={isMultiKanaalMode}
                title={isMultiKanaalMode ? "Extra's werken nu alleen voor 1 kanaal per scenario." : undefined}
              >
                Extra&apos;s
              </button>
            </div>
            <div className="editor-actions-group" />
          </div>
        </div>

        <div className="module-card compact-card">
          <div className="module-card-title">{introEnabled ? "Scenario & periode" : "Scenario"}</div>
          <div className="module-card-text">
            Maak scenario's (sub-offertes) en beheer kanaalkeuze. {introEnabled ? "De berekening hieronder toont nu: " : "De berekening gebruikt: "}<strong>{periodLabel}</strong>.
          </div>
          <div className="module-card-text" style={{ marginTop: "0.35rem" }}>
            Actief: <strong>{scenarioLabel}</strong> · <strong>{periodLabel}</strong> · <strong>{activeKanaalLabel}</strong>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "0.75rem" }}>
            <div>
              <div className="field-label">Scenario</div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <select
                  className="input"
                  value={activeVariantId}
                  onChange={(event) => selectVariant(event.target.value)}
                  style={{ flex: 1 }}
                >
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.name || variant.id}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={addScenarioFromActive}>
                  Scenario toevoegen
                </button>
                <button type="button" className="btn" onClick={deleteActiveScenario} disabled={!canDeleteScenario}>
                  Verwijderen
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                <div>
                  <div className="field-label">Naam</div>
                  <input
                    className="input"
                    value={activeVariant?.name ?? ""}
                    onChange={(event) => updateActiveVariantMeta("name", event.target.value)}
                    placeholder="Scenario naam..."
                  />
                </div>
                <div>
                  <div className="field-label">Kanaal</div>
                  <select
                    className="input"
                    value={normalizeKey(activeVariant?.channel_code) || currentKanaal}
                    onChange={(event) => updateActiveVariantMeta("channel_code", event.target.value)}
                  >
                    {channelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              {introEnabled ? (
                <>
                  <div className="field-label">Periode</div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button
                      type="button"
                      className={effectivePeriodIndex === 1 ? "btn btn-primary" : "btn"}
                      onClick={() => selectPeriod(1)}
                    >
                      Introductie
                    </button>
                    <button
                      type="button"
                      className={effectivePeriodIndex === 2 ? "btn btn-primary" : "btn"}
                      onClick={() => selectPeriod(2)}
                    >
                      Standaard
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted" style={{ marginTop: "0.4rem" }}>
                  Voeg een introductie toe om met periodes te werken.
                </div>
              )}
            </div>
          </div>
        </div>

        {isLitersMode ? renderLitersOfferte() : renderProductOfferte()}
      </div>
    );
  }

  function renderSummaryTable() {
    if (isLitersMode) {
      if (isMultiKanaalMode) {
        return (
          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table wizard-table-compact">
              <thead>
                <tr>
                  <th>Bier</th>
                  <th>Verpakking</th>
                  <th>Liters</th>
                  <th>{costPriceLabel}</th>
                  {selectedChannelOptions.map((option) => (
                    <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offerteLitersRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.biernaam}</td>
                    <td>{row.verpakking}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td>{formatEuro(row.kostprijsPerLiter)}</td>
                    {selectedChannelOptions.map((option) => (
                      <td key={`${row.id}-${option.value}-offer`}>{formatEuro(row.offerByChannel[option.value] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
                {offerteLitersRows.length === 0 ? (
                  <tr>
                    <td colSpan={4 + selectedChannelOptions.length} className="prijs-empty-cell">Nog geen liters-offerte opgebouwd.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        );
      }

      return (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Verpakking</th>
                <th>Liters</th>
                <th>{costPriceLabel}</th>
                <th>{offerPriceLabel} {currentKanaalLabel}</th>
              </tr>
            </thead>
            <tbody>
              {offerteLitersRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>{formatNumber(row.liters)}</td>
                  <td>{formatEuro(row.kostprijsPerLiter)}</td>
                  <td>{formatEuro(row.offerPrijs)}</td>
                </tr>
              ))}
              {offerteLitersRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="prijs-empty-cell">Nog geen liters-offerte opgebouwd.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      );
    }

    if (isMultiKanaalMode) {
      return (
        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Bier</th>
                <th>Product</th>
                <th>Aantal</th>
                <th>{costPriceLabel}</th>
                {selectedChannelOptions.map((option) => (
                  <th key={`${option.value}-offer`}>{offerPriceLabel} {option.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offerteProductRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.biernaam}</td>
                  <td>{row.verpakking}</td>
                  <td>{formatNumber(row.aantal, 0)}</td>
                  <td>{formatEuro(row.kostprijsPerStuk)}</td>
                  {selectedChannelOptions.map((option) => (
                    <td key={`${row.id}-${option.value}-offer`}>{formatEuro(row.offerByChannel[option.value] ?? 0)}</td>
                  ))}
                </tr>
              ))}
              {offerteProductRows.length === 0 ? (
                <tr>
                  <td colSpan={4 + selectedChannelOptions.length} className="prijs-empty-cell">Nog geen productofferte opgebouwd.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table wizard-table-compact">
          <thead>
            <tr>
              <th>Bier</th>
              <th>Product</th>
              <th>Aantal</th>
              <th>{costPriceLabel}</th>
              <th>{offerPriceLabel} {currentKanaalLabel}</th>
            </tr>
          </thead>
          <tbody>
            {offerteProductRows.map((row) => (
              <tr key={row.id}>
                <td>{row.biernaam}</td>
                <td>{row.verpakking}</td>
                <td>{formatNumber(row.aantal, 0)}</td>
                <td>{formatEuro(row.kostprijsPerStuk)}</td>
                <td>{formatEuro(row.offerPrijs)}</td>
              </tr>
            ))}
            {offerteProductRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="prijs-empty-cell">Nog geen productofferte opgebouwd.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSamenvattingStep() {
    const gekozenKanaal = currentKanaalLabel;
    const scenarioLabel = activeVariant?.name || "Scenario";
    const periodLabel = activePeriod?.label || (activePeriodIndex === 1 ? "Introductie" : "Standaard");

    return (
      <div className="wizard-stack">
        <div className="stats-grid wizard-stats-grid prijs-info-grid">
          <div className="stat-card">
            <div className="stat-label">Voorsteltype</div>
            <div className="stat-value small">{String(current.voorsteltype || "-")}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Verkoopjaar</div>
            <div className="stat-value small">{currentYear}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{isMultiKanaalMode ? "Kanalen" : "Kanaal"}</div>
            <div className="stat-value small">{gekozenKanaal}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Scenario</div>
            <div className="stat-value small">{scenarioLabel}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Periode</div>
            <div className="stat-value small">{periodLabel}</div>
          </div>
        </div>

        <div className="module-card compact-card">
          <div className="module-card-title">Commerciële samenvatting</div>
          <div className="module-card-text">
            Hieronder zie je de kostprijzen en de afgeleide verkoopprijzen per gekozen kanaal
            op basis van de actieve kostprijsversies en verkoopstrategie van {currentYear}.
          </div>
        </div>

        {renderSummaryTable()}
      </div>
    );
  }

  function handleConceptPdf() {
    if (typeof window === "undefined") {
      return;
    }
    const pdfChannelHeaders = isMultiKanaalMode
      ? selectedChannelOptions.map((option) => `<th>${offerPriceLabel} ${option.label}</th>`).join("")
      : `<th>${offerPriceLabel}</th>`;
    const transportRow =
      !isMultiKanaalMode && transportEffect?.isValid
        ? `<tr>
          <td>-</td>
          <td>Transport (${formatNumber(transportEffect.deliveries, 0)} levering${transportEffect.deliveries === 1 ? "" : "en"}${transportEffect.mode === "charge" ? ", doorbelast" : ", kosten"})</td>
          <td>${formatNumber(transportEffect.deliveries, 0)}</td>
          <td>${formatEuro(transportEffect.rateEx)}</td>
          ${
            isMultiKanaalMode
              ? selectedChannelOptions.map(() => `<td>${formatEuro(0)}</td>`).join("")
              : `<td>${formatEuro(transportEffect.mode === "charge" ? transportEffect.rateEx : 0)}</td>`
          }
        </tr>`
        : "";
    const extrasRows = !isMultiKanaalMode
      ? extrasEffects
          .map(
            (extra) => `<tr>
          <td>-</td>
          <td>${String(extra.label).replace(/</g, "&lt;")}${extra.isFree ? " (gratis)" : ""}</td>
          <td>${formatNumber(extra.qty, 0)}</td>
          <td>${formatEuro(extra.unitCostEx)}</td>
          ${isMultiKanaalMode ? selectedChannelOptions.map(() => `<td>${formatEuro(0)}</td>`).join("") : `<td>${formatEuro(extra.isFree ? 0 : extra.unitPriceEx)}</td>`}
        </tr>`
          )
          .join("")
      : "";

    const tableRows =
      (isLitersMode ? litersDisplayRows : productDisplayRows)
      .filter((row) => row.included)
      .map((row) =>
        `<tr>
          <td>${row.biernaam}</td>
          <td>${row.verpakking}</td>
          <td>${isLitersMode ? formatNumber((row as LitersDisplayRow).liters) : formatNumber((row as ProductDisplayRow).aantal, 0)}</td>
          <td>${isLitersMode ? formatEuro((row as LitersDisplayRow).kostprijsPerLiter) : formatEuro((row as ProductDisplayRow).kostprijsPerStuk)}</td>
          ${
            isMultiKanaalMode
              ? selectedChannelOptions.map((option) => `<td>${formatEuro(row.offerByChannel[option.value] ?? 0)}</td>`).join("")
              : `<td>${formatEuro(row.offerPrijs)}</td>`
          }
        </tr>`
      )
      .join("") + transportRow + extrasRows;
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>Conceptofferte ${String(current.offertenummer || "")}</title><style>body{font-family:Segoe UI,sans-serif;padding:24px;color:#18223a}h1,h2{margin:0 0 12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d7e1f4;padding:10px;text-align:left}th{background:#f3f7ff}</style></head><body><h1>Conceptofferte</h1><p><strong>Klant:</strong> ${String(current.klantnaam || "-")}<br/><strong>${isMultiKanaalMode ? "Kanalen" : "Kanaal"}:</strong> ${isMultiKanaalMode ? selectedKanaalLabels : currentKanaalLabel}<br/><strong>Jaar:</strong> ${currentYear}</p><h2>Overzicht</h2><table><thead><tr><th>Bier</th><th>Product</th><th>${isLitersMode ? "Liters" : "Aantal"}</th><th>Kostprijs</th>${pdfChannelHeaders}</tr></thead><tbody>${tableRows || `<tr><td colspan="${isMultiKanaalMode ? 4 + selectedChannelOptions.length : 6}">Nog geen offertelijnen.</td></tr>`}</tbody></table><p style="margin-top:24px;"><strong>Opmerking:</strong><br/>${String(current.opmerking ?? "").replace(/\n/g, "<br/>") || "-"}</p></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function renderAfrondenStep() {
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Afronden</div>
          <div className="module-card-text">
            Voeg eventueel nog een opmerking toe en vraag daarna een concept-PDF op voordat je het prijsvoorstel definitief maakt.
          </div>
        </div>
        <label className="nested-field">
          <span>Opmerking</span>
          <textarea
            className="dataset-input"
            rows={6}
            value={String(current.opmerking ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                draft.opmerking = event.target.value;
              })
            }
          />
        </label>
        <div className="editor-actions">
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <button type="button" className="editor-button editor-button-secondary" onClick={handleConceptPdf}>
              Concept-PDF
            </button>
          </div>
        </div>
      </div>
    );
  }

  function getGratisContextForCurrentPeriod() {
    const blocks = getVariantBlocks(current, activeVariantId);
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const effectivePeriod: 1 | 2 = introEnabled ? activePeriodIndex : 2;
    const xyBlock = blocks.find(
      (b) => String((b as any).type) === "xy_gratis" && isBlockActiveForPeriod(b as any, effectivePeriod)
    ) as QuoteBuilderBlock | undefined;
    if (!xyBlock) {
      return null;
    }
    const requiredQty = toNumber((xyBlock as any).required_qty, 4);
    const freeQty = toNumber((xyBlock as any).free_qty, 1);
    const eligibleRefs = Array.isArray((xyBlock as any).eligible_product_refs)
      ? ((xyBlock as any).eligible_product_refs as string[])
      : [];
    const gratis = computeGratisUnitsByProductRef({
      rows: offerteProductRows as any,
      requiredQty,
      freeQty,
      eligibleRefs
    });
    return { freeByRef: gratis.freeByRef, totalFree: gratis.totalFree, xyBlock };
  }

  function renderProductenStep() {
    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Producten & aantallen</div>
          <div className="module-card-text">
            Selecteer bieren (en optioneel verkoopbare artikelen) en vul aantallen in. Kortingen en prijslogica voeg je
            toe in de volgende stap.
          </div>
        </div>
        {renderUitgangspuntenStep()}
        {isLitersMode ? renderLitersOfferte(false) : renderProductOfferte(false)}
      </div>
    );
  }

  function renderOfferteMakenStep() {
    return renderOfferteStep();
  }

  function renderVergelijkenStep() {
    const introEnabled = hasIntroBlock(current, activeVariantId);
    const periods: Array<{ index: 1 | 2; label: string }> = introEnabled
      ? [
          { index: 1, label: "Introductie" },
          { index: 2, label: "Standaard" }
        ]
      : [{ index: 2, label: "Standaard" }];

    const compareRows: ScenarioCompareRow[] = variants.flatMap((variant) => {
      const channelLabel =
        channelOptionMap.get(normalizeKey(variant.channel_code) || currentKanaal)?.label ?? currentKanaalLabel;
      return periods.map((period) => {
        const totals = computeOfferTotalsForVariantPeriod(variant, period.index);
        return {
          scenarioId: variant.id,
          scenarioName: variant.name || variant.id,
          channelLabel,
          periodIndex: period.index,
          periodLabel: period.label,
          omzet: totals.omzet,
          kosten: totals.kosten,
          kortingEur: totals.kortingEur,
          margeEur: totals.margeEur,
          margePct: totals.margePct,
          transportMode: totals.transportMode,
          transportAmountEx: totals.transportAmountEx,
          extrasOmzet: totals.extrasOmzet,
          extrasKosten: totals.extrasKosten,
          activeRuleLabel: totals.activeRuleLabel
        };
      });
    });

    function exportCompareCsv() {
      const header = [
        "scenario",
        "kanaal",
        "periode",
        "pricing_rule",
        "omzet_ex",
        "kosten_ex",
        "korting_ex",
        "marge_ex",
        "marge_pct",
        "transport_mode",
        "transport_amount_ex",
        "extras_omzet_ex",
        "extras_kosten_ex"
      ];
      const lines = compareRows.map((row) =>
        [
          row.scenarioName,
          row.channelLabel,
          row.periodLabel,
          row.activeRuleLabel ?? "",
          round2(row.omzet),
          round2(row.kosten),
          round2(row.kortingEur),
          round2(row.margeEur),
          round2(row.margePct),
          row.transportMode ?? "",
          round2(row.transportAmountEx ?? 0),
          round2(row.extrasOmzet ?? 0),
          round2(row.extrasKosten ?? 0)
        ]
          .map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`)
          .join(",")
      );
      downloadTextFile(
        `scenario-vergelijking-${String(current.offertenummer || current.klantnaam || "prijsvoorstel")}.csv`,
        [header.join(","), ...lines].join("\n"),
        "text/csv;charset=utf-8"
      );
    }

    return (
      <div className="wizard-stack">
        <div className="module-card compact-card">
          <div className="module-card-title">Vergelijken</div>
          <div className="module-card-text">
            Vergelijk scenario&apos;s op basis van dezelfde actieve kostprijzen en verkoopstrategie. Transport en
            extra&apos;s worden meegenomen als bouwblok-correcties. Alles is exclusief BTW.
          </div>
          <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
            <div className="editor-actions-group" />
            <div className="editor-actions-group">
              <button type="button" className="editor-button editor-button-secondary" onClick={exportCompareCsv}>
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="dataset-editor-scroll">
          <table className="dataset-editor-table wizard-table-compact">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Kanaal</th>
                <th>Periode</th>
                <th>Logica</th>
                <th>Omzet (ex)</th>
                <th>Kosten (ex)</th>
                <th>Korting (ex)</th>
                <th>Marge</th>
                <th>Marge %</th>
                <th>Transport</th>
                <th>Extra&apos;s</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => (
                <tr key={`${row.scenarioId}-${row.periodIndex}`}>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => selectVariant(row.scenarioId)}
                      title="Ga naar scenario"
                    >
                      {row.scenarioName}
                    </button>
                  </td>
                  <td>{row.channelLabel}</td>
                  <td>{row.periodLabel}</td>
                  <td>{row.activeRuleLabel ?? "-"}</td>
                  <td>{formatEuro(row.omzet)}</td>
                  <td>{formatEuro(row.kosten)}</td>
                  <td>{formatEuro(row.kortingEur)}</td>
                  <td>{formatEuro(row.margeEur)}</td>
                  <td>{formatPercentage(row.margePct)}</td>
                  <td>
                    {row.transportAmountEx && row.transportAmountEx > 0
                      ? `${row.transportMode === "charge" ? "+" : "≈"} ${formatEuro(row.transportAmountEx)}`
                      : "-"}
                  </td>
                  <td>
                    {(row.extrasOmzet ?? 0) !== 0 || (row.extrasKosten ?? 0) !== 0
                      ? `${formatEuro(row.extrasOmzet ?? 0)} / ${formatEuro(row.extrasKosten ?? 0)}`
                      : "-"}
                  </td>
                </tr>
              ))}
              {compareRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="prijs-empty-cell">
                    Nog geen scenario&apos;s beschikbaar.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="module-card compact-card">
          <div className="module-card-title">Details actief scenario</div>
          <div className="module-card-text">
            Hieronder staat nog steeds de commerciële samenvatting van het actieve scenario (handig om in te zoomen).
          </div>
        </div>
        {renderSamenvattingStep()}
      </div>
    );
  }

  function renderStepContent() {
    if (currentStep.id === "basis") return renderBasisStep();
    if (currentStep.id === "producten") return renderProductenStep();
    if (currentStep.id === "offerte_maken") return renderOfferteMakenStep();
    if (currentStep.id === "vergelijken") return renderVergelijkenStep();
    return renderAfrondenStep();
  }

  return (
    <section className="content-card wizard-main-card">
      <div className="wizard-main-header">
        <div>
          <h2 className="wizard-main-title">
            {String(current.offertenummer || current.klantnaam || "Nieuw prijsvoorstel")}
          </h2>
          <div className="page-text">
            Bouw het prijsvoorstel op vanuit basisgegevens, productselectie, offerte-opbouw en vergelijken van scenario&apos;s.
          </div>
        </div>
        <div className="wizard-main-header-actions">
          {onBackToLanding ? (
            <button
              type="button"
              className="editor-button editor-button-secondary"
              onClick={onBackToLanding}
            >
              Terug
            </button>
          ) : null}
          {isEditingExisting ? (
            <button
              type="button"
              className="icon-button-table"
              aria-label="Prijsvoorstel verwijderen"
              title="Verwijderen"
              disabled={isSaving}
              onClick={() =>
                requestDelete(
                  "Prijsvoorstel verwijderen",
                  `Weet je zeker dat je het prijsvoorstel voor ${String(
                    current.klantnaam || current.offertenummer || "dit voorstel"
                  )} wilt verwijderen?`,
                  () => {
                    void handleDeleteCurrent();
                  }
                )
              }
            >
              <TrashIcon />
            </button>
          ) : null}
          <span className="pill">{String(current.status ?? "concept")}</span>
        </div>
      </div>

      <div className="wizard-shell wizard-shell-single">
        <div className="wizard-step-card wizard-step-stage-card">
          <div className="wizard-step-header">
            <div>
              <div className="wizard-step-title">
                Stap {activeStepIndex + 1}: {currentStep.label}
              </div>
              <div className="wizard-step-description">{currentStep.description}</div>
            </div>
          </div>

          <div className="wizard-step-body">{renderStepContent()}</div>

          <div className="editor-actions wizard-footer-actions">
            <div className="editor-actions-group">
              {activeStepIndex > 0 ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => setActiveStepIndex(Math.max(0, activeStepIndex - 1))}
                >
                  Vorige
                </button>
              ) : null}
            </div>
            <div className="editor-actions-group">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => {
                  void handleSave(false);
                }}
              >
                Opslaan
              </button>
              <button
                type="button"
                className="editor-button"
                disabled={isSaving}
                onClick={async () => {
                  if (currentStep.id === "afronden") {
                    const saved = await handleSave(true);
                    if (saved) {
                      onFinish?.();
                    }
                    return;
                  }

                  setActiveStepIndex(Math.min(wizardSteps.length - 1, activeStepIndex + 1));
                }}
              >
                {isSaving ? "Opslaan..." : currentStep.id === "afronden" ? "Afronden" : "Volgende"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {status ? (
        <div className={`editor-status wizard-inline-status${statusTone ? ` ${statusTone}` : ""}`}>
          {status}
        </div>
      ) : null}

      {discountModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="discount-modal-title">
            <div className="confirm-modal-title" id="discount-modal-title">
              % korting instellen
            </div>
            <div className="confirm-modal-text">
              Stel een kortingspercentage in voor het actieve scenario. Deze proof-of-concept block zet de korting op alle
              inbegrepen regels.
            </div>
            <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
              <label className="nested-field">
                <span>Toepassen op</span>
                <select
                  className="dataset-input"
                  value={discountDraftApplies}
                  onChange={(event) =>
                    setDiscountDraftApplies(event.target.value as QuoteBuilderBlock["applies_to_periods"])
                  }
                >
                  <option value="intro">Introductie (periode 1)</option>
                  <option value="standard">Standaard (periode 2)</option>
                  <option value="both">Beide periodes</option>
                </select>
              </label>
              <label className="nested-field">
                <span>Korting (%)</span>
                <input
                  className="dataset-input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={String(discountDraftPct)}
                  onChange={(event) => setDiscountDraftPct(Number(event.target.value || 0))}
                />
              </label>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setDiscountModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  const pct = Math.min(100, Math.max(0, toNumber(discountDraftPct, 0)));
                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    const index = list.findIndex((row) => String(row.id) === activeId);
                    if (index < 0) return;

                    const periodTargets: (1 | 2)[] =
                      discountDraftApplies === "both"
                        ? [1, 2]
                        : discountDraftApplies === "intro"
                          ? [1]
                          : [2];

                    const applyDiscount = (rows: QuoteLineRow[]) =>
                      rows.map((row) => {
                        if (!isIncluded((row as any).included)) return row;
                        const next: QuoteLineRow = { ...row };
                        if (periodTargets.includes(1)) (next as any).korting_pct_p1 = pct;
                        if (periodTargets.includes(2)) (next as any).korting_pct_p2 = pct;
                        return next;
                      });

                    const currentPeriod = toPeriodIndex((draft as any).active_period_index, 2);
                    const nextVariants = [...list];
                    const existing = nextVariants[index];
                    const updatedVariant: QuoteVariant = {
                      ...existing,
                      product_rows: applyDiscount(existing.product_rows),
                      beer_rows: applyDiscount(existing.beer_rows)
                    };
                    nextVariants[index] = updatedVariant;
                    (draft as any).variants = nextVariants;

                    draft.product_rows = applyVariantPeriodToWorkingRows(updatedVariant.product_rows, currentPeriod);
                    draft.beer_rows = applyVariantPeriodToWorkingRows(updatedVariant.beer_rows, currentPeriod);

                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                  const blocks: QuoteBuilderBlock[] = [
                    ...getVariantBlocks(draft, activeId).filter((block) => String((block as any).type) !== "discount_pct"),
                    {
                      id: `${activeId}:discount`,
                      type: "discount_pct",
                      korting_pct: pct,
                      applies_to_periods: discountDraftApplies
                    }
                  ];
                  blocksByVariant[activeId] = blocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;
                  });
                  setDiscountModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {introModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="intro-modal-title">
            <div className="confirm-modal-title" id="intro-modal-title">
              Introductieperiode instellen
            </div>
            <div className="confirm-modal-text">
              Door een introductieperiode toe te voegen, wordt de offerte opgesplitst in 2 periodes: Introductie (periode
              1) en Standaard (periode 2).
            </div>
            <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
              <label className="nested-field">
                <span>Startdatum</span>
                <input
                  className="dataset-input"
                  type="date"
                  value={introDraftStart}
                  onChange={(event) => setIntroDraftStart(event.target.value)}
                />
              </label>
              <label className="nested-field">
                <span>Einddatum</span>
                <input
                  className="dataset-input"
                  type="date"
                  value={introDraftEnd}
                  onChange={(event) => setIntroDraftEnd(event.target.value)}
                />
              </label>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setIntroModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    if (!activeId) return;

                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                    const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                      ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                      : [];

                    const nextBlocks = [
                      ...existingBlocks.filter((block) => String((block as any).type) !== "intro"),
                      {
                        id: `${activeId}:intro`,
                        type: "intro",
                        start_date: introDraftStart,
                        end_date: introDraftEnd
                      } satisfies QuoteBuilderBlock
                    ];
                    blocksByVariant[activeId] = nextBlocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;

                    const index = list.findIndex((row) => String(row.id) === activeId);
                    if (index >= 0) {
                      const nextList = [...list];
                      const variant = nextList[index];
                      const periods = ensureVariantPeriods((variant as any).periods).map((p) =>
                        p.period_index === 1
                          ? { ...p, start_date: introDraftStart, end_date: introDraftEnd }
                          : p
                      );
                      nextList[index] = { ...variant, periods };
                      (draft as any).variants = nextList;
                    }

                    (draft as any).active_period_index = 1;
                    // Re-materialize working rows for the selected period.
                    const nextList = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeVariant = nextList.find((row) => String(row.id) === activeId);
                    if (activeVariant) {
                      draft.product_rows = applyVariantPeriodToWorkingRows(activeVariant.product_rows, 1);
                      draft.beer_rows = applyVariantPeriodToWorkingRows(activeVariant.beer_rows, 1);
                    }
                  });
                  setIntroModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {staffelModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="staffel-modal-title">
            <div className="confirm-modal-title" id="staffel-modal-title">
              Staffel instellen
            </div>
            <div className="confirm-modal-text">
              Staffel werkt op liters per product (aantal x inhoud). De hoogste staffel waarvan de drempel is gehaald
              geldt voor alle inbegrepen regels van dat product.
            </div>

            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Drempel (L)</th>
                    <th>Korting (%)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {staffelDraftTiers.map((tier) => (
                    <tr key={tier.id}>
                      <td>
                        <select
                          className="dataset-input"
                          value={tier.product_id ? `${tier.product_type}|${tier.product_id}` : ""}
                          onChange={(event) => {
                            const value = String(event.target.value ?? "");
                            const [product_type, product_id] = value ? value.split("|") : ["", ""];
                            setStaffelDraftTiers((prev) =>
                              prev.map((row) =>
                                row.id === tier.id ? { ...row, product_id: product_id ?? "", product_type: product_type ?? "" } : row
                              )
                            );
                          }}
                        >
                          {staffelProductOptions.map((option) => (
                            <option key={option.value || "all"} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          min={0}
                          step="0.1"
                          value={String(tier.liters)}
                          onChange={(event) => {
                            const liters = toNumber(event.target.value, 0);
                            setStaffelDraftTiers((prev) =>
                              prev.map((row) => (row.id === tier.id ? { ...row, liters } : row))
                            );
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={String(tier.korting_pct)}
                          onChange={(event) => {
                            const korting_pct = toNumber(event.target.value, 0);
                            setStaffelDraftTiers((prev) =>
                              prev.map((row) => (row.id === tier.id ? { ...row, korting_pct } : row))
                            );
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button-table"
                          aria-label="Staffel verwijderen"
                          title="Verwijderen"
                          onClick={() => setStaffelDraftTiers((prev) => prev.filter((row) => row.id !== tier.id))}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {staffelDraftTiers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="prijs-empty-cell">
                        Voeg een staffel toe om korting automatisch af te leiden.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() =>
                    setStaffelDraftTiers((prev) => [
                      ...prev,
                      {
                        id: createId(),
                        product_id: "",
                        product_type: "",
                        liters: 50,
                        korting_pct: 5
                      }
                    ])
                  }
                >
                  Staffel toevoegen
                </button>
              </div>
              <div className="editor-actions-group" />
            </div>

            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setStaffelModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  const sanitized = staffelDraftTiers
                    .map((row) => ({
                      ...row,
                      liters: Math.max(0, toNumber(row.liters, 0)),
                      korting_pct: Math.min(100, Math.max(0, toNumber(row.korting_pct, 0)))
                    }))
                    .filter((row) => row.liters > 0 && row.korting_pct > 0);

                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    const index = list.findIndex((row) => String(row.id) === activeId);
                    if (index < 0) return;

                    const nextList = [...list];
                    nextList[index] = { ...nextList[index], staffels: sanitized as any };
                    (draft as any).variants = nextList;
                    (draft as any).active_period_index = hasIntroBlock(draft, activeId)
                      ? toPeriodIndex((draft as any).active_period_index, 2)
                      : 2;

                    // Enforce exclusivity: remove discount blocks and clear manual korting fields.
                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                    const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                      ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                      : [];
                    const nextBlocks: QuoteBuilderBlock[] = [
                      ...existingBlocks.filter((b) => !["discount_pct"].includes(String((b as any).type))),
                      { id: `${activeId}:staffel`, type: "staffel" }
                    ];
                    blocksByVariant[activeId] = nextBlocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;

                    const clearManual = (rows: QuoteLineRow[]) =>
                      rows.map((row) => ({
                        ...row,
                        korting_pct_p1: 0,
                        korting_pct_p2: 0,
                        korting_pct: 0
                      }));
                    const variant = nextList[index];
                    nextList[index] = {
                      ...variant,
                      product_rows: clearManual(variant.product_rows),
                      beer_rows: clearManual(variant.beer_rows),
                      staffels: sanitized as any
                    };
                    (draft as any).variants = nextList;

                    const activeVariant = nextList[index];
                    draft.staffels = Array.isArray(activeVariant.staffels) ? activeVariant.staffels : [];
                    draft.product_rows = applyVariantPeriodToWorkingRows(
                      activeVariant.product_rows,
                      toPeriodIndex((draft as any).active_period_index, 2)
                    );
                    draft.beer_rows = applyVariantPeriodToWorkingRows(
                      activeVariant.beer_rows,
                      toPeriodIndex((draft as any).active_period_index, 2)
                    );
                  });

                  setStaffelModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {xyGratisModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="xy-modal-title">
            <div className="confirm-modal-title" id="xy-modal-title">
              X+Y gratis instellen
            </div>
            <div className="confirm-modal-text">
              De goedkoopste eligible units worden gratis (omzet = 0, kosten tellen wel mee). Korting stapelt niet met
              staffels of % korting.
            </div>
            <div className="confirm-modal-text" style={{ marginTop: "0.5rem" }}>
              Let op: de aantallen in de offerte zijn de betaalde stuks. De gratis stuks worden hier bovenop toegevoegd.
            </div>

            <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
              <label className="nested-field">
                <span>Toepassen op</span>
                <select
                  className="dataset-input"
                  value={xyDraftApplies}
                  onChange={(event) =>
                    setXyDraftApplies(event.target.value as NonNullable<QuoteBuilderBlock["applies_to_periods"]>)
                  }
                >
                  <option value="intro">Introductie (periode 1)</option>
                  <option value="standard">Standaard (periode 2)</option>
                  <option value="both">Beide periodes</option>
                </select>
              </label>
              <label className="nested-field">
                <span>X (kopen)</span>
                <input
                  className="dataset-input"
                  type="number"
                  min={1}
                  step="1"
                  value={String(xyDraftRequired)}
                  onChange={(event) => setXyDraftRequired(Math.max(1, Math.floor(Number(event.target.value || 1))))}
                />
              </label>
              <label className="nested-field">
                <span>Y (gratis)</span>
                <input
                  className="dataset-input"
                  type="number"
                  min={1}
                  step="1"
                  value={String(xyDraftFree)}
                  onChange={(event) => setXyDraftFree(Math.max(1, Math.floor(Number(event.target.value || 1))))}
                />
              </label>
            </div>

            <div className="module-card compact-card" style={{ marginTop: "0.75rem" }}>
              <div className="module-card-title">Eligible producten</div>
              <div className="module-card-text">
                Laat leeg om alle (niet-catalogus) producten mee te nemen. Kies 1 of meer producten voor een mix-actie.
              </div>
              <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
                <table className="dataset-editor-table wizard-table-compact">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {xyDraftEligibleRefs.map((ref) => {
                      const option = xyEligibleProductOptions.find((o) => o.value === ref);
                      return (
                        <tr key={ref}>
                          <td>{option?.label ?? ref}</td>
                          <td>
                            <button
                              type="button"
                              className="icon-button-table"
                              aria-label="Verwijderen"
                              title="Verwijderen"
                              onClick={() => setXyDraftEligibleRefs((prev) => prev.filter((v) => v !== ref))}
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {xyDraftEligibleRefs.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="prijs-empty-cell">
                          Alle producten zijn eligible.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
                <div className="editor-actions-group">
                  <select
                    className="dataset-input"
                    value=""
                    onChange={(event) => {
                      const value = String(event.target.value ?? "");
                      if (!value) return;
                      setXyDraftEligibleRefs((prev) => (prev.includes(value) ? prev : [...prev, value]));
                    }}
                  >
                    <option value="">Product toevoegen...</option>
                    {xyEligibleProductOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="editor-actions-group" />
              </div>
            </div>

            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setXyGratisModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    const index = list.findIndex((row) => String(row.id) === activeId);
                    if (index < 0) return;

                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                    const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                      ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                      : [];

                    // Enforce exclusivity: remove discount/staffel blocks and clear staffels + manual korting fields.
                    const nextBlocks: QuoteBuilderBlock[] = [
                      ...existingBlocks.filter(
                        (b) => !["discount_pct", "staffel", "xy_gratis"].includes(String((b as any).type))
                      ),
                      {
                        id: `${activeId}:xy_gratis`,
                        type: "xy_gratis",
                        required_qty: xyDraftRequired,
                        free_qty: xyDraftFree,
                        applies_to_periods: xyDraftApplies,
                        eligible_product_refs: xyDraftEligibleRefs
                      }
                    ];
                    blocksByVariant[activeId] = nextBlocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;

                    const clearManual = (rows: QuoteLineRow[]) =>
                      rows.map((row) => ({
                        ...row,
                        korting_pct_p1: 0,
                        korting_pct_p2: 0,
                        korting_pct: 0
                      }));

                    const nextList = [...list];
                    const variant = nextList[index];
                    nextList[index] = {
                      ...variant,
                      product_rows: clearManual(variant.product_rows),
                      beer_rows: clearManual(variant.beer_rows),
                      staffels: []
                    };
                    (draft as any).variants = nextList;

                    const currentPeriod = hasIntroBlock(draft, activeId)
                      ? toPeriodIndex((draft as any).active_period_index, 2)
                      : 2;
                    draft.staffels = [];
                    draft.product_rows = applyVariantPeriodToWorkingRows(nextList[index].product_rows, currentPeriod);
                    draft.beer_rows = applyVariantPeriodToWorkingRows(nextList[index].beer_rows, currentPeriod);
                  });
                  setXyGratisModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {transportModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="transport-modal-title">
            <div className="confirm-modal-title" id="transport-modal-title">
              Transport instellen
            </div>
            <div className="confirm-modal-text">
              Transport is per levering. Binnen de km-drempel telt het als kostenpost. Boven de km-drempel kan transport
              worden doorbelast (omzet) wanneer de order onder de omzetdrempel blijft. Transport heeft altijd 21% BTW
              (weergave), maar de berekening blijft exclusief BTW.
            </div>

            <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
              <label className="nested-field">
                <span>Toepassen op</span>
                <select
                  className="dataset-input"
                  value={transportDraftApplies}
                  onChange={(event) =>
                    setTransportDraftApplies(event.target.value as NonNullable<QuoteBuilderBlock["applies_to_periods"]>)
                  }
                >
                  <option value="intro">Introductie (periode 1)</option>
                  <option value="standard">Standaard (periode 2)</option>
                  <option value="both">Beide periodes</option>
                </select>
              </label>
              <label className="nested-field">
                <span>Postcode (klant)</span>
                <input
                  className="dataset-input"
                  value={transportDraftPostcode}
                  onChange={(event) => setTransportDraftPostcode(event.target.value)}
                  placeholder="1234AB"
                />
              </label>
              <label className="nested-field">
                <span>Afstand (km)</span>
                <input
                  className="dataset-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={String(transportDraftDistanceKm)}
                  onChange={(event) => setTransportDraftDistanceKm(Math.max(0, Number(event.target.value || 0)))}
                />
              </label>
              <label className="nested-field">
                <span>Km-drempel</span>
                <input
                  className="dataset-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={String(transportDraftKmThreshold)}
                  onChange={(event) => setTransportDraftKmThreshold(Math.max(0, Number(event.target.value || 0)))}
                />
              </label>
              <label className="nested-field">
                <span>Omzetdrempel (ex)</span>
                <input
                  className="dataset-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={String(transportDraftThresholdEx)}
                  onChange={(event) => setTransportDraftThresholdEx(Math.max(0, Number(event.target.value || 0)))}
                />
              </label>
              <label className="nested-field">
                <span>Aantal leveringen</span>
                <input
                  className="dataset-input"
                  type="number"
                  min={1}
                  step="1"
                  value={String(transportDraftDeliveries)}
                  onChange={(event) => setTransportDraftDeliveries(Math.max(1, Math.floor(Number(event.target.value || 1))))}
                />
              </label>
              <label className="nested-field">
                <span>Tarief per levering (ex)</span>
                <input
                  className="dataset-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={String(transportDraftRateEx)}
                  onChange={(event) => setTransportDraftRateEx(Math.max(0, Number(event.target.value || 0)))}
                />
              </label>
            </div>

            <div className="confirm-modal-actions">
              {hasTransportBlock(current, activeVariantId) ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => {
                    updateCurrent((draft) => {
                      const list = Array.isArray((draft as any).variants)
                        ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                        : [];
                      const activeId =
                        String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                      if (!activeId) return;

                      const blocksByVariant =
                        typeof (draft as any).builder_blocks_by_variant === "object" &&
                        (draft as any).builder_blocks_by_variant !== null
                          ? { ...(draft as any).builder_blocks_by_variant }
                          : {};
                      const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                        ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                        : [];
                      blocksByVariant[activeId] = existingBlocks.filter((b) => String((b as any).type) !== "transport");
                      (draft as any).builder_blocks_by_variant = blocksByVariant;
                    });
                    setTransportModalOpen(false);
                  }}
                >
                  Verwijderen
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setTransportModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                disabled={
                  !String(transportDraftPostcode || "").trim() ||
                  transportDraftDistanceKm <= 0 ||
                  transportDraftDeliveries <= 0 ||
                  transportDraftRateEx <= 0
                }
                onClick={() => {
                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    if (!activeId) return;

                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                    const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                      ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                      : [];

                    const nextBlocks: QuoteBuilderBlock[] = [
                      ...existingBlocks.filter((b) => String((b as any).type) !== "transport"),
                      {
                        id: `${activeId}:transport`,
                        type: "transport",
                        applies_to_periods: transportDraftApplies,
                        postcode: String(transportDraftPostcode || "").trim(),
                        distance_km: Math.max(0, toNumber(transportDraftDistanceKm, 0)),
                        km_threshold: Math.max(0, toNumber(transportDraftKmThreshold, 40)),
                        threshold_amount_ex: Math.max(0, toNumber(transportDraftThresholdEx, 0)),
                        deliveries: Math.max(1, Math.floor(toNumber(transportDraftDeliveries, 1))),
                        rate_ex: Math.max(0, toNumber(transportDraftRateEx, 0))
                      }
                    ];
                    blocksByVariant[activeId] = nextBlocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;

                    const ctx = ((draft as any).builder_context as QuoteBuilderContext | undefined) ?? {
                      postcode: "",
                      distance_km: 0,
                      transport_threshold_ex: 0
                    };
                    (draft as any).builder_context = {
                      ...ctx,
                      postcode: String(transportDraftPostcode || "").trim(),
                      distance_km: Math.max(0, toNumber(transportDraftDistanceKm, 0)),
                      transport_threshold_ex: Math.max(0, toNumber(transportDraftThresholdEx, 0)),
                      transport_km_threshold: Math.max(0, toNumber(transportDraftKmThreshold, 40)),
                      transport_rate_ex: Math.max(0, toNumber(transportDraftRateEx, 0)),
                      transport_deliveries: Math.max(1, Math.floor(toNumber(transportDraftDeliveries, 1)))
                    };
                  });
                  setTransportModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {extrasModalOpen ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="extras-modal-title">
            <div className="confirm-modal-title" id="extras-modal-title">
              Extra&apos;s (diensten) instellen
            </div>
            <div className="confirm-modal-text">
              Extra&apos;s zijn diensten (bijv. proeverij, tapverhuur). BTW is altijd 21% voor de factuur; de berekening
              hier blijft exclusief BTW. Je kunt extra&apos;s gratis maken of conditioneel laten worden op basis van een
              omzetdrempel (ex).
            </div>

            <div className="wizard-form-grid" style={{ marginTop: "0.75rem" }}>
              <label className="nested-field">
                <span>Toepassen op</span>
                <select
                  className="dataset-input"
                  value={extrasDraftApplies}
                  onChange={(event) =>
                    setExtrasDraftApplies(event.target.value as NonNullable<QuoteBuilderBlock["applies_to_periods"]>)
                  }
                >
                  <option value="intro">Introductie (periode 1)</option>
                  <option value="standard">Standaard (periode 2)</option>
                  <option value="both">Beide periodes</option>
                </select>
              </label>
            </div>

            <div className="dataset-editor-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="dataset-editor-table wizard-table-compact">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Aantal</th>
                    <th>Verkoopprijs (ex)</th>
                    <th>Kosten (ex)</th>
                    <th>Gratis</th>
                    <th>Omzetdrempel (ex)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {extrasDraftRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          className="dataset-input"
                          value={row.label}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) => (item.id === row.id ? { ...item, label: event.target.value } : item))
                            )
                          }
                          placeholder="Bijv. Proeverij"
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          min={0}
                          step="1"
                          value={String(row.qty)}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, qty: Math.max(0, Math.floor(Number(event.target.value || 0))) }
                                  : item
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={String(row.unitPriceEx)}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, unitPriceEx: Math.max(0, Number(event.target.value || 0)) }
                                  : item
                              )
                            )
                          }
                          disabled={row.isFree}
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={String(row.unitCostEx)}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, unitCostEx: Math.max(0, Number(event.target.value || 0)) }
                                  : item
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.isFree}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      isFree: event.target.checked,
                                      unitPriceEx: event.target.checked ? 0 : item.unitPriceEx
                                    }
                                  : item
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="dataset-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={String(row.thresholdAmountEx)}
                          onChange={(event) =>
                            setExtrasDraftRows((prev) =>
                              prev.map((item) =>
                                item.id === row.id
                                  ? { ...item, thresholdAmountEx: Math.max(0, Number(event.target.value || 0)) }
                                  : item
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button-table"
                          aria-label="Verwijderen"
                          title="Verwijderen"
                          onClick={() => setExtrasDraftRows((prev) => prev.filter((item) => item.id !== row.id))}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {extrasDraftRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="prijs-empty-cell">
                        Nog geen extra&apos;s toegevoegd.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="editor-actions" style={{ marginTop: "0.75rem" }}>
              <div className="editor-actions-group">
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() =>
                    setExtrasDraftRows((prev) => [
                      ...prev,
                      {
                        id: createId(),
                        label: "",
                        qty: 1,
                        unitPriceEx: 0,
                        unitCostEx: 0,
                        isFree: false,
                        thresholdAmountEx: 0
                      }
                    ])
                  }
                >
                  Extra toevoegen
                </button>
              </div>
              <div className="editor-actions-group" />
            </div>

            <div className="confirm-modal-actions">
              {hasExtrasBlock(current, activeVariantId) ? (
                <button
                  type="button"
                  className="editor-button editor-button-secondary"
                  onClick={() => {
                    updateCurrent((draft) => {
                      const list = Array.isArray((draft as any).variants)
                        ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                        : [];
                      const activeId =
                        String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                      if (!activeId) return;

                      const blocksByVariant =
                        typeof (draft as any).builder_blocks_by_variant === "object" &&
                        (draft as any).builder_blocks_by_variant !== null
                          ? { ...(draft as any).builder_blocks_by_variant }
                          : {};
                      const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                        ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                        : [];
                      blocksByVariant[activeId] = existingBlocks.filter((b) => String((b as any).type) !== "extras");
                      (draft as any).builder_blocks_by_variant = blocksByVariant;
                    });
                    setExtrasModalOpen(false);
                  }}
                >
                  Verwijderen
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setExtrasModalOpen(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  updateCurrent((draft) => {
                    const list = Array.isArray((draft as any).variants)
                      ? (((draft as any).variants as unknown[]) as QuoteVariant[])
                      : [];
                    const activeId =
                      String((draft as any).active_variant_id ?? "").trim() || String(list[0]?.id ?? "");
                    if (!activeId) return;

                    const blocksByVariant =
                      typeof (draft as any).builder_blocks_by_variant === "object" &&
                      (draft as any).builder_blocks_by_variant !== null
                        ? { ...(draft as any).builder_blocks_by_variant }
                        : {};
                    const existingBlocks: QuoteBuilderBlock[] = Array.isArray(blocksByVariant[activeId])
                      ? (blocksByVariant[activeId] as QuoteBuilderBlock[])
                      : [];

                    const cleanedDraft = extrasDraftRows
                      .map((row) => ({
                        ...row,
                        label: normalizeText(row.label),
                        qty: Math.max(0, Math.floor(toNumber(row.qty, 0))),
                        unitPriceEx: Math.max(0, toNumber(row.unitPriceEx, 0)),
                        unitCostEx: Math.max(0, toNumber(row.unitCostEx, 0)),
                        thresholdAmountEx: Math.max(0, toNumber(row.thresholdAmountEx, 0)),
                        isFree: Boolean(row.isFree)
                      }))
                      .filter((row) => row.qty > 0 && (row.label || row.unitPriceEx > 0 || row.unitCostEx > 0 || row.isFree));

                    const nextBlocks: QuoteBuilderBlock[] = [
                      ...existingBlocks.filter((b) => String((b as any).type) !== "extras"),
                      ...cleanedDraft.map((row) => ({
                        id: `${activeId}:extras:${row.id}`,
                        type: "extras" as const,
                        applies_to_periods: extrasDraftApplies,
                        extra_label: row.label || "Extra",
                        extra_qty: row.qty,
                        extra_unit_price_ex: row.unitPriceEx,
                        extra_unit_cost_ex: row.unitCostEx,
                        extra_is_free: row.isFree,
                        extra_threshold_amount_ex: row.thresholdAmountEx
                      }))
                    ];
                    blocksByVariant[activeId] = nextBlocks;
                    (draft as any).builder_blocks_by_variant = blocksByVariant;
                  });
                  setExtrasModalOpen(false);
                }}
              >
                Opslaan
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="confirm-modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-prijsvoorstel-title">
            <div className="confirm-modal-title" id="confirm-prijsvoorstel-title">
              {pendingDelete.title}
            </div>
            <div className="confirm-modal-text">{pendingDelete.body}</div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="editor-button editor-button-secondary"
                onClick={() => setPendingDelete(null)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="editor-button"
                onClick={() => {
                  pendingDelete.onConfirm();
                  setPendingDelete(null);
                }}
              >
                Verwijderen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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

function SearchableMultiSelect({
  label,
  options,
  selectedValues,
  onChange
}: {
  label: string;
  options: SelectOption[];
  selectedValues: string[];
  onChange: (nextValues: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [options, query]
  );

  const selectedLabels = selectedValues
    .map((value) => options.find((item) => item.value === value)?.label ?? value)
    .filter(Boolean);

  return (
    <div className="prijs-multiselect">
      <div className="nested-field">
        <span>{label}</span>
        <button
          type="button"
          className={`prijs-multiselect-trigger${isOpen ? " open" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
        >
          <span className="prijs-multiselect-trigger-text">
            {selectedLabels.length > 0
              ? `${selectedLabels.length} bier${selectedLabels.length === 1 ? "" : "en"} geselecteerd`
              : "Kies een of meer bieren"}
          </span>
          <span className="prijs-multiselect-trigger-icon">{isOpen ? "−" : "+"}</span>
        </button>
      </div>

      {selectedValues.length > 0 ? (
        <div className="prijs-multiselect-chips">
          {selectedValues.map((value) => {
            const option = options.find((item) => item.value === value);
            return (
              <button
                key={value}
                type="button"
                className="prijs-multiselect-chip"
                onClick={() => onChange(selectedValues.filter((item) => item !== value))}
              >
                {option?.label ?? value} ×
              </button>
            );
          })}
        </div>
      ) : null}

      {isOpen ? (
        <div className="prijs-multiselect-dropdown">
          <div className="prijs-multiselect-header">
            <input
              className="dataset-input"
              type="text"
              value={query}
              placeholder="Zoek bier..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="prijs-selector-list prijs-selector-list-dropdown">
            {filteredOptions.map((option) => {
              const checked = selectedValues.includes(option.value);
              return (
                <label key={option.value} className="prijs-selector-row">
                  <span className="prijs-checkbox-line">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const nextValues = checked
                          ? selectedValues.filter((value) => value !== option.value)
                          : [...selectedValues, option.value];
                        onChange(nextValues);
                      }}
                    />
                    <span>{option.label}</span>
                  </span>
                </label>
              );
            })}
            {filteredOptions.length === 0 ? (
              <div className="prijs-empty-cell">Geen bieren gevonden voor deze zoekterm.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

