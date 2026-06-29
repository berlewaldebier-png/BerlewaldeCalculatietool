"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabId = "dashboard" | "pnl" | "break_even" | "contribution" | "plan_actual" | "variance" | "scenario" | "year_close";

type RevenueCategory = "beer" | "giftset" | "service" | "merchandise";

type ScenarioState = {
  pricePct: number;
  volumePct: number;
  fixedCostPct: number;
};

type ReadModelWarning = {
  code: string;
  message: string;
};

type ReadModelRevenueReconciliation = {
  source: string;
  basis: string;
  since: string;
  until: string;
  dashboard_revenue: number;
  break_even_revenue: number;
  contribution_revenue: number;
  difference: number;
  status: "match" | "difference";
  policy: string;
};

type ReadModelCategory = {
  category: RevenueCategory;
  rows: number;
  revenue: number;
  contribution: number;
  units: number;
  treatment: string;
};

type ReadModelContributionRow = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  category: RevenueCategory;
  units: number;
  revenue: number;
  variable_cost: number;
  purchase: number;
  packaging: number;
  excise: number;
  fixed_allocation: number;
  contribution: number;
  allocated_margin: number;
  contribution_ratio: number;
  missing_cost_lines: number;
};

type ContributionDisplayRow = {
  id: string;
  sku: string;
  subtitle: string;
  category: RevenueCategory;
  price: number;
  purchase: number;
  excise: number;
  packaging: number;
  contribution: number;
  fixedAllocation: number;
  allocatedMargin: number;
  units: number;
  totalContribution: number;
  missingCostLines: number;
  signal: {
    label: string;
    tone: "ok" | "warning" | "error" | "neutral";
  };
};

type ReadModelFinancialSet = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  fixed_costs: number;
  result: number;
};

type ReadModelPnl = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  fixed_costs: number;
  operating_result: number;
};

type ReadModelBreakEven = {
  revenue: number;
  variable_cost: number;
  contribution: number;
  fixed_costs: number;
  result_check: number;
  contribution_ratio: number;
};

type ReadModelTimelinePoint = {
  period: string;
  revenue: number;
  variable_cost: number;
  contribution: number;
  fixed_allocation: number;
  running_revenue: number;
  running_contribution: number;
};

type VarianceRow = {
  key: string;
  label: string;
  value: number;
  kind: string;
};

type ReadModelPlanActualRow = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  category: RevenueCategory;
  planned_units: number;
  planned_liters: number;
  planned_variable_cost_unit: number;
  planned_fixed_allocation_unit: number;
  planned_cost_unit: number;
  actual_units: number;
  actual_revenue: number;
  actual_contribution: number;
  reforecast_units: number;
  reforecast_contribution: number;
  status: "ok" | "plan_only" | "actual_only";
};

type BreakEvenReadModel = {
  year?: number;
  basis?: string;
  sources?: {
    plan_snapshot_id?: string;
    plan_source?: string;
    actual_source?: string;
    fixed_cost_source?: string;
  };
  contribution?: {
    rows?: ReadModelContributionRow[];
    categories?: ReadModelCategory[];
  };
  dashboard?: {
    plan?: ReadModelFinancialSet;
    actual?: ReadModelFinancialSet;
    reforecast?: ReadModelFinancialSet;
  };
  pnl?: ReadModelPnl;
  break_even?: ReadModelBreakEven;
  timeline?: ReadModelTimelinePoint[];
  variance_bridge?: VarianceRow[];
  revenue_reconciliation?: ReadModelRevenueReconciliation;
  plan_actual?: {
    rows?: ReadModelPlanActualRow[];
    model_note?: string;
  };
  data_quality?: {
    warnings?: ReadModelWarning[];
    missing_cost_lines?: number;
    unmapped_revenue?: number;
  };
};

const tabs: Array<{ id: TabId; title: string; description: string }> = [
  { id: "dashboard", title: "Dashboard", description: "Zijn we op koers?" },
  { id: "pnl", title: "Resultaatrekening", description: "Exact-achtige opbouw" },
  { id: "break_even", title: "Break-even", description: "Waar is resultaat nul?" },
  { id: "contribution", title: "Contributie", description: "Van verkoopprijs naar marge" },
  { id: "plan_actual", title: "Plan vs actual", description: "Volume en omzet" },
  { id: "variance", title: "Varianties", description: "Waarom wijken we af?" },
  { id: "scenario", title: "Scenario lab", description: "Wat als?" },
  { id: "year_close", title: "Jaarafsluiting", description: "Finale waarheid" },
];

const plannedNormalLiters = 40000;
const contributionPageSize = 5;
const emptyTotals = {
  revenue: 0,
  variable: 0,
  contribution: 0,
  abc: 0,
  allocatedMargin: 0,
  liters: 0,
  units: 0,
};

const revenuePhasing = [
  { month: "Jan", planPct: 0.05, actualPct: 0.052, reforecastPct: 0.052 },
  { month: "Feb", planPct: 0.11, actualPct: 0.105, reforecastPct: 0.105 },
  { month: "Mrt", planPct: 0.18, actualPct: 0.165, reforecastPct: 0.165 },
  { month: "Apr", planPct: 0.27, actualPct: 0.238, reforecastPct: 0.238 },
  { month: "Mei", planPct: 0.37, actualPct: 0.335, reforecastPct: 0.335 },
  { month: "Jun", planPct: 0.48, actualPct: 0.445, reforecastPct: 0.445 },
  { month: "Jul", planPct: 0.58, actualPct: null, reforecastPct: 0.545 },
  { month: "Aug", planPct: 0.67, actualPct: null, reforecastPct: 0.625 },
  { month: "Sep", planPct: 0.76, actualPct: null, reforecastPct: 0.715 },
  { month: "Okt", planPct: 0.86, actualPct: null, reforecastPct: 0.82 },
  { month: "Nov", planPct: 0.94, actualPct: null, reforecastPct: 0.91 },
  { month: "Dec", planPct: 1, actualPct: null, reforecastPct: 1 },
];

function money(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function money2(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number.isFinite(value) ? value : 0);
}

