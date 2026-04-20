import { validatePricingRuleExclusivity, validateQuoteBuilderGuardrails } from "../src/lib/quoteBuilderGuards";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

// 1) exclusivity: staffel + discount in same scenario must fail
{
  const errors = validatePricingRuleExclusivity([
    { type: "staffel" },
    { type: "discount_pct", applies_to_periods: "both" }
  ]);
  assert(errors.length > 0, "Expected exclusivity violation when staffel and discount are both present");
}

// 2) exclusivity: discount + xy in same period must fail
{
  const errors = validatePricingRuleExclusivity([
    { type: "discount_pct", applies_to_periods: "intro" },
    { type: "xy_gratis", applies_to_periods: "intro" }
  ]);
  assert(errors.some((e) => e.includes("Periode 1")), "Expected period-level exclusivity violation for period 1");
}

// 3) intro requires both periods
{
  const errors = validateQuoteBuilderGuardrails({
    variants: [{ id: "v1", periods: [{ period_index: 1 }] }],
    builder_blocks_by_variant: { v1: [{ type: "intro" }] }
  });
  assert(errors.some((e) => e.toLowerCase().includes("periode 1") || e.toLowerCase().includes("periode 2")), "Expected missing period error");
}

console.log("quoteBuilderGuards contracttest OK");

