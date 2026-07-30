import { buildQuoteablePackagingComponentOptions } from "@/components/offerte-samenstellen/dataSources";
import type {
  GenericRecord,
  ProductIndexResult,
  ProductOption,
  QuoteCommercialContextBinding,
} from "@/components/offerte-samenstellen/types";
import { normalizeText } from "@/components/offerte-samenstellen/quoteUtils";
import { getPackagingDefaultsForLabel } from "@/lib/packagingConfig";
import { normalizeSkuLabel, normalizeUnitLabel } from "@/lib/skuLabels";

export const QUOTE_COMMERCIAL_CONTEXT_VERSION = "rf-012c1-v1";

export type {
  QuoteActiveGenerationBinding,
  QuoteCommercialContextBinding,
  QuoteLegacyContextBinding,
  QuoteUnavailableContextBinding,
} from "@/components/offerte-samenstellen/types";

export type QuoteCommercialContextItem = {
  sku_id: string;
  scope_classification: string;
  subject_type: string;
  subject_id: string;
  canonical_beer_id: string;
  format_article_id: string;
  sku_kind: string;
  source_anchor_id: string;
  source_cost_version_id: string;
  source_cost_row_id: string;
  cost_version_id: string;
  cost_row_id: string;
  calculation_method: string;
  provenance_kind: string;
  provenance_source_year: number;
  primary_cost: number | null;
  packaging_cost: number | null;
  overhead_cost: number | null;
  excise_cost: number | null;
  cost_price: number | null;
  liters_per_unit: number | null;
  cost_required: boolean;
  cost_readiness_status: string;
  price_id: string;
  source_pricing_id: string;
  target_pricing_id: string;
  list_price: number | null;
  price_readiness_status: string;
  quote_readiness_status: "ready" | "excluded";
  reason_codes: string[];
};

export type QuoteCommercialContextResponse = {
  version: typeof QUOTE_COMMERCIAL_CONTEXT_VERSION;
  status: "ready" | "missing";
  consumer_mode: "active_generation";
  binding: {
    mode: "active_generation";
    version: typeof QUOTE_COMMERCIAL_CONTEXT_VERSION;
    generation_id: string;
    run_id: string;
    operational_year: number;
    manifest_hash: string;
    validation_hash: string;
  } | null;
  items: QuoteCommercialContextItem[];
  summary: {
    candidate_sku_count: number;
    quote_ready_count: number;
    excluded_count: number;
    exclusion_counts: Record<string, number>;
  };
  reason_codes: string[];
  requested_generation_id: string;
};

