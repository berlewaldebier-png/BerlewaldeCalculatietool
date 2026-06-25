import { calculateAccijnsPerProduct, vasteKostenPerLiter } from "@/lib/kostprijsEngine";

type GenericRecord = Record<string, unknown>;

export type KostprijsCalcType = "inkoop" | "eigen_productie";
export type ProductType = "basis" | "samengesteld";

export type OverheadBucket = {
  manufacturingPerLiter: number;
  businessPerLiter: number;
  totalPerLiter: number;
};

export type SummaryProductRow = {
  biernaam: string;
  soort: string;
  product_id?: string;
  product_type?: string;
  verpakking?: string;
  verpakkingseenheid: string;
  primaire_kosten: string | number;
  verpakkingskosten: string | number;
  vaste_kosten: string | number;
  manufacturing_overhead?: string | number;
  business_overhead?: string | number;
  overhead_breakdown?: Array<{
    cost_pool: string;
    allocation_driver: string;
    amount: number;
  }>;
  accijns: string | number;
  kostprijs: string | number;
};

export type ResultaatSnapshot = {
  methodology_version?: "legacy" | "abc_v1";
  integrale_kostprijs_per_liter: number | null;
  variabele_kosten_per_liter: number | null;
  directe_vaste_kosten_per_liter: number | null;
  manufacturing_overhead_per_liter?: number | null;
  business_overhead_per_liter?: number | null;
  productkost_per_liter?: number | null;
  kostendekkend_per_liter?: number | null;
  producten: {
    basisproducten: SummaryProductRow[];
    samengestelde_producten: SummaryProductRow[];
  };
};

export function roundValue(value: number) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function clampNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export type PackagingPriceRow = {
  jaar: number;
  verpakkingsonderdeel_id: string;
  prijs_per_stuk?: number;
};

export function createPackagingResolvers(params: {
  baseDefs: any[];
  compositeDefs: any[];
  packagingPrices: PackagingPriceRow[];
  draftPackagingPrices?: Record<string, number>;
  draftYear?: number;
}) {
  const { baseDefs, compositeDefs, packagingPrices, draftPackagingPrices, draftYear } = params;

  const priceByYearComponent = new Map<string, number>();
  (Array.isArray(packagingPrices) ? packagingPrices : []).forEach((row) => {
    const year = Number((row as any).jaar ?? 0);
    const id = String((row as any).verpakkingsonderdeel_id ?? "");
    if (!year || !id) return;
    priceByYearComponent.set(`${year}|${id}`, Number((row as any).prijs_per_stuk ?? 0));
  });

  const baseByIdYear = new Map<string, any>();
  baseDefs.forEach((row) => {
    const id = String(row?.id ?? "");
    const jaar = Number(row?.jaar ?? 0);
    if (!id || !jaar) return;
    baseByIdYear.set(`${jaar}|${id}`, row);
  });
  const compositeByIdYear = new Map<string, any>();
  compositeDefs.forEach((row) => {
    const id = String(row?.id ?? "");
    const jaar = Number(row?.jaar ?? 0);
    if (!id || !jaar) return;
    compositeByIdYear.set(`${jaar}|${id}`, row);
  });

  function componentPrice(year: number, componentId: string) {
    if (draftYear && draftPackagingPrices && year === draftYear) {
      return Number(draftPackagingPrices[componentId] ?? 0);
    }
    return Number(priceByYearComponent.get(`${year}|${componentId}`) ?? 0);
  }

  function getBaseDef(id: string, year: number) {
    return baseByIdYear.get(`${year}|${id}`) ?? baseDefs.find((row) => String(row?.id ?? "") === id) ?? null;
  }
  function getCompositeDef(id: string, year: number) {
    return (
      compositeByIdYear.get(`${year}|${id}`) ??
      compositeDefs.find((row) => String(row?.id ?? "") === id) ??
      null
    );
  }

  function packagingCostForBase(productId: string, year: number) {
    const def = getBaseDef(productId, year);
    if (!def) return 0;
    const onderdelen = Array.isArray(def.onderdelen) ? def.onderdelen : [];
    return onderdelen.reduce((sum: number, onderdeel: any) => {
      const componentId = String(onderdeel?.verpakkingsonderdeel_id ?? "");
      const qty = Number(onderdeel?.hoeveelheid ?? 0);
      return sum + qty * componentPrice(year, componentId);
    }, 0);
  }

  function packagingCostForComposite(productId: string, year: number) {
    const def = getCompositeDef(productId, year);
    if (!def) return 0;
    const basisproducten = Array.isArray(def.basisproducten) ? def.basisproducten : [];
    return basisproducten.reduce((sum: number, row: any) => {
      const baseId = String(row?.basisproduct_id ?? "");
      const count = Number(row?.aantal ?? 0);
      return sum + count * packagingCostForBase(baseId, year);
    }, 0);
  }

  function packagingCost(productId: string, productType: ProductType, year: number) {
    if (productType === "basis") return packagingCostForBase(productId, year);
    if (productType === "samengesteld") return packagingCostForComposite(productId, year);
    return 0;
  }

  function litersPerUnit(productId: string, productType: ProductType, year: number) {
    if (productType === "basis") {
      const def = getBaseDef(productId, year);
      return Number(def?.inhoud_per_eenheid_liter ?? def?.liters_per_product ?? 0);
    }
    if (productType === "samengesteld") {
      const def = getCompositeDef(productId, year);
      return Number(def?.totale_inhoud_liter ?? def?.liters_per_product ?? 0);
    }
    return 0;
  }

  return { packagingCost, litersPerUnit };
}

