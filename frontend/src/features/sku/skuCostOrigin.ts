import { normalizeSkuLabel } from "@/lib/skuLabels";

type GenericRecord = Record<string, unknown>;

export type SkuCostOrigin =
  | "purchased_batch"
  | "own_production_batch"
  | "derived_from_parent"
  | "composed_sellable"
  | "merchandise_component"
  | "service_manual"
  | "historical_manual"
  | "ignored_revenue_line"
  | "unknown";

export type SkuCostClassification = {
  costOrigin: SkuCostOrigin;
  sourceKind: string;
  parentSkuId: string;
  parentProductId: string;
  sortRank: number;
  isParentCostCarrier: boolean;
  isDerivedFromParent: boolean;
  isComposedSellable: boolean;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function payloadOf(row: unknown): GenericRecord {
  const source = row && typeof row === "object" ? (row as GenericRecord) : {};
  const payload = source.payload;
  return payload && typeof payload === "object" ? (payload as GenericRecord) : {};
}

export function readSkuCostOrigin(sku: unknown, article?: unknown): SkuCostOrigin {
  const skuSource = sku && typeof sku === "object" ? (sku as GenericRecord) : {};
  const articleSource = article && typeof article === "object" ? (article as GenericRecord) : {};
  const skuPayload = payloadOf(sku);
  const articlePayload = payloadOf(article);
  const explicit = lower(
    skuPayload.cost_origin ??
      skuSource.cost_origin ??
      articlePayload.cost_origin ??
      articleSource.cost_origin
  );
  if (
    explicit === "purchased_batch" ||
    explicit === "own_production_batch" ||
    explicit === "derived_from_parent" ||
    explicit === "composed_sellable" ||
    explicit === "merchandise_component" ||
    explicit === "service_manual" ||
    explicit === "historical_manual" ||
    explicit === "ignored_revenue_line"
  ) {
    return explicit;
  }
  return "unknown";
}

export function readSkuCostParentSkuId(sku: unknown): string {
  const source = sku && typeof sku === "object" ? (sku as GenericRecord) : {};
  const payload = payloadOf(sku);
  return text(payload.cost_parent_sku_id ?? source.cost_parent_sku_id ?? payload.parent_sku_id ?? source.parent_sku_id);
}

function sourceKindFor(origin: SkuCostOrigin) {
  switch (origin) {
    case "purchased_batch":
      return "Inkoop";
    case "own_production_batch":
      return "Eigen productie";
    case "derived_from_parent":
      return "Afgeleid";
    case "composed_sellable":
      return "Zelf samengesteld";
    case "merchandise_component":
      return "Merchandise";
    case "service_manual":
      return "Dienst";
    case "historical_manual":
      return "Historisch";
    case "ignored_revenue_line":
      return "Geen kostprijs nodig";
    default:
      return "Onbekend";
  }
}

function inferOriginFromShape(args: {
  sku?: unknown;
  article?: unknown;
  productType?: string;
  calcType?: string;
  productLabel?: string;
  hasBom?: boolean;
}): SkuCostOrigin {
  const sku = args.sku && typeof args.sku === "object" ? (args.sku as GenericRecord) : {};
  const article = args.article && typeof args.article === "object" ? (args.article as GenericRecord) : {};
  const skuPayload = payloadOf(sku);
  const articlePayload = payloadOf(article);
  const kind = lower(sku.kind);
  const articleKind = lower(article.kind);
  const productType = lower(args.productType);
  const label = normalizeSkuLabel(args.productLabel || sku.name || article.name || article.naam || "").toLowerCase();
  const subtype = lower(
    skuPayload.sellable_subtype ??
      sku.sellable_subtype ??
      articlePayload.sellable_subtype ??
      article.sellable_subtype
  );
  const pricingMethod = lower(
    skuPayload.pricing_method ??
      sku.pricing_method ??
      articlePayload.pricing_method ??
      article.pricing_method
  );
  const productGroup = lower(
    skuPayload.product_group ??
      sku.product_group ??
      articlePayload.product_group ??
      article.product_group
  );

  if (pricingMethod === "manual_rate" || subtype === "dienst" || subtype === "service") return "service_manual";
  if (subtype === "historical" || label.includes("historisch") || label.includes("wentersch")) return "historical_manual";
  if (args.hasBom || kind === "bundle" || subtype === "beer_bundle") return "composed_sellable";
  if (kind === "article" && (articleKind === "packaging_component" || productGroup === "merchandise")) return "merchandise_component";
  if (productType === "article") return "composed_sellable";
  if (productType === "basis" || productType === "samengesteld") {
    const calc = lower(args.calcType);
    return calc === "inkoop" ? "purchased_batch" : "own_production_batch";
  }
  return "unknown";
}

export function classifySkuCost(args: {
  sku?: unknown;
  article?: unknown;
  productType?: string;
  calcType?: string;
  productLabel?: string;
  hasBom?: boolean;
  parentSkuId?: string;
  parentProductId?: string;
}): SkuCostClassification {
  const explicit = readSkuCostOrigin(args.sku, args.article);
  const inferred = explicit === "unknown" ? inferOriginFromShape(args) : explicit;
  const parentSkuId = text(args.parentSkuId) || readSkuCostParentSkuId(args.sku);
  const parentProductId = text(args.parentProductId);
  const isDerived = inferred === "derived_from_parent";
  const isComposed = inferred === "composed_sellable";
  const isParent =
    inferred === "purchased_batch" ||
    inferred === "own_production_batch" ||
    inferred === "historical_manual" ||
    inferred === "merchandise_component" ||
    inferred === "service_manual";
  const sortRank =
    isParent ? 0 :
    isDerived ? 1 :
    isComposed ? 2 :
    inferred === "ignored_revenue_line" ? 9 :
    5;

  return {
    costOrigin: inferred,
    sourceKind: sourceKindFor(inferred),
    parentSkuId,
    parentProductId,
    sortRank,
    isParentCostCarrier: isParent,
    isDerivedFromParent: isDerived,
    isComposedSellable: isComposed,
  };
}
