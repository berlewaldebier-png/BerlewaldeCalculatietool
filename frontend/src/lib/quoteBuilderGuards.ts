export type QuoteBuilderBlockLike = {
  type?: string;
  applies_to_periods?: "both" | "intro" | "standard" | string;
};

export type QuoteVariantLike = {
  id?: string;
  periods?: Array<{ period_index?: 1 | 2 | number }>;
};

export type QuoteLike = {
  variants?: QuoteVariantLike[];
  builder_blocks_by_variant?: Record<string, QuoteBuilderBlockLike[]>;
};

const PRICING_RULE_TYPES = ["discount_pct", "staffel", "xy_gratis"] as const;
type PricingRuleType = (typeof PRICING_RULE_TYPES)[number];

function normalizeType(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isBlockActiveForPeriod(block: QuoteBuilderBlockLike, periodIndex: 1 | 2) {
  const applies = normalizeType(block.applies_to_periods ?? "both");
  if (applies === "both") return true;
  if (applies === "intro") return periodIndex === 1;
  if (applies === "standard") return periodIndex === 2;
  return true;
}

export function getActivePricingRuleTypesForPeriod(blocks: QuoteBuilderBlockLike[], periodIndex: 1 | 2) {
  const list = Array.isArray(blocks) ? blocks : [];
  const hasStaffel = list.some((b) => normalizeType(b.type) === "staffel");
  const hasDiscount = list.some((b) => normalizeType(b.type) === "discount_pct" && isBlockActiveForPeriod(b, periodIndex));
  const hasXy = list.some((b) => normalizeType(b.type) === "xy_gratis" && isBlockActiveForPeriod(b, periodIndex));
  const active = new Set<PricingRuleType>();
  if (hasStaffel) active.add("staffel");
  if (hasDiscount) active.add("discount_pct");
  if (hasXy) active.add("xy_gratis");
  return active;
}

export function validatePricingRuleExclusivity(blocks: QuoteBuilderBlockLike[]) {
  const list = Array.isArray(blocks) ? blocks : [];
  const errors: string[] = [];

  const staffelCount = list.filter((b) => normalizeType(b.type) === "staffel").length;
  const discountP1 = list.filter((b) => normalizeType(b.type) === "discount_pct" && isBlockActiveForPeriod(b, 1)).length;
  const discountP2 = list.filter((b) => normalizeType(b.type) === "discount_pct" && isBlockActiveForPeriod(b, 2)).length;
  const xyP1 = list.filter((b) => normalizeType(b.type) === "xy_gratis" && isBlockActiveForPeriod(b, 1)).length;
  const xyP2 = list.filter((b) => normalizeType(b.type) === "xy_gratis" && isBlockActiveForPeriod(b, 2)).length;

  if (staffelCount > 1) {
    errors.push("Er mogen niet meerdere staffel-blokken tegelijk bestaan in hetzelfde scenario.");
  }
  if (discountP1 > 1 || discountP2 > 1) {
    errors.push("Er mogen niet meerdere % korting-blokken tegelijk bestaan voor dezelfde periode in hetzelfde scenario.");
  }
  if (xyP1 > 1 || xyP2 > 1) {
    errors.push("Er mogen niet meerdere X+Y gratis-blokken tegelijk bestaan voor dezelfde periode in hetzelfde scenario.");
  }

  for (const periodIndex of [1, 2] as const) {
    const active = getActivePricingRuleTypesForPeriod(list, periodIndex);
    if (active.size > 1) {
      errors.push(
        `Periode ${periodIndex}: meerdere prijsregels tegelijk actief (${[...active].join(", ")}). Kies er 1.`
      );
    }
  }

  return errors;
}

export function validateIntroPeriods(variant: QuoteVariantLike, blocks: QuoteBuilderBlockLike[]) {
  const errors: string[] = [];
  const list = Array.isArray(blocks) ? blocks : [];
  const hasIntro = list.some((b) => normalizeType(b.type) === "intro");
  if (!hasIntro) return errors;

  const periods = Array.isArray(variant.periods) ? variant.periods : [];
  const hasP1 = periods.some((p) => Number(p.period_index) === 1);
  const hasP2 = periods.some((p) => Number(p.period_index) === 2);
  if (!hasP1 || !hasP2) {
    errors.push("Introductie is actief, maar periode 1 en/of periode 2 ontbreekt in dit scenario.");
  }
  return errors;
}

export function validateQuoteBuilderGuardrails(quote: QuoteLike) {
  const errors: string[] = [];
  const variants = Array.isArray(quote.variants) ? quote.variants : [];
  const blocksByVariant = typeof quote.builder_blocks_by_variant === "object" && quote.builder_blocks_by_variant !== null
    ? quote.builder_blocks_by_variant
    : {};

  for (const variant of variants) {
    const variantId = String(variant.id ?? "").trim();
    if (!variantId) continue;
    const blocks = Array.isArray(blocksByVariant[variantId]) ? blocksByVariant[variantId] : [];
    const prefix = `Scenario ${variantId}: `;
    validatePricingRuleExclusivity(blocks).forEach((err) => errors.push(prefix + err));
    validateIntroPeriods(variant, blocks).forEach((err) => errors.push(prefix + err));
  }

  return errors;
}

