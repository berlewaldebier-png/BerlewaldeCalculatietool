"use client";

import { vasteKostenPerLiter } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeAbcOverheadPerLiter,
  computeResultaatSnapshot,
  type ResultaatSnapshot,
} from "@/lib/kostprijsSnapshotEngine";
import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";
import { supplierPackagingAppliesForProduct } from "@/components/berekeningen/steps/SupplierConfigStep";

export type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export function buildResultaatSnapshotFromWizard(params: {
  row: GenericRecord;
  productie: Record<string, unknown>;
  vasteKosten: Record<string, unknown>;
  tarievenHeffingen: GenericRecord[];
  packagingComponentPrices: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  getYearProduction: (jaar: number, productie: any) => any;
  getProductDisplayName: (product: any) => string;
  calculateVariabeleKostenPerLiter: (
    row: GenericRecord,
    jaar: number,
    productie: any,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[]
  ) => number | null;
  getSelectedInkoopProducts: (
    row: GenericRecord,
    jaar: number,
    basisproducten: GenericRecord[],
    samengesteldeProducten: GenericRecord[]
  ) => any[];
}): ResultaatSnapshot {
  const {
    row,
    productie,
    vasteKosten,
    tarievenHeffingen,
    packagingComponentPrices,
    basisproducten,
    samengesteldeProducten,
    getYearProduction,
    getProductDisplayName,
    calculateVariabeleKostenPerLiter,
    getSelectedInkoopProducts,
  } = params;

  const basisgegevens = (row.basisgegevens as GenericRecord) ?? {};
  const jaar = Number((basisgegevens as any).jaar ?? 0);
  const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const biernaam = String((basisgegevens as any).biernaam ?? "");
  const hasBeerContext = Boolean(
    String((row as any).bier_id ?? (basisgegevens as any).bier_id ?? "").trim() ||
      String((basisgegevens as any).stijl ?? "").trim() ||
      biernaam.trim()
  );
  const variabeleKostenPerLiter =
    calculateVariabeleKostenPerLiter(row, jaar, productie, basisproducten, samengesteldeProducten) ?? 0;
  const productieGegevens = getYearProduction(jaar, productie);
  const vasteKostenRows = Array.isArray((vasteKosten as any)[String(jaar)]) ? ((vasteKosten as any)[String(jaar)] as any[]) : [];
  const calcType = soort.trim().toLowerCase() === "inkoop" ? "inkoop" : "eigen_productie";
  const fixedPerLiter =
    soort === "Inkoop"
      ? vasteKostenPerLiter({
          year: jaar,
          productieYear: productieGegevens as any,
          vasteKostenRows: vasteKostenRows as any,
          kostensoort: "indirect",
          delerType: "inkoop"
        })
      : vasteKostenPerLiter({
          year: jaar,
          productieYear: productieGegevens as any,
          vasteKostenRows: vasteKostenRows as any,
          kostensoort: "direct",
          delerType: "productie"
        });

  const overheadPerLiter = computeAbcOverheadPerLiter({
    calcType,
    productieYear: productieGegevens as any,
    vasteKostenRows: vasteKostenRows as any
  });
  const hasAnyAbc = (Array.isArray(vasteKostenRows) ? vasteKostenRows : []).some((row: any) => {
    return Boolean(String(row?.allocation_driver ?? "").trim() || String(row?.cost_pool ?? "").trim());
  });
  const methodologyVersion = hasAnyAbc ? "abc_v1" : "legacy";
  const fixedPerLiterEffective = hasAnyAbc ? overheadPerLiter.totalPerLiter : fixedPerLiter;
  const geselecteerdeInkoopProducten =
    soort === "Inkoop" ? getSelectedInkoopProducts(row, jaar, basisproducten, samengesteldeProducten) : [];
  const basisIds = new Set(
    (Array.isArray(basisproducten) ? basisproducten : [])
      .map((item) => String((item as any)?.id ?? "").trim())
      .filter(Boolean)
  );
  const productTypeForSelectedInkoopItem = (item: any): "basis" | "samengesteld" => {
    const product = item && typeof item === "object" && "product" in item ? item.product : item;
    const productId = String(product?.id ?? "").trim();
    const explicit = String(item?.productType ?? item?.product_type ?? product?.productType ?? product?.product_type ?? "")
      .trim()
      .toLowerCase();
    if (explicit === "basis" || explicit === "samengesteld") {
      return explicit;
    }
    if (productId && basisIds.has(productId)) {
      return "basis";
    }
    return "samengesteld";
  };
  const basisproductenVanJaar =
    soort === "Inkoop"
      ? geselecteerdeInkoopProducten.filter((item) => productTypeForSelectedInkoopItem(item) === "basis")
      : hasBeerContext
        ? basisproducten.filter((item) => Number((item as any).jaar ?? 0) === jaar)
        : [];
  const samengesteldeVanJaar =
    soort === "Inkoop"
      ? geselecteerdeInkoopProducten.filter((item) => productTypeForSelectedInkoopItem(item) === "samengesteld")
      : hasBeerContext
        ? samengesteldeProducten.filter((item) => Number((item as any).jaar ?? 0) === jaar)
        : [];

  const tarievenRow =
    (Array.isArray(tarievenHeffingen)
      ? (tarievenHeffingen.find((r: any) => Number(r?.jaar ?? 0) === jaar) as any)
      : null) ?? null;

  const packagingByProductId = new Map<string, number>();
  const litersByProductId = new Map<string, number>();
  const packagingEnabledByProductId = new Map<string, boolean>();
  const supplierConfig = row.supplier_config && typeof row.supplier_config === "object" ? (row.supplier_config as GenericRecord) : {};
  const includeExciseCosts = soort !== "Inkoop" || !Boolean((supplierConfig as any).excise_included_in_purchase_price);

  const { packagingCost, litersPerUnit } = createPackagingResolvers({
    baseDefs: Array.isArray(basisproducten) ? (basisproducten as any[]) : [],
    compositeDefs: Array.isArray(samengesteldeProducten) ? (samengesteldeProducten as any[]) : [],
    packagingPrices: Array.isArray(packagingComponentPrices) ? (packagingComponentPrices as any[]) : []
  });

  function registerProduct(product: any, productType: "basis" | "samengesteld") {
    const id = String(product?.id ?? "");
    if (!id) return;
    const liters = litersPerUnit(id, productType, jaar);
    litersByProductId.set(id, Number.isFinite(liters) ? liters : 0);
    const packagingEnabled = soort !== "Inkoop" || supplierPackagingAppliesForProduct(row, id);
    packagingEnabledByProductId.set(id, packagingEnabled);
    const packaging = packagingEnabled ? packagingCost(id, productType, jaar) : 0;
    packagingByProductId.set(id, Number.isFinite(packaging) ? packaging : 0);
  }

  const basisInputs = basisproductenVanJaar.map((item: any) => {
    const isSelectedInkoopProduct = typeof item === "object" && item !== null && "product" in item;
    const product = isSelectedInkoopProduct ? (item as any).product : item;
    registerProduct(product, "basis");
    const liters = litersByProductId.get(String(product?.id ?? "")) ?? 0;
    const primaryCost = isSelectedInkoopProduct ? Number((item as any).prijsPerEenheid ?? 0) : variabeleKostenPerLiter * liters;
    return { product, primaryCost };
  });

  const samengInputs = samengesteldeVanJaar.map((item: any) => {
    const isSelectedInkoopProduct = typeof item === "object" && item !== null && "product" in item;
    const product = isSelectedInkoopProduct ? (item as any).product : item;
    registerProduct(product, "samengesteld");
    const liters = litersByProductId.get(String(product?.id ?? "")) ?? 0;
    const primaryCost = isSelectedInkoopProduct ? Number((item as any).prijsPerEenheid ?? 0) : variabeleKostenPerLiter * liters;
    return { product, primaryCost };
  });

  const includePackagingCosts =
    soort !== "Inkoop" || Array.from(packagingEnabledByProductId.values()).some(Boolean);

  return computeResultaatSnapshot({
    biernaam,
    soortLabel: soort,
    year: jaar,
    calcType,
    variabeleKostenPerLiter,
    fixedCostPerLiter: fixedPerLiterEffective,
    basisgegevens,
    bierSnapshot: basisgegevens,
    tarievenHeffingenRow: tarievenRow,
    basisRows: basisInputs,
    samengRows: samengInputs,
    includePackagingCosts,
    includeExciseCosts,
    overheadPerLiter,
    methodologyVersion,
    vasteKostenRows: vasteKostenRows as any,
    productieYear: productieGegevens as any,
    packagingCost: (productId) =>
      packagingEnabledByProductId.get(String(productId)) ? Number(packagingByProductId.get(String(productId)) ?? 0) : 0,
    litersPerUnit: (productId) => Number(litersByProductId.get(String(productId)) ?? 0),
    productLabel: (product: any) => getProductDisplayName(product)
  });
}

