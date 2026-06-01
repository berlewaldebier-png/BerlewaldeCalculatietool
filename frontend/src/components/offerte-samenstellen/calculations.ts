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
  breakEven: QuoteBreakEvenSnapshot | null = null,
  handlingContext?: {
    year: number;
    productie: Record<string, unknown>;
    vasteKosten: Record<string, unknown>;
    settings?: Record<string, unknown>;
  }
): ScenarioMetrics {
  return calculateQuoteScenarioMetrics(scenario, activePeriod, breakEven, handlingContext);
}