export function computeFixedCostPerLiter(params: {
  calcType: KostprijsCalcType;
  year: number;
  productieYear: any;
  vasteKostenRows: any[];
}): number {
  const { calcType, year, productieYear, vasteKostenRows } = params;

  // Backwards-compatible behavior: if no ABC fields are present, fall back to legacy direct/indirect split.
  const hasAnyAbc =
    (Array.isArray(vasteKostenRows) ? vasteKostenRows : []).some((row) => {
      const r = row as any;
      return (
        String(r?.allocation_driver ?? "").trim() ||
        String(r?.cost_pool ?? "").trim()
      );
    }) ?? false;

  if (!hasAnyAbc) {
    return calcType === "inkoop"
      ? vasteKostenPerLiter({
          year,
          productieYear,
          vasteKostenRows,
          kostensoort: "indirect",
          delerType: "inkoop"
        })
      : vasteKostenPerLiter({
          year,
          productieYear,
          vasteKostenRows,
          kostensoort: "direct",
          delerType: "productie"
        });
  }

  const overhead = computeAbcOverheadPerLiter({ calcType, productieYear, vasteKostenRows });
  return overhead.totalPerLiter;
}

function computeDriverTotalLiters(args: {
  calcType: KostprijsCalcType;
  driver: string;
  stand: "normal" | "actual";
  domain: "sales" | "production";
  productieYear: any;
}): number {
  const { calcType, driver, stand, domain, productieYear } = args;
  const d = String(driver || "").trim().toUpperCase();

  if (domain === "sales") {
    const actualSales = Number(productieYear?.sales_l ?? 0);
    const normalSales = Number(productieYear?.normal_sales_l ?? 0) || actualSales;
    const sales = stand === "actual" ? actualSales : normalSales;
    if (d === "ALL_LITERS") return sales;

    // Normalized handling drivers: we still allocate into €/L for SKU costing (all-in baseline),
    // but require the underlying driver totals to be present so the rule is considered valid.
    if (d === "SHIPMENTS") {
      const actualShipments = Number(productieYear?.shipments ?? 0);
      const normalShipments = Number(productieYear?.normal_shipments ?? 0) || actualShipments;
      const shipments = stand === "actual" ? actualShipments : normalShipments;
      if (shipments > 0 && sales > 0) return sales;
      return 0;
    }
    if (d === "PICKS_OR_ORDER_LINES") {
      const actualOrderlines = Number(productieYear?.orderlines ?? 0);
      const normalOrderlines = Number(productieYear?.normal_orderlines ?? 0) || actualOrderlines;
      const orderlines = stand === "actual" ? actualOrderlines : normalOrderlines;
      if (orderlines > 0 && sales > 0) return sales;
      return 0;
    }
    return 0;
  }

  const actualPurchased = Number(productieYear?.hoeveelheid_inkoop_l ?? 0);
  const actualOwn = Number(productieYear?.hoeveelheid_productie_l ?? 0);
  const normalPurchased = Number(productieYear?.normal_inkoop_l ?? 0) || actualPurchased;
  const normalOwn = Number(productieYear?.normal_productie_l ?? 0) || actualOwn;
  const normalContract = Number(productieYear?.normal_contract_brew_l ?? 0);

  const purchased = stand === "actual" ? actualPurchased : normalPurchased;
  const own = stand === "actual" ? actualOwn : normalOwn;
  const contract = stand === "actual" ? 0 : normalContract;

  if (d === "ALL_LITERS") {
    return purchased + own + contract;
  }
  if (d === "PURCHASED_LITERS") {
    return purchased;
  }
  if (d === "OWN_PRODUCTION_LITERS") {
    return own;
  }
  if (d === "CONTRACT_BREW_LITERS") {
    return contract;
  }
  if (d === "PRODUCTION_LITERS") {
    return own + contract;
  }

  // Legacy mapping: treat empty/unknown driver as the old direct/indirect per calcType.
  if (!d) {
    return calcType === "inkoop" ? purchased : own;
  }
  return 0;
}

