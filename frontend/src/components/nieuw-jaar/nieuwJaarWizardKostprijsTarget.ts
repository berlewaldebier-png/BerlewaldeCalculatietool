"use client";

import { createPackagingResolvers } from "@/lib/kostprijsSnapshotEngine";
import { snapshotProductCostFromRecord } from "@/components/nieuw-jaar/nieuwJaarWizardUtils";
import type { ActiveCostRow } from "@/components/kostprijsbeheer/kostprijsBeheerDerivations";
import {
  calculateComponentCostprice,
  calculateDerivedChildCostprice,
  calculateDirectSkuCostprice,
  createCostpriceParts,
  type CostpriceParts,
} from "@/lib/costpriceCalculationEngine";
import { classifySkuCost, type SkuCostOrigin } from "@/features/sku/skuCostOrigin";

export type KostprijsPreviewRow = {
  bier_id: string;
  sku_id?: string;
  source_version_id?: string;
  product_id: string;
  biernaam: string;
  soort: string;
  cost_origin: SkuCostOrigin;
  source_kind: string;
  parent_sku_id?: string;
  parent_product_id?: string;
  parent_quantity?: number;
  product_type: "basis" | "samengesteld" | "article";
  verpakkingseenheid: string;
  source_kostprijs: number;
  source_primaire_kosten: number;
  source_verpakkingskosten: number;
  source_vaste_kosten: number;
  source_accijns: number;
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
  verschil: number;
  verschil_pct: number;
  status: "ok" | "warning" | "blocking";
  status_text: string;
};

type WorkRow = KostprijsPreviewRow & {
  _basisComponentId?: string;
  _unitQty?: number;
  _calcType?: string;
  _manualArticleCost?: boolean;
};

