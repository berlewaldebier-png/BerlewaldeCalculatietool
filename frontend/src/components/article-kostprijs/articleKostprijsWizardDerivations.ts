import {
  createId,
  text,
  toNumber,
  type GenericRecord,
} from "@/components/article-kostprijs/articleKostprijsWizardUtils";
import { calculateComponentCostprice } from "@/lib/costpriceCalculationEngine";

export type BomCostLine = {
  id: string;
  label: string;
  qty: number;
  componentSkuId?: string;
  componentArticleId?: string;
  activeVersionId?: string;
  productkosten: number;
  verpakkingskosten: number;
  opslag: number;
  accijnzen: number;
  kostprijs: number;
  warnings: string[];
};

export type Summary = {
  productkosten: number;
  verpakkingskosten: number;
  opslag: number;
  accijnzen: number;
  kostprijs: number;
  warnings: string[];
  componentVersionRefs: Array<{
    componentSkuId: string;
    componentLabel: string;
    quantity: number;
    activeVersionId: string;
  }>;
  compositionSnapshot: Array<{
    type: "sku" | "packaging" | "unknown";
    label: string;
    quantity: number;
    componentSkuId?: string;
    componentArticleId?: string;
    activeVersionId?: string;
    productkosten: number;
    verpakkingskosten: number;
    opslag: number;
    accijnzen: number;
    kostprijs: number;
  }>;
};

export function buildSkuById(skus: GenericRecord[]) {
  const map = new Map<string, GenericRecord>();
  skus.forEach((row) => {
    const id = text((row as any).id);
    if (id) map.set(id, row);
  });
  return map;
}

export function buildArticleById(articles: GenericRecord[]) {
  const map = new Map<string, GenericRecord>();
  articles.forEach((row) => {
    const id = text((row as any).id);
    if (id) map.set(id, row);
  });
  return map;
}

export function buildBundleOptions(args: {
  articles: GenericRecord[];
  skus: GenericRecord[];
  articleById: Map<string, GenericRecord>;
}) {
  const { articles, skus, articleById } = args;
  const out: Array<{ articleId: string; skuId: string; label: string }> = [];
  const bundleArticleIds = new Set(
    articles
      .filter((row) => text((row as any).kind).toLowerCase() === "bundle")
      .map((row) => text((row as any).id))
      .filter(Boolean)
  );

  skus.forEach((sku) => {
    if (text((sku as any).kind).toLowerCase() !== "article") return;
    const articleId = text((sku as any).article_id);
    if (!articleId || !bundleArticleIds.has(articleId)) return;
    const skuId = text((sku as any).id);
    const article = articleById.get(articleId);
    const label =
      text((article as any)?.name ?? (article as any)?.naam) ||
      text((sku as any).name) ||
      articleId;
    if (skuId) out.push({ articleId, skuId, label });
  });
  out.sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
  return out;
}

export function buildDefaultYear(activations: GenericRecord[]) {
  const years = activations
    .map((row) => toNumber((row as any).jaar, 0))
    .filter((y) => y > 0)
    .sort((a, b) => a - b);
  return years[years.length - 1] ?? new Date().getFullYear();
}

export function buildActiveVersionIdBySku(activations: GenericRecord[], selectedYear: number) {
  const map = new Map<string, string>();
  activations.forEach((row) => {
    const year = toNumber((row as any).jaar, 0);
    if (year !== selectedYear) return;
    const tot = text((row as any).effectief_tot);
    if (tot) return;
    const skuId = text((row as any).sku_id);
    const versionId = text((row as any).kostprijsversie_id);
    if (skuId && versionId) map.set(skuId, versionId);
  });
  return map;
}

export function buildVersionById(rows: GenericRecord[]) {
  const map = new Map<string, GenericRecord>();
  rows.forEach((row) => {
    const id = text((row as any).id);
    if (id) map.set(id, row);
  });
  return map;
}