function ruleAppliesToCalcType(scope: string, calcType: KostprijsCalcType): boolean {
  const s = String(scope || "").trim().toLowerCase() || "all";
  if (s === "all") return true;
  if (s === "purchased") return calcType === "inkoop";
  if (s === "own_production") return calcType !== "inkoop";
  if (s === "contract_brew") return false; // not supported in current calcType union yet
  return true;
}

export function computeAbcOverheadPerLiter(params: {
  calcType: KostprijsCalcType;
  productieYear: any;
  vasteKostenRows: any[];
}): OverheadBucket {
  const { calcType, productieYear, vasteKostenRows } = params;
  const rows = Array.isArray(vasteKostenRows) ? vasteKostenRows : [];

  const hasAnyAbc = rows.some((raw) => {
    const row = raw as any;
    return Boolean(String(row?.allocation_driver ?? "").trim() || String(row?.cost_pool ?? "").trim());
  });

  if (!hasAnyAbc) {
    // Legacy behavior: treat the previous fixed-cost-per-liter as manufacturing overhead.
    const total =
      calcType === "inkoop"
        ? vasteKostenPerLiter({
            year: 0,
            productieYear,
            vasteKostenRows: rows,
            kostensoort: "indirect",
            delerType: "inkoop"
          })
        : vasteKostenPerLiter({
            year: 0,
            productieYear,
            vasteKostenRows: rows,
            kostensoort: "direct",
            delerType: "productie"
          });
    return { manufacturingPerLiter: total, businessPerLiter: 0, totalPerLiter: total };
  }

  let manufacturing = 0;
  let business = 0;

  for (const raw of rows) {
    const row = raw as any;
    const scope = String(row?.allocation_scope ?? "all");
    if (!ruleAppliesToCalcType(scope, calcType)) continue;

    const amount = Number(row?.bedrag_per_jaar ?? 0) || 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    const driver = String(row?.allocation_driver ?? "").trim().toUpperCase();
    const stand = String(row?.stand ?? row?.basis ?? "").trim().toLowerCase() === "actual" ? "actual" : "normal";
    const domain = String(row?.domain ?? "sales").trim().toLowerCase() === "production" ? "production" : "sales";
    const denom = computeDriverTotalLiters({ calcType, driver, stand, domain, productieYear });
    if (!Number.isFinite(denom) || denom <= 0) continue;

    const rate = amount / denom;
    const includeInInventory =
      typeof row?.include_in_inventory_cost === "boolean"
        ? Boolean(row.include_in_inventory_cost)
        : // Legacy heuristic: "direct" treated as manufacturing, "indirect" as business when ABC fields are partially filled.
          !String(row?.kostensoort ?? "").toLowerCase().includes("indirect");

    if (includeInInventory) manufacturing += rate;
    else business += rate;
  }

  return {
    manufacturingPerLiter: manufacturing,
    businessPerLiter: business,
    totalPerLiter: manufacturing + business
  };
}

export function computeAccijnsForLiters(params: {
  year: number;
  liters: number;
  basisgegevens: GenericRecord;
  bierSnapshot?: GenericRecord;
  tarievenHeffingenRow: GenericRecord | null | undefined;
}): number {
  const { year, liters, basisgegevens, bierSnapshot, tarievenHeffingenRow } = params;
  const l = Number(liters ?? 0);
  if (!Number.isFinite(l) || l <= 0) return 0;
  if (!tarievenHeffingenRow) return 0;

  const snap = bierSnapshot && typeof bierSnapshot === "object" ? bierSnapshot : {};
  const mergedBasis: GenericRecord = {
    ...basisgegevens,
    alcoholpercentage: (snap as any).alcoholpercentage ?? (basisgegevens as any).alcoholpercentage ?? 0,
    tarief_accijns: (snap as any).tarief_accijns ?? (basisgegevens as any).tarief_accijns ?? "hoog",
    belastingsoort: (snap as any).belastingsoort ?? (basisgegevens as any).belastingsoort ?? "Accijns"
  };

  return calculateAccijnsPerProduct({
    litersPerProduct: l,
    basisgegevens: mergedBasis,
    tarievenHeffingenRows: [
      {
        jaar: year,
        tarief_hoog: Number((tarievenHeffingenRow as any).tarief_hoog ?? 0),
        tarief_laag: Number((tarievenHeffingenRow as any).tarief_laag ?? 0),
        verbruikersbelasting: Number((tarievenHeffingenRow as any).verbruikersbelasting ?? 0)
      }
    ],
    year
  });
}

