import type { QuoteProduct } from "@/components/offerte-samenstellen/types";

export type QuoteBaseLine = {
  ref: string;
  units: number;
  liters: number | null;
  sellInExPerUnit: number;
  costExPerUnit: number;
  revenueEx: number;
  costEx: number;
  contributionEx: number;
  contributionPerLiter: number | null;
  contributesToLiters: boolean;
  contributesToMargin: boolean;
};

export type QuoteAggregate = {
  totalRevenueEx: number;
  totalCostEx: number;
  totalContributionEx: number;
  totalLiters: number;
  weightedSellInPerLiter: number | null;
  weightedCostPerLiter: number | null;
  weightedContributionPerLiter: number | null;
};

function clampNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function buildQuoteBaseLines(params: {
  products: QuoteProduct[];
  getRef: (p: QuoteProduct) => string;
}): QuoteBaseLine[] {
  return (params.products ?? [])
    .filter((p) => clampNumber(p.qty, 0) > 0)
    .map((p) => {
      const ref = String(params.getRef(p) ?? "").trim();
      const units = clampNumber(p.qty, 0);
      const sellInExPerUnit = clampNumber(p.standardPriceEx, 0);
      const costExPerUnit = clampNumber(p.costPriceEx, 0);

      const contributesToLiters = Boolean(p.contributesToLiters ?? (p.litersPerUnit > 0));
      const contributesToMargin = Boolean(p.contributesToMargin ?? true);

      const litersPerUnit = contributesToLiters ? clampNumber(p.litersPerUnit, 0) : 0;
      const liters = litersPerUnit > 0 ? units * litersPerUnit : null;

      const revenueEx = units * sellInExPerUnit;
      const costEx = units * costExPerUnit;
      const contributionEx = revenueEx - costEx;
      const contributionPerLiter =
        liters && liters > 0 ? contributionEx / liters : null;

      return {
        ref,
        units,
        liters,
        sellInExPerUnit,
        costExPerUnit,
        revenueEx,
        costEx,
        contributionEx,
        contributionPerLiter,
        contributesToLiters,
        contributesToMargin,
      };
    })
    .filter((line) => Boolean(line.ref));
}

export function aggregateQuoteLines(lines: QuoteBaseLine[]): QuoteAggregate {
  const revenueEx = lines.reduce((sum, line) => sum + clampNumber(line.revenueEx, 0), 0);
  const costEx = lines.reduce((sum, line) => sum + clampNumber(line.costEx, 0), 0);
  const contributionEx = revenueEx - costEx;

  const literLines = lines.filter((line) => line.contributesToLiters && (line.liters ?? 0) > 0);
  const totalLiters = literLines.reduce((sum, line) => sum + (line.liters ?? 0), 0);

  const weightedSellInPerLiter =
    totalLiters > 0
      ? literLines.reduce((sum, line) => sum + (line.sellInExPerUnit * line.units), 0) / totalLiters
      : null;

  const weightedCostPerLiter =
    totalLiters > 0
      ? literLines.reduce((sum, line) => sum + (line.costExPerUnit * line.units), 0) / totalLiters
      : null;

  const weightedContributionPerLiter =
    totalLiters > 0 ? contributionEx / totalLiters : null;

  return {
    totalRevenueEx: revenueEx,
    totalCostEx: costEx,
    totalContributionEx: contributionEx,
    totalLiters,
    weightedSellInPerLiter,
    weightedCostPerLiter,
    weightedContributionPerLiter,
  };
}