export function buildPackagingPriceById(packagingComponentPrices: GenericRecord[], selectedYear: number) {
  const map = new Map<string, number>();
  packagingComponentPrices.forEach((row) => {
    const year = toNumber((row as any).jaar, 0);
    if (year !== selectedYear) return;
    const id = text((row as any).verpakkingsonderdeel_id ?? (row as any).packaging_component_id);
    if (!id) return;
    map.set(id, toNumber((row as any).prijs_per_stuk, 0));
  });
  return map;
}

export function findSnapshotRowForSku(args: {
  version: GenericRecord | null;
  skuId: string;
  skuById: Map<string, GenericRecord>;
}) {
  const { version, skuId, skuById } = args;
  if (!version) return null;
  // Canonical: use normalized cost lines provided by the backend (derived from cost_version_sku_rows).
  // Avoid reading `resultaat_snapshot` to prevent hidden fallback logic.
  const costLines = (
    // Backend canonical: `cost_lines` (snake-case)
    (version as any).cost_lines ??
    // Alternate shapes seen in older UI state / in-flight objects
    (version as any).costLines ??
    // Some code paths still use the non-underscored key name.
    (version as any).cost_lines ??
    []
  ) as unknown;
  const list = Array.isArray(costLines) ? (costLines as any[]) : [];

  // 1) Preferred: explicit sku_id in snapshot rows (article/bundle cost versions).
  const direct = (list as any[]).find((row) => text(row?.sku_id) === skuId) ?? null;
  if (direct) return direct;

  // 2) Beer cost versions store per-format rows keyed by product_id (= format_article_id).
  const sku = skuById.get(skuId) ?? null;
  const formatArticleId = text((sku as any)?.format_article_id);
  if (formatArticleId) {
    return (list as any[]).find((row) => text(row?.product_id) === formatArticleId) ?? null;
  }

  return null;
}

export function buildBomCostLines(args: {
  selectedYear: number;
  selectedArticleId: string;
  bomLines: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  skuById: Map<string, GenericRecord>;
  activeVersionIdBySku: Map<string, string>;
  versionById: Map<string, GenericRecord>;
  packagingPriceById: Map<string, number>;
}) {
  const {
    selectedYear,
    selectedArticleId,
    bomLines,
    skus,
    articles,
    skuById,
    activeVersionIdBySku,
    versionById,
    packagingPriceById,
  } = args;

  if (!selectedArticleId) return [];

  const summaryRows: GenericRecord[] = [];
  activeVersionIdBySku.forEach((versionId, skuId) => {
    const version = versionById.get(versionId) ?? null;
    const snap = findSnapshotRowForSku({ version, skuId, skuById });
    if (!snap) return;
    const componentSku = skuById.get(skuId) ?? null;
    summaryRows.push({
      ...(snap as GenericRecord),
      sku_id: skuId,
      product_id: text((snap as any).product_id) || text((componentSku as any)?.format_article_id),
    });
  });

  const packagingRows = Array.from(packagingPriceById.entries()).map(([componentId, price]) => ({
    jaar: selectedYear,
    verpakkingsonderdeel_id: componentId,
    prijs_per_stuk: price,
  }));

  const result = calculateComponentCostprice({
    parentArticleId: selectedArticleId,
    bomLines,
    skus,
    articles,
    summaryRows,
    packagingComponentPrices: packagingRows,
    year: selectedYear,
  });

  return result.components.map((component, index) => ({
    id: `${component.component_sku_id ?? component.component_article_id ?? "component"}-${index}`,
    label: component.label,
    qty: component.quantity,
    componentSkuId: component.component_sku_id,
    componentArticleId: component.component_article_id,
    activeVersionId: component.component_sku_id ? activeVersionIdBySku.get(component.component_sku_id) ?? "" : "",
    productkosten: component.primaire_kosten,
    verpakkingskosten: component.verpakkingskosten,
    opslag: component.vaste_kosten,
    accijnzen: component.accijns,
    kostprijs: component.kostprijs,
    warnings: component.issues.map((issue) => issue.message),
  }));
}

