export type GenericRecord = Record<string, unknown>;

export type ActiveCommercialContextInput = {
  operationalYear: number;
  channels: GenericRecord[];
  beers: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  costVersions: GenericRecord[];
  activations: GenericRecord[];
  activationEvents?: GenericRecord[];
  sellingPrices: GenericRecord[];
  advicePrices: GenericRecord[];
  packagingComponentPrices?: GenericRecord[];
  activeBreakEvenPlans?: GenericRecord[];
  basisProducts?: GenericRecord[];
  composedProducts?: GenericRecord[];
};

export type ContextWarning = {
  code: string;
  message: string;
  skuId?: string;
  channelCode?: string;
  sourceIds?: string[];
};

export type CostComponents = Readonly<{
  purchaseEx: number;
  packagingEx: number;
  indirectEx: number;
  exciseEx: number;
  costPriceEx: number;
}>;

export type PlanningCostResolution = {
  status:
    | "resolved"
    | "not_required"
    | "missing_activation"
    | "missing_cost_version"
    | "missing_cost_row"
    | "invalid_cost";
  source:
    | "first_observable_activation"
    | "explicit_approved_rebaseline"
    | "packaging_component_price"
    | "not_applicable"
    | "unresolved";
  sourceId: string;
  activationId: string;
  costVersionId: string;
  costRowId: string;
  effectiveAt: string;
  historyProven: boolean;
  costPriceEx: number | null;
  components: CostComponents | null;
  warnings: string[];
};

export type SellingPriceResolution = {
  channelCode: string;
  status: "resolved" | "missing" | "not_applicable";
  sellInEx: number | null;
  marginPct: number | null;
  resolvedYear: number;
  source: "prijs" | "opslag" | "manual_rate" | "unresolved";
  sourceRecordId: string;
  sourceScope:
    | import("@/components/offerte-samenstellen/sellInResolver").SellInResolutionSourceScope
    | "manual_rate"
    | "unresolved";
  sourceKey: string;
  warnings: string[];
};

export type AdvicePriceResolution = {
  channelCode: string;
  status: "resolved" | "missing" | "not_applicable";
  sourceRecordId: string;
  markupPct: number | null;
  priceInclVat: number | null;
  minimumInclVat: number | null;
  maximumInclVat: number | null;
  customerMarginPct: number | null;
  warnings: string[];
};

export type ActiveCommercialSkuContext = {
  skuId: string;
  beerId: string;
  productId: string;
  skuKind: string;
  costMethod: string;
  versionProvenance: {
    calculationType: string;
    sourceType: string;
    sourceYear: number | null;
  };
  pricingMethod: "cost_plus" | "manual_rate";
  litersPerUnit: number;
  vatRatePct: number;
  planningCost: PlanningCostResolution;
  sellingPrices: SellingPriceResolution[];
  advicePrices: AdvicePriceResolution[];
  readiness: {
    quote: boolean;
    breakEven: boolean;
    advice: boolean;
  };
  warnings: string[];
};

export type ConsumerDifference = {
  consumer: "quote" | "advice" | "break_even";
  field: "presence" | "cost_price" | "cost_version" | "sell_in";
  skuId: string;
  channelCode?: string;
  reason: string;
};

export type ActiveCommercialContext = {
  resolverVersion: "rf-011a-v1";
  operationalContext: {
    year: number;
    status: "candidate";
    authority: "explicit_parameter";
    activeYearsetAuthorityEstablished: false;
  };
  skus: ActiveCommercialSkuContext[];
  breakEvenPlan: {
    status: "resolved" | "missing" | "ambiguous";
    planId: string;
    generationId: string;
    source: string;
    candidateIds: string[];
  };
  completenessWarnings: ContextWarning[];
  shadowComparison: {
    quoteCompared: number;
    adviceCompared: number;
    breakEvenCompared: number;
    differences: ConsumerDifference[];
  };
};

export type ActiveCommercialContextReader = {
  readSnapshot: (
    operationalYear: number
  ) => Promise<Omit<ActiveCommercialContextInput, "operationalYear">>;
};
