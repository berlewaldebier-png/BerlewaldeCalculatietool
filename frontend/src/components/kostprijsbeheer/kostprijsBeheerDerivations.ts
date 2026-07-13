import {
  buildCostSourceLabel,
  buildSupplierLabel,
  buildVersionLabel,
  getSnapshotProductCost,
  parseSortTimestamp,
} from "@/components/kostprijsbeheer/kostprijsBeheerUtils";
import { normalizeSkuLabel } from "@/lib/skuLabels";

export type GenericRecord = Record<string, unknown>;

export type ExistingBerekeningRow = {
  id: string;
  bierNaam: string;
  jaar: number | null;
  status: string;
  type: string;
  sourceLabel: string;
  supplierLabel: string;
  kostprijsPerLiter: number | null;
  ts: string;
  matches: boolean;
};

export type ActiveCostCandidateOption = {
  id: string;
  label: string;
  cost: number | null;
  deltaEuro: number | null;
  deltaPct: number | null;
  sortKey: string;
};

export type ActiveCostRow = {
  key: string;
  skuId: string;
  productId: string;
  artikelNaam: string;
  bierNaam: string;
  groupLabel: string;
  categorie: string;
  productNaam: string;
  productType: string;
  effectiefVanaf: string;
  versieId: string;
  versieLabel: string;
  sourceLabel: string;
  supplierLabel: string;
  versieTimestamp: number;
  currentCost: number | null;
  recommendedVersionId: string;
  definitiveOptions: ActiveCostCandidateOption[];
  hasUpdate: boolean;
  isWarning: boolean;
  deltaEuro: number | null;
  deltaPct: number | null;
};

function cleanRepeatedName(label: unknown) {
  return normalizeSkuLabel(label);
}

function nonBeerGroupLabel(productGroup: string, sellableSubtype: string) {
  const group = String(productGroup || "").trim().toLowerCase();
  const subtype = String(sellableSubtype || "").trim().toLowerCase();
  if (group === "merchandise" || subtype === "merchandise") return "Merchandise";
  if (group === "dienst" || subtype === "dienst") return "Dienstverlening";
  return "";
}

export function buildExistingBerekeningenRows(args: {
  currentBerekeningen: GenericRecord[];
  bierenById: Map<string, string>;
  existingSearch: string;
  existingFilterMode: "all" | "concept" | "definitief";
  selectedYear: number;
}): ExistingBerekeningRow[] {
  const { currentBerekeningen, bierenById, existingSearch, existingFilterMode, selectedYear } = args;
  const q = existingSearch.trim().toLowerCase();

  return currentBerekeningen
    .filter((row) => {
      const year = Number((row as any)?.jaar ?? (row as any)?.basisgegevens?.jaar ?? 0) || 0;
      if (year !== selectedYear) return false;
      const status = String((row as any)?.status ?? "").trim().toLowerCase();
      if (existingFilterMode === "concept") return status === "concept";
      if (existingFilterMode === "definitief") return status === "definitief";
      return true;
    })
    .map((row) => {
      const id = String((row as any)?.id ?? "");
      const basis = ((row as any)?.basisgegevens ?? {}) as any;
      const bierId = String((row as any)?.bier_id ?? "");
      const bierNaam = String(
        bierenById.get(bierId) ?? basis?.biernaam ?? (row as any)?.bier_snapshot?.biernaam ?? ""
      );
      const jaar = Number((row as any)?.jaar ?? basis?.jaar ?? 0) || 0;
      const status = String((row as any)?.status ?? "");
      const type = String((row as any)?.type ?? "");
      const sourceLabel = buildCostSourceLabel(row);
      const supplierLabel = buildSupplierLabel(row);
      const kostprijsPerLiter = Number((row as any)?.kostprijs ?? Number.NaN);
      const ts = String((row as any)?.finalized_at ?? (row as any)?.updated_at ?? (row as any)?.created_at ?? "");
      const label = buildVersionLabel(row);
      const hay = `${bierNaam} ${jaar} ${status} ${type} ${label} ${sourceLabel} ${supplierLabel}`.toLowerCase();
      return {
        id,
        bierNaam: bierNaam || "-",
        jaar: jaar || null,
        status,
        type,
        sourceLabel,
        supplierLabel,
        kostprijsPerLiter: Number.isFinite(kostprijsPerLiter) ? kostprijsPerLiter : null,
        ts,
        matches: !q || hay.includes(q),
      };
    })
    .filter((row) => row.matches)
    .sort((left, right) => parseSortTimestamp(right.ts) - parseSortTimestamp(left.ts));
}

