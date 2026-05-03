import type {
  GenericRecord,
  ProductIndexResult,
  QuoteChannel,
} from "@/components/offerte-samenstellen/types";
import { normalizeText } from "@/components/offerte-samenstellen/quoteUtils";
import { buildProductFacts } from "@/lib/productFacts";
import { buildCentralSkuIndex } from "@/features/sku/centralSkuIndex";

function channelToStrategyKey(channel: QuoteChannel): string | null {
  if (channel === "Horeca") return "horeca";
  if (channel === "Retail") return "retail";
  return null;
}

function buildStaffelCompatibility(packLabel: string, litersPerUnit: number) {
  const normalizedPack = normalizeText(packLabel).toLowerCase();
  const litersKey =
    Number.isFinite(litersPerUnit) && litersPerUnit > 0 ? litersPerUnit.toFixed(4) : "0";

  return {
    key: `${normalizedPack}::${litersKey}`,
    label: packLabel,
  };
}

type BuildProductOptionsParams = {
  year: number;
  channel: QuoteChannel;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  litersPerUnitOverrides?: Map<string, number>;
  scenarioLabelSuffix?: string;
};

export function buildQuoteableProductOptions(
  params: BuildProductOptionsParams
): ProductIndexResult {
  const warnings: string[] = [];
  const strategyKey = channelToStrategyKey(params.channel);
  if (!strategyKey) {
    warnings.push(
      `Geen verkoopstrategie-prijzen bekend voor kanaal '${params.channel}'. Standaardprijzen blijven 0 tot je een ondersteund kanaal kiest.`
    );
  }

  // Phase 1 SKU-aanpak: prefer the central SKU index as the selector source.
  // This keeps selection logic consistent across Offerte/Verkoopstrategie/Adviesprijzen.
  const central = buildCentralSkuIndex({
    year: params.year,
    channels: params.channels,
    verkoopprijzen: params.verkoopprijzen,
    skus: params.skus,
    articles: params.articles,
    kostprijsversies: params.kostprijsversies,
    kostprijsproductactiveringen: params.kostprijsproductactiveringen,
  });

  const factsIndex = buildProductFacts({
    ...params,
    channelCode: strategyKey,
    onlyReady: true,
  });

  const options = factsIndex.facts.map((fact) => {
    const staffelCompatibility = buildStaffelCompatibility(
      fact.packLabel,
      fact.litersPerUnit
    );

    return {
      optionId: fact.ref,
      bierId: fact.bierId,
      productId: fact.productId,
      label: fact.label,
      bierName: fact.bierName,
      packLabel: fact.packLabel,
      litersPerUnit: fact.litersPerUnit,
      staffelCompatibilityKey: staffelCompatibility.key,
      staffelCompatibilityLabel: staffelCompatibility.label,
      costPriceEx: fact.costPriceEx,
      standardPriceEx: fact.sellInEx,
      vatRatePct: fact.vatRatePct,
      kostprijsversieId: fact.kostprijsversieId,
    };
  });

  warnings.push(...factsIndex.warnings);
  if (options.length === 0) {
    warnings.push(
      `Geen actieve kostprijsproductactiveringen gevonden voor jaar ${params.year}. Draai eerst reset+seed of activeer kostprijzen.`
    );
  }

  // Add services (manual_rate) to the options list (they don't participate in liters-based compatibility).
  // They are selectable in offers as "services" and can be priced per uom (uur/pakket/stuk).
  // Note: we still require they exist as active SKUs for the year; creation flow routes via kostprijsbeheer.
  const serviceRows = central.rows.filter((row) => row.pricingMethod === "manual_rate");
  for (const service of serviceRows) {
    const optionId = `sku:${service.skuId}`;
    if (options.some((opt) => opt.optionId === optionId)) continue;
    if (service.manualRateEx <= 0) continue;

    options.push({
      optionId,
      bierId: `sku:${service.skuId}`,
      productId: "",
      label: service.label,
      bierName: service.label,
      packLabel: service.uom,
      litersPerUnit: 0,
      staffelCompatibilityKey: `service::${normalizeText(service.uom).toLowerCase()}`,
      staffelCompatibilityLabel: service.uom,
      costPriceEx: 0,
      standardPriceEx: service.manualRateEx,
      vatRatePct: service.btwPct,
      kostprijsversieId: "",
    });
  }

  if (options.length > 0 && options.every((row) => row.vatRatePct === 0)) {
    warnings.push(
      "BTW-tarief ontbreekt in kostprijsversies (basisgegevens.btw_tarief). BTW toggle toont dan alleen ex prijzen."
    );
  }

  return { options, warnings };
}
