import { createHash } from "node:crypto";

export type ManifestClassification =
  | "basis"
  | "composed"
  | "variant"
  | "article"
  | "service"
  | "unknown";

export type YearTransitionManifestRow = {
  skuId: string;
  beerId: string;
  productId: string;
  kind: string;
  classification: ManifestClassification;
  bomFingerprint: string;
  externalMappingFingerprint: string;
  labelFingerprint: string;
  planningCostVersionId: string;
  planningCostRowId: string;
  sourcePlanningCostVersionId?: string;
  sourceSkuIds?: string[];
  componentFingerprint: string;
  activated: boolean;
  costPositive: boolean;
  litersPositive: boolean;
  sellInReadyChannels: string[];
  provenance: {
    kind: string;
    sourceYear: number | null;
  };
};

export type FormatExpectation = {
  beerId: string;
  formatCode: string;
  skuId: string | null;
};

export type HistoricalDossierRow = {
  versionId: string;
  skuId: string;
  originalCategory: "basis" | "composed" | "none" | "ambiguous";
  normalizedCategory: "basis" | "composed" | "none" | "ambiguous";
  originalFingerprint: string;
  normalizedFingerprint: string;
};

export type YearTransitionParityInput = {
  sourceYear: number;
  targetYear: number;
  requiredChannels: string[];
  sourceRows: YearTransitionManifestRow[];
  targetRows: YearTransitionManifestRow[];
  currentUiProjection: Array<{ skuId: string; groupKey: string }>;
  formatExpectations: FormatExpectation[];
  historicalDossiers: HistoricalDossierRow[];
};

type ReadinessState =
  | "ready"
  | "not_applicable"
  | "not_activated"
  | "cost_row_missing"
  | "cost_non_positive"
  | "liters_missing"
  | "sell_in_missing";

export type YearTransitionParityReport = {
  sourceYear: number;
  targetYear: number;
  counts: {
    sourceRows: number;
    sourceUniqueSkus: number;
    targetRows: number;
    targetUniqueSkus: number;
    uiProjectionRows: number;
    historicalDossierRows: number;
  };
  duplicateSourceSkuIds: string[];
  duplicateTargetSkuIds: string[];
  duplicateUiProjectionSkuIds: string[];
  missingTargetSkuIds: string[];
  extraTargetSkuIds: string[];
  identityDifferences: Array<{ skuId: string; fields: string[] }>;
  labelDriftSkuIds: string[];
  missingSourceVersionSkuIds: string[];
  sourceVersionDifferences: string[];
  oneToManySourceSkuIds: string[];
  manyToOneTargetSkuIds: string[];
  readiness: Array<{ beerId: string; formatCode: string; skuId: string | null; state: ReadinessState; missingChannels: string[] }>;
  targetReadiness: Array<{ skuId: string; state: ReadinessState; missingChannels: string[] }>;
  historicalDossierDifferences: Array<{
    versionId: string;
    skuId: string;
    categoryChanged: boolean;
    contentChanged: boolean;
  }>;
  blockingReasonCounts: Record<string, number>;
};

const IDENTITY_FIELDS: Array<keyof YearTransitionManifestRow> = [
  "beerId",
  "productId",
  "kind",
  "classification",
  "bomFingerprint",
  "externalMappingFingerprint",
];