function moneyOrMissing(value: number, available: boolean) {
  return available ? money(value) : "Nog niet ingevuld";
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeCategory(value: unknown): RevenueCategory {
  const text = asText(value);
  if (text === "giftset" || text === "service" || text === "merchandise") return text;
  return "beer";
}

function normalizeVarianceKind(value: unknown, amount: number) {
  const text = asText(value);
  if (text === "result") return "result";
  if (text === "positive" || text === "negative") return text;
  return amount >= 0 ? "positive" : "negative";
}

function parseReadModel(value: Record<string, unknown> | null): BreakEvenReadModel | null {
  if (!value) return null;
  const contribution = asRecord(value.contribution);
  const dataQuality = asRecord(value.data_quality);
  const sources = asRecord(value.sources);
  const dashboard = asRecord(value.dashboard);
  const pnl = asRecord(value.pnl);
  const breakEven = asRecord(value.break_even);
  const planActual = asRecord(value.plan_actual);
  const revenueReconciliation = asRecord(value.revenue_reconciliation);
  const rawTimeline = Array.isArray(value.timeline) ? value.timeline : [];
  const rawVarianceBridge = Array.isArray(value.variance_bridge) ? value.variance_bridge : [];
  const rawPlanActualRows = Array.isArray(planActual.rows) ? planActual.rows : [];
  const rawCategories = Array.isArray(contribution.categories) ? contribution.categories : [];
  const rawContributionRows = Array.isArray(contribution.rows) ? contribution.rows : [];
  const warnings = Array.isArray(dataQuality.warnings) ? dataQuality.warnings : [];
  const financialSet = (raw: unknown): ReadModelFinancialSet => {
    const row = asRecord(raw);
    return {
      revenue: asNumber(row.revenue),
      variable_cost: asNumber(row.variable_cost),
      contribution: asNumber(row.contribution),
      fixed_costs: asNumber(row.fixed_costs),
      result: asNumber(row.result),
    };
  };
  return {
    year: asNumber(value.year),
    basis: asText(value.basis),
    sources: {
      plan_snapshot_id: asText(sources.plan_snapshot_id),
      plan_source: asText(sources.plan_source),
      actual_source: asText(sources.actual_source),
      fixed_cost_source: asText(sources.fixed_cost_source),
    },
    contribution: {
      rows: rawContributionRows.map((item) => {
        const row = asRecord(item);
        return {
          sku_id: asText(row.sku_id),
          sku_code: asText(row.sku_code),
          sku_name: asText(row.sku_name),
          category: normalizeCategory(row.category),
          units: asNumber(row.units),
          revenue: asNumber(row.revenue),
          variable_cost: asNumber(row.variable_cost),
          purchase: asNumber(row.purchase),
          packaging: asNumber(row.packaging),
          excise: asNumber(row.excise),
          fixed_allocation: asNumber(row.fixed_allocation),
          contribution: asNumber(row.contribution),
          allocated_margin: asNumber(row.allocated_margin),
          contribution_ratio: asNumber(row.contribution_ratio),
          missing_cost_lines: asNumber(row.missing_cost_lines),
        };
      }),
      categories: rawCategories.map((item) => {
        const row = asRecord(item);
        return {
          category: normalizeCategory(row.category),
          rows: asNumber(row.rows),
          revenue: asNumber(row.revenue),
          contribution: asNumber(row.contribution),
          units: asNumber(row.units),
          treatment: asText(row.treatment) || categoryTreatment(normalizeCategory(row.category)),
        };
      }),
    },
    dashboard: {
      plan: financialSet(dashboard.plan),
      actual: financialSet(dashboard.actual),
      reforecast: financialSet(dashboard.reforecast),
    },
    pnl: {
      revenue: asNumber(pnl.revenue),
      variable_cost: asNumber(pnl.variable_cost),
      contribution: asNumber(pnl.contribution),
      fixed_costs: asNumber(pnl.fixed_costs),
      operating_result: asNumber(pnl.operating_result),
    },
    break_even: {
      revenue: asNumber(breakEven.revenue),
      variable_cost: asNumber(breakEven.variable_cost),
      contribution: asNumber(breakEven.contribution),
      fixed_costs: asNumber(breakEven.fixed_costs),
      result_check: asNumber(breakEven.result_check),
      contribution_ratio: asNumber(breakEven.contribution_ratio),
    },
    timeline: rawTimeline.map((item) => {
      const row = asRecord(item);
      return {
        period: asText(row.period),
        revenue: asNumber(row.revenue),
        variable_cost: asNumber(row.variable_cost),
        contribution: asNumber(row.contribution),
        fixed_allocation: asNumber(row.fixed_allocation),
        running_revenue: asNumber(row.running_revenue),
        running_contribution: asNumber(row.running_contribution),
      };
    }).filter((row) => row.period),
    variance_bridge: rawVarianceBridge.map((item) => {
      const row = asRecord(item);
      const value = asNumber(row.value);
      return {
        key: asText(row.key),
        label: asText(row.label),
        value,
        kind: normalizeVarianceKind(row.kind, value),
      };
    }).filter((row) => row.key && row.label),
    revenue_reconciliation: Object.keys(revenueReconciliation).length ? {
      source: asText(revenueReconciliation.source),
      basis: asText(revenueReconciliation.basis),
      since: asText(revenueReconciliation.since),
      until: asText(revenueReconciliation.until),
      dashboard_revenue: asNumber(revenueReconciliation.dashboard_revenue),
      break_even_revenue: asNumber(revenueReconciliation.break_even_revenue),
      contribution_revenue: asNumber(revenueReconciliation.contribution_revenue ?? revenueReconciliation.break_even_revenue),
      difference: asNumber(revenueReconciliation.difference),
      status: asText(revenueReconciliation.status) === "match" ? "match" : "difference",
      policy: asText(revenueReconciliation.policy),
    } : undefined,
    plan_actual: {
      model_note: asText(planActual.model_note),
      rows: rawPlanActualRows.map((item) => {
        const row = asRecord(item);
        const status = asText(row.status);
        return {
          sku_id: asText(row.sku_id),
          sku_code: asText(row.sku_code),
          sku_name: asText(row.sku_name),
          category: normalizeCategory(row.category),
          planned_units: asNumber(row.planned_units),
          planned_liters: asNumber(row.planned_liters),
          planned_variable_cost_unit: asNumber(row.planned_variable_cost_unit),
          planned_fixed_allocation_unit: asNumber(row.planned_fixed_allocation_unit),
          planned_cost_unit: asNumber(row.planned_cost_unit),
          actual_units: asNumber(row.actual_units),
          actual_revenue: asNumber(row.actual_revenue),
          actual_contribution: asNumber(row.actual_contribution),
          reforecast_units: asNumber(row.reforecast_units),
          reforecast_contribution: asNumber(row.reforecast_contribution),
          status: status === "plan_only" || status === "actual_only" ? status : "ok",
        };
      }),
    },
    data_quality: {
      missing_cost_lines: asNumber(dataQuality.missing_cost_lines),
      unmapped_revenue: asNumber(dataQuality.unmapped_revenue),
      warnings: warnings.map((item) => {
        const row = asRecord(item);
        return { code: asText(row.code), message: asText(row.message) };
      }).filter((item) => item.message),
    },
  };
}

function buildScenarioFromTotals(base: { revenue: number; variable: number }, scenario: ScenarioState, baseFixedCosts: number) {
  const priceFactor = 1 + scenario.pricePct / 100;
  const volumeFactor = 1 + scenario.volumePct / 100;
  const fixedFactor = 1 + scenario.fixedCostPct / 100;
  const revenue = base.revenue * volumeFactor * priceFactor;
  const variable = base.variable * volumeFactor;
  const contribution = revenue - variable;
  const fixedCosts = baseFixedCosts * fixedFactor;
  return {
    revenue,
    variable,
    contribution,
    fixedCosts,
    result: contribution - fixedCosts,
    breakEvenRevenue: contribution > 0 && revenue > 0 ? fixedCosts / (contribution / revenue) : 0,
  };
}

function buildRevenueTimeline(planRevenue: number, actualRevenue: number, reforecastRevenue: number) {
  return revenuePhasing.map((point) => ({
    month: point.month,
    plan: planRevenue * point.planPct,
    actual: point.actualPct === null ? null : actualRevenue * (point.actualPct / 0.445),
    reforecast: reforecastRevenue * point.reforecastPct,
  }));
}

function monthLabel(period: string, fallback: string) {
  const monthNames = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  const match = /^(\d{4})-(\d{2})/.exec(period);
  if (!match) return fallback;
  const monthIndex = Number(match[2]) - 1;
  return monthNames[monthIndex] ?? fallback;
}

function buildRevenueTimelineFromReadModel(planRevenue: number, actualRevenue: number, reforecastRevenue: number, readModelTimeline: ReadModelTimelinePoint[] | undefined) {
  const fallback = buildRevenueTimeline(planRevenue, actualRevenue, reforecastRevenue);
  if (!readModelTimeline?.length) return fallback;

  const byMonth = new Map<string, ReadModelTimelinePoint>();
  for (const point of readModelTimeline) {
    const key = point.period.slice(0, 7);
    if (key) byMonth.set(key, point);
  }
  const sortedKeys = [...byMonth.keys()].sort();
  if (!sortedKeys.length) return fallback;

  const year = sortedKeys[0].slice(0, 4);
  const actualByMonth = new Map(sortedKeys.map((key) => [Number(key.slice(5, 7)), byMonth.get(key)?.running_revenue ?? null]));
  const lastActualMonth = Math.max(...[...actualByMonth.keys()]);
  const lastActualRevenue = actualByMonth.get(lastActualMonth) ?? 0;

  return fallback.map((point, index) => {
    const monthNumber = index + 1;
    const actual = actualByMonth.get(monthNumber) ?? null;
    const futureMonths = Math.max(1, 12 - lastActualMonth);
    const futureStep = Math.max(0, reforecastRevenue - lastActualRevenue) / futureMonths;
    const reforecastPoint = monthNumber <= lastActualMonth ? (actual ?? lastActualRevenue) : lastActualRevenue + futureStep * (monthNumber - lastActualMonth);
    const period = `${year}-${String(monthNumber).padStart(2, "0")}`;
    return {
      ...point,
      month: monthLabel(period, point.month),
      actual,
      reforecast: reforecastPoint,
    };
  });
}

function contributionDisplaySignal(row: ReadModelContributionRow): ContributionDisplayRow["signal"] {
  if (row.missing_cost_lines > 0) return { label: "kostprijs ontbreekt", tone: "error" };
  if (row.contribution_ratio > 0 && row.contribution_ratio < 0.25) return { label: "marge-risico", tone: "error" };
  if (row.contribution > 9000) return { label: "mixdrager", tone: "ok" };
  if (row.contribution > 0) return { label: "contributie", tone: "neutral" };
  return { label: "controle nodig", tone: "warning" };
}

function perUnit(total: number, units: number) {
  return units > 0 ? total / units : 0;
}

function contributionRowsFromReadModel(rows: ReadModelContributionRow[] | undefined): ContributionDisplayRow[] {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const sku = row.sku_name || row.sku_code || row.sku_id;
    const code = row.sku_code ? `SKU ${row.sku_code}` : row.sku_id;
    return {
      id: row.sku_id || `${sku}-${row.sku_code}`,
      sku,
      subtitle: `${code} - ${number(row.units)} st verkocht`,
      category: row.category,
      price: perUnit(row.revenue, row.units),
      purchase: perUnit(row.purchase, row.units),
      excise: perUnit(row.excise, row.units),
      packaging: perUnit(row.packaging, row.units),
      contribution: perUnit(row.contribution, row.units),
      fixedAllocation: perUnit(row.fixed_allocation, row.units),
      allocatedMargin: perUnit(row.allocated_margin, row.units),
      units: row.units,
      totalContribution: row.contribution,
      missingCostLines: row.missing_cost_lines,
      signal: contributionDisplaySignal(row),
    };
  });
}