type SummaryInputRow = {
  product: GenericRecord;
  primaryCost: number;
};

export function computeSummaryRows(params: {
  rows: SummaryInputRow[];
  biernaam: string;
  soortLabel: string;
  productType: ProductType;
  year: number;
  basisgegevens: GenericRecord;
  bierSnapshot?: GenericRecord;
  tarievenHeffingenRow: GenericRecord | null | undefined;
  fixedCostPerLiter: number;
  overheadPerLiter?: OverheadBucket;
  vasteKostenRows?: any[];
  calcType?: KostprijsCalcType;
  productieYear?: any;
  includePackagingCosts: boolean;
  includeExciseCosts?: boolean;
  packagingCost: (productId: string, productType: ProductType, year: number) => number;
  litersPerUnit: (productId: string, productType: ProductType, year: number) => number;
  productLabel: (product: GenericRecord) => string;
}): SummaryProductRow[] {
  const {
    rows,
    biernaam,
    soortLabel,
    productType,
    year,
    basisgegevens,
    bierSnapshot,
    tarievenHeffingenRow,
    fixedCostPerLiter,
    overheadPerLiter,
    vasteKostenRows,
    calcType,
    productieYear,
    includePackagingCosts,
    includeExciseCosts = true,
    packagingCost,
    litersPerUnit,
    productLabel
  } = params;

  return rows.map(({ product, primaryCost }) => {
    const productId = String((product as any)?.id ?? "");
    const label = productLabel(product);
    const liters = Number(litersPerUnit(productId, productType, year) ?? 0) || 0;
    const accijns = includeExciseCosts
      ? computeAccijnsForLiters({
          year,
          liters,
          basisgegevens,
          bierSnapshot,
          tarievenHeffingenRow
        })
      : 0;
    const manufacturingPerLiter = overheadPerLiter?.manufacturingPerLiter ?? fixedCostPerLiter;
    const businessPerLiter = overheadPerLiter?.businessPerLiter ?? 0;
    const manufacturingOverhead = manufacturingPerLiter * liters;
    const businessOverhead = businessPerLiter * liters;
    const vasteKosten = manufacturingOverhead + businessOverhead;

    const overhead_breakdown: SummaryProductRow["overhead_breakdown"] =
      vasteKostenRows && calcType && productieYear
        ? computeOverheadBreakdownForLiters({
            liters,
            calcType,
            productieYear,
            vasteKostenRows
          })
        : undefined;
    const packaging = includePackagingCosts ? packagingCost(productId, productType, year) : 0;
    const kostprijs = Number(primaryCost ?? 0) + packaging + vasteKosten + accijns;

    return {
      biernaam,
      soort: soortLabel,
      product_id: productId,
      product_type: productType,
      verpakking: label || "-",
      verpakkingseenheid: label || "-",
      primaire_kosten: roundValue(Number(primaryCost ?? 0)),
      verpakkingskosten: roundValue(packaging),
      vaste_kosten: roundValue(vasteKosten),
      manufacturing_overhead: roundValue(manufacturingOverhead),
      business_overhead: roundValue(businessOverhead),
      overhead_breakdown,
      accijns: roundValue(accijns),
      kostprijs: roundValue(kostprijs)
    };
  });
}

function computeOverheadBreakdownForLiters(params: {
  liters: number;
  calcType: KostprijsCalcType;
  productieYear: any;
  vasteKostenRows: any[];
}): Array<{ cost_pool: string; allocation_driver: string; amount: number }> {
  const { liters, calcType, productieYear, vasteKostenRows } = params;
  const l = Number(liters ?? 0);
  if (!Number.isFinite(l) || l <= 0) return [];

  const rows = Array.isArray(vasteKostenRows) ? vasteKostenRows : [];
  const out: Array<{ cost_pool: string; allocation_driver: string; amount: number }> = [];

  for (const raw of rows) {
    const row = raw as any;
    const scope = String(row?.allocation_scope ?? "all");
    if (!ruleAppliesToCalcType(scope, calcType)) continue;

    const amount = Number(row?.bedrag_per_jaar ?? 0) || 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    const driver = String(row?.allocation_driver ?? "").trim().toUpperCase();
    const stand = String(row?.stand ?? row?.basis ?? "").trim().toLowerCase() === "actual" ? "actual" : "normal";
    const domain = String(row?.domain ?? "sales").trim().toLowerCase() === "production" ? "production" : "sales";
    const denom = computeDriverTotalLiters({ calcType, driver, stand, domain, productieYear });
    if (!Number.isFinite(denom) || denom <= 0) continue;

    const rate = amount / denom;
    const allocated = rate * l;
    if (!Number.isFinite(allocated) || allocated === 0) continue;

    const pool = String(row?.cost_pool ?? "").trim() || String(row?.omschrijving ?? "").trim() || "Overhead";
    out.push({ cost_pool: pool, allocation_driver: driver || "LEGACY", amount: roundValue(allocated) });
  }

  return out;
}

