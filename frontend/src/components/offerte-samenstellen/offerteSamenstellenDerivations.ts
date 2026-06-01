import { calculateScenarioMetrics } from "@/components/offerte-samenstellen/calculations";
import type {
  QuoteBreakEvenSnapshot,
  QuoteScenario,
  ScenarioMetrics,
} from "@/components/offerte-samenstellen/types";

export type ScenarioId = "A" | "B" | "C";
export type Scenario = QuoteScenario;

export function buildScenarioMetricsMap(args: {
  scenarios: Record<ScenarioId, Scenario>;
  effectiveBreakEvenSnapshot: QuoteBreakEvenSnapshot | null;
  year: number;
  productie: Record<string, unknown>;
  vasteKosten: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }> {
  const ids: ScenarioId[] = ["A", "B", "C"];
  return Object.fromEntries(
    ids.map((id) => {
      const sc = args.scenarios[id];
      return [
        id,
        {
          standard: calculateScenarioMetrics(sc, "standard", args.effectiveBreakEvenSnapshot, {
            year: args.year,
            productie: args.productie,
            vasteKosten: args.vasteKosten,
            settings: args.settings,
          }),
          intro: sc.intro
            ? calculateScenarioMetrics(sc, "intro", args.effectiveBreakEvenSnapshot, {
                year: args.year,
                productie: args.productie,
                vasteKosten: args.vasteKosten,
                settings: args.settings,
              })
            : null,
        },
      ];
    })
  ) as Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }>;
}

