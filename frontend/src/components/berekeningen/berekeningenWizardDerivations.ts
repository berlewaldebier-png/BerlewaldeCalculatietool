"use client";

import { vasteKostenPerLiter } from "@/lib/kostprijsEngine";
import {
  createPackagingResolvers,
  computeResultaatSnapshot,
  type ResultaatSnapshot,
} from "@/lib/kostprijsSnapshotEngine";
import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";

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
  expandSelectedInkoopProductsToBasisproducten: (selected: any[], basisproducten: GenericRecord[]) => any[];
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
    expandSelectedInkoopProductsToBasisproducten,
  } = params;

  const basisgegevens = (row.basisgegevens as GenericRecord) ?? {};
  const jaar = Number((basisgegevens as any).jaar ?? 0);
  const soort = String(((row.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  const biernaam = String((basisgegevens as any).biernaam ?? "");
  const variabeleKostenPerLiter =
    calculateVariabeleKostenPerLiter(row, jaar, productie, basisproducten, samengesteldeProducten) ?? 0;
  const productieGegevens = getYearProduction(jaar, productie);
  const vasteKostenRows = Array.isArray((vasteKosten as any)[String(jaar)]) ? ((vasteKosten as any)[String(jaar)] as any[]) : [];
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
  const geselecteerdeInkoopProducten =
    soort === "Inkoop"
      ? expandSelectedInkoopProductsToBasisproducten(
          getSelectedInkoopProducts(row, jaar, basisproducten, samengesteldeProducten),
          basisproducten
        )
      : [];
  const basisproductenVanJaar =
    soort === "Inkoop"
      ? geselecteerdeInkoopProducten.filter((item) => Number((item as any).product?.inhoud_per_eenheid_liter ?? 0) > 0)
      : basisproducten.filter((item) => Number((item as any).jaar ?? 0) === jaar);
  const samengesteldeVanJaar =
    soort === "Inkoop"
      ? geselecteerdeInkoopProducten.filter((item) => Number((item as any).product?.totale_inhoud_liter ?? 0) > 0)
      : samengesteldeProducten.filter((item) => Number((item as any).jaar ?? 0) === jaar);

  const tarievenRow =
    (Array.isArray(tarievenHeffingen)
      ? (tarievenHeffingen.find((r: any) => Number(r?.jaar ?? 0) === jaar) as any)
      : null) ?? null;

  const includePackagingCosts = soort !== "Inkoop";
  const calcType = soort.trim().toLowerCase() === "inkoop" ? "inkoop" : "eigen_productie";

  const packagingByProductId = new Map<string, number>();
  const litersByProductId = new Map<string, number>();

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
    const packaging = includePackagingCosts ? packagingCost(id, productType, jaar) : 0;
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

  return computeResultaatSnapshot({
    biernaam,
    soortLabel: soort,
    year: jaar,
    calcType,
    variabeleKostenPerLiter,
    fixedCostPerLiter: fixedPerLiter,
    basisgegevens,
    bierSnapshot: basisgegevens,
    tarievenHeffingenRow: tarievenRow,
    basisRows: basisInputs,
    samengRows: samengInputs,
    includePackagingCosts,
    packagingCost: (productId) =>
      includePackagingCosts ? Number(packagingByProductId.get(String(productId)) ?? 0) : 0,
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
  const soort = String(((current.soort_berekening as GenericRecord)?.type ?? "Eigen productie")).trim();
  if (soort !== "Inkoop") {
    return "";
  }
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  if (subjectType !== "bier") {
    return "";
  }
  const inkoop = ((current.invoer as GenericRecord)?.inkoop as GenericRecord) ?? {};
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