export function computeResultaatSnapshot(params: {
  biernaam: string;
  soortLabel: string;
  year: number;
  calcType: KostprijsCalcType;
  variabeleKostenPerLiter: number;
  fixedCostPerLiter: number;
  overheadPerLiter?: OverheadBucket;
  methodologyVersion?: "legacy" | "abc_v1";
  vasteKostenRows?: any[];
  productieYear?: any;
  basisgegevens: GenericRecord;
  bierSnapshot?: GenericRecord;
  tarievenHeffingenRow: GenericRecord | null | undefined;
  basisRows: SummaryInputRow[];
  samengRows: SummaryInputRow[];
  includePackagingCosts: boolean;
  includeExciseCosts?: boolean;
  packagingCost: (productId: string, productType: ProductType, year: number) => number;
  litersPerUnit: (productId: string, productType: ProductType, year: number) => number;
  productLabel: (product: GenericRecord) => string;
}): ResultaatSnapshot {
  const {
    biernaam,
    soortLabel,
    year,
    calcType,
    variabeleKostenPerLiter,
    fixedCostPerLiter,
    overheadPerLiter,
    methodologyVersion,
    vasteKostenRows,
    productieYear,
    basisgegevens,
    bierSnapshot,
    tarievenHeffingenRow,
    basisRows,
    samengRows,
    includePackagingCosts,
    includeExciseCosts = true,
    packagingCost,
    litersPerUnit,
    productLabel
  } = params;

  const basisproducten = computeSummaryRows({
    rows: basisRows,
    biernaam,
    soortLabel,
    productType: "basis",
    year,
    basisgegevens,
    bierSnapshot,
    tarievenHeffingenRow,
    fixedCostPerLiter,
    overheadPerLiter,
    vasteKostenRows,
    calcType,
    productieYear,
    includePackagingCosts,
    includeExciseCosts,
    packagingCost,
    litersPerUnit,
    productLabel
  });
  const samengestelde_producten = computeSummaryRows({
    rows: samengRows,
    biernaam,
    soortLabel,
    productType: "samengesteld",
    year,
    basisgegevens,
    bierSnapshot,
    tarievenHeffingenRow,
    fixedCostPerLiter,
    overheadPerLiter,
    vasteKostenRows,
    calcType,
    productieYear,
    includePackagingCosts,
    includeExciseCosts,
    packagingCost,
    litersPerUnit,
    productLabel
  });

  const manufacturingPerLiter = overheadPerLiter ? overheadPerLiter.manufacturingPerLiter : fixedCostPerLiter;
  const businessPerLiter = overheadPerLiter ? overheadPerLiter.businessPerLiter : 0;
  const productkostPerLiter = Number(variabeleKostenPerLiter ?? 0) + Number(manufacturingPerLiter ?? 0);
  const kostendekkendPerLiter = productkostPerLiter + Number(businessPerLiter ?? 0);

  return {
    methodology_version: methodologyVersion,
    integrale_kostprijs_per_liter: roundValue(Number(variabeleKostenPerLiter ?? 0) + Number(fixedCostPerLiter ?? 0)),
    variabele_kosten_per_liter: roundValue(Number(variabeleKostenPerLiter ?? 0)),
    directe_vaste_kosten_per_liter: roundValue(Number(fixedCostPerLiter ?? 0)),
    manufacturing_overhead_per_liter: overheadPerLiter ? roundValue(overheadPerLiter.manufacturingPerLiter) : undefined,
    business_overhead_per_liter: overheadPerLiter ? roundValue(overheadPerLiter.businessPerLiter) : undefined,
    productkost_per_liter: overheadPerLiter ? roundValue(productkostPerLiter) : undefined,
    kostendekkend_per_liter: overheadPerLiter ? roundValue(kostendekkendPerLiter) : undefined,
    producten: {
      basisproducten,
      samengestelde_producten
    }
  };
}

