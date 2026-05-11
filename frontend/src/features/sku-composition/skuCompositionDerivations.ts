import { text, toNumber, type PackagingLine } from "@/features/sku-composition/skuCompositionUtils";

type CentralSku = {
  contentLiter: number;
  pricingMethod: string;
  manualRateEx: number;
  kostprijsEx: number;
};

export function computeFormatPackagingCost(args: {
  formatId: string;
  bomByParent: Map<string, Record<string, unknown>[]>;
  articlesById: Map<string, Record<string, unknown>>;
  packagingCostById: Map<string, number>;
}) {
  const { formatId, bomByParent, articlesById, packagingCostById } = args;
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const compute = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const lines = bomByParent.get(id) ?? [];
    let subtotal = 0;
    lines.forEach((line) => {
      const componentArticleId = text((line as any)?.component_article_id);
      if (!componentArticleId) return;
      const qty = Math.max(0, toNumber((line as any)?.quantity, 0));
      if (qty === 0) return;
      const component = articlesById.get(componentArticleId);
      const kind = text((component as any)?.kind).toLowerCase();
      if (kind === "packaging_component") {
        subtotal += qty * (packagingCostById.get(componentArticleId) ?? 0);
        return;
      }
      if (kind === "format") {
        subtotal += qty * compute(componentArticleId);
      }
    });
    visiting.delete(id);
    memo.set(id, subtotal);
    return subtotal;
  };

  return compute(formatId);
}

export function computePackagingCost(args: {
  mode: "afvuleenheid" | "verkoopbaar";
  packagingLines: PackagingLine[];
  bomByParent: Map<string, Record<string, unknown>[]>;
  articlesById: Map<string, Record<string, unknown>>;
  packagingCostById: Map<string, number>;
}) {
  const { mode, packagingLines, bomByParent, articlesById, packagingCostById } = args;
  let packagingCost = 0;
  packagingLines.forEach((line) => {
    const qty = Math.max(0, toNumber(line.qty, 0));
    if (qty === 0) return;
    if (mode === "afvuleenheid" && line.kind === "format") {
      packagingCost += qty * computeFormatPackagingCost({ formatId: line.componentId, bomByParent, articlesById, packagingCostById });
      return;
    }
    packagingCost += qty * (packagingCostById.get(line.componentId) ?? 0);
  });
  return packagingCost;
}

export function computeTotals(args: {
  mode: "afvuleenheid" | "verkoopbaar";
  sellableKind: "product" | "dienst";
  manualRateEx: number;
  composition: { componentSkuId: string; qty: number }[];
  packagingLines: PackagingLine[];
  contentLiter: number;
  formatOptions: { value: string; contentLiter?: number }[];
  centralSkuById: Map<string, CentralSku>;
  bomByParent: Map<string, Record<string, unknown>[]>;
  articlesById: Map<string, Record<string, unknown>>;
  packagingCostById: Map<string, number>;
}) {
  const {
    mode,
    sellableKind,
    manualRateEx,
    composition,
    packagingLines,
    contentLiter,
    formatOptions,
    centralSkuById,
    bomByParent,
    articlesById,
    packagingCostById,
  } = args;

  let liters = 0;
  let cost = 0;

  if (mode === "verkoopbaar" && sellableKind === "dienst") {
    cost = Math.max(0, toNumber(manualRateEx, 0));
    return { liters: 0, cost, packagingCost: 0, totalCost: cost };
  }

  composition.forEach((line) => {
    const sku = centralSkuById.get(line.componentSkuId);
    if (!sku) return;
    const qty = Math.max(0, toNumber(line.qty, 0));
    liters += qty * (sku.contentLiter || 0);
    cost += qty * (sku.pricingMethod === "manual_rate" ? sku.manualRateEx : sku.kostprijsEx);
  });

  const packagingCost = computePackagingCost({ mode, packagingLines, bomByParent, articlesById, packagingCostById });

  if (mode === "afvuleenheid") {
    liters =
      toNumber(contentLiter, 0) > 0
        ? Math.max(0, toNumber(contentLiter, 0))
        : packagingLines.reduce((sum, line) => {
            if (line.kind !== "format") return sum;
            const opt = formatOptions.find((candidate) => candidate.value === line.componentId);
            if (!opt) return sum;
            return sum + Math.max(0, toNumber(line.qty, 0)) * (opt.contentLiter || 0);
          }, 0);
  }

  return { liters, cost, packagingCost, totalCost: cost + packagingCost };
}

