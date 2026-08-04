export type ActiveBreakEvenTimelinePoint = {
  period: string;
  actual_available?: boolean;
  running_plan_revenue?: number;
  running_plan_variable_cost?: number;
  running_actual_revenue?: number;
  running_actual_variable_cost?: number;
  running_forecast_revenue?: number;
  running_forecast_variable_cost?: number;
};

export type BreakEvenRevenueChartPoint = {
  month: string;
  plan: number;
  planCost: number;
  actual: number | null;
  actualCost: number | null;
  reforecast: number;
  reforecastCost: number;
};

const monthNames = [
  "Jan",
  "Feb",
  "Mrt",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dec",
];

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isActiveGenerationPlanSource(source: unknown) {
  return String(source ?? "") === "active_commercial_generation_frozen_plan";
}

export function isExplicitForecastSource(source: unknown) {
  return ["reforecast_snapshot", "active_generation_forecast_revision"].includes(
    String(source ?? ""),
  );
}

export function activeForecastSourceLabel(source: unknown) {
  switch (String(source ?? "")) {
    case "active_generation_initial_forecast":
      return "initiële Forecast uit het frozen Plan";
    case "active_generation_actual_plus_remaining_plan":
      return "Actual YTD plus resterend frozen Plan";
    case "active_generation_forecast_revision":
      return "expliciete Forecast-revisie binnen dezelfde jaarset";
    case "year_close_snapshot":
      return "definitieve jaarafsluiting";
    case "reforecast_snapshot":
      return "bestaande prognosesnapshot";
    default:
      return "tijdelijke actuals";
  }
}

export function buildActiveGenerationRevenueTimeline(
  rows: ActiveBreakEvenTimelinePoint[] | undefined,
): BreakEvenRevenueChartPoint[] | null {
  if (!rows?.length) return null;
  const normalized = rows
    .filter((row) => /^\d{4}-\d{2}$/.test(String(row.period ?? "")))
    .sort((left, right) => left.period.localeCompare(right.period));
  if (!normalized.length) return null;
  if (
    !normalized.some(
      (row) =>
        row.running_plan_revenue !== undefined
        && row.running_forecast_revenue !== undefined,
    )
  ) {
    return null;
  }
  return normalized.map((row) => {
    const month = Number(row.period.slice(5, 7));
    const actualAvailable = Boolean(row.actual_available);
    return {
      month: monthNames[month - 1] ?? row.period,
      plan: number(row.running_plan_revenue),
      planCost: number(row.running_plan_variable_cost),
      actual: actualAvailable ? number(row.running_actual_revenue) : null,
      actualCost: actualAvailable
        ? number(row.running_actual_variable_cost)
        : null,
      reforecast: number(row.running_forecast_revenue),
      reforecastCost: number(row.running_forecast_variable_cost),
    };
  });
}
