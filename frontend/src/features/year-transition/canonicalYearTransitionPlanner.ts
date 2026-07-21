import {
  calculateComponentCostprice,
  calculateDerivedChildCostprice,
  calculateDirectSkuCostprice,
  createCostpriceParts,
  type CostpriceParts,
} from "@/lib/costpriceCalculationEngine";
import { selectPlanningCostCandidate } from "@/features/commercial-context/activeCommercialContextPlanning";
import type { GenericRecord } from "@/features/commercial-context/activeCommercialContextTypes";
import {
  number,
  record,
  round,
  text,
} from "@/features/commercial-context/activeCommercialContextUtils";
import { buildPlanForecastContract } from "@/features/year-transition/planForecastContract";
import type {
  CanonicalYearTransitionInput,
  CanonicalYearTransitionPlan,
  CanonicalYearTransitionReader,
  MutableTransitionEntry,
  YearTransitionBlocker,
  YearTransitionClassification,
} from "@/features/year-transition/canonicalYearTransitionTypes";

export type {
  CanonicalTransitionEntry,
  CanonicalYearTransitionInput,
  CanonicalYearTransitionPlan,
  CanonicalYearTransitionReader,
  FrozenPlanAllocation,
  FrozenPlanDraft,
  FrozenPlanValues,
  PlanForecastContract,
  YearTransitionBlocker,
  YearTransitionBlockerCode,
  YearTransitionClassification,
} from "@/features/year-transition/canonicalYearTransitionTypes";

type MutableEntry = MutableTransitionEntry;