export function validateCurrentBeforePersistFromWizard(params: {
  current: GenericRecord;
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  getProductUnitOptions: (jaar: number, basisproducten: GenericRecord[], samengesteldeProducten: GenericRecord[], current: GenericRecord) => Array<{ id: string }>;
  isFustOption: (option: any) => boolean;
}): string {
  const { current, basisproducten, samengesteldeProducten, getProductUnitOptions, isFustOption } = params;

  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const inkoop = ((current.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
  const soort = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const productionStatus = String(
    (current as any)?.production_status ?? ((current.soort_berekening as GenericRecord | undefined) as any)?.production_status ?? ""
  ).trim();
  const brontype = String((current as any)?.brontype ?? "").trim().toLowerCase();
  const isBrouwmoment = brontype === "brouwmoment" || brontype === "brew_moment";
  const isBrewedOwnProduction = soort === "Eigen productie" && productionStatus === "brewed_batch";
  if (isBrouwmoment || isBrewedOwnProduction) {
    const brouwmoment = ((current as any).brouwmoment as GenericRecord | undefined) ?? {};
    const lot = String((brouwmoment as any).lotnummer ?? (inkoop as any).lotnummer ?? "").trim();
    const brouwdatum = String((brouwmoment as any).brouwdatum ?? (current as any).effectief_vanaf ?? "").trim();
    if (!lot) {
      return "LOT-nummer is verplicht voor een gebrouwen batch.";
    }
    if (!brouwdatum) {
      return "Brouwdatum is verplicht voor een gebrouwen batch.";
    }
  }
  if (soort === "Inkoop" && String((inkoop as any).lotnummer ?? "").trim() === "") {
    return "LOT-nummer is verplicht in de stap Inkoopfactuur.";
  }
  if (soort !== "Inkoop") {
    return "";
  }
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  if (subjectType !== "bier") {
    return "";
  }
  const factuurregels = Array.isArray((inkoop as any).factuurregels) ? ((inkoop as any).factuurregels as GenericRecord[]) : [];
  const jaar = Number(((current.basisgegevens as GenericRecord)?.jaar ?? 0) || 0);
  const unitOptions = getProductUnitOptions(jaar, basisproducten, samengesteldeProducten, current);
  for (const regel of factuurregels) {
    const option = unitOptions.find((item) => item.id === String((regel as any).eenheid ?? ""));
    if (!isFustOption(option)) {
      continue;
    }
    if (String((regel as any).afvulkosten_fust ?? "").trim() === "") {
      return "Afvulkosten fusten zijn verplicht voor geselecteerde fustregels.";
    }
  }
  return "";
}
