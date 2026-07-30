import { deepStrictEqual, equal } from "node:assert/strict";

import {
  activeForecastSourceLabel,
  buildActiveGenerationRevenueTimeline,
  isActiveGenerationPlanSource,
  isExplicitForecastSource,
} from "../src/features/commercial-context/breakEvenCommercialContext";


equal(
  isActiveGenerationPlanSource(
    "active_commercial_generation_frozen_plan",
  ),
  true,
);
equal(isActiveGenerationPlanSource("active_plan_snapshot"), false);
equal(
  isExplicitForecastSource("active_generation_forecast_revision"),
  true,
);
equal(
  activeForecastSourceLabel(
    "active_generation_actual_plus_remaining_plan",
  ),
  "Actual YTD plus resterend frozen Plan",
);

const activeTimeline = buildActiveGenerationRevenueTimeline([
  {
    period: "2026-02",
    actual_available: false,
    running_plan_revenue: 300,
    running_plan_variable_cost: 120,
    running_actual_revenue: 110,
    running_actual_variable_cost: 45,
    running_forecast_revenue: 310,
    running_forecast_variable_cost: 125,
  },
  {
    period: "2026-01",
    actual_available: true,
    running_plan_revenue: 100,
    running_plan_variable_cost: 40,
    running_actual_revenue: 110,
    running_actual_variable_cost: 45,
    running_forecast_revenue: 110,
    running_forecast_variable_cost: 45,
  },
]);

deepStrictEqual(activeTimeline, [
  {
    month: "Jan",
    plan: 100,
    planCost: 40,
    actual: 110,
    actualCost: 45,
    reforecast: 110,
    reforecastCost: 45,
  },
  {
    month: "Feb",
    plan: 300,
    planCost: 120,
    actual: null,
    actualCost: null,
    reforecast: 310,
    reforecastCost: 125,
  },
]);

equal(buildActiveGenerationRevenueTimeline([]), null);
equal(
  buildActiveGenerationRevenueTimeline([
    {
      period: "2026-01",
      actual_available: true,
    },
  ]),
  null,
);

console.log("break-even active commercial context contracttest OK");
