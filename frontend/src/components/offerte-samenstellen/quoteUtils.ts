import type {
  BasisData,
  QuoteDraft,
  QuoteFormState,
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
    name: `Scenario ${id}`,
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
  };
}

export function createInitialQuoteFormState(): QuoteFormState {
  return {
    introStart: "",
    introEnd: "",
    introProducts: "",
    introEligibleRefs: [],
    introPromoType: "discount",
    introAction: "",
    introValue: "",
    staffelProduct: "",
    staffelEligibleRefs: [],
    staffelRows: [
      { from: "1", to: "9", price: "25,00" },
      { from: "10", to: "49", price: "22,00" },
      { from: "50", to: "∞", price: "20,00" },
    ],
    mixCondition: "3 verschillende bieren",
    mixStructure: "3+2",
    mixEligibleRefs: [],
    mixProducts: "",
    discountMode: "Totaal",
    discountValue: "5",
    kortingEligibleRefs: [],
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
