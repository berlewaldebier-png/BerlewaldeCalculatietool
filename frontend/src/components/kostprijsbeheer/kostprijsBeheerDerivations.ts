import {
  buildVersionLabel,
  getSnapshotProductCost,
  parseSortTimestamp,
} from "@/components/kostprijsbeheer/kostprijsBeheerUtils";

export type GenericRecord = Record<string, unknown>;

export type ExistingBerekeningRow = {
  id: string;
  bierNaam: string;
  jaar: number | null;
  status: string;
  type: string;
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
  artikelNaam: string;
  categorie: string;
  productNaam: string;
  productType: string;
  effectiefVanaf: string;
  versieId: string;
  versieLabel: string;
  versieTimestamp: number;
  currentCost: number | null;
  recommendedVersionId: string;
  definitiveOptions: ActiveCostCandidateOption[];
  hasUpdate: boolean;
  isWarning: boolean;
  deltaEuro: number | null;
  deltaPct: number | null;
};

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
      const kostprijsPerLiter = Number((row as any)?.kostprijs ?? Number.NaN);
      const ts = String((row as any)?.finalized_at ?? (row as any)?.updated_at ?? (row as any)?.created_at ?? "");
      const label = buildVersionLabel(row);
      const hay = `${bierNaam} ${jaar} ${status} ${type} ${label}`.toLowerCase();
      return {
        id,
        bierNaam: bierNaam || "-",
        jaar: jaar || null,
        status,
        type,
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
  samengesteldById: Map<string, string>;
  berekeningenById: Map<string, GenericRecord>;
  currentBerekeningen: GenericRecord[];
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
    samengesteldById,
    berekeningenById,
    currentBerekeningen,
  } = args;
  const q = search.trim().toLowerCase();
  const warningThresholdPct = 10;

  const rows: ActiveCostRow[] = (Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [])
    .filter((row) => Number((row as any)?.jaar ?? 0) === selectedYear)
    .map((row, index) => {
      const skuId = String((row as any)?.sku_id ?? "");
      const bierId = String((row as any)?.bier_id ?? "");
      const productId = String((row as any)?.product_id ?? "");
      const productType = String((row as any)?.product_type ?? "");
      const versieId = String((row as any)?.kostprijsversie_id ?? "");
      const effectiefVanaf = String((row as any)?.effectief_vanaf ?? "");

      const bierNaam = bierenById.get(bierId) ?? bierId ?? "-";
      const skuRow = skuId ? skuById.get(skuId) ?? null : null;
      const skuKind = String((skuRow as any)?.kind ?? "").toLowerCase();
      const skuArticleId =
        skuKind === "beer_format"
          ? String((skuRow as any)?.format_article_id ?? "")
          : String((skuRow as any)?.article_id ?? "");
      const skuArticle = skuArticleId ? articleById.get(skuArticleId) ?? null : null;
      const skuLabel =
        String((skuRow as any)?.name ?? "") ||
        String((skuArticle as any)?.name ?? "") ||
        String((skuRow as any)?.naam ?? "") ||
        String((skuArticle as any)?.naam ?? "");

      const productNaamFromLegacy = (basisById.get(productId) ?? samengesteldById.get(productId) ?? "") as string;
      const productNaam = productNaamFromLegacy || skuLabel || productId || (skuId ? skuId : "-");

      const effectiefProductId = (productId || skuArticleId || "").trim();

      const versie = versieId ? berekeningenById.get(versieId) : undefined;

      const versieLabel = buildVersionLabel(versieId ? versie : undefined);
      const versieTimestamp = parseSortTimestamp(
        (versie as any)?.finalized_at ?? (versie as any)?.updated_at ?? effectiefVanaf
      );

      const costLinesRaw = (versie as any)?.cost_lines ?? (versie as any)?.costLines ?? [];
      const snapshotRows = Array.isArray(costLinesRaw) ? (costLinesRaw as GenericRecord[]) : [];
      const matchingSnapshotRow =
        effectiefProductId ? snapshotRows.find((item) => String((item as any)?.product_id ?? "").trim() === effectiefProductId) : undefined;
      const versionType = String((versie as any)?.type ?? "").toLowerCase();
      const currentCost =
        matchingSnapshotRow && effectiefProductId
          ? getSnapshotProductCost(matchingSnapshotRow)
          : skuId && !productId && (versionType === "bundle" || versionType === "article")
            ? Number((versie as any)?.kostprijs ?? Number.NaN)
            : null;

      const categorie =
        String((versie as any)?.basisgegevens?.stijl ?? (versie as any)?.bier_snapshot?.stijl ?? "").trim() ||
        String((versie as any)?.basisgegevens?.categorie ?? "").trim() ||
        (skuKind === "beer_format" ? String((versie as any)?.basisgegevens?.stijl ?? "").trim() : "");

      const isVersionForYearAndBier = (record: GenericRecord) => {
        const recordYear = Number((record as any)?.jaar ?? (record as any)?.basisgegevens?.jaar ?? 0) || 0;
        if (recordYear !== selectedYear) return false;
        return String((record as any)?.bier_id ?? "") === bierId;
      };

      const affectsProduct = (record: GenericRecord) => {
        if (!effectiefProductId) return false;
        const statusValue = String((record as any)?.status ?? "").toLowerCase();

        // Definitive versions must have a snapshot containing this product_id.
        if (statusValue === "definitief") {
          const costLines = (record as any)?.cost_lines ?? (record as any)?.costLines ?? [];
          const rows = Array.isArray(costLines) ? (costLines as GenericRecord[]) : [];
          return rows.some((item) => String((item as any)?.product_id ?? "").trim() === effectiefProductId);
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
          const match = effectiefProductId
            ? rows.find((item) => String((item as any)?.product_id ?? "").trim() === effectiefProductId)
            : undefined;
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
      return {
        key: rowKeyBase ? rowKeyBase : `row-${index}`,
        skuId,
        artikelNaam: productNaam || bierNaam,
        categorie,
        productNaam,
        productType,
        effectiefVanaf,
        versieId,
        versieLabel,
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

  const filtered = !q
    ? rows
    : rows.filter((row) => {
        const hay = `${row.artikelNaam} ${row.categorie} ${row.versieLabel}`.toLowerCase();
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