export function auditYearTransitionSkuParity(
  input: YearTransitionParityInput
): YearTransitionParityReport {
  const sourceBySku = indexFirst(input.sourceRows);
  const targetBySku = indexFirst(input.targetRows);
  const duplicateSourceSkuIds = duplicateIds(input.sourceRows.map((row) => row.skuId));
  const duplicateTargetSkuIds = duplicateIds(input.targetRows.map((row) => row.skuId));
  const duplicateUiProjectionSkuIds = duplicateIds(
    input.currentUiProjection.map((row) => row.skuId)
  );
  const sourceIds = [...sourceBySku.keys()].sort();
  const targetIds = [...targetBySku.keys()].sort();
  const missingTargetSkuIds = sourceIds.filter((skuId) => !targetBySku.has(skuId));
  const extraTargetSkuIds = targetIds.filter((skuId) => !sourceBySku.has(skuId));

  const identityDifferences: YearTransitionParityReport["identityDifferences"] = [];
  const labelDriftSkuIds: string[] = [];
  const missingSourceVersionSkuIds: string[] = [];
  const sourceVersionDifferences: string[] = [];

  for (const skuId of sourceIds) {
    const source = sourceBySku.get(skuId);
    const target = targetBySku.get(skuId);
    if (!source || !target) continue;
    const fields = IDENTITY_FIELDS.filter((field) => source[field] !== target[field]).map(String);
    if (fields.length > 0) identityDifferences.push({ skuId, fields: fields.sort() });
    if (source.labelFingerprint !== target.labelFingerprint) labelDriftSkuIds.push(skuId);
    if (
      target.provenance.kind === "recalculated_from_year" &&
      !target.sourcePlanningCostVersionId
    ) {
      missingSourceVersionSkuIds.push(skuId);
    }
    if (
      target.sourcePlanningCostVersionId &&
      target.sourcePlanningCostVersionId !== source.planningCostVersionId
    ) {
      sourceVersionDifferences.push(skuId);
    }
  }

  const lineageTargetsBySource = new Map<string, Set<string>>();
  const lineageSourcesByTarget = new Map<string, Set<string>>();
  for (const target of input.targetRows) {
    const sourceSkuIds = uniqueSorted(
      target.sourceSkuIds ?? (sourceBySku.has(target.skuId) ? [target.skuId] : [])
    );
    lineageSourcesByTarget.set(target.skuId, new Set(sourceSkuIds));
    for (const sourceSkuId of sourceSkuIds) {
      const targets = lineageTargetsBySource.get(sourceSkuId) ?? new Set<string>();
      targets.add(target.skuId);
      lineageTargetsBySource.set(sourceSkuId, targets);
    }
  }
  const oneToManySourceSkuIds = [...lineageTargetsBySource.entries()]
    .filter(([, targetSkuIds]) => targetSkuIds.size > 1)
    .map(([sourceSkuId]) => sourceSkuId)
    .sort();
  const manyToOneTargetSkuIds = [...lineageSourcesByTarget.entries()]
    .filter(([, sourceSkuIds]) => sourceSkuIds.size > 1)
    .map(([targetSkuId]) => targetSkuId)
    .sort();

  const requiredChannels = uniqueSorted(input.requiredChannels);
  const targetReadiness = targetIds.map((skuId) => {
    const row = targetBySku.get(skuId)!;
    return { skuId, ...readinessFor(row, requiredChannels) };
  });
  const readiness = [...input.formatExpectations]
    .sort((left, right) => `${left.beerId}|${left.formatCode}`.localeCompare(`${right.beerId}|${right.formatCode}`))
    .map((expectation) => {
      if (!expectation.skuId) {
        return { ...expectation, state: "not_applicable" as const, missingChannels: [] };
      }
      const row = targetBySku.get(expectation.skuId);
      if (!row) {
        return { ...expectation, state: "not_activated" as const, missingChannels: [] };
      }
      return { ...expectation, ...readinessFor(row, requiredChannels) };
    });

  const historicalDossierDifferences = [...input.historicalDossiers]
    .sort((left, right) => `${left.versionId}|${left.skuId}`.localeCompare(`${right.versionId}|${right.skuId}`))
    .filter(
      (row) =>
        row.originalCategory !== row.normalizedCategory ||
        row.originalFingerprint !== row.normalizedFingerprint
    )
    .map((row) => ({
      versionId: row.versionId,
      skuId: row.skuId,
      categoryChanged: row.originalCategory !== row.normalizedCategory,
      contentChanged: row.originalFingerprint !== row.normalizedFingerprint,
    }));

  const blockingReasons = [
    ...duplicateSourceSkuIds.map(() => "duplicate_source_sku"),
    ...duplicateTargetSkuIds.map(() => "duplicate_target_sku"),
    ...missingTargetSkuIds.map(() => "missing_target_sku"),
    ...extraTargetSkuIds.map(() => "extra_target_sku"),
    ...identityDifferences.map(() => "identity_difference"),
    ...missingSourceVersionSkuIds.map(() => "missing_source_version"),
    ...sourceVersionDifferences.map(() => "source_version_difference"),
    ...oneToManySourceSkuIds.map(() => "one_to_many_identity"),
    ...manyToOneTargetSkuIds.map(() => "many_to_one_identity"),
    ...targetReadiness
      .filter((row) => row.state !== "ready")
      .map((row) => `target_${row.state}`),
    ...historicalDossierDifferences.map(() => "historical_dossier_difference"),
  ];

  return {
    sourceYear: input.sourceYear,
    targetYear: input.targetYear,
    counts: {
      sourceRows: input.sourceRows.length,
      sourceUniqueSkus: sourceBySku.size,
      targetRows: input.targetRows.length,
      targetUniqueSkus: targetBySku.size,
      uiProjectionRows: input.currentUiProjection.length,
      historicalDossierRows: input.historicalDossiers.length,
    },
    duplicateSourceSkuIds,
    duplicateTargetSkuIds,
    duplicateUiProjectionSkuIds,
    missingTargetSkuIds,
    extraTargetSkuIds,
    identityDifferences,
    labelDriftSkuIds: labelDriftSkuIds.sort(),
    missingSourceVersionSkuIds: missingSourceVersionSkuIds.sort(),
    sourceVersionDifferences: sourceVersionDifferences.sort(),
    oneToManySourceSkuIds,
    manyToOneTargetSkuIds,
    readiness,
    targetReadiness,
    historicalDossierDifferences,
    blockingReasonCounts: countValues(blockingReasons),
  };
}