export function planCanonicalYearTransition(
  input: CanonicalYearTransitionInput
): CanonicalYearTransitionPlan {
  const snapshot = clone(input);
  const globalBlockers: YearTransitionBlocker[] = [];
  if (
    !Number.isInteger(snapshot.sourceYear) ||
    !Number.isInteger(snapshot.targetYear) ||
    snapshot.sourceYear <= 0 ||
    snapshot.targetYear <= snapshot.sourceYear
  ) {
    globalBlockers.push({ code: "invalid_year_transition" });
  }

  const skusById = indexUnique(snapshot.skus, "id");
  const articlesById = indexUnique(snapshot.articles, "id");
  const versionsById = indexUnique(snapshot.costVersions, "id");
  const requiredChannels = uniqueSorted(snapshot.requiredChannels.map((value) => text(value).toLowerCase()));
  const sourceSkuIds = uniqueSorted(
    snapshot.activations
      .filter((row) => number(row.jaar) === snapshot.sourceYear)
      .map((row) => text(row.sku_id))
  );
  const targetInputsBySku = groupBy(
    snapshot.targetYearInputs,
    (row) => text(row.sku_id)
  );
  const entries: MutableEntry[] = [];
  const targetInputBySku = new Map<string, GenericRecord>();
  const sourceSkuIdSet = new Set(sourceSkuIds);

  for (const [skuId, rows] of targetInputsBySku) {
    if (!skuId) continue;
    if (!sourceSkuIdSet.has(skuId)) {
      globalBlockers.push({
        code: "extra_target_input",
        skuId,
        sourceIds: rows.map((row) => text(row.id)).filter(Boolean).sort(),
      });
      continue;
    }
    if (rows.length === 1) targetInputBySku.set(skuId, rows[0]);
  }

  for (const skuId of sourceSkuIds) {
    const sku = skusById.get(skuId);
    if (!sku) {
      globalBlockers.push({ code: "unknown_source_sku", skuId });
      continue;
    }
    const formatArticleId = text(sku.format_article_id || sku.article_id);
    const article = articlesById.get(formatArticleId) ?? {};
    const classification = classifySku(sku, article, snapshot.bomLines);
    const pricingMethod = classification === "service" ? "manual_rate" : "cost_plus";
    const planningCost = selectPlanningCostCandidate({
      skuId,
      year: snapshot.sourceYear,
      pricingMethod,
      productId: formatArticleId,
      activations: snapshot.activations,
      activationEvents: snapshot.activationEvents ?? [],
      versionsById,
      packagingComponentPrices: snapshot.packagingComponentPrices ?? [],
    });
    const sourceVersion = versionsById.get(planningCost.costVersionId) ?? {};
    const sourceComponents = planningCost.components
      ? toCostpriceParts(planningCost.components)
      : null;
    const entry: MutableEntry = {
      skuId,
      beerId: text(sku.beer_id || sku.bier_id),
      subjectId: text(sku.beer_id || sku.bier_id || sku.article_id || sku.id),
      formatArticleId,
      skuKind: text(sku.kind),
      classification,
      bomFingerprint: fingerprintBom(formatArticleId, snapshot.bomLines),
      externalMappingFingerprint: fingerprintMappings(skuId, snapshot.externalMappings ?? []),
      source: {
        year: snapshot.sourceYear,
        costVersionId: planningCost.costVersionId,
        costRowId: planningCost.costRowId,
        costMethod: text(sourceVersion.type || sourceVersion.cost_method || sourceVersion.cost_source),
        components: sourceComponents,
      },
      target: {
        year: snapshot.targetYear,
        calculationMode: "",
        components: null,
        litersPerUnit: 0,
        readyChannels: [],
        readiness: "blocked",
      },
      provenance: {
        kind: "recalculated_from_year",
        sourceYear: snapshot.sourceYear,
        sourceCostVersionId: planningCost.costVersionId,
        sourceCostRowId: planningCost.costRowId,
      },
      changedFields: [],
      blockers: [],
    };
    if (planningCost.status !== "resolved" && planningCost.status !== "not_required") {
      entry.blockers.push({
        code: "source_cost_unresolved",
        skuId,
        sourceIds: [planningCost.sourceId, ...planningCost.warnings].filter(Boolean),
      });
    }
    const targetInputs = targetInputsBySku.get(skuId) ?? [];
    if (targetInputs.length === 0) {
      entry.blockers.push({ code: "target_input_missing", skuId });
    } else if (targetInputs.length > 1) {
      entry.blockers.push({
        code: "duplicate_target_input",
        skuId,
        sourceIds: targetInputs.map((row) => text(row.id)).filter(Boolean).sort(),
      });
    }
    entries.push(entry);
  }

  const entryBySku = new Map(entries.map((entry) => [entry.skuId, entry]));
  const unresolved = new Set(entries.map((entry) => entry.skuId));
  let progressed = true;
  while (unresolved.size > 0 && progressed) {
    progressed = false;
    for (const skuId of [...unresolved].sort()) {
      const entry = entryBySku.get(skuId)!;
      const targetInput = targetInputBySku.get(skuId);
      if (!targetInput) {
        unresolved.delete(skuId);
        continue;
      }
      const declaredProductId = text(targetInput.product_id || targetInput.format_article_id);
      if (declaredProductId && declaredProductId !== entry.formatArticleId) {
        entry.blockers.push({
          code: "target_input_identity_mismatch",
          skuId,
          sourceIds: [text(targetInput.id)].filter(Boolean),
        });
      }
      const mode = text(targetInput.calculation_mode || targetInput.mode).toLowerCase();
      entry.target.calculationMode = mode;
      entry.target.litersPerUnit = round(number(targetInput.liters_per_unit || targetInput.liters));
      entry.target.readyChannels = uniqueSorted(
        array(targetInput.ready_channels || targetInput.sell_in_ready_channels).map((value) =>
          text(value).toLowerCase()
        )
      );

      if (mode === "not_required") {
        entry.target.readiness = "not_required";
        entry.target.components = null;
        unresolved.delete(skuId);
        progressed = true;
        continue;
      }
      if (mode === "direct") {
        const result = calculateDirectSkuCostprice({
          primaryCost: number(targetInput.primary_cost_ex || targetInput.primaire_kosten),
          packagingCost: number(targetInput.packaging_cost_ex || targetInput.verpakkingskosten),
          overheadCost: number(targetInput.overhead_cost_ex || targetInput.vaste_kosten),
          exciseCost: number(targetInput.excise_cost_ex || targetInput.accijns),
          liters: entry.target.litersPerUnit,
          sourceLabel: "approved_target_year_input",
        });
        entry.target.components = createCostpriceParts(result);
        unresolved.delete(skuId);
        progressed = true;
        continue;
      }
      if (mode === "derived") {
        const parentSkuId = text(targetInput.parent_sku_id);
        const parent = entryBySku.get(parentSkuId);
        if (!parent) {
          entry.blockers.push({ code: "derived_parent_missing", skuId, sourceIds: [parentSkuId].filter(Boolean) });
          unresolved.delete(skuId);
          progressed = true;
          continue;
        }
        if (unresolved.has(parentSkuId)) continue;
        if (!parent.target.components) {
          entry.blockers.push({ code: "derived_parent_unresolved", skuId, sourceIds: [parentSkuId] });
          unresolved.delete(skuId);
          progressed = true;
          continue;
        }
        const result = calculateDerivedChildCostprice({
          parent: parent.target.components,
          factor: number(targetInput.parent_factor || targetInput.factor),
          extraPackagingCost: number(targetInput.extra_packaging_cost_ex || targetInput.extra_packaging_cost),
          parentLabel: parentSkuId,
        });
        entry.target.components = createCostpriceParts(result);
        if (result.status !== "ok") {
          entry.blockers.push({ code: "derived_parent_unresolved", skuId, sourceIds: [parentSkuId] });
        }
        unresolved.delete(skuId);
        progressed = true;
        continue;
      }
      if (mode === "composed") {
        const relevantLines = snapshot.bomLines.filter(
          (row) => text(row.parent_article_id) === entry.formatArticleId
        );
        if (relevantLines.length === 0) {
          entry.blockers.push({ code: "composed_bom_missing", skuId });
          unresolved.delete(skuId);
          progressed = true;
          continue;
        }
        const componentSkuIds = uniqueSorted(relevantLines.map((row) => text(row.component_sku_id)));
        if (componentSkuIds.some((componentSkuId) => unresolved.has(componentSkuId))) continue;
        const summaryRows = entries
          .filter((candidate) => candidate.target.components)
          .map((candidate) => ({
            sku_id: candidate.skuId,
            product_id: candidate.formatArticleId,
            product_type: candidate.classification === "composed" ? "article" : candidate.classification,
            ...candidate.target.components,
          }));
        const result = calculateComponentCostprice({
          parentArticleId: entry.formatArticleId,
          bomLines: snapshot.bomLines,
          skus: snapshot.skus,
          articles: snapshot.articles,
          summaryRows,
          packagingComponentPrices: snapshot.packagingComponentPrices ?? [],
          year: snapshot.targetYear,
        });
        entry.target.components = createCostpriceParts(result);
        if (!result.valid) {
          entry.blockers.push({
            code: "composed_cost_unresolved",
            skuId,
            sourceIds: result.issues
              .flatMap((issue) => [issue.component_sku_id, issue.component_article_id])
              .filter((value): value is string => Boolean(value)),
          });
        }
        unresolved.delete(skuId);
        progressed = true;
        continue;
      }
      entry.blockers.push({
        code: "target_calculation_mode_unknown",
        skuId,
        sourceIds: [text(targetInput.id)].filter(Boolean),
        detail: "unknown_calculation_mode",
      });
      unresolved.delete(skuId);
      progressed = true;
    }
  }

  for (const skuId of [...unresolved].sort()) {
    const entry = entryBySku.get(skuId)!;
    entry.blockers.push({ code: "derived_parent_unresolved", skuId });
  }

  for (const entry of entries) {
    validateTargetReadiness(entry, requiredChannels);
    entry.changedFields = changedFields(entry);
    entry.blockers = canonicalBlockers(entry.blockers);
  }

  const planForecast = buildPlanForecastContract(snapshot.frozenPlan);
  const historicalRepresentations = (snapshot.historicalDossiers ?? [])
    .map((row) => ({
      versionId: text(row.versionId),
      originalSnapshot: clone(row.originalSnapshot),
      normalizedRows: clone(row.normalizedRows),
      differs: canonicalJson(row.originalSnapshot) !== canonicalJson(row.normalizedRows),
    }))
    .sort((left, right) => left.versionId.localeCompare(right.versionId));
  const shadowComparison = buildShadowComparison(entries, snapshot.currentUiDerivedRows ?? []);
  const blockers = canonicalBlockers([
    ...globalBlockers,
    ...entries.flatMap((entry) => entry.blockers),
    ...planForecast.plan.blockers,
  ]);
  const canonicalEntries = entries
    .sort((left, right) => left.skuId.localeCompare(right.skuId))
    .map((entry) => ({
      ...clone(entry),
      source: {
        ...clone(entry.source),
        components: entry.source.components
          ? normalizeCostpriceParts(entry.source.components)
          : null,
      },
      target: {
        ...clone(entry.target),
        components: entry.target.components
          ? normalizeCostpriceParts(entry.target.components)
          : null,
      },
    }));

  return {
    plannerVersion: "rf-011c-v1",
    sourceYear: snapshot.sourceYear,
    targetYear: snapshot.targetYear,
    entries: canonicalEntries,
    planForecast,
    historicalRepresentations,
    shadowComparison,
    blockers,
    readyForCandidateWrite: blockers.length === 0,
  };
}

