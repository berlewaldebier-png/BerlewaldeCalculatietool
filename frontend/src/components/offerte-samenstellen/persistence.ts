import type {
  BasisData,
  BuilderBlock,
  QuoteBuilderUiState,
  QuoteDraftMeta,
  QuoteDraftSnapshot,
  QuotePersistencePayload,
  QuoteScenario,
  ScenarioId,
} from "@/components/offerte-samenstellen/types";
import { normalizeText } from "@/components/offerte-samenstellen/quoteUtils";

export const QUOTE_DRAFT_SCHEMA_VERSION = 1;

type BuildQuoteDraftSnapshotParams = {
  meta: QuoteDraftMeta;
  year: number;
  basis: BasisData;
  scenarios: Record<ScenarioId, QuoteScenario>;
  ui: QuoteBuilderUiState;
};

export function buildQuoteDraftSnapshot({
  meta,
  year,
  basis,
  scenarios,
  ui,
}: BuildQuoteDraftSnapshotParams): QuoteDraftSnapshot {
  return {
    meta,
    year,
    basis,
    scenarios,
    ui,
  };
}

function serializeBlock(block: BuilderBlock): BuilderBlock {
  return {
    ...block,
    icon: null,
  };
}

function serializeSnapshot(snapshot: QuoteDraftSnapshot): QuoteDraftSnapshot {
  return {
    ...snapshot,
    scenarios: {
      A: {
        ...snapshot.scenarios.A,
        blocks: snapshot.scenarios.A.blocks.map(serializeBlock),
      },
      B: {
        ...snapshot.scenarios.B,
        blocks: snapshot.scenarios.B.blocks.map(serializeBlock),
      },
      C: {
        ...snapshot.scenarios.C,
        blocks: snapshot.scenarios.C.blocks.map(serializeBlock),
      },
    },
  };
}

export function buildQuotePersistencePayload(
  snapshot: QuoteDraftSnapshot
): QuotePersistencePayload {
  return {
    schemaVersion: QUOTE_DRAFT_SCHEMA_VERSION,
    kind: "offerte-draft",
    savedAt: new Date().toISOString(),
    draft: serializeSnapshot(snapshot),
  };
}

export function buildQuoteDownloadFilename(offerteNaam: string) {
  const slug = normalizeText(offerteNaam)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");

  return `offerte-${slug || "concept"}.json`;
}