export function summarizeBomCostLines(args: { bomCostLines: BomCostLine[]; selectedBundleSkuId: string }) {
  const { bomCostLines, selectedBundleSkuId } = args;
  let productkosten = 0;
  let verpakkingskosten = 0;
  let opslag = 0;
  let accijnzen = 0;
  const warnings: string[] = [];
  const componentVersionRefs: Summary["componentVersionRefs"] = [];
  const compositionSnapshot: Summary["compositionSnapshot"] = [];
  bomCostLines.forEach((line) => {
    productkosten += line.productkosten;
    verpakkingskosten += line.verpakkingskosten;
    opslag += line.opslag;
    accijnzen += line.accijnzen;
    warnings.push(...line.warnings);
    if (line.componentSkuId) {
      if (line.activeVersionId) {
        componentVersionRefs.push({
          componentSkuId: line.componentSkuId,
          componentLabel: line.label,
          quantity: line.qty,
          activeVersionId: line.activeVersionId,
        });
      }
    }
    compositionSnapshot.push({
      type: line.componentSkuId ? "sku" : line.componentArticleId ? "packaging" : "unknown",
      label: line.label,
      quantity: line.qty,
      componentSkuId: line.componentSkuId,
      componentArticleId: line.componentArticleId,
      activeVersionId: line.activeVersionId,
      productkosten: line.productkosten,
      verpakkingskosten: line.verpakkingskosten,
      opslag: line.opslag,
      accijnzen: line.accijnzen,
      kostprijs: line.kostprijs,
    });
  });
  const kostprijs = productkosten + verpakkingskosten + opslag + accijnzen;
  if (!selectedBundleSkuId) warnings.push("Selecteer eerst een artikel.");
  if (bomCostLines.length === 0) warnings.push("Samenstelling (BOM) is leeg.");
  return {
    productkosten,
    verpakkingskosten,
    opslag,
    accijnzen,
    kostprijs,
    warnings,
    componentVersionRefs,
    compositionSnapshot,
  } satisfies Summary;
}

export function buildBundleKostprijsversieRecord(args: {
  recordId: string;
  selectedYear: number;
  nextStatus: "concept" | "definitief";
  selectedBundleSkuId: string;
  selectedArticleId: string;
  selectedLabel: string;
  selectedArticle: GenericRecord | null;
  summary: Summary;
  nowIso: () => string;
}) {
  const {
    recordId,
    selectedYear,
    nextStatus,
    selectedBundleSkuId,
    selectedArticleId,
    selectedLabel,
    selectedArticle,
    summary,
    nowIso,
  } = args;

  const ts = nowIso();
  const snapshotRow =
    nextStatus === "definitief"
      ? [
          {
            id: `row-${recordId}`,
            sku_id: selectedBundleSkuId,
            product_id: selectedArticleId,
            product_type: "article",
            verpakking: selectedLabel,
            verpakking_label: selectedLabel,
            primaire_kosten: summary.productkosten,
            inkoop: summary.productkosten,
            verpakkingskosten: summary.verpakkingskosten,
            vaste_kosten: summary.opslag,
            indirecte_kosten: summary.opslag,
            accijns: summary.accijnzen,
            kostprijs: summary.kostprijs,
            liters_per_product: toNumber((selectedArticle as any)?.content_liter, 0),
          },
        ]
      : [];

  return {
    id: recordId,
    jaar: selectedYear,
    status: nextStatus,
    bier_id: "",
    versie_nummer: 1,
    created_at: ts,
    updated_at: ts,
    finalized_at: nextStatus === "definitief" ? ts : "",
    type: "bundle",
    brontype: "bundle_article",
    basisgegevens: {
      jaar: selectedYear,
      biernaam: selectedLabel,
      btw_tarief: "21%",
      article_id: selectedArticleId,
      sku_id: selectedBundleSkuId,
      source_component_versions: summary.componentVersionRefs,
      composition_snapshot: summary.compositionSnapshot,
    },
    invoer: {
      samenstelling_snapshot: summary.compositionSnapshot,
    },
    resultaat_snapshot:
      nextStatus === "definitief"
        ? { producten: { basisproducten: snapshotRow, samengestelde_producten: [] } }
        : {},
    kostprijs: summary.kostprijs,
  } satisfies GenericRecord;
}