export async function readCanonicalYearTransitionPlan(
  sourceYear: number,
  targetYear: number,
  reader: CanonicalYearTransitionReader
): Promise<CanonicalYearTransitionPlan> {
  const snapshot = await reader.readSnapshot(sourceYear, targetYear);
  return planCanonicalYearTransition({ sourceYear, targetYear, ...snapshot });
}

function validateTargetReadiness(entry: MutableEntry, requiredChannels: string[]) {
  if (entry.target.readiness === "not_required") return;
  const cost = entry.target.components?.kostprijs ?? 0;
  if (cost <= 0) entry.blockers.push({ code: "target_cost_non_positive", skuId: entry.skuId });
  if (entry.target.litersPerUnit <= 0 && entry.classification !== "article" && entry.classification !== "service") {
    entry.blockers.push({ code: "target_liters_missing", skuId: entry.skuId });
  }
  const ready = new Set(entry.target.readyChannels);
  const missingChannels = requiredChannels.filter((channel) => !ready.has(channel));
  if (missingChannels.length > 0) {
    entry.blockers.push({ code: "target_channel_missing", skuId: entry.skuId, sourceIds: missingChannels });
  }
  entry.target.readiness = entry.blockers.length === 0 ? "ready" : "blocked";
}

function changedFields(entry: MutableEntry): string[] {
  const fields: string[] = [];
  if (entry.source.year !== entry.target.year) fields.push("year");
  if (entry.source.costMethod) fields.push("provenance");
  const source = entry.source.components;
  const target = entry.target.components;
  if (source && target) {
    if (!sameMoney(source.primaire_kosten, target.primaire_kosten)) fields.push("components.primary");
    if (!sameMoney(source.verpakkingskosten, target.verpakkingskosten)) fields.push("components.packaging");
    if (!sameMoney(source.vaste_kosten, target.vaste_kosten)) fields.push("components.overhead");
    if (!sameMoney(source.accijns, target.accijns)) fields.push("components.excise");
    if (!sameMoney(source.kostprijs, target.kostprijs)) fields.push("components.costPrice");
  } else if (source !== target) {
    fields.push("components");
  }
  return uniqueSorted(fields);
}