export function buildYearTransitionFingerprintManifest(
  input: YearTransitionParityInput,
  report: YearTransitionParityReport
) {
  return {
    schemaVersion: 1,
    fixtureSet: "RF-010C-year-transition-private-fingerprints",
    audit: {
      sourceYear: input.sourceYear,
      targetYear: input.targetYear,
      counts: report.counts,
      blockingReasonCounts: report.blockingReasonCounts,
      duplicateUiProjectionSkuCount: report.duplicateUiProjectionSkuIds.length,
      labelDriftSkuCount: report.labelDriftSkuIds.length,
      historicalDossierDifferenceCount: report.historicalDossierDifferences.length,
    },
    fingerprints: {
      sourceManifest: fingerprint(canonicalRows(input.sourceRows)),
      targetManifest: fingerprint(canonicalRows(input.targetRows)),
      sourceSkuSet: fingerprint(uniqueSorted(input.sourceRows.map((row) => row.skuId))),
      targetSkuSet: fingerprint(uniqueSorted(input.targetRows.map((row) => row.skuId))),
      identityDifferences: fingerprint(report.identityDifferences),
      readiness: fingerprint(report.readiness),
      targetReadiness: fingerprint(report.targetReadiness),
      historicalDossiers: fingerprint(
        [...input.historicalDossiers].sort((left, right) =>
          `${left.versionId}|${left.skuId}`.localeCompare(`${right.versionId}|${right.skuId}`)
        )
      ),
      report: fingerprint(report),
    },
  };
}

function readinessFor(
  row: YearTransitionManifestRow,
  requiredChannels: string[]
): { state: Exclude<ReadinessState, "not_applicable">; missingChannels: string[] } {
  if (!row.activated) return { state: "not_activated", missingChannels: [] };
  if (!row.planningCostVersionId || !row.planningCostRowId) {
    return { state: "cost_row_missing", missingChannels: [] };
  }
  if (!row.costPositive) return { state: "cost_non_positive", missingChannels: [] };
  if (!row.litersPositive && row.kind !== "article" && row.kind !== "service") {
    return { state: "liters_missing", missingChannels: [] };
  }
  const readyChannels = new Set(row.sellInReadyChannels);
  const missingChannels = requiredChannels.filter((channel) => !readyChannels.has(channel));
  if (missingChannels.length > 0) return { state: "sell_in_missing", missingChannels };
  return { state: "ready", missingChannels: [] };
}

function indexFirst(rows: YearTransitionManifestRow[]) {
  const result = new Map<string, YearTransitionManifestRow>();
  for (const row of rows) {
    if (!result.has(row.skuId)) result.set(row.skuId, row);
  }
  return result;
}

function duplicateIds(values: string[]) {
  const counts = countValues(values.filter(Boolean));
  return Object.keys(counts)
    .filter((value) => counts[value] > 1)
    .sort();
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function countValues(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalRows(rows: YearTransitionManifestRow[]) {
  return [...rows]
    .map((row) => ({ ...row, sellInReadyChannels: uniqueSorted(row.sellInReadyChannels) }))
    .sort((left, right) => left.skuId.localeCompare(right.skuId));
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
