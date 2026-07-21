import { buildBreakEvenProductLines } from "@/components/break-even/breakEvenUtils";
import { buildQuoteableProductOptions } from "@/components/offerte-samenstellen/dataSources";
import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";
import type {
  ActiveCommercialContextInput,
  ActiveCommercialSkuContext,
  ConsumerDifference,
} from "@/features/commercial-context/activeCommercialContextTypes";

export function buildActiveCommercialContextShadow(
  input: ActiveCommercialContextInput,
  skus: ActiveCommercialSkuContext[]
) {
  const differences: ConsumerDifference[] = [];
  let quoteCompared = 0;
  let adviceCompared = 0;
  let breakEvenCompared = 0;
  const common = {
    year: input.operationalYear,
    channels: input.channels,
    bieren: input.beers,
    skus: input.skus,
    articles: input.articles,
    kostprijsversies: input.costVersions,
    kostprijsproductactiveringen: input.activations,
    verkoopprijzen: input.sellingPrices,
    basisproducten: input.basisProducts ?? [],
    samengesteldeProducten: input.composedProducts ?? [],
  };

  for (const channel of [
    { code: "horeca", label: "Horeca" as const },
    { code: "retail", label: "Retail" as const },
  ]) {
    const current = buildQuoteableProductOptions({ ...common, channel: channel.label });
    const currentBySku = new Map(
      current.options
        .filter((row) => row.optionId.startsWith("sku:"))
        .map((row) => [row.optionId.slice(4), row])
    );
    for (const target of skus) {
      const selling = target.sellingPrices.find(
        (row) => row.channelCode === channel.code
      );
      const observed = currentBySku.get(target.skuId);
      if (!observed && target.readiness.quote) {
        differences.push({
          consumer: "quote",
          field: "presence",
          skuId: target.skuId,
          channelCode: channel.code,
          reason: "resolver_ready_but_current_quote_missing",
        });
        continue;
      }
      if (!observed) continue;
      quoteCompared += 1;
      const targetCost = target.planningCost.costPriceEx ?? 0;
      if (Math.abs(observed.costPriceEx - targetCost) > 0.000001) {
        differences.push({
          consumer: "quote",
          field: "cost_price",
          skuId: target.skuId,
          channelCode: channel.code,
          reason: "current_consumer_differs_from_planning_anchor",
        });
      }
      if (observed.kostprijsversieId !== target.planningCost.costVersionId) {
        differences.push({
          consumer: "quote",
          field: "cost_version",
          skuId: target.skuId,
          channelCode: channel.code,
          reason: "current_consumer_uses_different_cost_version",
        });
      }
      if (
        selling?.sellInEx !== null &&
        selling?.sellInEx !== undefined &&
        Math.abs(observed.standardPriceEx - selling.sellInEx) > 0.000001
      ) {
        differences.push({
          consumer: "quote",
          field: "sell_in",
          skuId: target.skuId,
          channelCode: channel.code,
          reason: "current_consumer_uses_different_sell_in",
        });
      }
    }
  }

  const legacyAdviceLookup = buildSellInLookup(
    input.sellingPrices,
    input.operationalYear
  );
  const legacyAdviceDefaults = buildChannelDefaultOpslagMap(input.channels);
  for (const target of skus.filter((row) => row.pricingMethod === "cost_plus")) {
    if (target.planningCost.costPriceEx === null) continue;
    for (const selling of target.sellingPrices) {
      if (selling.sellInEx === null) continue;
      const legacy = resolveSellInPriceEx({
        // Current Adviesprijzen omits skuId. Report that source difference without
        // changing the consumer in this slice.
        bierId: target.beerId,
        productId: target.productId,
        costPriceEx: target.planningCost.costPriceEx,
        channelCode: selling.channelCode,
        lookup: legacyAdviceLookup,
        channelDefaultOpslag: legacyAdviceDefaults,
      });
      adviceCompared += 1;
      if (Math.abs(legacy.sellInEx - selling.sellInEx) > 0.000001) {
        differences.push({
          consumer: "advice",
          field: "sell_in",
          skuId: target.skuId,
          channelCode: selling.channelCode,
          reason: "current_advice_omits_sku_price_scope",
        });
      }
    }
  }

  const currentBreakEven = buildBreakEvenProductLines(common);
  const currentBreakEvenBySku = new Map(
    currentBreakEven
      .filter((row) => row.ref.startsWith("sku:"))
      .map((row) => [row.ref.slice(4), row])
  );
  for (const target of skus) {
    const observed = currentBreakEvenBySku.get(target.skuId);
    if (!observed && target.readiness.breakEven) {
      differences.push({
        consumer: "break_even",
        field: "presence",
        skuId: target.skuId,
        reason: "resolver_ready_but_current_break_even_missing",
      });
      continue;
    }
    if (!observed) continue;
    breakEvenCompared += 1;
    if (
      Math.abs(observed.costPriceEx - (target.planningCost.costPriceEx ?? 0)) >
      0.000001
    ) {
      differences.push({
        consumer: "break_even",
        field: "cost_price",
        skuId: target.skuId,
        reason: "current_consumer_differs_from_planning_anchor",
      });
    }
    const horeca = target.sellingPrices.find((row) => row.channelCode === "horeca");
    if (
      horeca?.sellInEx !== null &&
      horeca?.sellInEx !== undefined &&
      Math.abs(observed.sellInEx - horeca.sellInEx) > 0.000001
    ) {
      differences.push({
        consumer: "break_even",
        field: "sell_in",
        skuId: target.skuId,
        reason: "current_consumer_uses_different_sell_in",
      });
    }
  }

  return {
    quoteCompared,
    adviceCompared,
    breakEvenCompared,
    differences: differences.sort((left, right) =>
      `${left.consumer}:${left.skuId}:${left.channelCode ?? ""}:${left.field}`.localeCompare(
        `${right.consumer}:${right.skuId}:${right.channelCode ?? ""}:${right.field}`
      )
    ),
  };
}
