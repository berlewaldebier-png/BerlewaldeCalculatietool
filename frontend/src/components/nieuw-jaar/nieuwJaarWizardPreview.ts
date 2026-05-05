"use client";

import { createPackagingResolvers } from "@/lib/kostprijsSnapshotEngine";
import { snapshotProductCostFromRecord } from "@/components/nieuw-jaar/nieuwJaarWizardUtils";

type GenericRecord = Record<string, unknown>;

export type PreviewRow = {
  bierId: string;
  biernaam: string;
  productId: string;
  productType: "basis" | "samengesteld" | "";
  calcType: "inkoop" | "eigen_productie";
  productLabel: string;
  sourcePrimaryCost: number;
  sourceCost: number;
  estimatedTargetCost: number;
  delta: number;
  sellIn: Record<string, number>;
};

export function buildPreviewRows(args: {
  initialBasisproducten: unknown;
  initialSamengesteldeProducten: unknown;
  initialBieren: unknown;
  currentPackagingPrices: unknown;
  draftPackagingPrices: unknown;
  sourceYear: number;
  targetYear: number;
  currentBerekeningen: unknown;
  currentActivations: unknown;
  currentVerkoopprijzen: unknown;
  draftVerkoopstrategieTarget: unknown;
  currentTarieven: unknown;
  currentProductie: unknown;
  currentVasteKosten: unknown;
  draftProductieTarget: unknown;
  draftTariefTarget: unknown;
  draftVasteKostenTarget: unknown;
  eigenProductieOverrides: Record<string, any>;
  scenarioPrimaryCosts: Record<string, unknown>;
  getProductieForYear: (year: number) => any | null;
  computeIndirectFixedCostPerInkoopLiter: (year: number) => number;
  computeDirectFixedCostPerProductieLiter: (year: number) => number;
  computeAccijnsForLiters: (year: number, record: any, liters: number) => number;
  computeEigenProductieReceptTotals: (override: any, batchGrootteLiters: number) => { literPrijs: number } | null;
  calcSellInPrice: (cost: number, marginPct: number) => number;
}): PreviewRow[] {
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
    currentVerkoopprijzen,
    draftVerkoopstrategieTarget,
    scenarioPrimaryCosts,
    eigenProductieOverrides,
    getProductieForYear,
    computeIndirectFixedCostPerInkoopLiter,
    computeDirectFixedCostPerProductieLiter,
    computeAccijnsForLiters,
    computeEigenProductieReceptTotals,
    calcSellInPrice,
  } = args;

  // Preview is intentionally "indicative": we adjust source-year cost by deltas we can derive
  // from the yearset (fixed costs per liter + packaging component prices).

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

  const channels = [
    { code: "horeca", naam: "Horeca", defaultMargin: 50 },
    { code: "retail", naam: "Supermarkt", defaultMargin: 30 },
    { code: "slijterij", naam: "Slijterij", defaultMargin: 40 },
    { code: "zakelijk", naam: "Speciaalzaak", defaultMargin: 45 },
  ] as const;

  // Map basisproducten -> "primary" composed product so basis rows can follow their composite strategy defaults.
  const compositeById = new Map<string, any>();
  compositeDefs.forEach((row) => {
    const id = String(row.id ?? "");
    if (id) compositeById.set(id, row);
  });
  const basisParentMap = new Map<string, { productId: string; label: string; score: number }[]>();
  compositeDefs.forEach((row) => {
    const compositeId = String(row.id ?? "");
    const compositeLabel = String(row.omschrijving ?? "");
    const basisRows = Array.isArray(row.basisproducten) ? row.basisproducten : [];
    basisRows.forEach((basisRow: any) => {
      const basisId = String(basisRow.basisproduct_id ?? "");
      if (!basisId || basisId.startsWith("verpakkingsonderdeel:")) return;
      const current = basisParentMap.get(basisId) ?? [];
      const scoreRaw = Number(basisRow.aantal ?? 0);
      const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
      current.push({ productId: compositeId, label: compositeLabel, score });
      basisParentMap.set(basisId, current);
    });
  });
  const resolvedBasisParent = new Map<string, { productId: string; label: string }>();
  for (const [basisId, items] of basisParentMap.entries()) {
    if (!items || items.length === 0) continue;
    const sorted = [...items].sort((left, right) => {
      const scoreDiff = Number(right.score ?? 0) - Number(left.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const labelDiff = String(left.label ?? "").localeCompare(String(right.label ?? ""), "nl-NL");
      if (labelDiff !== 0) return labelDiff;
      return String(left.productId ?? "").localeCompare(String(right.productId ?? ""));
    });
    resolvedBasisParent.set(basisId, { productId: sorted[0].productId, label: sorted[0].label });
  }

  const STRATEGY_TYPES = new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]);
  const verkoopStrategyRows = (Array.isArray(draftVerkoopstrategieTarget) && (draftVerkoopstrategieTarget as any[]).length > 0
    ? (draftVerkoopstrategieTarget as any[])
    : (Array.isArray(currentVerkoopprijzen) ? (currentVerkoopprijzen as any[]) : [])
  )
    .filter((row) => row && typeof row === "object" && STRATEGY_TYPES.has(String((row as any).record_type ?? "")))
    .map((row) => row as any);

  function followProductIdFor(productId: string, productType: string) {
    if (productType !== "basis") return "";
    return resolvedBasisParent.get(productId)?.productId ?? "";
  }

  function getYearStrategyRow(year: number) {
    return (
      verkoopStrategyRows.find(
        (row) => String(row.record_type ?? "") === "jaarstrategie" && Number(row.jaar ?? 0) === year
      ) ?? null
    );
  }

  function getPackagingStrategyRow(year: number, productId: string) {
    return (
      verkoopStrategyRows.find(
        (row) =>
          String(row.record_type ?? "") === "verkoopstrategie_verpakking" &&
          Number(row.jaar ?? 0) === year &&
          String(row.product_id ?? "") === productId
      ) ?? null
    );
  }

  function getBeerStrategyRow(year: number, bierId: string, productId: string) {
    return (
      verkoopStrategyRows.find(
        (row) =>
          String(row.record_type ?? "") === "verkoopstrategie_product" &&
          Number(row.jaar ?? 0) === year &&
          String(row.bier_id ?? "") === bierId &&
          String(row.product_id ?? "") === productId
      ) ?? null
    );
  }

  function marginFromStrategy(row: any, code: string): number | null {
    const margins = row?.sell_in_margins ?? row?.kanaalmarges ?? {};
    if (!margins || typeof margins !== "object") return null;
    const raw = (margins as any)[code];
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  function effectiveMargin(
    year: number,
    bierId: string,
    productId: string,
    productType: string,
    code: string,
    defaultMargin: number
  ) {
    const followId = followProductIdFor(productId, productType);
    const keyProductId = followId || productId;
    const beerRow = getBeerStrategyRow(year, bierId, keyProductId);
    const beerMargin = marginFromStrategy(beerRow, code);
    if (beerMargin !== null) return beerMargin;
    const packRow = getPackagingStrategyRow(year, keyProductId);
    const packMargin = marginFromStrategy(packRow, code);
    if (packMargin !== null) return packMargin;
    const yearRow = getYearStrategyRow(year);
    const yearMargin = marginFromStrategy(yearRow, code);
    if (yearMargin !== null) return yearMargin;
    return defaultMargin;
  }

  const out: PreviewRow[] = [];

  latestActivationByKey.forEach((activation) => {
    const bierId = String(activation.bier_id ?? "");
    const productId = String(activation.product_id ?? "");
    const versionId = String(activation.kostprijsversie_id ?? "");
    const record = versionById.get(versionId);
    if (!record) return;
    const snap = snapshotProductCostFromRecord(record, productId);
    if (!snap) return;

    const sourceCost = Number(snap.kostprijs ?? 0);
    const sourcePrimary = Number(snap.primaireKosten ?? 0);
    const otherCost = sourceCost - sourcePrimary;
    const scenarioKey = `${bierId}::${productId}`;
    const scenarioPrimaryRaw = Object.prototype.hasOwnProperty.call(scenarioPrimaryCosts, scenarioKey)
      ? Number((scenarioPrimaryCosts as any)[scenarioKey] ?? sourcePrimary)
      : sourcePrimary;
    const scenarioPrimary = Number.isFinite(scenarioPrimaryRaw) ? scenarioPrimaryRaw : sourcePrimary;
    const productType = String(snap.productType ?? "");
    const basePackaging = packagingCost(productId, productType as any, sourceYear);
    const targetPackaging = packagingCost(productId, productType as any, targetYear);
    const packagingDelta = targetPackaging - basePackaging;
    const liters = litersPerUnit(productId, productType as any, targetYear);
    const calcTypeRaw = String(record?.type ?? record?.soort_berekening?.type ?? "").trim().toLowerCase();
    const calcType = calcTypeRaw === "inkoop" ? "inkoop" : "eigen_productie";
    const fixedPerLiterSource =
      calcType === "inkoop" ? computeIndirectFixedCostPerInkoopLiter(sourceYear) : computeDirectFixedCostPerProductieLiter(sourceYear);
    const fixedPerLiterTarget =
      calcType === "inkoop" ? computeIndirectFixedCostPerInkoopLiter(targetYear) : computeDirectFixedCostPerProductieLiter(targetYear);
    const fixedDelta = (fixedPerLiterTarget - fixedPerLiterSource) * Number(liters ?? 0);

    const litersValue = Number(liters ?? 0);
    const override = eigenProductieOverrides[bierId] ?? null;
    const recordTarget =
      calcType === "eigen_productie" && override
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

    const accijnsSource = computeAccijnsForLiters(sourceYear, record, litersValue);
    const accijnsTarget = computeAccijnsForLiters(targetYear, recordTarget, litersValue);

    let estimatedTargetCost = 0;
    if (calcType === "inkoop") {
      const scenarioBaseCost = scenarioPrimary + otherCost;
      const accijnsDelta = accijnsTarget - accijnsSource;
      estimatedTargetCost = scenarioBaseCost + packagingDelta + fixedDelta + accijnsDelta;
    } else {
      const batchGrootte = Number(getProductieForYear(targetYear)?.batchgrootte_eigen_productie_l ?? 0);
      const totals = override ? computeEigenProductieReceptTotals(override, batchGrootte) : null;
      const primaireTarget = totals ? totals.literPrijs * litersValue : sourcePrimary;
      const vasteTarget = fixedPerLiterTarget * litersValue;
      estimatedTargetCost = primaireTarget + targetPackaging + vasteTarget + accijnsTarget;
    }
    const sellIn = Object.fromEntries(
      channels.map((channel) => {
        const margin = effectiveMargin(targetYear, bierId, productId, productType, channel.code, channel.defaultMargin);
        return [channel.code, calcSellInPrice(estimatedTargetCost, margin)];
      })
    ) as Record<string, number>;

    out.push({
      bierId,
      biernaam: bierNameById.get(bierId) ?? String(((record.basisgegevens ?? {}) as any)?.biernaam ?? bierId),
      productId,
      productType: productType === "basis" || productType === "samengesteld" ? (productType as any) : "",
      calcType,
      productLabel: snap.productLabel,
      sourcePrimaryCost: sourcePrimary,
      sourceCost,
      estimatedTargetCost,
      delta: estimatedTargetCost - sourceCost,
      sellIn,
    });
  });

  out.sort((a, b) => (a.biernaam + a.productLabel).localeCompare(b.biernaam + b.productLabel, "nl-NL"));
  return out;
}
