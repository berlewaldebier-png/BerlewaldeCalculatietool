import { calculateQuoteScenarioMetrics } from "../src/lib/quoteScenarioPricing";
import type {
  QuoteBreakEvenSnapshot,
  QuoteScenario,
  ScenarioMetrics,
} from "../src/components/offerte-samenstellen/types";

function approxEqual(actual: number, expected: number, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`Expected ~${expected}, got ${actual}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function createScenario(overrides?: Partial<QuoteScenario>): QuoteScenario {
  return {
    id: "A",
    name: "Scenario A",
    note: "",
    intro: null,
    products: [
      {
        id: "beer:1:product:10",
        name: "Blond",
        pack: "Doos 24*33cl",
        qty: 10,
        litersPerUnit: 7.92,
        unit: "doos",
        standardPriceEx: 10,
        costPriceEx: 6,
        vatRatePct: 21,
        source: {
          bier_id: "1",
          product_id: "10",
          kostprijsversie_id: "kp-1",
        },
      },
    ],
    blocks: [],
    ...overrides,
  };
}

function calculate(
  scenario: QuoteScenario,
  activePeriod: "standard" | "intro",
  breakEven: QuoteBreakEvenSnapshot | null = null
) {
  return calculateQuoteScenarioMetrics(scenario, activePeriod, breakEven);
}

{
  const metrics = calculate(
    createScenario({
      blocks: [
        {
          id: "korting",
          type: "Korting",
          title: "Korting",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          payload: {
            discountMode: "Totaal",
            discountPct: 10,
            eligibleRefs: ["beer:1:product:10"],
          },
        },
      ],
    }),
    "standard",
    {
      configId: "be-1",
      configName: "BE",
      year: 2026,
      breakEvenRevenue: 80,
      breakEvenLiters: 10,
      weightedSellInPerLiter: 1,
      weightedVariableCostPerLiter: 1,
      weightedContributionPerLiter: 1,
      contributionMarginPct: 1,
      mixTotalPct: 100,
      calculatedAt: "2026-01-01T00:00:00.000Z",
    }
  );

  approxEqual(metrics.revenueEx, 90);
  approxEqual(metrics.costEx, 60);
  approxEqual(metrics.breakEvenProjected ?? 0, 10);
  approxEqual(metrics.pricingByRef["beer:1:product:10"]?.offerUnitPriceEx ?? 0, 9);
}

{
  const metrics = calculate(
    createScenario({
      products: [{ ...createScenario().products[0], qty: 12 }],
      blocks: [
        {
          id: "staffel",
          type: "Staffel",
          title: "Staffel",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          payload: {
            eligibleRefs: ["beer:1:product:10"],
            discountMode: "absolute",
            discountValue: 1,
            tiers: [
              { from: 1, to: 10, priceEx: null },
              { from: 11, to: null, priceEx: null },
            ],
          },
        },
      ],
    }),
    "standard"
  );

  approxEqual(metrics.revenueEx, 108);
  approxEqual(metrics.costEx, 72);
  approxEqual(metrics.pricingByRef["beer:1:product:10"]?.offerUnitPriceEx ?? 0, 9);
}

{
  const metrics = calculate(
    createScenario({
      products: [{ ...createScenario().products[0], standardPriceEx: 12 }],
      blocks: [
        {
          id: "wholesale",
          type: "Groothandel",
          title: "Groothandel",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          payload: {
            marginPct: 20,
            eligibleRefs: ["beer:1:product:10"],
          },
        },
      ],
    }),
    "standard"
  );

  approxEqual(metrics.revenueEx, 100);
  approxEqual(metrics.costEx, 60);
  approxEqual(metrics.pricingByRef["beer:1:product:10"]?.offerUnitPriceEx ?? 0, 10);
}

{
  const metrics = calculate(
    createScenario({
      products: [{ ...createScenario().products[0], qty: 4 }],
      blocks: [
        {
          id: "mix",
          type: "Mix",
          title: "Mix",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          payload: {
            requiredQty: 3,
            freeQty: 1,
            eligibleRefs: ["beer:1:product:10"],
          },
        },
      ],
    }),
    "standard"
  );

  approxEqual(metrics.revenueEx, 40);
  approxEqual(metrics.costEx, 30);
}

{
  const metrics = calculate(
    createScenario({
      products: [{ ...createScenario().products[0], qty: 4 }],
      blocks: [
        {
          id: "intro",
          type: "Intro",
          title: "Intro",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          appliesTo: "intro",
          payload: {
            promoType: "x_plus_y",
            xValue: "4",
            yValue: "1",
            applyMode: "combined",
            eligibleRefs: ["beer:1:product:10"],
          },
        },
      ],
    }),
    "intro"
  );

  approxEqual(metrics.revenueEx, 40);
  approxEqual(metrics.costEx, 30);
}

{
  const metrics = calculate(
    createScenario({
      blocks: [
        {
          id: "retour",
          type: "Retour",
          title: "Retour",
          subtitle: "",
          lines: [],
          tone: "",
          icon: null,
          appliesTo: "global",
          payload: {
            returnPct: 10,
          },
        },
      ],
    }),
    "standard"
  );

  approxEqual(metrics.revenueEx, 90);
  approxEqual(metrics.costEx, 60);
  assert(
    metrics.notes.some((note) => note.includes("Retour-effect")),
    "Expected retour note"
  );
}

console.log("quoteScenarioCalculations contracttest OK");
