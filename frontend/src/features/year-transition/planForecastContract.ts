import {
  number,
  round,
  text,
} from "@/features/commercial-context/activeCommercialContextUtils";
import type {
  FrozenPlanAllocation,
  FrozenPlanDraft,
  FrozenPlanValues,
  PlanForecastContract,
  YearTransitionBlocker,
} from "@/features/year-transition/canonicalYearTransitionTypes";

const PLAN_TOLERANCE = 0.01;

export function buildPlanForecastContract(
  frozenPlan: FrozenPlanDraft | null
): PlanForecastContract {
  const blockers: YearTransitionBlocker[] = [];
  if (!frozenPlan || text(frozenPlan.source) !== "new_year_preparation") {
    blockers.push({ code: "plan_source_missing" });
  }
  const targets = frozenPlan ? normalizePlanValues(frozenPlan.targets) : null;
  if (!targets || targets.revenue <= 0) blockers.push({ code: "plan_revenue_missing" });
  if (!targets || targets.variableCost < 0) blockers.push({ code: "plan_variable_cost_invalid" });
  if (!targets || targets.contribution <= 0) blockers.push({ code: "plan_contribution_missing" });
  if (
    targets &&
    Math.abs(targets.revenue - targets.variableCost - targets.contribution) >
      PLAN_TOLERANCE
  ) {
    blockers.push({ code: "plan_totals_inconsistent" });
  }
  if (!targets || targets.liters <= 0) blockers.push({ code: "plan_liters_missing" });
  if (!targets || targets.units <= 0) blockers.push({ code: "plan_units_missing" });
  const periods = normalizeAllocations(frozenPlan?.periodAllocations ?? []);
  const skus = normalizeAllocations(frozenPlan?.skuAllocations ?? []);
  if (periods.length === 0) blockers.push({ code: "plan_period_allocation_missing" });
  else if (targets && !allocationMatches(targets, periods)) {
    blockers.push({ code: "plan_period_allocation_mismatch" });
  }
  if (skus.length === 0) blockers.push({ code: "plan_sku_allocation_missing" });
  else if (targets && !allocationMatches(targets, skus)) {
    blockers.push({ code: "plan_sku_allocation_mismatch" });
  }
  const canonical = canonicalBlockers(blockers);
  const ready = canonical.length === 0;
  return {
    plan: {
      status: ready ? "ready" : "blocked",
      immutableAfterActivation: true,
      source: text(frozenPlan?.source),
      sourceRecordId: text(frozenPlan?.sourceRecordId),
      targets: targets ? clone(targets) : null,
      periodAllocations: clone(periods),
      skuAllocations: clone(skus),
      blockers: canonical,
    },
    initialForecast: {
      status: ready ? "ready" : "blocked",
      basis: "frozen_plan",
      targets: ready && targets ? clone(targets) : null,
      exactlyMatchesPlan: ready,
    },
    runtimePolicy: {
      plan: "immutable_frozen_plan",
      actual: "realized_transactions_exact_lot_or_frozen_snapshot",
      forecast: "actual_to_date_plus_remaining_plan_plus_explicit_revision",
      yearClose: "forecast_equals_final_actual",
    },
  };
}

function allocationMatches(
  targets: FrozenPlanValues,
  rows: FrozenPlanAllocation[]
): boolean {
  const totals = rows.reduce(
    (sum, row) => ({
      revenue: sum.revenue + row.revenue,
      variableCost: sum.variableCost + row.variableCost,
      contribution: sum.contribution + row.contribution,
      liters: sum.liters + row.liters,
      units: sum.units + row.units,
    }),
    { revenue: 0, variableCost: 0, contribution: 0, liters: 0, units: 0 }
  );
  return (Object.keys(totals) as Array<keyof FrozenPlanValues>).every(
    (key) => Math.abs(totals[key] - targets[key]) <= PLAN_TOLERANCE
  );
}

function normalizePlanValues(values: FrozenPlanValues): FrozenPlanValues {
  return {
    revenue: round(number(values.revenue)),
    variableCost: round(number(values.variableCost)),
    contribution: round(number(values.contribution)),
    liters: round(number(values.liters)),
    units: round(number(values.units)),
  };
}

function normalizeAllocations(
  rows: FrozenPlanAllocation[]
): FrozenPlanAllocation[] {
  return rows
    .map((row) => ({ key: text(row.key), ...normalizePlanValues(row) }))
    .filter((row) => row.key)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function canonicalBlockers(rows: YearTransitionBlocker[]): YearTransitionBlocker[] {
  const byKey = new Map<string, YearTransitionBlocker>();
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
