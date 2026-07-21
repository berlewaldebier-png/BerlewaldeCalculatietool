import type { GenericRecord } from "@/features/commercial-context/activeCommercialContextTypes";
import type { CostpriceParts } from "@/lib/costpriceCalculationEngine";

export type YearTransitionClassification =
  | "basis"
  | "composed"
  | "variant"
  | "article"
  | "service"
  | "unknown";

export type YearTransitionBlockerCode =
  | "invalid_year_transition"
  | "unknown_source_sku"
  | "source_cost_unresolved"
  | "duplicate_target_input"
  | "extra_target_input"
  | "target_input_missing"
  | "target_input_identity_mismatch"
  | "target_calculation_mode_unknown"
  | "target_cost_non_positive"
  | "target_liters_missing"
  | "target_channel_missing"
  | "derived_parent_missing"
  | "derived_parent_unresolved"
  | "composed_bom_missing"
  | "composed_cost_unresolved"
  | "plan_source_missing"
  | "plan_revenue_missing"
  | "plan_variable_cost_invalid"
  | "plan_contribution_missing"
  | "plan_totals_inconsistent"
  | "plan_liters_missing"
  | "plan_units_missing"
  | "plan_period_allocation_missing"
  | "plan_period_allocation_mismatch"
  | "plan_sku_allocation_missing"
  | "plan_sku_allocation_mismatch";

export type YearTransitionBlocker = Readonly<{
  code: YearTransitionBlockerCode;
  skuId?: string;
  sourceIds?: string[];
  detail?: string;
}>;

export type FrozenPlanValues = Readonly<{
  revenue: number;
  variableCost: number;
  contribution: number;
  liters: number;
  units: number;
}>;

export type FrozenPlanAllocation = FrozenPlanValues &
  Readonly<{
    key: string;
  }>;

export type FrozenPlanDraft = Readonly<{
  source: string;
  sourceRecordId?: string;
  targets: FrozenPlanValues;
  periodAllocations: FrozenPlanAllocation[];
  skuAllocations: FrozenPlanAllocation[];
}>;

export type CanonicalYearTransitionInput = Readonly<{
  sourceYear: number;
  targetYear: number;
  requiredChannels: string[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
  costVersions: GenericRecord[];
  activations: GenericRecord[];
  activationEvents?: GenericRecord[];
  externalMappings?: GenericRecord[];
  packagingComponentPrices?: GenericRecord[];
  targetYearInputs: GenericRecord[];
  frozenPlan: FrozenPlanDraft | null;
  currentUiDerivedRows?: GenericRecord[];
  historicalDossiers?: Array<{
    versionId: string;
    originalSnapshot: unknown;
    normalizedRows: unknown;
  }>;
}>;

export type CanonicalTransitionEntry = Readonly<{
  skuId: string;
  beerId: string;
  subjectId: string;
  formatArticleId: string;
  skuKind: string;
  classification: YearTransitionClassification;
  bomFingerprint: string;
  externalMappingFingerprint: string;
  source: Readonly<{
    year: number;
    costVersionId: string;
    costRowId: string;
    costMethod: string;
    components: CostpriceParts | null;
  }>;
  target: Readonly<{
    year: number;
    calculationMode: string;
    components: CostpriceParts | null;
    litersPerUnit: number;
    readyChannels: string[];
    readiness: "ready" | "not_required" | "blocked";
  }>;
  provenance: Readonly<{
    kind: "recalculated_from_year";
    sourceYear: number;
    sourceCostVersionId: string;
    sourceCostRowId: string;
  }>;
  changedFields: string[];
  blockers: YearTransitionBlocker[];
}>;

export type PlanForecastContract = Readonly<{
  plan: Readonly<{
    status: "ready" | "blocked";
    immutableAfterActivation: true;
    source: string;
    sourceRecordId: string;
    targets: FrozenPlanValues | null;
    periodAllocations: FrozenPlanAllocation[];
    skuAllocations: FrozenPlanAllocation[];
    blockers: YearTransitionBlocker[];
  }>;
  initialForecast: Readonly<{
    status: "ready" | "blocked";
    basis: "frozen_plan";
    targets: FrozenPlanValues | null;
    exactlyMatchesPlan: boolean;
  }>;
  runtimePolicy: Readonly<{
    plan: "immutable_frozen_plan";
    actual: "realized_transactions_exact_lot_or_frozen_snapshot";
    forecast: "actual_to_date_plus_remaining_plan_plus_explicit_revision";
    yearClose: "forecast_equals_final_actual";
  }>;
}>;

export type CanonicalYearTransitionPlan = Readonly<{
  plannerVersion: "rf-011c-v1";
  sourceYear: number;
  targetYear: number;
  entries: CanonicalTransitionEntry[];
  planForecast: PlanForecastContract;
  historicalRepresentations: Array<{
    versionId: string;
    originalSnapshot: unknown;
    normalizedRows: unknown;
    differs: boolean;
  }>;
  shadowComparison: Readonly<{
    currentRows: number;
    duplicateUiSkuIds: string[];
    missingCurrentSkuIds: string[];
    extraCurrentSkuIds: string[];
    differingSkuIds: string[];
  }>;
  blockers: YearTransitionBlocker[];
  readyForCandidateWrite: boolean;
}>;

export type CanonicalYearTransitionReader = Readonly<{
  readSnapshot: (
    sourceYear: number,
    targetYear: number
  ) => Promise<Omit<CanonicalYearTransitionInput, "sourceYear" | "targetYear">>;
}>;

export type MutableTransitionEntry = {
  skuId: string;
  beerId: string;
  subjectId: string;
  formatArticleId: string;
  skuKind: string;
  classification: YearTransitionClassification;
  bomFingerprint: string;
  externalMappingFingerprint: string;
  source: {
    year: number;
    costVersionId: string;
    costRowId: string;
    costMethod: string;
    components: CostpriceParts | null;
  };
  target: {
    year: number;
    calculationMode: string;
    components: CostpriceParts | null;
    litersPerUnit: number;
    readyChannels: string[];
    readiness: "ready" | "not_required" | "blocked";
  };
  provenance: {
    kind: "recalculated_from_year";
    sourceYear: number;
    sourceCostVersionId: string;
    sourceCostRowId: string;
  };
  changedFields: string[];
  blockers: YearTransitionBlocker[];
};