type QuoteActiveOptionsParams = {
  context: QuoteCommercialContextResponse;
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  litersPerUnitOverrides?: Map<string, number>;
  scenarioLabelSuffix?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordById(rows: GenericRecord[]) {
  return new Map(
    rows
      .map((row) => [text((row as any)?.id), row] as const)
      .filter(([id]) => Boolean(id))
  );
}

function readVatRatePct(item: QuoteCommercialContextItem, versions: Map<string, GenericRecord>) {
  const version =
    versions.get(item.source_cost_version_id) ??
    versions.get(item.cost_version_id) ??
    null;
  const raw =
    (version as any)?.basisgegevens?.btw_tarief ??
    (version as any)?.basisgegevens?.btw_pct ??
    "";
  const match = text(raw).match(/(\d+(?:[.,]\d+)?)\s*%?/);
  if (!match) return 0;
  return number(match[1], 0);
}

function salesUnitLabel(packLabel: string, article: GenericRecord | null) {
  const combined = `${packLabel} ${text((article as any)?.uom)}`.toLowerCase();
  if (combined.includes("fust") || combined.includes("keg")) return "fust";
  if (combined.includes("doos") || combined.includes("case")) return "doos";
  if (combined.includes("fles")) return "fles";
  if (combined.includes("blik") || combined.includes("can")) return "blik";
  if (combined.includes("uur")) return "uur";
  if (combined.includes("pakket")) return "pakket";
  if (combined.includes("liter")) return "liter";
  return "stuk";
}

function exclusionWarning(code: string, count: number) {
  const messages: Record<string, string> = {
    quote_catalog_reference_only:
      "catalogusreferentie en niet als verkoopbare offerte-SKU geclassificeerd",
    quote_cost_not_ready: "kostprijscontext nog niet gereed",
    quote_cost_non_positive: "geen positieve planningskostprijs",
    quote_sell_in_missing: "geen SKU-specifieke verkoopprijs",
    quote_sell_in_not_ready: "verkoopprijscontext nog niet gereed",
    quote_sell_in_non_positive: "geen positieve SKU-specifieke verkoopprijs",
  };
  return `${count} SKU${count === 1 ? "" : "'s"} niet selecteerbaar: ${
    messages[code] ?? code
  }. Controleer de actieve jaarset voordat je deze SKU in een offerte gebruikt.`;
}

export function bindingFromResponse(
  response: QuoteCommercialContextResponse
): QuoteCommercialContextBinding {
  const binding = response.binding;
  if (response.status === "ready" && binding) {
    return {
      mode: "active_generation",
      version: QUOTE_COMMERCIAL_CONTEXT_VERSION,
      generationId: binding.generation_id,
      runId: binding.run_id,
      operationalYear: binding.operational_year,
      manifestHash: binding.manifest_hash,
      validationHash: binding.validation_hash,
    };
  }
  return {
    mode: "unavailable",
    version: QUOTE_COMMERCIAL_CONTEXT_VERSION,
    operationalYear: 0,
    reasonCode:
      response.reason_codes[0] ?? "active_commercial_generation_missing",
  };
}

export function bindingFromPersistedSnapshot(
  value: unknown,
  persistedYear: number
): QuoteCommercialContextBinding {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  if (
    raw?.mode === "active_generation" &&
    text(raw.generationId) &&
    text(raw.runId) &&
    number(raw.operationalYear, 0) > 0
  ) {
    return {
      mode: "active_generation",
      version: QUOTE_COMMERCIAL_CONTEXT_VERSION,
      generationId: text(raw.generationId),
      runId: text(raw.runId),
      operationalYear: number(raw.operationalYear, persistedYear),
      manifestHash: text(raw.manifestHash),
      validationHash: text(raw.validationHash),
    };
  }
  if (raw?.mode === "unavailable") {
    return {
      mode: "unavailable",
      version: QUOTE_COMMERCIAL_CONTEXT_VERSION,
      operationalYear: number(raw.operationalYear, persistedYear),
      reasonCode: text(raw.reasonCode) || "active_commercial_generation_missing",
    };
  }
  return {
    mode: "legacy_persisted",
    version: QUOTE_COMMERCIAL_CONTEXT_VERSION,
    operationalYear: persistedYear,
    reasonCode: "pre_rf012c1_snapshot",
  };
}

export function contextMatchesBinding(
  response: QuoteCommercialContextResponse | null,
  binding: QuoteCommercialContextBinding
) {
  return Boolean(
    response?.status === "ready" &&
      response.binding &&
      binding.mode === "active_generation" &&
      response.binding.generation_id === binding.generationId &&
      response.binding.run_id === binding.runId
  );
}

export function buildQuoteableActiveContextOptions({
  context,
  bieren,
  skus,
  articles,
  kostprijsversies,
  verpakkingsonderdelen,
  verpakkingsonderdeelPrijzen,
  litersPerUnitOverrides,
  scenarioLabelSuffix,
}: QuoteActiveOptionsParams): ProductIndexResult {
  if (context.status !== "ready" || !context.binding) {
    return {
      options: [],
      warnings: [
        "Er is geen actieve commerciële jaarset beschikbaar. Activeer eerst een gereedstaande jaarset; nieuwe offerteproducten blijven tot die tijd geblokkeerd.",
      ],
    };
  }

  const skuById = recordById(skus);
  const articleById = recordById(articles);
  const beerById = recordById(bieren);
  const versionById = recordById(kostprijsversies);
  const warnings = Object.entries(context.summary.exclusion_counts)
    .filter(([, count]) => number(count, 0) > 0)
    .map(([code, count]) => exclusionWarning(code, number(count, 0)));
  const options: ProductOption[] = [];

  for (const item of context.items) {
    if (item.quote_readiness_status !== "ready") continue;
    const sku = skuById.get(item.sku_id) ?? null;
    const productId =
      item.format_article_id ||
      text((sku as any)?.format_article_id) ||
      text((sku as any)?.article_id) ||
      item.subject_id;
    const article = articleById.get(productId) ?? null;
    const rawLabel =
      text((sku as any)?.name) ||
      text((sku as any)?.naam) ||
      text((article as any)?.name) ||
      text((article as any)?.naam) ||
      item.sku_id;
    const label = normalizeSkuLabel(rawLabel);
    const beerId =
      item.canonical_beer_id ||
      text((sku as any)?.beer_id) ||
      `sku:${item.sku_id}`;
    const beer =
      beerById.get(beerId) ??
      beerById.get(item.subject_id) ??
      null;
    const beerName =
      normalizeSkuLabel(
        text((beer as any)?.biernaam) ||
          text((beer as any)?.naam) ||
          (item.subject_type === "beer" ? item.subject_id : label)
      ) || label;
    const rawPack =
      text((article as any)?.name) ||
      text((article as any)?.naam) ||
      text((sku as any)?.packaging_type) ||
      label;
    const packLabel =
      normalizeUnitLabel(rawPack) || normalizeSkuLabel(rawPack) || label;
    const unitLabel = salesUnitLabel(packLabel, article);
    const baselineLiters = number(item.liters_per_unit, 0);
    const overrideLiters =
      litersPerUnitOverrides?.get(item.sku_id) ??
      litersPerUnitOverrides?.get(productId) ??
      null;
    const hasOverride = number(overrideLiters, 0) > 0 && baselineLiters > 0;
    const effectiveLiters = hasOverride
      ? number(overrideLiters, baselineLiters)
      : baselineLiters;
    const baselineCost = number(item.cost_price, 0);
    const effectiveCost = hasOverride
      ? baselineCost * (effectiveLiters / baselineLiters)
      : baselineCost;
    const packagingDefaults = getPackagingDefaultsForLabel(unitLabel);
    const staffelLiters =
      effectiveLiters > 0 ? effectiveLiters.toFixed(4) : "0";

    options.push({
      optionId: `sku:${item.sku_id}`,
      bierId: beerId,
      productId,
      label: `${label}${hasOverride ? scenarioLabelSuffix ?? " (scenario)" : ""}`,
      bierName: beerName,
      packLabel,
      salesUnitLabel: unitLabel,
      unitsPerLayer: packagingDefaults.unitsPerLayer,
      unitsPerPallet: packagingDefaults.unitsPerPallet,
      contributesToLiters:
        effectiveLiters > 0 && !["stuk", "uur", "pakket"].includes(unitLabel),
      contributesToMargin: true,
      litersPerUnit: effectiveLiters,
      staffelCompatibilityKey: `${normalizeText(packLabel).toLowerCase()}::${staffelLiters}`,
      staffelCompatibilityLabel: packLabel,
      costPriceEx: effectiveCost,
      standardPriceEx: number(item.list_price, 0),
      standardPriceYear: context.binding.operational_year,
      vatRatePct: readVatRatePct(item, versionById),
      kostprijsversieId: item.cost_version_id,
    });
  }

  options.push(
    ...buildQuoteablePackagingComponentOptions({
      year: context.binding.operational_year,
      verpakkingsonderdelen,
      verpakkingsonderdeelPrijzen,
    }).filter(
      (candidate) =>
        !options.some((existing) => existing.optionId === candidate.optionId)
    )
  );
  options.sort((left, right) => left.label.localeCompare(right.label, "nl-NL"));
  if (options.length === 0) {
    warnings.push(
      "De actieve commerciële jaarset bevat geen offerteklare SKU's. Controleer de SKU-kostprijs- en verkoopprijsstatus."
    );
  }
  return { options, warnings };
}