export function buildActiveRows(args: {
  kostprijsproductactiveringen: GenericRecord[];
  selectedYear: number;
  search: string;
  activeSort: { key: "bron" | "artikel" | "categorie" | "since" | "kostprijs"; direction: "asc" | "desc" };
  bierenById: Map<string, string>;
  basisById: Map<string, string>;
  skuById: Map<string, GenericRecord>;
  articleById: Map<string, GenericRecord>;
  bomLines: GenericRecord[];
  samengesteldById: Map<string, string>;
  berekeningenById: Map<string, GenericRecord>;
  currentBerekeningen: GenericRecord[];
  packagingComponentPrices?: GenericRecord[];
}): ActiveCostRow[] {
  const {
    kostprijsproductactiveringen,
    selectedYear,
    search,
    activeSort,
    bierenById,
    basisById,
    skuById,
    articleById,
    bomLines,
    samengesteldById,
    berekeningenById,
    currentBerekeningen,
    packagingComponentPrices,
  } = args;
  const q = search.trim().toLowerCase();
  const warningThresholdPct = 10;
  const bomLinesByParentArticle = new Map<string, GenericRecord[]>();
  (Array.isArray(bomLines) ? bomLines : []).forEach((line) => {
    const parentArticleId = String((line as any)?.parent_article_id ?? "").trim();
    if (!parentArticleId) return;
    if (!bomLinesByParentArticle.has(parentArticleId)) bomLinesByParentArticle.set(parentArticleId, []);
    bomLinesByParentArticle.get(parentArticleId)?.push(line);
  });

  function collectGroupLabelsForArticle(articleId: string, visited: Set<string>): Set<string> {
    const result = new Set<string>();
    const currentArticleId = String(articleId || "").trim();
    if (!currentArticleId || visited.has(currentArticleId)) return result;
    visited.add(currentArticleId);
    for (const line of bomLinesByParentArticle.get(currentArticleId) || []) {
      const componentArticleId = String((line as any)?.component_article_id ?? "").trim();
      if (componentArticleId) {
        collectGroupLabelsForArticle(componentArticleId, new Set(visited)).forEach((label) => result.add(label));
      }
      const componentSkuId = String((line as any)?.component_sku_id ?? "").trim();
      if (!componentSkuId) continue;
      const componentSku = skuById.get(componentSkuId) ?? null;
      const componentBeerId = String((componentSku as any)?.beer_id ?? "").trim();
      const componentLabel = componentBeerId ? bierenById.get(componentBeerId) ?? "" : "";
      if (componentLabel) {
        result.add(componentLabel);
        continue;
      }
      const nestedArticleId = String((componentSku as any)?.article_id ?? "").trim();
      if (nestedArticleId) {
        collectGroupLabelsForArticle(nestedArticleId, new Set(visited)).forEach((label) => result.add(label));
      }
    }
    return result;
  }

  const componentGroupLabelsByArticleId = new Map<string, Set<string>>();
  for (const parentArticleId of bomLinesByParentArticle.keys()) {
    const labels = collectGroupLabelsForArticle(parentArticleId, new Set());
    if (labels.size > 0) componentGroupLabelsByArticleId.set(parentArticleId, labels);
  }

  const packagingPriceByArticleId = new Map<string, number>();
  (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row) => {
    const year = Number((row as any)?.jaar ?? 0) || 0;
    if (year !== selectedYear) return;
    const articleId = String((row as any)?.verpakkingsonderdeel_id ?? (row as any)?.component_id ?? "").trim();
    if (!articleId) return;
    const price = Number((row as any)?.prijs_per_stuk ?? (row as any)?.price_per_unit ?? 0) || 0;
    if (price > 0) packagingPriceByArticleId.set(articleId, price);
  });

  const rawRows: Array<ActiveCostRow & { groupLabels?: string[] }> = (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [])
    .filter((row) => Number((row as any)?.jaar ?? 0) === selectedYear)
    .map((row, index) => {
      const skuId = String((row as any)?.sku_id ?? "");
      const versieId = String((row as any)?.kostprijsversie_id ?? "");
      const effectiefVanaf = String((row as any)?.effectief_vanaf ?? "");
      const skuRow = skuId ? skuById.get(skuId) ?? null : null;
      const skuKind = String((skuRow as any)?.kind ?? "").toLowerCase();
      const skuArticleId =
        skuKind === "beer_format"
          ? String((skuRow as any)?.format_article_id ?? "")
          : String((skuRow as any)?.article_id ?? "");
      const versie = versieId ? berekeningenById.get(versieId) : undefined;
      const bierId =
        String((row as any)?.bier_id ?? "").trim() ||
        String((skuRow as any)?.beer_id ?? "").trim() ||
        String((versie as any)?.bier_id ?? "").trim();
      const skuArticle = skuArticleId ? articleById.get(skuArticleId) ?? null : null;
      const productGroup = String(
        (skuRow as any)?.product_group ?? (skuArticle as any)?.product_group ?? ""
      ).trim().toLowerCase();
      const sellableSubtype = String(
        (skuRow as any)?.sellable_subtype ?? (skuArticle as any)?.sellable_subtype ?? ""
      ).trim().toLowerCase();
      const isGiftset = skuKind === "article" && productGroup === "giftset";
      const categoryGroupLabel = nonBeerGroupLabel(productGroup, sellableSubtype);
      const productId =
        String((row as any)?.product_id ?? "").trim() ||
        skuArticleId;
      const productType =
        String((row as any)?.product_type ?? "").trim() ||
        (skuKind === "article" ? "article" : skuKind === "beer_format" ? "sku" : "");

      const bierNaam = isGiftset ? "Geschenkverpakkingen" : bierenById.get(bierId) ?? bierId ?? "-";
      const skuLabel =
        String((skuRow as any)?.name ?? "") ||
        String((skuArticle as any)?.name ?? "") ||
        String((skuRow as any)?.naam ?? "") ||
        String((skuArticle as any)?.naam ?? "");

      const productNaamFromLegacy = (basisById.get(productId) ?? samengesteldById.get(productId) ?? "") as string;
      const productNaam = cleanRepeatedName(productNaamFromLegacy || skuLabel || productId || (skuId ? skuId : "-"));

      const effectiefProductId = (productId || skuArticleId || "").trim();

      const versieLabel = buildVersionLabel(versieId ? versie : undefined);
      const sourceLabel = buildCostSourceLabel(versieId ? versie : undefined);
      const supplierLabel = buildSupplierLabel(versieId ? versie : undefined);
      const versieTimestamp = parseSortTimestamp(
        (versie as any)?.finalized_at ?? (versie as any)?.updated_at ?? effectiefVanaf
      );

      const costLinesRaw = (versie as any)?.cost_lines ?? (versie as any)?.costLines ?? [];
      const snapshotRows = Array.isArray(costLinesRaw) ? (costLinesRaw as GenericRecord[]) : [];
      const matchingSnapshotRow = snapshotRows.find((item) => {
        const rowProductId = String((item as any)?.product_id ?? "").trim();
        const rowSkuId = String((item as any)?.sku_id ?? "").trim();
        return Boolean(
          (effectiefProductId && rowProductId === effectiefProductId) ||
            (skuId && rowSkuId === skuId)
        );
      });
      const versionType = String((versie as any)?.type ?? "").toLowerCase();
      const currentCost =
        matchingSnapshotRow && effectiefProductId
          ? getSnapshotProductCost(matchingSnapshotRow)
          : skuId && !productId && (versionType === "bundle" || versionType === "article")
            ? Number((versie as any)?.kostprijs ?? Number.NaN)
            : null;

      const categorie =
        (isGiftset ? "Giftset" : "") ||
        String((versie as any)?.basisgegevens?.stijl ?? (versie as any)?.bier_snapshot?.stijl ?? "").trim() ||
        String((versie as any)?.basisgegevens?.categorie ?? "").trim() ||
        (skuKind === "beer_format" ? String((versie as any)?.basisgegevens?.stijl ?? "").trim() : "");

      const isVersionForYearAndBier = (record: GenericRecord) => {
        const recordYear = Number((record as any)?.jaar ?? (record as any)?.basisgegevens?.jaar ?? 0) || 0;
        if (recordYear !== selectedYear) return false;
        return String((record as any)?.bier_id ?? "") === bierId;
      };

      const affectsProduct = (record: GenericRecord) => {
        if (!effectiefProductId && !skuId) return false;
        const statusValue = String((record as any)?.status ?? "").toLowerCase();

        // Definitive versions must have a snapshot containing this product_id.
        if (statusValue === "definitief") {
          const costLines = (record as any)?.cost_lines ?? (record as any)?.costLines ?? [];
          const rows = Array.isArray(costLines) ? (costLines as GenericRecord[]) : [];
          return rows.some((item) => {
            const rowProductId = String((item as any)?.product_id ?? "").trim();
            const rowSkuId = String((item as any)?.sku_id ?? "").trim();
            return Boolean(
              (effectiefProductId && rowProductId === effectiefProductId) ||
                (skuId && rowSkuId === skuId)
            );
          });
        }

        // Concept (factuur) versions don't have a snapshot; infer by invoice unit id inclusion.
        const brontypeValue = String((record as any)?.brontype ?? "").toLowerCase();
        if (brontypeValue !== "factuur") return false;
        const invoer = ((record as any)?.invoer ?? {}) as any;
        const inkoop = (invoer?.inkoop ?? {}) as any;
        const facturen = Array.isArray(inkoop?.facturen) ? inkoop.facturen : [];
        for (const factuur of facturen) {
          const regels = Array.isArray((factuur as any)?.factuurregels) ? (factuur as any).factuurregels : [];
          for (const regel of regels) {
            if (String((regel as any)?.eenheid ?? "").trim() === String(effectiefProductId)) {
              return true;
            }
          }
        }
        return false;
      };

      const activeVersion = versieId ? berekeningenById.get(versieId) : undefined;
      const activeFinalized = String((activeVersion as any)?.finalized_at ?? "");
      const activeUpdated = String((activeVersion as any)?.updated_at ?? "");

      const candidates = currentBerekeningen
        .filter((record) => isVersionForYearAndBier(record))
        .filter((record) => String((record as any)?.id ?? "") !== versieId)
        .filter((record) => affectsProduct(record));

      const definitiveCandidates: ActiveCostCandidateOption[] = candidates
        .filter((record) => String((record as any)?.status ?? "").toLowerCase() === "definitief")
        .filter((record) => {
          const finalized = String((record as any)?.finalized_at ?? "");
          const updated = String((record as any)?.updated_at ?? "");
          return finalized > activeFinalized || updated > activeUpdated;
        })
        .map((record) => {
          const costLinesRaw = (record as any)?.cost_lines ?? (record as any)?.costLines ?? [];
          const rows = Array.isArray(costLinesRaw) ? (costLinesRaw as GenericRecord[]) : [];
          const match = rows.find((item) => {
            const rowProductId = String((item as any)?.product_id ?? "").trim();
            const rowSkuId = String((item as any)?.sku_id ?? "").trim();
            return Boolean(
              (effectiefProductId && rowProductId === effectiefProductId) ||
                (skuId && rowSkuId === skuId)
            );
          });
          const cost = match ? getSnapshotProductCost(match) : null;
          const deltaEuro = currentCost !== null && cost !== null ? cost - currentCost : null;
          const deltaPct =
            currentCost !== null && cost !== null && currentCost > 0 ? ((deltaEuro as number) / currentCost) * 100 : null;
          const versionId = String((record as any)?.id ?? "");
          const updated = String((record as any)?.updated_at ?? "");
          const finalized = String((record as any)?.finalized_at ?? "");
          const versieNummer = Number((record as any)?.versie_nummer ?? 0) || 0;
          const sortKey = `${finalized || updated}|${updated}|${String(versieNummer).padStart(6, "0")}|${versionId}`;
          return {
            id: versionId,
            label: buildVersionLabel(record),
            cost,
            deltaEuro,
            deltaPct,
            sortKey,
          };
        })
        .filter((option) => option.id)
        .sort((a, b) => b.sortKey.localeCompare(a.sortKey));

      const recommended = definitiveCandidates[0];
      const recommendedVersionId = recommended?.id ?? "";
      const deltaEuro = recommended?.deltaEuro ?? null;
      const deltaPct = recommended?.deltaPct ?? null;

      const hasUpdate = Boolean(recommendedVersionId) && recommendedVersionId !== versieId;
      const isWarning = hasUpdate && deltaPct !== null && deltaPct >= warningThresholdPct;

      const rowKeyBase = skuId || `${bierId}|${productId}`;
      const componentGroupLabels =
        skuKind === "article" && !bierId && skuArticleId
          ? Array.from(componentGroupLabelsByArticleId.get(skuArticleId) ?? [])
          : [];
      const groupLabels =
        categoryGroupLabel
          ? [categoryGroupLabel]
          : componentGroupLabels.length
            ? componentGroupLabels
            : [isGiftset ? "Geschenkverpakkingen" : bierNaam];
      return {
        key: rowKeyBase ? rowKeyBase : `row-${index}`,
        skuId,
        productId: effectiefProductId,
        artikelNaam: productNaam || bierNaam,
        bierNaam,
        groupLabel: groupLabels[0] || bierNaam,
        groupLabels,
        categorie,
        productNaam,
        productType,
        effectiefVanaf,
        versieId,
        versieLabel,
        sourceLabel,
        supplierLabel,
        versieTimestamp,
        currentCost,
        recommendedVersionId,
        definitiveOptions: definitiveCandidates,
        hasUpdate,
        isWarning,
        deltaEuro,
        deltaPct,
      };
    });

  for (const [skuId, skuRow] of skuById.entries()) {
    const skuKind = String((skuRow as any)?.kind ?? "").trim().toLowerCase();
    if (skuKind !== "article") continue;
    if ((skuRow as any)?.active === false || (skuRow as any)?.actief === false) continue;
    const skuArticleId = String((skuRow as any)?.article_id ?? "").trim();
    if (!skuArticleId) continue;
    const skuArticle = articleById.get(skuArticleId) ?? null;
    if (!skuArticle) continue;
    if ((skuArticle as any)?.active === false || (skuArticle as any)?.actief === false) continue;
    if (!(skuArticle as any)?.beschikbaar_voor_offertes) continue;
    const currentCost = packagingPriceByArticleId.get(skuArticleId);
    if (currentCost === undefined) continue;
    if (rawRows.some((row) => row.skuId === skuId)) continue;
    const productGroup = String(
      (skuRow as any)?.product_group ?? (skuArticle as any)?.product_group ?? ""
    ).trim().toLowerCase();
    const sellableSubtype = String(
      (skuRow as any)?.sellable_subtype ?? (skuArticle as any)?.sellable_subtype ?? ""
    ).trim().toLowerCase();
    const groupLabel = nonBeerGroupLabel(productGroup, sellableSubtype) || "Merchandise";
    const label = cleanRepeatedName(
      String((skuRow as any)?.name ?? "") ||
        String((skuArticle as any)?.name ?? "") ||
        String((skuArticle as any)?.naam ?? "") ||
        skuId
    );
    rawRows.push({
      key: skuId,
      skuId,
      productId: skuArticleId,
      artikelNaam: label,
      bierNaam: groupLabel,
      groupLabel,
      groupLabels: [groupLabel],
      categorie: groupLabel,
      productNaam: label,
      productType: "article",
      effectiefVanaf: `${selectedYear}-01-01`,
      versieId: "",
      versieLabel: "Jaarprijs",
      sourceLabel: "Verpakkingsonderdeel",
      supplierLabel: "",
      versieTimestamp: 0,
      currentCost,
      recommendedVersionId: "",
      definitiveOptions: [],
      hasUpdate: false,
      isWarning: false,
      deltaEuro: null,
      deltaPct: null,
    });
  }

  function composedCostForArticle(articleId: string, visited: Set<string>): number | null {
    const currentArticleId = String(articleId || "").trim();
    if (!currentArticleId || visited.has(currentArticleId)) return null;
    visited.add(currentArticleId);
    let total = 0;
    let hasAnyCost = false;
    for (const line of bomLinesByParentArticle.get(currentArticleId) || []) {
      const qty = Math.max(0, Number((line as any)?.quantity ?? 0) || 0);
      if (qty <= 0) continue;
      const componentSkuId = String((line as any)?.component_sku_id ?? "").trim();
      if (componentSkuId) {
        const componentRow = rawRows.find((row) => row.skuId === componentSkuId && typeof row.currentCost === "number");
        if (componentRow && typeof componentRow.currentCost === "number") {
          total += qty * componentRow.currentCost;
          hasAnyCost = true;
        }
        continue;
      }
      const componentArticleId = String((line as any)?.component_article_id ?? "").trim();
      if (!componentArticleId) continue;
      const directPrice = packagingPriceByArticleId.get(componentArticleId);
      if (typeof directPrice === "number") {
        total += qty * directPrice;
        hasAnyCost = true;
        continue;
      }
      const nested = composedCostForArticle(componentArticleId, new Set(visited));
      if (nested !== null) {
        total += qty * nested;
        hasAnyCost = true;
      }
    }
    return hasAnyCost ? total : null;
  }

  for (const [skuId, skuRow] of skuById.entries()) {
    const skuKind = String((skuRow as any)?.kind ?? "").trim().toLowerCase();
    if (skuKind !== "article") continue;
    if (rawRows.some((row) => row.skuId === skuId)) continue;
    if ((skuRow as any)?.active === false || (skuRow as any)?.actief === false) continue;
    const skuArticleId = String((skuRow as any)?.article_id ?? "").trim();
    if (!skuArticleId || !bomLinesByParentArticle.has(skuArticleId)) continue;
    const skuArticle = articleById.get(skuArticleId) ?? null;
    if (!skuArticle) continue;
    if ((skuArticle as any)?.active === false || (skuArticle as any)?.actief === false) continue;
    const currentCost = composedCostForArticle(skuArticleId, new Set());
    if (currentCost === null) continue;
    const productGroup = String(
      (skuRow as any)?.product_group ?? (skuArticle as any)?.product_group ?? ""
    ).trim().toLowerCase();
    const sellableSubtype = String(
      (skuRow as any)?.sellable_subtype ?? (skuArticle as any)?.sellable_subtype ?? ""
    ).trim().toLowerCase();
    const categoryGroupLabel = nonBeerGroupLabel(productGroup, sellableSubtype);
    const componentGroupLabels = Array.from(componentGroupLabelsByArticleId.get(skuArticleId) ?? []);
    const groupLabels = Array.from(new Set([categoryGroupLabel, ...componentGroupLabels].filter(Boolean)));
    if (groupLabels.length === 0) continue;
    const label = cleanRepeatedName(
      String((skuRow as any)?.name ?? "") ||
        String((skuArticle as any)?.name ?? "") ||
        String((skuArticle as any)?.naam ?? "") ||
        skuId
    );
    rawRows.push({
      key: skuId,
      skuId,
      productId: skuArticleId,
      artikelNaam: label,
      bierNaam: groupLabels[0],
      groupLabel: groupLabels[0],
      groupLabels,
      categorie: categoryGroupLabel || "Samenstelling",
      productNaam: label,
      productType: "article",
      effectiefVanaf: `${selectedYear}-01-01`,
      versieId: "",
      versieLabel: "Samenstelling",
      sourceLabel: "Componenten",
      supplierLabel: "",
      versieTimestamp: 0,
      currentCost,
      recommendedVersionId: "",
      definitiveOptions: [],
      hasUpdate: false,
      isWarning: false,
      deltaEuro: null,
      deltaPct: null,
    });
  }

  const rows: ActiveCostRow[] = rawRows.flatMap((row) => {
    const labels = (row.groupLabels && row.groupLabels.length ? row.groupLabels : [row.groupLabel]).filter(Boolean);
    return labels.map((label) => {
      const { groupLabels: _groupLabels, ...rest } = row;
      return {
        ...rest,
        key: `${rest.key}|${label}`,
        groupLabel: label,
      };
    });
  });

  const filtered = !q
    ? rows
    : rows.filter((row) => {
        const hay = `${row.artikelNaam} ${row.categorie} ${row.versieLabel} ${row.sourceLabel} ${row.supplierLabel}`.toLowerCase();
        return hay.includes(q);
      });

  const direction = activeSort.direction === "asc" ? 1 : -1;
  const key = activeSort.key;
  return [...filtered].sort((a, b) => {
    if (key === "artikel") {
      const delta = a.artikelNaam.localeCompare(b.artikelNaam) * direction;
      if (delta !== 0) return delta;
    } else if (key === "categorie") {
      const delta = (a.categorie || "").localeCompare(b.categorie || "") * direction;
      if (delta !== 0) return delta;
    } else if (key === "since") {
      const av = parseSortTimestamp(a.effectiefVanaf || "");
      const bv = parseSortTimestamp(b.effectiefVanaf || "");
      const delta = (av - bv) * direction;
      if (delta !== 0) return delta;
    } else if (key === "kostprijs") {
      const av = typeof a.currentCost === "number" && Number.isFinite(a.currentCost) ? a.currentCost : -Infinity;
      const bv = typeof b.currentCost === "number" && Number.isFinite(b.currentCost) ? b.currentCost : -Infinity;
      const delta = (av - bv) * direction;
      if (delta !== 0) return delta;
    } else {
      const delta = (a.versieTimestamp - b.versieTimestamp) * direction;
      if (delta !== 0) return delta;
    }

    return (a.artikelNaam + a.versieLabel).localeCompare(b.artikelNaam + b.versieLabel);
  });
}