function scenarioKeyFromParts(skuId: string) {
  return String(skuId || "").trim();
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function applyParts(row: KostprijsPreviewRow, parts: CostpriceParts) {
  row.primaire_kosten = parts.primaire_kosten;
  row.verpakkingskosten = parts.verpakkingskosten;
  row.vaste_kosten = parts.vaste_kosten;
  row.accijns = parts.accijns;
  row.kostprijs = parts.kostprijs;
  row.verschil = row.kostprijs - Number(row.source_kostprijs ?? 0);
  row.verschil_pct = Number(row.source_kostprijs ?? 0) > 0 ? row.verschil / Number(row.source_kostprijs ?? 0) : 0;
}

function hasBeerCostParts(parts: Pick<CostpriceParts, "primaire_kosten" | "vaste_kosten" | "accijns">) {
  return (
    Math.abs(num(parts.primaire_kosten)) > 0.000001 ||
    Math.abs(num(parts.vaste_kosten)) > 0.000001 ||
    Math.abs(num(parts.accijns)) > 0.000001
  );
}

function sourcePartsRow(row: KostprijsPreviewRow) {
  return {
    sku_id: row.sku_id,
    product_id: row.product_id,
    product_type: row.product_type,
    cost_origin: row.cost_origin,
    primaire_kosten: row.source_primaire_kosten,
    verpakkingskosten: row.source_verpakkingskosten,
    vaste_kosten: row.source_vaste_kosten,
    accijns: row.source_accijns,
    kostprijs: row.source_kostprijs,
  };
}

function targetPartsRow(row: KostprijsPreviewRow) {
  return {
    sku_id: row.sku_id,
    product_id: row.product_id,
    product_type: row.product_type,
    cost_origin: row.cost_origin,
    primaire_kosten: row.primaire_kosten,
    verpakkingskosten: row.verpakkingskosten,
    vaste_kosten: row.vaste_kosten,
    accijns: row.accijns,
    kostprijs: row.kostprijs,
  };
}

export function buildKostprijsTargetRows(args: {
  initialBasisproducten: unknown;
  initialSamengesteldeProducten: unknown;
  initialBieren: unknown;
  initialSkus?: unknown;
  initialArticles?: unknown;
  initialBomLines?: unknown;
  currentPackagingPrices: unknown;
  draftPackagingPrices: unknown;
  sourceYear: number;
  targetYear: number;
  currentBerekeningen: unknown;
  currentActivations: unknown;
  sourceActiveRows?: ActiveCostRow[];
  eigenProductieOverrides: Record<string, any>;
  scenarioPrimaryCosts: Record<string, unknown>;
  getProductieForYear: (year: number) => any | null;
  fixedCostRowsForYear: (year: number) => Array<Record<string, unknown>>;
  computeFixedCostPerLiter: (args: {
    calcType: "inkoop" | "eigen_productie";
    year: number;
    productieYear: unknown;
    vasteKostenRows: unknown;
  }) => number;
  computeAccijnsForLiters: (year: number, record: any, liters: number) => number;
  computeEigenProductieReceptTotals: (override: any, batchGrootteLiters: number) => { literPrijs: number };
}): { basisRows: KostprijsPreviewRow[]; samengRows: KostprijsPreviewRow[] } {
  const {
    initialBasisproducten,
    initialSamengesteldeProducten,
    initialBieren,
    initialSkus,
    initialArticles,
    initialBomLines,
    currentPackagingPrices,
    draftPackagingPrices,
    sourceYear,
    targetYear,
    currentBerekeningen,
    currentActivations,
    sourceActiveRows,
    eigenProductieOverrides,
    scenarioPrimaryCosts,
    getProductieForYear,
    fixedCostRowsForYear,
    computeFixedCostPerLiter,
    computeAccijnsForLiters,
    computeEigenProductieReceptTotals,
  } = args;

  const baseDefs = (Array.isArray(initialBasisproducten) ? initialBasisproducten : [])
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => row as any);
  const compositeDefs = (Array.isArray(initialSamengesteldeProducten) ? initialSamengesteldeProducten : [])
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => row as any);
  const basisById = new Map<string, any>(baseDefs.map((row) => [text(row.id), row]));
  const samengesteldById = new Map<string, any>(compositeDefs.map((row) => [text(row.id), row]));
  const skuDefs = (Array.isArray(initialSkus) ? initialSkus : [])
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => row as any);
  const articleDefs = (Array.isArray(initialArticles) ? initialArticles : [])
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => row as any);
  const bomLines = Array.isArray(initialBomLines) ? initialBomLines : [];
  const bomLinesByParent = new Map<string, any[]>();
  bomLines.forEach((line: any) => {
    const parentId = text(line?.parent_article_id);
    if (!parentId) return;
    bomLinesByParent.set(parentId, [...(bomLinesByParent.get(parentId) ?? []), line]);
  });

  const { packagingCost, litersPerUnit } = createPackagingResolvers({
    baseDefs,
    compositeDefs,
    packagingPrices: currentPackagingPrices as any,
    draftPackagingPrices: draftPackagingPrices as any,
    draftYear: targetYear,
  });

  const versionById = new Map<string, any>();
  (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
    if (String(record.status ?? "").toLowerCase() !== "definitief") return;
    const id = text(record.id);
    if (id) versionById.set(id, record);
  });

  const latestActivationByKey = new Map<string, any>();
  (Array.isArray(currentActivations) ? currentActivations : []).forEach((row: any) => {
    if (Number(row.jaar ?? 0) !== sourceYear) return;
    const skuId = text(row.sku_id);
    if (!skuId) return;
    const current = latestActivationByKey.get(skuId);
    const ts = text(row.effectief_vanaf ?? row.updated_at);
    const curTs = text(current?.effectief_vanaf ?? current?.updated_at);
    if (!current || ts.localeCompare(curTs) > 0) latestActivationByKey.set(skuId, row);
  });

  const bierNameById = new Map<string, string>();
  (Array.isArray(initialBieren) ? initialBieren : []).forEach((row: any) => {
    const id = text(row.id);
    const naam = text(row.naam ?? row.biernaam);
    if (id && naam) bierNameById.set(id, naam);
  });

  const skuById = new Map<string, any>();
  skuDefs.forEach((row) => {
    const id = text(row?.id);
    if (id) skuById.set(id, row);
  });
  const articleById = new Map<string, any>();
  articleDefs.forEach((row) => {
    const id = text(row?.id);
    if (id) articleById.set(id, row);
  });

  const sourceRows = Array.isArray(sourceActiveRows) && sourceActiveRows.length > 0
    ? sourceActiveRows
    : Array.from(latestActivationByKey.values()).map((activation) => ({
        bierNaam: "",
        groupLabel: "",
        productId: text(activation.product_id),
        productType: text(activation.product_type),
        skuId: text(activation.sku_id),
        versieId: text(activation.kostprijsversie_id),
        artikelNaam: "",
        productNaam: "",
        currentCost: null,
        sourceLabel: "",
        supplierLabel: "",
      } as Partial<ActiveCostRow>));

  function snapshotForRecord(record: any, productId: string, skuId: string) {
    const found = costLineForRecord(record, productId, skuId);
    if (found) {
      return {
        kostprijs: num(found.kostprijs),
        primaireKosten: num(found.primaire_kosten ?? found.primaireKosten),
        verpakkingskosten: num(found.verpakkingskosten),
        vasteKosten: num(found.vaste_kosten ?? found.manufacturing_overhead) + num(found.business_overhead),
        accijns: num(found.accijns),
        productType: text(found.product_type),
        productLabel: text(found.verpakking ?? found.verpakkingseenheid ?? found.omschrijving ?? productId),
      };
    }
    return record ? snapshotProductCostFromRecord(record, productId) : null;
  }

  function costLineForRecord(record: any, productId: string, skuId: string) {
    const costLines = record?.cost_lines ?? record?.costLines ?? [];
    const rows = Array.isArray(costLines) ? costLines : [];
    return rows.find((row: any) => {
      const rowSkuId = text(row?.sku_id);
      const rowProductId = text(row?.product_id);
      return Boolean((skuId && rowSkuId === skuId) || (productId && rowProductId === productId));
    });
  }

  function isFormatArticle(articleId: string) {
    return text(articleById.get(articleId)?.kind).toLowerCase() === "format";
  }

  function componentInfo(productId: string, productType: string): { basisComponentId: string; unitQty: number } | null {
    const formatComponents = (bomLinesByParent.get(productId) ?? [])
      .map((line: any) => ({
        basisComponentId: text(line?.component_article_id),
        unitQty: num(line?.quantity),
      }))
      .filter((item) => item.basisComponentId && isFormatArticle(item.basisComponentId) && item.unitQty > 0);
    if (formatComponents.length === 1) return formatComponents[0];
    if (basisById.has(productId)) return { basisComponentId: productId, unitQty: 1 };
    const composite = samengesteldById.get(productId);
    const basisList = Array.isArray(composite?.basisproducten) ? composite.basisproducten : [];
    const beerComponents = basisList
      .map((item: any) => ({
        basisComponentId: text(item?.basisproduct_id),
        unitQty: num(item?.aantal),
      }))
      .filter((item: any) => item.basisComponentId && item.unitQty > 0);
    if (productType === "samengesteld" && beerComponents.length === 1) return beerComponents[0];
    return null;
  }

  const workRows: WorkRow[] = [];

  sourceRows.forEach((activation) => {
    const versionId = text(activation.versieId);
    const record = versionById.get(versionId);
    const activationProductId = text(activation.productId);
    const skuId = text(activation.skuId);
    const skuRow = skuId ? skuById.get(skuId) : null;
    const firstCostLine = record ? costLineForRecord(record, activationProductId, skuId) : null;
    const productId = text(
      activationProductId ||
        firstCostLine?.product_id ||
        skuRow?.format_article_id ||
        skuRow?.article_id ||
        record?.basisgegevens?.article_id ||
        record?.basisgegevens?.product_id
    );
    if (!productId) return;
    const snap = record ? snapshotForRecord(record, productId, skuId) : null;
    const rawProductType = text(snap?.productType ?? firstCostLine?.product_type ?? activation.productType);
    const productType = samengesteldById.has(productId)
      ? "samengesteld"
      : basisById.has(productId)
        ? "basis"
        : rawProductType === "sku" && text(skuRow?.kind).toLowerCase() === "beer_format"
          ? "basis"
          : rawProductType;
    if (productType !== "basis" && productType !== "samengesteld" && productType !== "article") return;

    const articleRow = productId ? articleById.get(productId) : null;
    const rawCalcType = text(record?.type ?? record?.soort_berekening?.type).toLowerCase();
    const costSource = text(record?.cost_source ?? record?.source).toLowerCase();
    const isHistoricalBeerSkuCost =
      costSource === "historical_sku_cost" &&
      text(skuRow?.kind).toLowerCase() === "beer_format";
    const calcType = isHistoricalBeerSkuCost ? "inkoop" : rawCalcType;
    const costClass = classifySkuCost({
      sku: skuRow,
      article: articleRow,
      productType,
      calcType,
      productLabel: text(activation.artikelNaam || activation.productNaam || productId),
      hasBom: bomLinesByParent.has(productId),
    });

    const recordBasis = typeof record?.basisgegevens === "object" && record.basisgegevens ? record.basisgegevens : {};
    const recordBierId = text(record?.bier_id ?? recordBasis?.bier_id);
    const bierId = text(recordBierId || activation.groupLabel || activation.bierNaam || skuRow?.beer_id || "");
    const groupLabel = text(activation.groupLabel || activation.bierNaam || bierNameById.get(bierId) || recordBasis?.biernaam || bierId || "Zonder stijl");
    const label = text(activation.artikelNaam || activation.productNaam || snap?.productLabel || productId);
    const info = componentInfo(productId, productType);

    const row: WorkRow = {
      bier_id: bierId || groupLabel,
      sku_id: skuId,
      source_version_id: versionId,
      product_id: productId,
      biernaam: groupLabel,
      soort: costClass.sourceKind || (calcType === "inkoop" ? "Inkoop" : calcType ? "Eigen productie" : text(activation.sourceLabel || "Actief")),
      cost_origin: costClass.costOrigin,
      source_kind: costClass.sourceKind,
      parent_sku_id: costClass.parentSkuId || undefined,
      parent_product_id: costClass.parentProductId || undefined,
      parent_quantity: undefined,
      product_type: productType as any,
      verpakkingseenheid: label,
      source_kostprijs: num(snap?.kostprijs ?? activation.currentCost),
      source_primaire_kosten: num(snap?.primaireKosten),
      source_verpakkingskosten: num((snap as any)?.verpakkingskosten),
      source_vaste_kosten: num((snap as any)?.vasteKosten),
      source_accijns: num((snap as any)?.accijns),
      primaire_kosten: 0,
      verpakkingskosten: 0,
      vaste_kosten: 0,
      accijns: 0,
      kostprijs: 0,
      verschil: 0,
      verschil_pct: 0,
      status: "warning",
      status_text: "Nog niet doorgerekend.",
      _basisComponentId: info?.basisComponentId,
      _unitQty: info?.unitQty,
      _calcType: calcType,
      _manualArticleCost: false,
    };

    if (!record || !snap) {
      row.status = "blocking";
      row.status_text = "Geen kostprijsversie/snapshot gevonden; target-kostprijs wordt niet via fallback berekend.";
      workRows.push(row);
      return;
    }

    if (productType === "article") {
      const isManualArticleCost =
        costSource !== "historical_sku_cost" &&
        num(snap?.kostprijs) > 0 &&
        num(snap?.vasteKosten) === 0 &&
        num(snap?.accijns) === 0;
      row.cost_origin = "composed_sellable";
      row.source_kind = "Zelf samengesteld";
      row.soort = "Zelf samengesteld";
      row.status_text = "Zelf samengesteld: wordt uit componenten doorgerekend.";
      if (isManualArticleCost) {
        row.cost_origin = "merchandise_component";
        row.source_kind = "Merchandise";
        row.soort = "Merchandise";
        row._manualArticleCost = true;
      }
      workRows.push(row);
      return;
    }

    const liters = num(litersPerUnit(productId, productType as any, targetYear));
    const sourcePrimary = num(snap.primaireKosten);
    const scenarioKey = scenarioKeyFromParts(skuId);
    const scenarioPrimary = scenarioKey && Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
      ? num((scenarioPrimaryCosts as any)[scenarioKey] ?? sourcePrimary)
      : sourcePrimary;
    let primaireKosten = Number.isFinite(scenarioPrimary) ? scenarioPrimary : sourcePrimary;
    const override = eigenProductieOverrides[bierId] ?? null;
    const recordTarget =
      calcType !== "inkoop" && override
        ? {
            ...record,
            basisgegevens: {
              ...(typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {}),
              alcoholpercentage: num(override.alcoholpercentage),
              tarief_accijns: override.tarief_accijns,
            },
            bier_snapshot: {
              ...(typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {}),
              alcoholpercentage: num(override.alcoholpercentage),
              tarief_accijns: override.tarief_accijns,
            },
          }
        : record;
    if (calcType !== "inkoop" && override) {
      const batchGrootte = num(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l);
      const totals = computeEigenProductieReceptTotals(override, batchGrootte);
      primaireKosten = totals.literPrijs * liters;
    }

    const vastePerLiter = computeFixedCostPerLiter({
      calcType: calcType === "inkoop" ? "inkoop" : "eigen_productie",
      year: targetYear,
      productieYear: getProductieForYear(targetYear),
      vasteKostenRows: fixedCostRowsForYear(targetYear),
    });
    const directCost = calculateDirectSkuCostprice({
      primaryCost: primaireKosten,
      packagingCost: calcType === "inkoop" ? 0 : packagingCost(productId, productType as any, targetYear),
      overheadCost: vastePerLiter * liters,
      exciseCost: computeAccijnsForLiters(targetYear, recordTarget, liters),
      liters,
      sourceLabel: calcType === "inkoop" ? "Inkoopscenario" : "Recept/verpakking/ABC targetjaar",
    });
    applyParts(row, directCost);
    row.status = directCost.status === "ok" ? "ok" : "blocking";
    row.status_text = directCost.status === "ok" ? "Doorgerekend" : directCost.issues.map((issue) => issue.message).join(" ");
    workRows.push(row);
  });

  const parentByBasisAndBeer = new Map<string, WorkRow>();
  workRows
    .filter((row) => row.product_type !== "article" && row._basisComponentId && num(row._unitQty) > 1)
    .forEach((row) => {
      const key = `${row.bier_id || row.biernaam}::${row._basisComponentId}`;
      const current = parentByBasisAndBeer.get(key);
      if (!current || num(row._unitQty) > num(current._unitQty)) parentByBasisAndBeer.set(key, row);
    });

  workRows.forEach((row) => {
    if (row.product_type === "article") return;
    if (!row._basisComponentId || !row._unitQty) return;
    const parent = parentByBasisAndBeer.get(`${row.bier_id || row.biernaam}::${row._basisComponentId}`);
    if (!parent || parent === row) return;
    const factor = num(parent._unitQty) / num(row._unitQty);
    if (!Number.isFinite(factor) || factor <= 1) return;

    const sourceParentPackagingShare = num(parent.source_verpakkingskosten) / factor;
    const sourceExtraPackaging = Math.max(0, num(row.source_verpakkingskosten) - sourceParentPackagingShare);
    const targetExtraPackaging = sourceExtraPackaging > 0.000001
      ? packagingCost(row.product_id, row.product_type as any, targetYear)
      : 0;
    const childCost = calculateDerivedChildCostprice({
      parent,
      factor,
      extraPackagingCost: targetExtraPackaging,
      parentLabel: parent.verpakkingseenheid,
    });
    row.cost_origin = "derived_from_parent";
    row.source_kind = "Afgeleid";
    row.soort = "Afgeleid";
    row.parent_sku_id = parent.sku_id;
    row.parent_product_id = parent.product_id;
    row.parent_quantity = factor;
    applyParts(row, childCost);
    row.status = childCost.status === "ok" ? "ok" : "blocking";
    row.status_text = childCost.status === "ok" ? `Afgeleid van ${parent.verpakkingseenheid}` : childCost.issues.map((issue) => issue.message).join(" ");
  });

  const basisRows: KostprijsPreviewRow[] = [];
  const samengRows: KostprijsPreviewRow[] = [];
  workRows.forEach((row) => {
    if (row.product_type === "basis") basisRows.push(row);
    else samengRows.push(row);
  });

  const allRows = [...basisRows, ...samengRows];
  const targetPackagingPrices = [
    ...(Array.isArray(currentPackagingPrices) ? (currentPackagingPrices as any[]) : []),
    ...Object.entries(draftPackagingPrices ?? {}).map(([componentId, price]) => ({
      jaar: targetYear,
      verpakkingsonderdeel_id: componentId,
      prijs_per_stuk: num(price),
    })),
  ];
  const sourcePackagingPrices = Array.isArray(currentPackagingPrices) ? (currentPackagingPrices as any[]) : [];

  function componentPrice(rows: any[], componentId: string, year: number) {
    const found = rows
      .filter((row) => num(row?.jaar) === year && text(row?.verpakkingsonderdeel_id ?? row?.component_id) === componentId)
      .at(-1);
    return num(found?.prijs_per_stuk ?? found?.price_per_unit);
  }

  allRows.forEach((row) => {
    const articleId = text(row.product_id);
    if (!articleId || bomLinesByParent.has(articleId) || row.product_type !== "article") return;
    const sourcePrice = componentPrice(sourcePackagingPrices, articleId, sourceYear);
    const targetPrice = componentPrice(targetPackagingPrices, articleId, targetYear);
    if (sourcePrice <= 0 && targetPrice <= 0) return;
    row.cost_origin = "merchandise_component";
    row.source_kind = "Merchandise";
    row.soort = "Merchandise";
    row.source_primaire_kosten = 0;
    row.source_verpakkingskosten = sourcePrice;
    row.source_vaste_kosten = 0;
    row.source_accijns = 0;
    row.source_kostprijs = sourcePrice;
    applyParts(row, createCostpriceParts({
      primaire_kosten: 0,
      verpakkingskosten: targetPrice,
      vaste_kosten: 0,
      accijns: 0,
    }));
    row.status = targetPrice > 0 ? "ok" : "blocking";
    row.status_text = targetPrice > 0 ? "Merchandise jaarprijs" : "Merchandise prijs ontbreekt voor targetjaar.";
  });

  allRows.forEach((row) => {
    const articleId = text(row.product_id);
    if (!articleId || !bomLinesByParent.has(articleId) || row.product_type !== "article") return;
    if ((row as WorkRow)._manualArticleCost) {
      applyParts(row, createCostpriceParts({
        primaire_kosten: num(row.source_primaire_kosten),
        verpakkingskosten: num(row.source_verpakkingskosten),
        vaste_kosten: 0,
        accijns: 0,
      }));
      row.status = row.kostprijs > 0 ? "ok" : "blocking";
      row.status_text = row.kostprijs > 0 ? "Handmatige merchandise/artikelkostprijs" : "Handmatige artikelkostprijs ontbreekt.";
      return;
    }

    const sourceParts = calculateComponentCostprice({
      parentArticleId: articleId,
      bomLines: bomLines as any,
      skus: skuDefs,
      articles: articleDefs,
      summaryRows: allRows.map(sourcePartsRow),
      packagingComponentPrices: sourcePackagingPrices,
      year: sourceYear,
    });
    if (sourceParts.valid && sourceParts.kostprijs > 0) {
      row.source_primaire_kosten = sourceParts.primaire_kosten;
      row.source_verpakkingskosten = sourceParts.verpakkingskosten;
      row.source_vaste_kosten = sourceParts.vaste_kosten;
      row.source_accijns = sourceParts.accijns;
      row.source_kostprijs = sourceParts.kostprijs;
    }

    const targetParts = calculateComponentCostprice({
      parentArticleId: articleId,
      bomLines: bomLines as any,
      skus: skuDefs,
      articles: articleDefs,
      summaryRows: allRows.map(targetPartsRow),
      packagingComponentPrices: targetPackagingPrices,
      year: targetYear,
    });
    applyParts(row, targetParts);
    const sourceHasBeerParts = hasBeerCostParts({
      primaire_kosten: row.source_primaire_kosten,
      vaste_kosten: row.source_vaste_kosten,
      accijns: row.source_accijns,
    });
    const targetHasBeerParts = hasBeerCostParts(targetParts);
    const hasOnlyPackaging =
      num(targetParts.verpakkingskosten) > 0 &&
      !targetHasBeerParts &&
      num(row.source_kostprijs) > 0;
    row.cost_origin = "composed_sellable";
    row.source_kind = "Zelf samengesteld";
    row.soort = "Zelf samengesteld";
    if (!targetParts.valid) {
      row.status = "blocking";
      row.status_text = targetParts.issues.map((issue) => issue.message).join(" ");
    } else if (sourceHasBeerParts && !targetHasBeerParts) {
      row.status = "blocking";
      row.status_text = "Component ontbreekt: artikel heeft bronjaar-bierkosten, maar targetjaar mist inkoop/ABC/accijns.";
    } else if (hasOnlyPackaging) {
      row.status = "blocking";
      row.status_text = "Component ontbreekt: artikel rekent alleen verpakking door.";
    } else {
      row.status = "ok";
      row.status_text = "Doorgerekend uit componenten";
    }
  });

  allRows.forEach((row) => {
    if (row.status !== "ok") return;
    if (num(row.source_kostprijs) > 0 && num(row.kostprijs) + 0.005 < num(row.source_kostprijs)) {
      row.status = "blocking";
      row.status_text = `Target lager dan bronjaar (${num(row.kostprijs).toFixed(2)} < ${num(row.source_kostprijs).toFixed(2)}).`;
    }
  });

  function sortKey(row: KostprijsPreviewRow) {
    const classRank =
      row.cost_origin === "purchased_batch" || row.cost_origin === "own_production_batch" || row.cost_origin === "historical_manual" ? 0 :
      row.cost_origin === "derived_from_parent" ? 1 :
      row.cost_origin === "composed_sellable" ? 2 :
      5;
    return `${row.biernaam}::${classRank}::${row.parent_sku_id || row.sku_id || ""}::${row.verpakkingseenheid}`;
  }

  basisRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));
  samengRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));

  return { basisRows, samengRows };
}
