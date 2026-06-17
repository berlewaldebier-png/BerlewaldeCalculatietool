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

export { euro, clampNumber, normalizeText } from "./offerteSamenstellenUi";

export function inferUnitFromPack(pack: string): QuoteProductUnit {
  const text = pack.toLowerCase();
  if (text.includes("liter") || text === "l") return "liter";
  if (text.includes("fust")) return "fust";
  if (text.includes("doos")) return "doos";
  if (text.includes("glas") || text.includes("stuk")) return "stuk";
  return "fles";
}

export function createInitialBasisData(): BasisData {
  return {
    klantId: null,
    klantNaam: "",
    contactpersoon: "",
    kanaal: "Horeca",
    offerteNaam: "",
    geldigTot: "",
    opmerking: "",
    afstandKm: "",
  };
}

export function createEmptyScenario(id: ScenarioId): QuoteScenario {
  return {
    id,
    name: `Voorstel ${id}`,
    products: [],
    blocks: [],
    autoRebalance: true,
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
    dealContext: "one_off",
    mixSource: "quote",
    targetVolumeLiters: null,
    agreementVolumeLiters: null,
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
    introScopeAllProducts: true,
    introContractDurationMonths: "12",
    introContractEndDate: "",
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
    staffelScopeAllProducts: true,
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
    discountMode: "Totaal",
    discountValue: "5",
    kortingScopeAllProducts: true,
    kortingEligibleRefs: [],
    wholesaleScopeAllProducts: true,
    wholesaleEligibleRefs: [],
    wholesaleMarginPct: "18",
    wholesaleSameMarginAllProducts: true,
    wholesaleMarginsByRef: {},
    palletDoosUnitsPerLayer: "12",
    palletDoosUnitsPerPallet: "72",
    palletFustUnitsPerLayer: "20",
    palletFustUnitsPerPallet: "40",
    palletDoosCostPerPallet: "15",
    palletDoosPickCostPerExtraSku: "5",
    palletFustCostPerPallet: "15",
    palletFustPickCostPerExtraSku: "5",
    palletChargedToCustomer: true,
    transportDistanceKm: "0",
    transportRateEx: "0,45",
    transportDeliveries: "1",
    transportThresholdKm: "40",
    transportFreeShippingThresholdValue: "20",
    transportFreeShippingThresholdUnit: "km",
    transportCostType: "per_km",
    transportCostEx: "40",
    transportIncludeInMargin: true,
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
  if (product.source?.option_id) {
    return String(product.source.option_id);
  }
  if (product.source?.packaging_component_id) {
    return `packaging:${String(product.source.packaging_component_id)}`;
  }
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
