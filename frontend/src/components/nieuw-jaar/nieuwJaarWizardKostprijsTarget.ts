"use client";

import { createPackagingResolvers } from "@/lib/kostprijsSnapshotEngine";
import { snapshotProductCostFromRecord } from "@/components/nieuw-jaar/nieuwJaarWizardUtils";

export type KostprijsPreviewRow = {
  biernaam: string;
  soort: string;
  product_type: "basis" | "samengesteld";
  verpakkingseenheid: string;
  primaire_kosten: number;
  verpakkingskosten: number;
  vaste_kosten: number;
  accijns: number;
  kostprijs: number;
};

export function buildKostprijsTargetRows(args: {
  initialBasisproducten: unknown;
  initialSamengesteldeProducten: unknown;
  initialBieren: unknown;
  currentPackagingPrices: unknown;
  draftPackagingPrices: unknown;
  sourceYear: number;
  targetYear: number;
  currentBerekeningen: unknown;
  currentActivations: unknown;
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
    currentPackagingPrices,
    draftPackagingPrices,
    sourceYear,
    targetYear,
    currentBerekeningen,
    currentActivations,
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

  const { packagingCost, litersPerUnit } = createPackagingResolvers({
    baseDefs,
    compositeDefs,
    packagingPrices: currentPackagingPrices as any,
    draftPackagingPrices: draftPackagingPrices as any,
    draftYear: targetYear,
  });

  const versionById = new Map<string, any>();
  (Array.isArray(currentBerekeningen) ? currentBerekeningen : []).forEach((record: any) => {
    const basis = typeof record.basisgegevens === "object" && record.basisgegevens !== null ? record.basisgegevens : {};
    const jaar = Number(record.jaar ?? basis.jaar ?? 0);
    const statusVal = String(record.status ?? "").toLowerCase();
    if (jaar !== sourceYear || statusVal !== "definitief") return;
    const id = String(record.id ?? "");
    if (id) versionById.set(id, record);
  });

  const latestActivationByKey = new Map<string, any>();
  (Array.isArray(currentActivations) ? currentActivations : []).forEach((row: any) => {
    if (Number(row.jaar ?? 0) !== sourceYear) return;
    const bierId = String(row.bier_id ?? "");
    const productId = String(row.product_id ?? "");
    if (!bierId || !productId) return;
    const key = `${bierId}::${productId}`;
    const current = latestActivationByKey.get(key);
    const ts = String(row.effectief_vanaf ?? row.updated_at ?? "");
    const curTs = String(current?.effectief_vanaf ?? current?.updated_at ?? "");
    if (!current || ts.localeCompare(curTs) > 0) {
      latestActivationByKey.set(key, row);
    }
  });

  const bierNameById = new Map<string, string>();
  (Array.isArray(initialBieren) ? initialBieren : []).forEach((row: any) => {
    const id = String(row.id ?? "");
    const naam = String(row.naam ?? row.biernaam ?? "");
    if (id && naam) bierNameById.set(id, naam);
  });

  const basisRows: KostprijsPreviewRow[] = [];
  const samengRows: KostprijsPreviewRow[] = [];

  latestActivationByKey.forEach((activation) => {
    const bierId = String(activation.bier_id ?? "");
    const productId = String(activation.product_id ?? "");
    const versionId = String(activation.kostprijsversie_id ?? "");
    const record = versionById.get(versionId);
    if (!record) return;
    const snap = snapshotProductCostFromRecord(record, productId);
    if (!snap) return;

    const productType = String(snap.productType ?? "");
    if (productType !== "basis" && productType !== "samengesteld") return;

    const calcType = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
    const soortLabel = calcType === "inkoop" ? "Inkoop" : "Eigen productie";

    const liters = Number(litersPerUnit(productId, productType as any, targetYear) ?? 0) || 0;
    const sourcePrimary = Number(snap.primaireKosten ?? 0);
    const scenarioKey = `${bierId}::${productId}`;
    const scenarioPrimary = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
      ? Number((scenarioPrimaryCosts as any)[scenarioKey] ?? sourcePrimary)
      : sourcePrimary;
    let primaireKosten = Number.isFinite(scenarioPrimary) ? scenarioPrimary : sourcePrimary;
    const override = eigenProductieOverrides[bierId] ?? null;
    const recordTarget =
      calcType !== "inkoop" && override
        ? {
            ...record,
            basisgegevens: {
              ...(typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {}),
              alcoholpercentage: Number(override.alcoholpercentage ?? 0),
              tarief_accijns: override.tarief_accijns,
            },
            bier_snapshot: {
              ...(typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {}),
              alcoholpercentage: Number(override.alcoholpercentage ?? 0),
              tarief_accijns: override.tarief_accijns,
            },
          }
        : record;
    if (calcType !== "inkoop" && override) {
      const batchGrootte = Number(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l ?? 0);
      const totals = computeEigenProductieReceptTotals(override, batchGrootte);
      primaireKosten = totals.literPrijs * liters;
    }

    const verpakkingskosten = calcType === "inkoop" ? 0 : packagingCost(productId, productType as any, targetYear);
    const vastePerLiter = computeFixedCostPerLiter({
      calcType: calcType === "inkoop" ? "inkoop" : "eigen_productie",
      year: targetYear,
      productieYear: getProductieForYear(targetYear),
      vasteKostenRows: fixedCostRowsForYear(targetYear),
    });
    const vasteKosten = vastePerLiter * liters;
    const accijns = computeAccijnsForLiters(targetYear, recordTarget, liters);
    const kostprijs = primaireKosten + verpakkingskosten + vasteKosten + accijns;

    const row: KostprijsPreviewRow = {
      biernaam: bierNameById.get(bierId) ?? String(((record.basisgegevens ?? {}) as any)?.biernaam ?? bierId),
      soort: soortLabel,
      product_type: productType as any,
      verpakkingseenheid: String(snap.productLabel ?? productId),
      primaire_kosten: primaireKosten,
      verpakkingskosten,
      vaste_kosten: vasteKosten,
      accijns,
      kostprijs,
    };

    if (productType === "samengesteld") {
      samengRows.push(row);
    } else {
      basisRows.push(row);
    }
  });

  function sortKey(row: KostprijsPreviewRow) {
    return `${row.biernaam}::${row.verpakkingseenheid}`;
  }

  basisRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));
  samengRows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "nl-NL"));

  return { basisRows, samengRows };
}

