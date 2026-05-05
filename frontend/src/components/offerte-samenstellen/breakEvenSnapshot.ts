import type {
  BreakEvenConfig,
  BreakEvenResult,
  QuoteBreakEvenSnapshot,
} from "@/components/offerte-samenstellen/types";

export function buildBreakEvenSnapshot(
  config: BreakEvenConfig | null,
  result: BreakEvenResult | null
): QuoteBreakEvenSnapshot | null {
  if (!config || !result) return null;
  return {
    configId: config.id,
    configName: config.naam,
    year: config.jaar,
    breakEvenRevenue: result.breakEvenRevenue,
    breakEvenLiters: result.breakEvenLiters,
    weightedSellInPerLiter: result.weightedSellInPerLiter,
    weightedVariableCostPerLiter: result.weightedVariableCostPerLiter,
    weightedContributionPerLiter: result.weightedContributionPerLiter,
    contributionMarginPct: result.contributionMarginPct,
    mixTotalPct: result.mixTotalPct,
    calculatedAt: new Date().toISOString(),
  };
}

