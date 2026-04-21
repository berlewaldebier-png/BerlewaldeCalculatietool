import { euro, inferUnitFromPack } from "@/components/offerte-samenstellen/quoteUtils";
import type { ProductOption, QuoteFormState } from "@/components/offerte-samenstellen/types";

type IntroPriceLabel = "Introprijs" | "Effectieve introprijs" | "Prijs bij drempel";

export type IntroFinancialLine = {
  optionId: string;
  label: string;
  unitLabel: string;
  standardPriceLabel: string;
  introPriceLabel: string;
  introPriceTitle: IntroPriceLabel;
  costPriceLabel: string;
  standardMarginLabel: string;
  newMarginLabel: string;
  customerAdvantageLabel: string;
  marginImpactLabel: string;
  glassLabel: string;
  glassesPerPackLabel: string;
  standardGlassRevenueLabel: string;
  revenuePerGlassLabel: string;
  costPerGlassLabel: string;
  marginPerGlassLabel: string;
  customerAdvantagePerGlassLabel: string;
  promoSummary: string;
  revenueBefore: number;
  revenueAfter: number;
  promoCost: number;
  costTotal: number;
  grossMargin: number;
  marginPct: number;
  standardGlassRevenue: number;
  introGlassRevenue: number;
  glassCost: number;
  totalGlasses: number;
};

export type IntroFinancialSummary = {
  productCount: number;
  revenueBeforeLabel: string;
  revenueAfterLabel: string;
  promoCostLabel: string;
  costTotalLabel: string;
  grossMarginLabel: string;
  marginPctLabel: string;
  standardGlassRevenueLabel: string;
  introGlassRevenueLabel: string;
  glassCostLabel: string;
};

function parseDutchNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumberNl(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

function resolveDefaultGlassSizeMl(product: ProductOption) {
  const unit = inferUnitFromPack(product.packLabel);
  return unit === "fust" ? 250 : 330;
}

function inferLitersFromPackLabel(packLabel: string) {
  const text = packLabel.toLowerCase().replace(/\s+/g, "");
  const multiPackMatch = text.match(/(\d+)[x*](\d+(?:[.,]\d+)?)cl/);
  if (multiPackMatch) {
    const qty = Number(multiPackMatch[1]);
    const cl = Number(multiPackMatch[2].replace(",", "."));
    if (Number.isFinite(qty) && Number.isFinite(cl)) {
      return (qty * cl) / 100;
    }
  }

  const literMatch = text.match(/(\d+(?:[.,]\d+)?)l/);
  if (literMatch) {
    const liters = Number(literMatch[1].replace(",", "."));
    if (Number.isFinite(liters)) {
      return liters;
    }
  }

  const clMatch = text.match(/(\d+(?:[.,]\d+)?)cl/);
  if (clMatch) {
    const liters = Number(clMatch[1].replace(",", ".")) / 100;
    if (Number.isFinite(liters)) {
      return liters;
    }
  }

  return 0;
}

function resolvePackLiters(product: ProductOption) {
  if (product.litersPerUnit > 0) {
    return product.litersPerUnit;
  }
  return inferLitersFromPackLabel(product.packLabel);
}

function resolveGlassesPerPack(product: ProductOption, glassSizeMl: number) {
  const liters = resolvePackLiters(product);
  if (liters > 0) {
    return (liters * 1000) / glassSizeMl;
  }
  return 0;
}

function formatGlassLabel(glassSizeMl: number) {
  return `${formatNumberNl(glassSizeMl / 10, 0)} cl`;
}

function getPromoSummary(product: ProductOption, form: QuoteFormState) {
  if (form.introPromoType === "discount") {
    if (form.introDiscountMode === "all") {
      return `${form.introDiscountPercent || "0"}% korting`;
    }

    return `${form.introDiscountsByProduct[product.optionId] || "0"}% korting`;
  }

  if (form.introPromoType === "x_plus_y") {
    if (form.introApplyMode === "single" && form.introSingleProductRef !== product.optionId) {
      return "Geen intro op dit product";
    }

    return `${form.introXValue || "0"} + ${form.introYValue || "0"}`;
  }

  if (
    form.introThresholdApplyMode === "single" &&
    form.introThresholdSingleProductRef !== product.optionId
  ) {
    return "Geen drempelkorting op dit product";
  }

  return `${form.introThresholdDiscount || "0"}% bij ${form.introThresholdValue || "0"} ${form.introThresholdType}`;
}

type IntroCalculation = {
  revenueBefore: number;
  revenueAfter: number;
  promoCost: number;
  costTotal: number;
  grossMargin: number;
  marginPct: number;
  standardMargin: number;
  marginImpact: number;
  customerAdvantage: number;
  totalGlasses: number;
  standardGlassRevenue: number;
  introGlassRevenue: number;
  glassCost: number;
  customerAdvantagePerGlass: number;
  marginPerGlass: number;
  introPriceTitle: IntroPriceLabel;
};

function calculateDiscountLine(product: ProductOption, form: QuoteFormState): IntroCalculation {
  const standardPrice = product.standardPriceEx;
  const costPrice = product.costPriceEx;
  const discountPct =
    form.introDiscountMode === "all"
      ? parseDutchNumber(form.introDiscountPercent)
      : parseDutchNumber(form.introDiscountsByProduct[product.optionId]);
  const nextPrice = discountPct === null ? standardPrice : standardPrice * (1 - discountPct / 100);
  const glassSizeMl = resolveDefaultGlassSizeMl(product);
  const glassesPerPack = resolveGlassesPerPack(product, glassSizeMl);
  const revenueBefore = standardPrice;
  const revenueAfter = nextPrice;
  const promoCost = Math.max(0, revenueBefore - revenueAfter);
  const costTotal = costPrice;
  const grossMargin = revenueAfter - costTotal;
  const standardMargin = revenueBefore - costTotal;
  const marginImpact = standardMargin - grossMargin;
  const customerAdvantage = promoCost;
  const standardGlassRevenue = glassesPerPack > 0 ? revenueBefore / glassesPerPack : 0;
  const introGlassRevenue = glassesPerPack > 0 ? revenueAfter / glassesPerPack : 0;
  const glassCost = glassesPerPack > 0 ? costTotal / glassesPerPack : 0;
  const customerAdvantagePerGlass = glassesPerPack > 0 ? customerAdvantage / glassesPerPack : 0;
  const marginPerGlass = introGlassRevenue - glassCost;

  return {
    revenueBefore,
    revenueAfter,
    promoCost,
    costTotal,
    grossMargin,
    marginPct: revenueAfter > 0 ? (grossMargin / revenueAfter) * 100 : 0,
    standardMargin,
    marginImpact,
    customerAdvantage,
    totalGlasses: glassesPerPack,
    standardGlassRevenue,
    introGlassRevenue,
    glassCost,
    customerAdvantagePerGlass,
    marginPerGlass,
    introPriceTitle: "Introprijs",
  };
}

function calculateXPlusYLine(product: ProductOption, form: QuoteFormState): IntroCalculation {
  const standardPrice = product.standardPriceEx;
  const costPrice = product.costPriceEx;
  const applies =
    form.introApplyMode === "combined" || form.introSingleProductRef === product.optionId;
  const x = parseDutchNumber(form.introXValue) ?? 0;
  const y = parseDutchNumber(form.introYValue) ?? 0;
  const glassSizeMl = resolveDefaultGlassSizeMl(product);
  const glassesPerPack = resolveGlassesPerPack(product, glassSizeMl);

  if (!applies || x <= 0 || y < 0) {
    const fallback = calculateDiscountLine(product, {
      ...form,
      introPromoType: "discount",
      introDiscountMode: "all",
      introDiscountPercent: "0",
    });
    return {
      ...fallback,
      introPriceTitle: "Effectieve introprijs",
    };
  }

  const totalUnits = x + y;
  const paidUnits = x;
  const revenueBefore = totalUnits * standardPrice;
  const revenueAfter = paidUnits * standardPrice;
  const promoCost = y * costPrice;
  const costTotal = totalUnits * costPrice;
  const grossMargin = revenueAfter - costTotal;
  const standardMargin = revenueBefore - costTotal;
  const marginImpact = standardMargin - grossMargin;
  const customerAdvantage = revenueBefore - revenueAfter;
  const totalGlasses = totalUnits * glassesPerPack;
  const standardGlassRevenue = totalGlasses > 0 ? revenueBefore / totalGlasses : 0;
  const introGlassRevenue = totalGlasses > 0 ? revenueAfter / totalGlasses : 0;
  const glassCost = totalGlasses > 0 ? costTotal / totalGlasses : 0;
  const customerAdvantagePerGlass = totalGlasses > 0 ? customerAdvantage / totalGlasses : 0;
  const marginPerGlass = introGlassRevenue - glassCost;

  return {
    revenueBefore,
    revenueAfter,
    promoCost,
    costTotal,
    grossMargin,
    marginPct: revenueAfter > 0 ? (grossMargin / revenueAfter) * 100 : 0,
    standardMargin,
    marginImpact,
    customerAdvantage,
    totalGlasses,
    standardGlassRevenue,
    introGlassRevenue,
    glassCost,
    customerAdvantagePerGlass,
    marginPerGlass,
    introPriceTitle: "Effectieve introprijs",
  };
}

function calculateThresholdLine(product: ProductOption, form: QuoteFormState): IntroCalculation {
  const standardPrice = product.standardPriceEx;
  const costPrice = product.costPriceEx;
  const applies =
    form.introThresholdApplyMode === "all" ||
    form.introThresholdSingleProductRef === product.optionId;
  const thresholdValue = parseDutchNumber(form.introThresholdValue) ?? 0;
  const thresholdDiscount = parseDutchNumber(form.introThresholdDiscount) ?? 0;
  const glassSizeMl = resolveDefaultGlassSizeMl(product);
  const packLiters = resolvePackLiters(product);
  const glassesPerPack = resolveGlassesPerPack(product, glassSizeMl);

  const useLiters = form.introThresholdType === "liters" && packLiters > 0;
  const units = Math.max(0, thresholdValue);
  const priceBasis = useLiters ? standardPrice / packLiters : standardPrice;
  const costBasis = useLiters ? costPrice / packLiters : costPrice;
  const totalGlasses = useLiters
    ? (units * 1000) / glassSizeMl
    : units * glassesPerPack;

  if (!applies || units <= 0) {
    const revenueBefore = standardPrice;
    const revenueAfter = standardPrice;
    const costTotal = costPrice;
    const grossMargin = revenueAfter - costTotal;
    const standardMargin = revenueBefore - costTotal;
    const standardGlassRevenue = glassesPerPack > 0 ? revenueBefore / glassesPerPack : 0;
    const introGlassRevenue = glassesPerPack > 0 ? revenueAfter / glassesPerPack : 0;
    const glassCost = glassesPerPack > 0 ? costTotal / glassesPerPack : 0;

    return {
      revenueBefore,
      revenueAfter,
      promoCost: 0,
      costTotal,
      grossMargin,
      marginPct: revenueAfter > 0 ? (grossMargin / revenueAfter) * 100 : 0,
      standardMargin,
      marginImpact: 0,
      customerAdvantage: 0,
      totalGlasses: glassesPerPack,
      standardGlassRevenue,
      introGlassRevenue,
      glassCost,
      customerAdvantagePerGlass: 0,
      marginPerGlass: introGlassRevenue - glassCost,
      introPriceTitle: "Prijs bij drempel",
    };
  }

  const revenueBefore = units * priceBasis;
  const revenueAfter = revenueBefore * (1 - thresholdDiscount / 100);
  const promoCost = revenueBefore * (thresholdDiscount / 100);
  const costTotal = units * costBasis;
  const grossMargin = revenueAfter - costTotal;
  const standardMargin = revenueBefore - costTotal;
  const marginImpact = standardMargin - grossMargin;
  const customerAdvantage = revenueBefore - revenueAfter;
  const standardGlassRevenue = totalGlasses > 0 ? revenueBefore / totalGlasses : 0;
  const introGlassRevenue = totalGlasses > 0 ? revenueAfter / totalGlasses : 0;
  const glassCost = totalGlasses > 0 ? costTotal / totalGlasses : 0;
  const customerAdvantagePerGlass = totalGlasses > 0 ? customerAdvantage / totalGlasses : 0;
  const marginPerGlass = introGlassRevenue - glassCost;

  return {
    revenueBefore,
    revenueAfter,
    promoCost,
    costTotal,
    grossMargin,
    marginPct: revenueAfter > 0 ? (grossMargin / revenueAfter) * 100 : 0,
    standardMargin,
    marginImpact,
    customerAdvantage,
    totalGlasses,
    standardGlassRevenue,
    introGlassRevenue,
    glassCost,
    customerAdvantagePerGlass,
    marginPerGlass,
    introPriceTitle: "Prijs bij drempel",
  };
}

export function buildIntroFinancialLines(
  products: ProductOption[],
  form: QuoteFormState
): IntroFinancialLine[] {
  return products.map((product) => {
    const glassSizeMl = resolveDefaultGlassSizeMl(product);
    const glassesPerPack = resolveGlassesPerPack(product, glassSizeMl);
    const calculation =
      form.introPromoType === "x_plus_y"
        ? calculateXPlusYLine(product, form)
        : form.introPromoType === "threshold_discount"
          ? calculateThresholdLine(product, form)
          : calculateDiscountLine(product, form);

    return {
      optionId: product.optionId,
      label: product.label,
      unitLabel: inferUnitFromPack(product.packLabel),
      standardPriceLabel: euro(calculation.revenueBefore),
      introPriceLabel: euro(calculation.revenueAfter),
      introPriceTitle: calculation.introPriceTitle,
      costPriceLabel: euro(calculation.costTotal),
      standardMarginLabel: euro(calculation.standardMargin),
      newMarginLabel: euro(calculation.grossMargin),
      customerAdvantageLabel: euro(calculation.customerAdvantage),
      marginImpactLabel: euro(calculation.marginImpact),
      glassLabel: formatGlassLabel(glassSizeMl),
      glassesPerPackLabel: formatNumberNl(glassesPerPack),
      standardGlassRevenueLabel: euro(calculation.standardGlassRevenue),
      revenuePerGlassLabel: euro(calculation.introGlassRevenue),
      costPerGlassLabel: euro(calculation.glassCost),
      marginPerGlassLabel: euro(calculation.marginPerGlass),
      customerAdvantagePerGlassLabel: euro(calculation.customerAdvantagePerGlass),
      promoSummary: getPromoSummary(product, form),
      revenueBefore: calculation.revenueBefore,
      revenueAfter: calculation.revenueAfter,
      promoCost: calculation.promoCost,
      costTotal: calculation.costTotal,
      grossMargin: calculation.grossMargin,
      marginPct: calculation.marginPct,
      standardGlassRevenue: calculation.standardGlassRevenue,
      introGlassRevenue: calculation.introGlassRevenue,
      glassCost: calculation.glassCost,
      totalGlasses: calculation.totalGlasses,
    };
  });
}

export function buildIntroFinancialSummary(lines: IntroFinancialLine[]): IntroFinancialSummary | null {
  if (lines.length === 0) {
    return null;
  }

  const revenueBefore = lines.reduce((sum, line) => sum + line.revenueBefore, 0);
  const revenueAfter = lines.reduce((sum, line) => sum + line.revenueAfter, 0);
  const promoCost = lines.reduce((sum, line) => sum + line.promoCost, 0);
  const costTotal = lines.reduce((sum, line) => sum + line.costTotal, 0);
  const grossMargin = lines.reduce((sum, line) => sum + line.grossMargin, 0);
  const marginPct = revenueAfter > 0 ? (grossMargin / revenueAfter) * 100 : 0;
  const totalGlasses = lines.reduce((sum, line) => sum + line.totalGlasses, 0);
  const standardGlassRevenue = totalGlasses > 0 ? revenueBefore / totalGlasses : 0;
  const introGlassRevenue = totalGlasses > 0 ? revenueAfter / totalGlasses : 0;
  const glassCost = totalGlasses > 0 ? costTotal / totalGlasses : 0;

  return {
    productCount: lines.length,
    revenueBeforeLabel: euro(revenueBefore),
    revenueAfterLabel: euro(revenueAfter),
    promoCostLabel: euro(promoCost),
    costTotalLabel: euro(costTotal),
    grossMarginLabel: euro(grossMargin),
    marginPctLabel: `${formatNumberNl(marginPct, 1)}%`,
    standardGlassRevenueLabel: euro(standardGlassRevenue),
    introGlassRevenueLabel: euro(introGlassRevenue),
    glassCostLabel: euro(glassCost),
  };
}
