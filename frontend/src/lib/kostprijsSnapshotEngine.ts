import { calculateAccijnsPerProduct, vasteKostenPerLiter } from "@/lib/kostprijsEngine";

type GenericRecord = Record<string, unknown>;

export type KostprijsCalcType = "inkoop" | "eigen_productie";
export type ProductType = "basis" | "samengesteld";

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
  accijns: string | number;
  kostprijs: string | number;
};

export type ResultaatSnapshot = {
  integrale_kostprijs_per_liter: number | null;
  variabele_kosten_per_liter: number | null;
  directe_vaste_kosten_per_liter: number | null;
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
  includePackagingCosts: boolean;
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
    includePackagingCosts,
    packagingCost,
    litersPerUnit,
    productLabel
  } = params;

  return rows.map(({ product, primaryCost }) => {
    const productId = String((product as any)?.id ?? "");
    const label = productLabel(product);
    const liters = Number(litersPerUnit(productId, productType, year) ?? 0) || 0;
    const accijns = computeAccijnsForLiters({
      year,
      liters,
      basisgegevens,
      bierSnapshot,
      tarievenHeffingenRow
    });
    const vasteKosten = fixedCostPerLiter * liters;
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
      accijns: roundValue(accijns),
      kostprijs: roundValue(kostprijs)
    };
  });
}

export function computeResultaatSnapshot(params: {
  biernaam: string;
  soortLabel: string;
  year: number;
  calcType: KostprijsCalcType;
  variabeleKostenPerLiter: number;
  fixedCostPerLiter: number;
  basisgegevens: GenericRecord;
  bierSnapshot?: GenericRecord;
  tarievenHeffingenRow: GenericRecord | null | undefined;
  basisRows: SummaryInputRow[];
  samengRows: SummaryInputRow[];
  includePackagingCosts: boolean;
  packagingCost: (productId: string, productType: ProductType, year: number) => number;
  litersPerUnit: (productId: string, productType: ProductType, year: number) => number;
  productLabel: (product: GenericRecord) => string;
}): ResultaatSnapshot {
  const {
    biernaam,
    soortLabel,
    year,
    variabeleKostenPerLiter,
    fixedCostPerLiter,
    basisgegevens,
    bierSnapshot,
    tarievenHeffingenRow,
    basisRows,
    samengRows,
    includePackagingCosts,
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
    includePackagingCosts,
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
    includePackagingCosts,
    packagingCost,
    litersPerUnit,
    productLabel
  });

  return {
    integrale_kostprijs_per_liter: roundValue(Number(variabeleKostenPerLiter ?? 0) + Number(fixedCostPerLiter ?? 0)),
    variabele_kosten_per_liter: roundValue(Number(variabeleKostenPerLiter ?? 0)),
    directe_vaste_kosten_per_liter: roundValue(Number(fixedCostPerLiter ?? 0)),
    producten: {
      basisproducten,
      samengestelde_producten
    }
  };
}