function buildShadowComparison(entries: MutableEntry[], currentRows: GenericRecord[]) {
  const ids = currentRows.map((row) => text(row.sku_id || row.skuId)).filter(Boolean);
  const duplicateUiSkuIds = duplicateValues(ids);
  const currentBySku = new Map<string, GenericRecord>();
  for (const row of currentRows) {
    const skuId = text(row.sku_id || row.skuId);
    if (skuId && !currentBySku.has(skuId)) currentBySku.set(skuId, row);
  }
  const canonicalIds = entries.map((entry) => entry.skuId).sort();
  const currentIds = [...currentBySku.keys()].sort();
  const missingCurrentSkuIds = canonicalIds.filter((skuId) => !currentBySku.has(skuId));
  const canonicalSet = new Set(canonicalIds);
  const extraCurrentSkuIds = currentIds.filter((skuId) => !canonicalSet.has(skuId));
  const differingSkuIds = entries
    .filter((entry) => {
      const current = currentBySku.get(entry.skuId);
      if (!current) return false;
      const currentCost = number(current.target_cost ?? current.kostprijs ?? current.cost_price_ex);
      const targetCost = entry.target.components?.kostprijs ?? 0;
      const currentProductId = text(current.product_id || current.productId);
      const currentType = text(current.product_type || current.classification);
      return (
        !sameMoney(currentCost, targetCost) ||
        (currentProductId && currentProductId !== entry.formatArticleId) ||
        (currentType && currentType !== entry.classification)
      );
    })
    .map((entry) => entry.skuId)
    .sort();
  return {
    currentRows: currentRows.length,
    duplicateUiSkuIds,
    missingCurrentSkuIds,
    extraCurrentSkuIds,
    differingSkuIds,
  };
}