function planActualStatus(row: ReadModelPlanActualRow): ContributionDisplayRow["signal"] {
  if (row.status === "actual_only") return { label: "alleen actual", tone: "warning" };
  if (row.status === "plan_only") return { label: "alleen plan", tone: "neutral" };
  return { label: "plan + actual", tone: "ok" };
}

function categoryLabel(category: RevenueCategory) {
  switch (category) {
    case "beer":
      return "Bier";
    case "giftset":
      return "Geschenk";
    case "service":
      return "Dienst";
    case "merchandise":
      return "Merchandise";
  }
}

function categoryTreatment(category: RevenueCategory) {
  switch (category) {
    case "beer":
      return "Omzet, contributie, liters en mix";
    case "giftset":
      return "Omzet als product, liters via samenstelling";
    case "service":
      return "Service-omzet, bierverbruik optioneel als kost";
    case "merchandise":
      return "Contributie, geen bierliters";
  }
}

function estimateBreakEvenMonth(timeline: Array<{ month: string; reforecast: number }>, breakEvenRevenue: number) {
  const hit = timeline.find((point) => point.reforecast >= breakEvenRevenue);
  return hit?.month ?? "niet binnen dit jaar";
}

export function BreakEvenNextMockup({
  selectedYear,
  readModel,
  readModelError = "",
}: {
  selectedYear: number;
  readModel?: Record<string, unknown> | null;
  readModelError?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [query, setQuery] = useState("");
  const [contributionPage, setContributionPage] = useState(1);
  const [scenario, setScenario] = useState<ScenarioState>({ pricePct: 5, volumePct: 8, fixedCostPct: 0 });

  const parsedReadModel = useMemo(() => parseReadModel(readModel ?? null), [readModel]);
  const readModelWarnings = parsedReadModel?.data_quality?.warnings ?? [];
  const readModelCategories = parsedReadModel?.contribution?.categories ?? [];
  const readModelContributionRows = parsedReadModel?.contribution?.rows ?? [];
  const readModelTimeline = parsedReadModel?.timeline ?? [];
  const readModelVarianceBridge = parsedReadModel?.variance_bridge ?? [];
  const readModelPlanActualRows = parsedReadModel?.plan_actual?.rows ?? [];
  const revenueReconciliation = parsedReadModel?.revenue_reconciliation ?? null;
  const planActualNote = parsedReadModel?.plan_actual?.model_note ?? "";
  const yearOptions = useMemo(() => {
    const values = new Set([2025, 2026, selectedYear, selectedYear + 1]);
    return [...values].filter((year) => year >= 2024 && year <= 2100).sort((a, b) => a - b);
  }, [selectedYear]);
  const hasReadModel = Boolean(parsedReadModel);
  const hasPlanTargets = Boolean(
    parsedReadModel
    && (parsedReadModel.dashboard?.plan?.revenue ?? 0) > 0
    && (parsedReadModel.dashboard?.plan?.contribution ?? 0) > 0,
  );
  const hasActuals = Boolean(parsedReadModel && (parsedReadModel.dashboard?.actual?.revenue ?? 0) > 0);
  const hasTemporaryReforecast = Boolean(parsedReadModel && (parsedReadModel.dashboard?.reforecast?.revenue ?? 0) > 0);
  const plan = {
    ...emptyTotals,
    revenue: hasPlanTargets ? parsedReadModel?.dashboard?.plan?.revenue ?? 0 : 0,
    variable: hasPlanTargets ? parsedReadModel?.dashboard?.plan?.variable_cost ?? 0 : 0,
    contribution: hasPlanTargets ? parsedReadModel?.dashboard?.plan?.contribution ?? 0 : 0,
  };
  const actual = {
    ...emptyTotals,
    revenue: parsedReadModel?.dashboard?.actual?.revenue ?? 0,
    variable: parsedReadModel?.dashboard?.actual?.variable_cost ?? 0,
    contribution: parsedReadModel?.dashboard?.actual?.contribution ?? 0,
  };
  const reforecast = {
    ...emptyTotals,
    revenue: parsedReadModel?.dashboard?.reforecast?.revenue ?? 0,
    variable: parsedReadModel?.dashboard?.reforecast?.variable_cost ?? 0,
    contribution: parsedReadModel?.dashboard?.reforecast?.contribution ?? 0,
  };
  const activePlanFixedCosts = hasPlanTargets ? parsedReadModel?.dashboard?.plan?.fixed_costs ?? 0 : 0;
  const activeReforecastFixedCosts = parsedReadModel?.dashboard?.reforecast?.fixed_costs ?? 0;
  const scenarioResult = useMemo(
    () => buildScenarioFromTotals({ revenue: reforecast.revenue, variable: reforecast.variable }, scenario, activeReforecastFixedCosts),
    [activeReforecastFixedCosts, reforecast.revenue, reforecast.variable, scenario],
  );
  const fixedRate = activePlanFixedCosts > 0 ? activePlanFixedCosts / plannedNormalLiters : 0;
  const occupancyResult = (reforecast.liters - plannedNormalLiters) * fixedRate;
  const planResult = hasPlanTargets ? parsedReadModel?.dashboard?.plan?.result ?? (plan.contribution - activePlanFixedCosts) : 0;
  const reforecastResult = parsedReadModel?.dashboard?.reforecast?.result ?? (reforecast.contribution - activeReforecastFixedCosts);
  const revenueTimeline = useMemo(
    () => buildRevenueTimelineFromReadModel(plan.revenue, actual.revenue, reforecast.revenue, readModelTimeline),
    [actual.revenue, plan.revenue, readModelTimeline, reforecast.revenue],
  );
  const revenueGap = reforecast.revenue - plan.revenue;
  const revenueGapPct = plan.revenue > 0 ? (revenueGap / plan.revenue) * 100 : 0;
  const planBreakEvenRevenue = plan.contribution > 0 && plan.revenue > 0 ? activePlanFixedCosts / (plan.contribution / plan.revenue) : 0;
  const contributionGap = plan.contribution - reforecast.contribution;
  const resultGap = planResult - reforecastResult;
  const neededPricePct = reforecast.revenue > 0 ? Math.max(0, (plan.revenue / reforecast.revenue - 1) * 100) : 0;
  const neededVolumePct = reforecast.contribution > 0 ? Math.max(0, ((plan.contribution / reforecast.contribution) - 1) * 100) : 0;
  const neededResultPricePct = reforecast.revenue > 0 ? Math.max(0, resultGap / reforecast.revenue * 100) : 0;
  const neededResultVolumePct = reforecast.contribution > 0 ? Math.max(0, resultGap / reforecast.contribution * 100) : 0;
  const balancedPricePct = neededResultPricePct / 2;
  const balancedVolumePct = neededResultVolumePct / 2;
  const reforecastContributionRatio = reforecast.revenue > 0 ? reforecast.contribution / reforecast.revenue : 0;
  const reforecastVariableRatio = reforecast.revenue > 0 ? reforecast.variable / reforecast.revenue : 0;
  const contributionPerLiter = reforecast.liters > 0 ? reforecast.contribution / reforecast.liters : 0;
  const contributionPerUnit = reforecast.units > 0 ? reforecast.contribution / reforecast.units : 0;
  const breakEvenRevenue = parsedReadModel?.break_even?.revenue || (reforecastContributionRatio > 0 ? activeReforecastFixedCosts / reforecastContributionRatio : 0);
  const breakEvenVariableCost = parsedReadModel?.break_even?.variable_cost || (breakEvenRevenue * reforecastVariableRatio);
  const breakEvenContribution = breakEvenRevenue - breakEvenVariableCost;
  const breakEvenLiters = contributionPerLiter > 0 ? activeReforecastFixedCosts / contributionPerLiter : 0;
  const breakEvenUnits = contributionPerUnit > 0 ? activeReforecastFixedCosts / contributionPerUnit : 0;
  const breakEvenResultCheck = parsedReadModel?.break_even?.result_check ?? (breakEvenRevenue - breakEvenVariableCost - activeReforecastFixedCosts);
  const remainingContributionYtd = Math.max(0, activeReforecastFixedCosts - actual.contribution);
  const expectedBreakEvenMonth = estimateBreakEvenMonth(revenueTimeline, breakEvenRevenue);

  const varianceRows = useMemo(() => {
    return readModelVarianceBridge;
  }, [readModelVarianceBridge]);

  const contributionRows = useMemo(() => {
    const sourceRows = contributionRowsFromReadModel(readModelContributionRows);
    const normalized = query.trim().toLowerCase();
    return sourceRows
      .filter((row) => {
        if (!normalized) return true;
        return `${row.sku} ${row.subtitle} ${categoryLabel(row.category)}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => b.totalContribution - a.totalContribution);
  }, [query, readModelContributionRows]);
  const contributionPageCount = Math.max(1, Math.ceil(contributionRows.length / contributionPageSize));
  const safeContributionPage = Math.min(contributionPage, contributionPageCount);
  const pagedContributionRows = contributionRows.slice((safeContributionPage - 1) * contributionPageSize, safeContributionPage * contributionPageSize);
  const topContributor = contributionRows[0];
  const marginRiskCount = contributionRows.filter((row) => row.signal.tone === "error").length;
  const categoryRows = readModelCategories;
  const planActualRows = readModelPlanActualRows;

  const progressPct = activeReforecastFixedCosts > 0 ? Math.max(0, Math.min(130, (reforecast.contribution / activeReforecastFixedCosts) * 100)) : 0;
  const largestVariance = [...varianceRows.filter((row) => row.key !== "plan" && row.key !== "result")].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];

  return (
    <div className="be-next-page">
      <section className="module-card">
        <div className="module-card-header be-next-hero">
          <div>
            <div className="module-card-title">Break-even als stuurinstrument</div>
            <div className="module-card-text">
              Tijdelijke frontend-prototype. De backend-readmodel data wordt geladen voor jaar {selectedYear}; ontbrekende data wordt expliciet leeg of als waarschuwing getoond.
            </div>
          </div>
          <div className="be-next-year-switcher" aria-label="Rapportagejaar kiezen">
            {yearOptions.map((year) => (
              <a key={year} className={`secondary-button${year === selectedYear ? " active" : ""}`} href={`/break-even-next?year=${year}`}>
                {year}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="module-card">
        <div className="module-card-header be-next-table-header">
          <div>
            <div className="module-card-title">Read-model koppeling</div>
            <div className="module-card-text">
              Deze analyse gebruikt het backend read-model voor echte cijfers. Ontbrekende planwaarden worden leeg getoond en niet aangevuld.
            </div>
          </div>
          <span className={`status-pill ${readModelError ? "status-error" : parsedReadModel ? "status-ok" : "status-warning"}`}>
            {readModelError ? "niet geladen" : parsedReadModel ? "backend gekoppeld" : "geen backenddata"}
          </span>
        </div>
        {readModelError ? (
          <div className="editor-status error">Read-model kon niet worden geladen. Hoofdkaarten tonen daarom geen echte break-even cijfers.</div>
        ) : readModelWarnings.length ? (
          <div className="be-next-warning-list">
            {readModelWarnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`} className="editor-status warning">
                <strong>{warning.code || "waarschuwing"}</strong>: {warning.message}
              </div>
            ))}
          </div>
        ) : (
          <div className="editor-status success">Read-model is geladen zonder waarschuwingen.</div>
        )}
      </section>

      <div className="data-quality-tabs" role="tablist" aria-label="Break-even next onderdelen">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab}
            className={`data-quality-tab${tab.id === activeTab ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.title}</span>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>

      {activeTab === "dashboard" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-3">
            <MetricCard label="Plan omzet" value={moneyOrMissing(plan.revenue, hasPlanTargets)} helper={hasPlanTargets ? "frozen plan" : "maak eerst een break-even plan"} />
            <MetricCard label="Actual YTD omzet" value={moneyOrMissing(actual.revenue, hasActuals)} helper={hasActuals ? "SSOT: backend actuals op invoice-basis" : "geen actuals gevonden"} />
            <MetricCard label="Reforecast omzet" value={moneyOrMissing(reforecast.revenue, hasTemporaryReforecast)} helper={hasTemporaryReforecast ? "tijdelijk gelijk aan actual YTD tot reforecastmodel bestaat" : "reforecast nog niet ingericht"} />
            <MetricCard label="Plan break-even omzet" value={moneyOrMissing(planBreakEvenRevenue, hasPlanTargets)} helper="op basis van frozen plan" />
            <MetricCard label="Huidige break-even omzet" value={moneyOrMissing(breakEvenRevenue, hasActuals)} helper="op basis van actual contributieratio" />
            <MetricCard label="Verwacht resultaat" value={moneyOrMissing(reforecastResult, hasTemporaryReforecast)} tone={reforecastResult >= 0 ? "positive" : "negative"} helper={`grootste driver: ${largestVariance?.label ?? "-"}`} />
          </div>

          {revenueReconciliation ? (
            <section className="module-card">
              <div className="module-card-header be-next-table-header">
                <div>
                  <div className="module-card-title">Omzetreconciliatie</div>
                  <div className="module-card-text">
                    Dashboard &gt; Omzet over tijd is leidend voor actual omzet. De contributielaag kan lager zijn zolang regels nog geen categorie of kostprijsbron hebben.
                  </div>
                </div>
                <span className={`status-pill ${revenueReconciliation.status === "match" ? "status-ok" : "status-warning"}`}>
                  {revenueReconciliation.status === "match" ? "match" : "verschil"}
                </span>
              </div>
              <div className="data-table">
                <table>
                  <tbody>
                    <PnlRow label="Dashboard omzet (SSOT)" value={revenueReconciliation.dashboard_revenue} strong />
                    <PnlRow label="Break-even contributie-omzet" value={revenueReconciliation.contribution_revenue} />
                    <PnlRow label="Verschil nog te verklaren" value={revenueReconciliation.difference} />
                  </tbody>
                </table>
              </div>
              <div className="module-card-text">
                Basis {revenueReconciliation.basis || "-"}; periode {revenueReconciliation.since || "-"} t/m {revenueReconciliation.until || "-"}.
              </div>
            </section>
          ) : null}

          <section className="module-card">
            <div className="module-card-title">Break-even voortgang</div>
            <div className="be-next-progress-row">
              <div className="be3-ring" style={{ background: `conic-gradient(#22c55e ${Math.min(100, progressPct) * 3.6}deg, #e5e7eb 0deg)` }}>
                <div>
                  <strong>{number(progressPct, 0)}%</strong>
                  <span>contributie</span>
                </div>
              </div>
              <div className="be-next-explain">
                <strong>Dit vertelt of de verwachte contributie genoeg is om vaste kosten te dragen.</strong>
                <p>
                  De analyse houdt plan, actuals en reforecast gescheiden. Ontbrekende planwaarden worden niet automatisch aangevuld.
                </p>
              </div>
            </div>
          </section>

          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Omzet over tijd: plan, actual en reforecast</div>
                <div className="module-card-text">Blauw is het oorspronkelijke plan. De actuele/reforecast lijn kleurt groen als we boven plan eindigen en rood als we eronder blijven.</div>
              </div>
              <span className={`status-pill ${revenueGap >= 0 ? "status-ok" : "status-error"}`}>
                {revenueGap >= 0 ? "boven plan" : "onder plan"} {number(revenueGapPct, 1)}%
              </span>
            </div>
            <div className="be-next-chart be-next-revenue-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTimeline} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `€ ${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value: number) => money(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="plan" name="Plan" stroke="#2563eb" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="actual" name="Actual YTD" stroke={revenueGap >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={3} connectNulls={false} />
                  <Line type="monotone" dataKey="reforecast" name="Reforecast" stroke={revenueGap >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={3} strokeDasharray="7 7" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className={`module-card be-next-advice ${hasPlanTargets && revenueGap >= 0 ? "positive" : hasPlanTargets ? "negative" : ""}`}>
            <div>
              <div className="module-card-title">Conclusie</div>
              <p>
                {!hasPlanTargets
                  ? "Er is nog geen frozen plan voor dit jaar. Actuals kunnen al worden gecontroleerd, maar planverschil en stuuradvies zijn pas zinvol na het vastleggen van planomzet en plancontributie."
                  : revenueGap >= 0
                  ? `De reforecast ligt ${money(Math.abs(revenueGap))} boven plan. Stuur vooral op behoud van mix en contributie, niet alleen op extra omzet.`
                  : `De reforecast ligt ${money(Math.abs(revenueGap))} onder plan. Om het plan te halen is indicatief ${number(neededPricePct, 1)}% prijsverhoging of ${number(neededVolumePct, 1)}% extra contributievolume nodig.`}
              </p>
            </div>
            <div className="be-next-advice-actions">
              <span>Stuurgetal</span>
              <strong>Contributie</strong>
              <small>omzet blijft referentie</small>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "pnl" ? (
        <div className="be-next-grid be-next-grid-2">
          <PnlCard title="Plan" revenue={plan.revenue} variable={plan.variable} fixedCosts={activePlanFixedCosts} />
          <PnlCard title="Reforecast" revenue={reforecast.revenue} variable={reforecast.variable} fixedCosts={activeReforecastFixedCosts} />
          <section className="module-card be-next-wide">
            <div className="module-card-title">Van resultaatrekening naar verklaard resultaat</div>
            <VarianceBridge rows={varianceRows} />
          </section>
        </div>
      ) : null}

      {activeTab === "break_even" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-3">
            <MetricCard label="Break-even omzet" value={money(breakEvenRevenue)} helper="om vaste kosten te dekken" />
            <MetricCard label="Break-even liters" value={`${number(breakEvenLiters)} L`} helper="op huidige reforecast mix" />
            <MetricCard label="Break-even units" value={number(breakEvenUnits)} helper="gewogen gemiddelde units" />
            <MetricCard label="Nog contributie nodig" value={money(remainingContributionYtd)} helper="vanaf actual YTD tot vaste kosten" />
            <MetricCard label="Verwachte break-even maand" value={expectedBreakEvenMonth} helper="op basis van reforecast omzetlijn" />
            <MetricCard label="Controle resultaat" value={money(breakEvenResultCheck)} tone={Math.abs(breakEvenResultCheck) < 1 ? "positive" : "negative"} helper="moet rond nul zijn" />
          </div>

          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Controleberekening bij break-even</div>
                <div className="module-card-text">Deze berekening bewijst dat de break-even omzet precies genoeg contributie oplevert om de vaste kosten te dragen.</div>
              </div>
              <span className="status-pill status-ok">resultaat = 0</span>
            </div>
            <div className="data-table">
              <table>
                <tbody>
                  <PnlRow label="Omzet op break-even" value={breakEvenRevenue} />
                  <PnlRow label="Variabele kosten bij huidige mix" value={-breakEvenVariableCost} />
                  <PnlRow label="Contributie" value={breakEvenContribution} strong />
                  <PnlRow label="Vaste kosten" value={-activeReforecastFixedCosts} />
                  <PnlRow label="Resultaat" value={breakEvenResultCheck} strong />
                </tbody>
              </table>
            </div>
          </section>

          <section className="module-card be-next-advice">
            <div>
              <div className="module-card-title">Interpretatie</div>
              <p>
                Bij de huidige mix levert elke euro omzet gemiddeld {number(reforecastContributionRatio * 100, 1)}% contributie op.
                Daardoor is {money(breakEvenRevenue)} omzet nodig om {money(activeReforecastFixedCosts)} vaste kosten te dekken.
              </p>
            </div>
            <div className="be-next-advice-actions">
              <span>Rekenbasis</span>
              <strong>{money2(contributionPerLiter)} / L</strong>
              <small>contributie per liter</small>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "contribution" ? (
        <div className="wizard-stack">
          <section className="module-card">
            <div className="module-card-header">
              <div className="module-card-title">Categoriebehandeling</div>
              <div className="module-card-text">Deze laag voorkomt dat giftsets, diensten en merchandise de bierliters of mixanalyse vervuilen.</div>
            </div>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>Categorie</th>
                    <th>Omzet</th>
                    <th>Contributie</th>
                    <th>Liters/mix</th>
                    <th>Behandeling</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((row) => (
                    <tr key={row.category}>
                      <td><strong>{categoryLabel(row.category)}</strong><br /><small>{row.rows} verkoopbare regels</small></td>
                      <td>{money(row.revenue)}</td>
                      <td><strong>{money(row.contribution)}</strong></td>
                      <td>{row.units > 0 ? `${number(row.units)} st` : "-"}</td>
                      <td>{row.treatment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Van verkoopprijs naar contributie</div>
                <div className="module-card-text">Groepeerbaar per stijl/SKU-type; start met contributors en risico's, niet met alle 90 SKU's tegelijk.</div>
              </div>
              <input
                className="editor-input"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setContributionPage(1);
                }}
                placeholder="Zoek stijl, type of SKU"
              />
            </div>
            <div className="be-next-grid be-next-grid-3 be-next-contribution-summary">
              <MetricCard label="Zichtbare regels" value={`${contributionRows.length}`} helper="na filter/search" />
              <MetricCard
                label="Top contributor"
                value={topContributor ? money(topContributor.totalContribution) : "-"}
                helper={topContributor?.sku ?? "geen regels"}
              />
              <MetricCard label="Marge-risico's" value={`${marginRiskCount}`} helper="contributie onder 25% van prijs" tone={marginRiskCount > 0 ? "negative" : "positive"} />
            </div>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Categorie</th>
                    <th>Signaal</th>
                    <th>Prijs</th>
                    <th>Inkoop/productie</th>
                    <th>Accijns</th>
                    <th>Verpakking</th>
                    <th>Contributie</th>
                    <th>ABC allocatie</th>
                    <th>Marge na allocatie</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedContributionRows.map((row) => {
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.sku}</strong><br />
                          <small>{row.subtitle}</small>
                        </td>
                        <td><span className="status-pill status-neutral">{categoryLabel(row.category)}</span></td>
                        <td><span className={`status-pill status-${row.signal.tone}`}>{row.signal.label}</span></td>
                        <td>{money2(row.price)}</td>
                        <td>{money2(row.purchase)}</td>
                        <td>{money2(row.excise)}</td>
                        <td>{money2(row.packaging)}</td>
                        <td><strong>{money2(row.contribution)}</strong></td>
                        <td>{money2(row.fixedAllocation)}</td>
                        <td>{money2(row.allocatedMargin)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="be-next-pagination">
              <span>
                Pagina {safeContributionPage} van {contributionPageCount} - {contributionRows.length} regels
              </span>
              <div>
                <button type="button" className="secondary-button" disabled={safeContributionPage <= 1} onClick={() => setContributionPage((page) => Math.max(1, page - 1))}>
                  Vorige
                </button>
                <button type="button" className="secondary-button" disabled={safeContributionPage >= contributionPageCount} onClick={() => setContributionPage((page) => Math.min(contributionPageCount, page + 1))}>
                  Volgende
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "plan_actual" ? (
        <section className="module-card">
          <div className="module-card-header be-next-table-header">
            <div>
              <div className="module-card-title">Plan vs actual vs reforecast</div>
              <div className="module-card-text">
                {planActualNote || "Planregels worden naast actuals gezet. Per-SKU planvolume komt later uit de frozen planmix."}
              </div>
            </div>
            <span className="status-pill status-neutral">{planActualRows.length} SKU's</span>
          </div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Categorie</th>
                  <th>Status</th>
                  <th>Plan volume</th>
                  <th>Plan kostprijs</th>
                  <th>Actual YTD</th>
                  <th>Actual contributie</th>
                  <th>Reforecast</th>
                  <th>Reforecast contributie</th>
                </tr>
              </thead>
              <tbody>
                {planActualRows.map((row) => {
                  const status = planActualStatus(row);
                  return (
                    <tr key={row.sku_id || row.sku_name}>
                      <td><strong>{row.sku_name}</strong><br /><small>{row.sku_code || row.sku_id}</small></td>
                      <td><span className="status-pill status-neutral">{categoryLabel(row.category)}</span></td>
                      <td><span className={`status-pill status-${status.tone}`}>{status.label}</span></td>
                      <td>{row.planned_units > 0 ? `${number(row.planned_units)} st / ${number(row.planned_liters)} L` : "niet ingevuld"}</td>
                      <td>
                        <strong>{money2(row.planned_cost_unit)}</strong><br />
                        <small>variabel {money2(row.planned_variable_cost_unit)} + vast {money2(row.planned_fixed_allocation_unit)}</small>
                      </td>
                      <td>{number(row.actual_units)} st<br /><small>{money(row.actual_revenue)} omzet</small></td>
                      <td><strong>{money(row.actual_contribution)}</strong></td>
                      <td>{number(row.reforecast_units)} st</td>
                      <td><strong>{money(row.reforecast_contribution)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "variance" ? (
        <div className="be-next-grid be-next-grid-2">
          <section className="module-card">
            <div className="module-card-title">Variance bridge</div>
            <div className="be-next-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={varianceRows}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={80} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `€ ${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value: number) => money(Number(value))} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {varianceRows.map((entry) => (
                      <Cell key={entry.key} fill={entry.kind === "result" ? "#2563eb" : entry.value >= 0 ? "#22c55e" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="module-card">
            <div className="module-card-title">Bezettingsresultaat</div>
            <div className="placeholder-block">
              <strong>{money(occupancyResult)}</strong>
              <div className="muted">
                Formule: ({number(reforecast.liters)} L reforecast - {number(plannedNormalLiters)} L normale bezetting) x {money2(fixedRate)} vaste kosten per liter.
              </div>
            </div>
            <div className="module-card-text">
              Dit resultaat verklaart dat vaste kosten over minder of meer volume worden terugverdiend dan gepland. De geplande kostprijs blijft dus intact.
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "scenario" ? (
        <div className="wizard-stack">
          <div className="be-next-grid be-next-grid-2">
            <section className="module-card">
              <div className="module-card-title">Scenario lab</div>
              <ScenarioSlider label="Prijs" value={scenario.pricePct} min={-10} max={15} onChange={(pricePct) => setScenario((current) => ({ ...current, pricePct }))} />
              <ScenarioSlider label="Volume" value={scenario.volumePct} min={-25} max={30} onChange={(volumePct) => setScenario((current) => ({ ...current, volumePct }))} />
              <ScenarioSlider label="Vaste kosten" value={scenario.fixedCostPct} min={-20} max={20} onChange={(fixedCostPct) => setScenario((current) => ({ ...current, fixedCostPct }))} />
            </section>
            <section className="module-card">
              <div className="module-card-title">Scenario uitkomst</div>
              <div className="record-card-grid">
                <MetricCard label="Omzet" value={money(scenarioResult.revenue)} />
                <MetricCard label="Contributie" value={money(scenarioResult.contribution)} />
                <MetricCard label="Vaste kosten" value={money(scenarioResult.fixedCosts)} />
                <MetricCard label="Resultaat" value={money(scenarioResult.result)} tone={scenarioResult.result >= 0 ? "positive" : "negative"} />
                <MetricCard label="Break-even omzet" value={money(scenarioResult.breakEvenRevenue)} />
              </div>
            </section>
          </div>

          <section className="module-card">
            <div className="module-card-header">
              <div className="module-card-title">Advieskaarten om het gat te sluiten</div>
              <div className="module-card-text">Indicatief op basis van huidige reforecast. Deze kaarten schrijven niets weg en zijn bedoeld als stuurinformatie.</div>
            </div>
            <div className="be-next-grid be-next-grid-4">
              <AdviceCard
                title="Prijs"
                value={`+${number(neededResultPricePct, 1)}%`}
                helper={`prijs nodig om ${money(Math.max(0, resultGap))} resultaatgat te sluiten`}
                mutedValue={`omzetgat: +${number(neededPricePct, 1)}%`}
              />
              <AdviceCard
                title="Volume"
                value={`+${number(neededResultVolumePct, 1)}%`}
                helper="extra contributievolume bij gelijke prijs en mix"
                mutedValue={`contributiegat: ${money(Math.max(0, contributionGap))}`}
              />
              <AdviceCard
                title="Gebalanceerd"
                value={`+${number(balancedPricePct, 1)}% / +${number(balancedVolumePct, 1)}%`}
                helper="helft via prijs, helft via volume"
                mutedValue="eerste realistische stuurvariant"
              />
              <AdviceCard
                title="Vaste kosten"
                value={money(Math.max(0, resultGap))}
                helper="kostenreductie nodig als prijs en volume gelijk blijven"
                mutedValue={`huidige vaste kosten: ${money(activeReforecastFixedCosts)}`}
              />
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "year_close" ? (
        <div className="be-next-grid be-next-grid-2">
          <section className="module-card">
            <div className="module-card-header be-next-table-header">
              <div>
                <div className="module-card-title">Jaarafsluiting preview</div>
                <div className="module-card-text">Preview op basis van hetzelfde read-model als dashboard, P&L en break-even.</div>
              </div>
              <span className={`status-pill ${readModelWarnings.length ? "status-warning" : "status-ok"}`}>
                {readModelWarnings.length ? "controle nodig" : "klaar voor controle"}
              </span>
            </div>
            <div className="data-table">
              <table>
                <tbody>
                  <PnlRow label="Omzet" value={reforecast.revenue} />
                  <PnlRow label="Variabele kosten" value={-reforecast.variable} />
                  <PnlRow label="Contributie" value={reforecast.contribution} strong />
                  <PnlRow label="Vaste kosten" value={-activeReforecastFixedCosts} />
                  <PnlRow label="Operationeel resultaat" value={reforecastResult} strong />
                  <PnlRow label="Bezettingsresultaat t.o.v. plan" value={occupancyResult} />
                </tbody>
              </table>
            </div>
          </section>
          <section className="module-card">
            <div className="module-card-title">Datakwaliteit voor afsluiten</div>
            {readModelWarnings.length ? (
              <div className="be-next-warning-list">
                {readModelWarnings.map((warning) => (
                  <div key={`year-close-${warning.code}-${warning.message}`} className="editor-status warning">
                    <strong>{warning.code || "waarschuwing"}</strong>: {warning.message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="editor-status success">Geen read-model waarschuwingen gevonden.</div>
            )}
          </section>
          <section className="module-card be-next-wide">
            <div className="module-card-title">Handoff naar Nieuw jaar voorbereiden</div>
            <div className="placeholder-block">
              <strong>Expliciete keuze nodig</strong>
              <div className="muted">
                Na jaarafsluiting kan de gebruiker kiezen of gesloten actuals worden gebruikt als basis voor het nieuwe conceptjaar. Niets wordt stil overschreven.
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: "positive" | "negative" }) {
  return (
    <section className={`module-card be-next-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </section>
  );
}

function AdviceCard({ title, value, helper, mutedValue }: { title: string; value: string; helper: string; mutedValue: string }) {
  return (
    <section className="be-next-advice-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
      <small>{mutedValue}</small>
    </section>
  );
}

function PnlCard({ title, revenue, variable, fixedCosts }: { title: string; revenue: number; variable: number; fixedCosts: number }) {
  const contribution = revenue - variable;
  const result = contribution - fixedCosts;
  return (
    <section className="module-card">
      <div className="module-card-title">{title}</div>
      <div className="data-table">
        <table>
          <tbody>
            <PnlRow label="Omzet" value={revenue} />
            <PnlRow label="Kostprijs verkopen / variabel" value={-variable} />
            <PnlRow label="Brutomarge / contributie" value={contribution} strong />
            <PnlRow label="Vaste kosten" value={-fixedCosts} />
            <PnlRow label="Operationeel resultaat" value={result} strong />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PnlRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td>{strong ? <strong>{label}</strong> : label}</td>
      <td style={{ textAlign: "right" }}>{strong ? <strong>{money(value)}</strong> : money(value)}</td>
    </tr>
  );
}

function VarianceBridge({ rows }: { rows: VarianceRow[] }) {
  return (
    <div className="data-table">
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.kind === "result" ? <strong>{row.label}</strong> : row.label}</td>
              <td style={{ textAlign: "right" }}>
                <strong className={row.value >= 0 ? "be-next-positive" : "be-next-negative"}>{money(row.value)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="be3-slider">
      <div>
        <span>{label}</span>
        <strong>{value > 0 ? "+" : ""}{number(value, 0)}%</strong>
      </div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

