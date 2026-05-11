import {
  createId,
  text,
  toNumber,
  type GenericRecord,
} from "@/components/article-kostprijs/articleKostprijsWizardUtils";

export type BomCostLine = {
  id: string;
  label: string;
  qty: number;
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

  // 3) Fallback: some older snapshots may key on product_id = article_id.
  const articleId = text((sku as any)?.article_id);
  if (articleId) {
    return (list as any[]).find((row) => text(row?.product_id) === articleId) ?? null;
  }

  return null;
}

export function buildBomCostLines(args: {
  selectedArticleId: string;
  bomLines: GenericRecord[];
  skuById: Map<string, GenericRecord>;
  articleById: Map<string, GenericRecord>;
  activeVersionIdBySku: Map<string, string>;
  versionById: Map<string, GenericRecord>;
  packagingPriceById: Map<string, number>;
}) {
  const {
    selectedArticleId,
    bomLines,
    skuById,
    articleById,
    activeVersionIdBySku,
    versionById,
    packagingPriceById,
  } = args;

  if (!selectedArticleId) return [];

  const relevant = bomLines.filter((row) => text((row as any).parent_article_id) === selectedArticleId);
  const out: BomCostLine[] = [];

  relevant.forEach((line) => {
    const qty = Math.max(0, toNumber((line as any).quantity, 0));
    const componentSkuId = text((line as any).component_sku_id);
    const componentArticleId = text((line as any).component_article_id);
    const warnings: string[] = [];

    if (componentSkuId) {
      const componentSku = skuById.get(componentSkuId) ?? null;
      const label = text((componentSku as any)?.name) || componentSkuId;
      const activeVid = activeVersionIdBySku.get(componentSkuId) ?? "";
      const version = activeVid ? versionById.get(activeVid) ?? null : null;
      if (!activeVid || !version) warnings.push("Geen actieve kostprijs gevonden voor component.");
      const snap = findSnapshotRowForSku({ version, skuId: componentSkuId, skuById }) ?? {};

      const productkosten = toNumber(
        (snap as any).inkoop ?? (snap as any).primaire_kosten ?? (snap as any).variabele_kosten,
        0
      );
      const verpakkingskosten = toNumber((snap as any).verpakkingskosten, 0);
      const opslag = toNumber(
        (snap as any).vaste_kosten ??
          (snap as any).vaste_directe_kosten ??
          (snap as any).indirecte_kosten,
        0
      );
      const accijns = toNumber((snap as any).accijns, 0);
      const kostprijs = toNumber(
        (snap as any).kostprijs,
        productkosten + verpakkingskosten + opslag + accijns
      );

      out.push({
        id: text((line as any).id) || createId(),
        label,
        qty,
        productkosten: qty * productkosten,
        verpakkingskosten: qty * verpakkingskosten,
        opslag: qty * opslag,
        accijnzen: qty * accijns,
        kostprijs: qty * kostprijs,
        warnings,
      });
      return;
    }

    if (componentArticleId) {
      const article = articleById.get(componentArticleId) ?? null;
      const label = text((article as any)?.name ?? (article as any)?.naam) || componentArticleId;
      const price = packagingPriceById.get(componentArticleId);
      if (price === undefined) warnings.push("Geen actieve jaarprijs gevonden voor verpakkingsonderdeel.");
      const unit = price ?? 0;
      out.push({
        id: text((line as any).id) || createId(),
        label,
        qty,
        productkosten: 0,
        verpakkingskosten: qty * unit,
        opslag: 0,
        accijnzen: 0,
        kostprijs: qty * unit,
        warnings,
      });
      return;
    }

    warnings.push("Onbekende BOM-regel: mist component_sku_id of component_article_id.");
    out.push({
      id: text((line as any).id) || createId(),
      label: text((line as any).omschrijving) || "Onbekend onderdeel",
      qty,
      productkosten: 0,
      verpakkingskosten: 0,
      opslag: 0,
      accijnzen: 0,
      kostprijs: 0,
      warnings,
    });
  });

  return out;
}

export function summarizeBomCostLines(args: { bomCostLines: BomCostLine[]; selectedBundleSkuId: string }) {
  const { bomCostLines, selectedBundleSkuId } = args;
  let productkosten = 0;
  let verpakkingskosten = 0;
  let opslag = 0;
  let accijnzen = 0;
  const warnings: string[] = [];
  bomCostLines.forEach((line) => {
    productkosten += line.productkosten;
    verpakkingskosten += line.verpakkingskosten;
    opslag += line.opslag;
    accijnzen += line.accijnzen;
    warnings.push(...line.warnings);
  });
  const kostprijs = productkosten + verpakkingskosten + opslag + accijnzen;
  if (!selectedBundleSkuId) warnings.push("Selecteer eerst een artikel.");
  if (bomCostLines.length === 0) warnings.push("Samenstelling (BOM) is leeg.");
  return { productkosten, verpakkingskosten, opslag, accijnzen, kostprijs, warnings } satisfies Summary;
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
    },
    resultaat_snapshot:
      nextStatus === "definitief"
        ? { producten: { basisproducten: snapshotRow, samengestelde_producten: [] } }
        : {},
    kostprijs: summary.kostprijs,
  } satisfies GenericRecord;
}
