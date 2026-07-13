"use client";

type GenericRecord = Record<string, unknown>;

export type PreviewRow = {
  skuId?: string;
  bierId: string;
  biernaam: string;
  productId: string;
  productType: "basis" | "samengesteld" | "article" | "";
  calcType: "inkoop" | "eigen_productie";
  productLabel: string;
  sourcePrimaryCost: number;
  sourceCost: number;
  estimatedTargetCost: number;
  delta: number;
  litersPerUnit: number;
  sellIn: Record<string, number>;
};

type KostprijsTargetRow = {
  bier_id?: string;
  sku_id?: string;
  product_id?: string;
  biernaam?: string;
  soort?: string;
  product_type?: "basis" | "samengesteld" | "article";
  verpakkingseenheid?: string;
  source_kostprijs?: number;
  primaire_kosten?: number;
  kostprijs?: number;
  verschil?: number;
  status?: "ok" | "warning" | "blocking";
};

type KostprijsTargetRows = {
  basisRows: KostprijsTargetRow[];
  samengRows: KostprijsTargetRow[];
};

const CHANNELS = [
  { code: "horeca", defaultMargin: 50 },
  { code: "retail", defaultMargin: 30 },
  { code: "slijterij", defaultMargin: 40 },
  { code: "zakelijk", defaultMargin: 45 },
] as const;

const STRATEGY_TYPES = new Set(["jaarstrategie", "verkoopstrategie_product", "verkoopstrategie_verpakking"]);

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marginFromStrategy(row: GenericRecord | null, code: string): number | null {
  const margins = row?.sell_in_margins ?? row?.kanaalmarges ?? {};
  if (!margins || typeof margins !== "object") return null;
  const raw = (margins as GenericRecord)[code];
  if (raw === "" || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPreviewRows(args: {
  kostprijsTargetRows: KostprijsTargetRows;
  currentVerkoopprijzen: unknown;
  draftVerkoopstrategieTarget: unknown;
  targetYear: number;
  calcSellInPrice: (cost: number, marginPct: number) => number;
}): PreviewRow[] {
  const {
    kostprijsTargetRows,
    currentVerkoopprijzen,
    draftVerkoopstrategieTarget,
    targetYear,
    calcSellInPrice,
  } = args;

  const rows = [
    ...(Array.isArray(kostprijsTargetRows.samengRows) ? kostprijsTargetRows.samengRows : []),
    ...(Array.isArray(kostprijsTargetRows.basisRows) ? kostprijsTargetRows.basisRows : []),
  ].filter((row) => row && row.status === "ok");

  const strategyRows = (Array.isArray(draftVerkoopstrategieTarget) && draftVerkoopstrategieTarget.length > 0
    ? draftVerkoopstrategieTarget
    : Array.isArray(currentVerkoopprijzen)
      ? currentVerkoopprijzen
      : []
  )
    .filter((row) => row && typeof row === "object" && STRATEGY_TYPES.has(String((row as GenericRecord).record_type ?? "")))
    .map((row) => row as GenericRecord);

  function yearStrategyRow() {
    return strategyRows.find(
      (row) => String(row.record_type ?? "") === "jaarstrategie" && num(row.jaar) === targetYear
    ) ?? null;
  }

  function productStrategyRow(skuId: string) {
    return strategyRows.find(
      (row) =>
        String(row.record_type ?? "") === "verkoopstrategie_product" &&
        num(row.jaar) === targetYear &&
        String(row.sku_id ?? "").trim() === skuId
    ) ?? null;
  }

  function effectiveMargin(skuId: string, code: string, defaultMargin: number) {
    const productMargin = marginFromStrategy(productStrategyRow(skuId), code);
    if (productMargin !== null) return productMargin;
    const yearMargin = marginFromStrategy(yearStrategyRow(), code);
    if (yearMargin !== null) return yearMargin;
    return defaultMargin;
  }

  return rows
    .map((row) => {
      const skuId = String(row.sku_id ?? "").trim();
      const targetCost = num(row.kostprijs);
      const sellIn = Object.fromEntries(
        CHANNELS.map((channel) => [
          channel.code,
          calcSellInPrice(targetCost, effectiveMargin(skuId, channel.code, channel.defaultMargin)),
        ])
      ) as Record<string, number>;

      return {
        skuId,
        bierId: String(row.bier_id ?? row.biernaam ?? "").trim(),
        biernaam: String(row.biernaam ?? "Zonder stijl"),
        productId: String(row.product_id ?? "").trim(),
        productType: row.product_type ?? "",
        calcType: String(row.soort ?? "").toLowerCase().includes("inkoop") ? "inkoop" : "eigen_productie",
        productLabel: String(row.verpakkingseenheid ?? row.product_id ?? ""),
        sourcePrimaryCost: num(row.primaire_kosten),
        sourceCost: num(row.source_kostprijs),
        estimatedTargetCost: targetCost,
        delta: num(row.verschil),
        litersPerUnit: 0,
        sellIn,
      } satisfies PreviewRow;
    })
    .sort((a, b) => (a.biernaam + a.productLabel).localeCompare(b.biernaam + b.productLabel, "nl-NL"));
}