function classifySku(sku: GenericRecord, article: GenericRecord, bomLines: GenericRecord[]): YearTransitionClassification {
  const kind = text(sku.kind).toLowerCase();
  const payload = record(sku.payload);
  if (kind === "service" || text(article.kind).toLowerCase() === "service") return "service";
  if (text(sku.parent_sku_id || payload.parent_sku_id || payload.variant_of_sku_id)) return "variant";
  const productId = text(sku.format_article_id || sku.article_id);
  const hasBom = bomLines.some((row) => text(row.parent_article_id) === productId);
  if (hasBom) return "composed";
  if (kind === "article") return "article";
  if (kind === "beer_format") return "basis";
  return "unknown";
}

function fingerprintBom(productId: string, bomLines: GenericRecord[]): string {
  const rows = bomLines
    .filter((row) => text(row.parent_article_id) === productId)
    .map((row) => ({
      componentSkuId: text(row.component_sku_id),
      componentArticleId: text(row.component_article_id),
      quantity: round(number(row.quantity ?? row.qty ?? row.aantal)),
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return `bom-v1:${canonicalJson(rows)}`;
}

function fingerprintMappings(skuId: string, mappings: GenericRecord[]): string {
  const rows = mappings
    .filter(
      (row) =>
        text(row.sku_id || row.internal_sku_id || row.calculatietool_sku_id) === skuId
    )
    .map((row) => ({
      id: text(row.id),
      externalId: text(row.external_id || row.douano_product_id || row.product_id),
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return `mapping-v1:${canonicalJson(rows)}`;
}

function toCostpriceParts(components: {
  purchaseEx: number;
  packagingEx: number;
  indirectEx: number;
  exciseEx: number;
  costPriceEx: number;
}): CostpriceParts {
  return {
    primaire_kosten: round(components.purchaseEx),
    verpakkingskosten: round(components.packagingEx),
    vaste_kosten: round(components.indirectEx),
    accijns: round(components.exciseEx),
    kostprijs: round(components.costPriceEx),
  };
}

function normalizeCostpriceParts(parts: CostpriceParts): CostpriceParts {
  const normalized = createCostpriceParts({
    primaire_kosten: round(parts.primaire_kosten),
    verpakkingskosten: round(parts.verpakkingskosten),
    vaste_kosten: round(parts.vaste_kosten),
    accijns: round(parts.accijns),
  });
  return { ...normalized, kostprijs: round(parts.kostprijs) };
}

function canonicalBlockers(rows: YearTransitionBlocker[]): YearTransitionBlocker[] {
  const byKey = new Map<string, YearTransitionBlocker>();
  for (const row of rows) {
    const normalized = {
      ...row,
      sourceIds: row.sourceIds ? uniqueSorted(row.sourceIds) : undefined,
    };
    const key = canonicalJson(normalized);
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return [...byKey.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function indexUnique(rows: GenericRecord[], field: string): Map<string, GenericRecord> {
  const out = new Map<string, GenericRecord>();
  for (const row of rows) {
    const key = text(row[field]);
    if (key && !out.has(key)) out.set(key, row);
  }
  return out;
}

function groupBy(rows: GenericRecord[], key: (row: GenericRecord) => string): Map<string, GenericRecord[]> {
  const out = new Map<string, GenericRecord[]>();
  for (const row of rows) {
    const value = key(row);
    out.set(value, [...(out.get(value) ?? []), row]);
  }
  return out;
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function sameMoney(left: number, right: number): boolean {
  return Math.abs(round(left) - round(right)) <= 0.000001;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
