import { calculateQuoteScenarioMetrics } from "@/lib/quoteScenarioPricing";
import type {
  QuoteBreakEvenSnapshot,
  QuoteScenario,
  ScenarioMetrics,
} from "@/components/offerte-samenstellen/types";

type PeriodKey = "standard" | "intro";

export function calculateScenarioMetrics(
  scenario: QuoteScenario,
  activePeriod: PeriodKey,
  breakEven: QuoteBreakEvenSnapshot | null = null
): ScenarioMetrics {
  return calculateQuoteScenarioMetrics(scenario, activePeriod, breakEven);
}
