import type { ReactNode } from "react";

export type GenericRecord = Record<string, unknown>;

export type StepKey = "basis" | "builder" | "vergelijk" | "afronden";
export type UnitMode = "producten" | "liters";
export type VatMode = "incl" | "excl";
export type ScenarioId = "A" | "B" | "C";
export type QuoteChannel = "Horeca" | "Retail" | "Events";
export type QuoteBlockContext = "intro" | "standard" | "global";

export type QuoteProductUnit = "fust" | "doos" | "fles";

export type QuoteProductSource = {
  bier_id?: string;
  product_id?: string;
  kostprijsversie_id?: string;
};

export type QuoteProduct = {
  id: string;
  name: string;
  pack: string;
  qty: number;
  litersPerUnit: number;
  unit: QuoteProductUnit;
  standardPriceEx: number;
  costPriceEx: number;
  vatRatePct: number;
  source?: QuoteProductSource;
};

export type OptionType =
  | "Intro"
  | "Staffel"
  | "Mix"
  | "Korting"
  | "Transport"
  | "Retour"
  | "Proeverij"
  | "Tapverhuur";

export type ToolbarGroup = {
  title: string;
  items: Array<{ icon: ReactNode; label: OptionType }>;
};

export type BuilderBlock = {
  id: string;
  type: OptionType;
  title: string;
  subtitle: string;
  lines: string[];
  tone: string;
  icon: ReactNode;
  impact?: string;
  appliesTo?: QuoteBlockContext;
  payload?: Record<string, unknown>;
};

export type QuoteScenario = {
  id: ScenarioId;
  name: string;
  products: QuoteProduct[];
  blocks: BuilderBlock[];
  note?: string;
  intro?: { start: string; end: string } | null;
};

export type BasisData = {
  klantNaam: string;
  contactpersoon: string;
  kanaal: QuoteChannel;
  offerteNaam: string;
  geldigTot: string;
  opmerking: string;
};

export type QuoteDraftStatus = "concept" | "definitief";

export type QuoteDraftMeta = {
  draftId: string | null;
  status: QuoteDraftStatus;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type QuoteDraft = {
  meta: QuoteDraftMeta;
  year: number;
  basis: BasisData;
  scenarios: Record<ScenarioId, QuoteScenario>;
  breakEven: QuoteBreakEvenSnapshot | null;
};

export type QuoteBreakEvenSnapshot = {
  configId: string;
  configName: string;
  year: number;
  breakEvenRevenue: number;
  breakEvenLiters: number;
  weightedSellInPerLiter: number;
  weightedVariableCostPerLiter: number;
  weightedContributionPerLiter: number;
  contributionMarginPct: number;
  mixTotalPct: number;
  calculatedAt: string;
};

export type QuoteBuilderUiState = {
  step: StepKey;
  activeScenario: ScenarioId;
  unitMode: UnitMode;
  vatMode: VatMode;
};

export type QuoteDraftSnapshot = QuoteDraft & {
  ui: QuoteBuilderUiState;
};

export type QuotePersistencePayload = {
  schemaVersion: number;
  kind: "offerte-draft";
  savedAt: string;
  draft: QuoteDraftSnapshot;
};

export type QuoteDraftRecord = {
  id: string;
  quote_number: string;
  quote_number_seq: number;
  schema_version: number;
  draft_version: number;
  status: QuoteDraftStatus;
  year: number;
  customer_name: string;
  contact_name: string;
  channel_code: string;
  title: string;
  valid_until: string | null;
  active_scenario_id: ScenarioId;
  created_at: string | null;
  updated_at: string | null;
  finalized_at: string | null;
  payload: QuotePersistencePayload;
};

export type ProductOption = {
  optionId: string;
  bierId: string;
  productId: string;
  label: string;
  bierName: string;
  packLabel: string;
  litersPerUnit: number;
  staffelCompatibilityKey: string;
  staffelCompatibilityLabel: string;
  costPriceEx: number;
  standardPriceEx: number;
  vatRatePct: number;
  kostprijsversieId: string;
};

export type ProductIndexResult = {
  options: ProductOption[];
  warnings: string[];
};

export type ScenarioMetrics = {
  revenueEx: number;
  costEx: number;
  extraCostEx: number;
  transportCostEx: number;
  marginPct: number;
  breakEvenCurrent: number | null;
  breakEvenProjected: number | null;
  breakEvenCoveragePct: number | null;
  notes: string[];
};

export type StaffelRowInput = {
  from: string;
  to: string;
  price: string;
};

export type StaffelDiscountMode = "percent" | "absolute" | "free";

export type QuoteFormState = {
  introStart: string;
  introEnd: string;
  introEligibleRefs: string[];
  introPromoType: "discount" | "x_plus_y" | "threshold_discount";
  introDiscountMode: "all" | "per_product";
  introDiscountPercent: string;
  introDiscountsByProduct: Record<string, string>;
  introXValue: string;
  introYValue: string;
  introApplyMode: "combined" | "single";
  introSingleProductRef: string;
  introThresholdType: "liters" | "dozen";
  introThresholdApplyMode: "all" | "single";
  introThresholdSingleProductRef: string;
  introThresholdValue: string;
  introThresholdDiscount: string;
  introNote: string;
  staffelUseBaseOfferProducts: boolean;
  staffelEligibleRefs: string[];
  staffelDiscountMode: StaffelDiscountMode;
  staffelDiscountValue: string;
  staffelRows: StaffelRowInput[];
  mixCondition: string;
  mixStructure: string;
  mixEligibleRefs: string[];
  mixProducts?: string;
  kortingUseBaseOfferProducts: boolean;
  discountMode: string;
  discountValue: string;
  kortingEligibleRefs: string[];
  transportDistanceKm: string;
  transportRateEx: string;
  transportDeliveries: string;
  transportThresholdKm: string;
  transportChargedToCustomer: boolean;
  returnPct: string;
  tastingCondition: string;
  tastingIsFree: boolean;
  tastingPriceEx: string;
  tastingCostEx: string;
  tapCondition: string;
  tapIsFree: boolean;
  tapPriceEx: string;
  tapCostEx: string;
};

export type OfferteSamenstellenProps = {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  catalogusproducten: GenericRecord[];
  verpakkingsonderdelen: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  breakEvenConfiguraties: unknown;
  vasteKosten: Record<string, unknown>;
  initialMode?: string;
  initialDraftId?: string | null;
};
