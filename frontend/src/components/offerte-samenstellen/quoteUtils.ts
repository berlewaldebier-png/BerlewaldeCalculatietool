import type {
  BasisData,
  QuoteDraft,
  QuoteProduct,
  QuoteFormState,
  ProductOption,
  QuoteProductUnit,
  QuoteScenario,
  ScenarioId,
} from "@/components/offerte-samenstellen/types";

export function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function clampNumber(value: unknown, fallback: number) {
  const num = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function inferUnitFromPack(pack: string): QuoteProductUnit {
  const text = pack.toLowerCase();
  if (text.includes("fust")) return "fust";
  if (text.includes("doos")) return "doos";
  return "fles";
}

export function createInitialBasisData(): BasisData {
  return {
    klantNaam: "",
    contactpersoon: "",
    kanaal: "Horeca",
    offerteNaam: "",
    geldigTot: "",
    opmerking: "",
  };
}

export function createEmptyScenario(id: ScenarioId): QuoteScenario {
  return {
    id,
    name: `Voorstel ${id}`,
    products: [],
    blocks: [],
    note: "",
    intro: null,
  };
}

export function createInitialQuoteDraft(year: number): QuoteDraft {
  return {
    meta: {
      draftId: null,
      status: "concept",
      version: 1,
      createdAt: null,
      updatedAt: null,
    },
    year,
    basis: createInitialBasisData(),
    scenarios: {
      A: createEmptyScenario("A"),
      B: createEmptyScenario("B"),
      C: createEmptyScenario("C"),
    },
    breakEven: null,
  };
}

export function createInitialQuoteFormState(): QuoteFormState {
  return {
    introStart: "",
    introEnd: "",
    introEligibleRefs: [],
    introPromoType: "discount",
    introDiscountMode: "all",
    introDiscountPercent: "",
    introDiscountsByProduct: {},
    introXValue: "",
    introYValue: "",
    introApplyMode: "combined",
    introSingleProductRef: "",
    introThresholdType: "liters",
    introThresholdApplyMode: "all",
    introThresholdSingleProductRef: "",
    introThresholdValue: "",
    introThresholdDiscount: "",
    introNote: "",
    staffelUseBaseOfferProducts: true,
    staffelEligibleRefs: [],
    staffelDiscountMode: "absolute",
    staffelDiscountValue: "0,50",
    staffelRows: [
      { from: "1", to: "10", price: "" },
      { from: "11", to: "", price: "" },
    ],
    mixCondition: "3 verschillende bieren",
    mixStructure: "3+2",
    mixEligibleRefs: [],
    mixProducts: "",
    kortingUseBaseOfferProducts: true,
    discountMode: "Totaal",
    discountValue: "5",
    kortingEligibleRefs: [],
    wholesaleUseBaseOfferProducts: true,
    wholesaleEligibleRefs: [],
    wholesaleMarginPct: "18",
    transportDistanceKm: "42",
    transportRateEx: "0,50",
    transportDeliveries: "1",
    transportThresholdKm: "40",
    transportChargedToCustomer: true,
    returnPct: "10",
    tastingCondition: "Gratis bij >= 10 fusten",
    tastingIsFree: true,
    tastingPriceEx: "0",
    tastingCostEx: "75",
    tapCondition: "Gratis bij >= 5 fusten",
    tapIsFree: true,
    tapPriceEx: "0",
    tapCostEx: "90",
  };
}

export function getProductRef(product: QuoteProduct) {
  if (product.source?.sku_id) {
    return `sku:${String(product.source.sku_id)}`;
  }
  if (product.source?.bier_id && product.source?.product_id) {
    return `beer:${String(product.source.bier_id)}:product:${String(product.source.product_id)}`;
  }
  return String(product.id ?? "").trim();
}

export function resolveScenarioProductRefs(
  scenarioProducts: QuoteProduct[],
  productOptions: ProductOption[]
) {
  const optionIds = new Set(productOptions.map((option) => option.optionId));
  return scenarioProducts
    .map((product) => getProductRef(product))
    .filter((ref) => ref && optionIds.has(ref));
}
