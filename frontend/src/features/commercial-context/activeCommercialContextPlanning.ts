import type {
  CostComponents,
  GenericRecord,
  PlanningCostResolution,
} from "@/features/commercial-context/activeCommercialContextTypes";
import {
  number,
  record,
  round,
  text,
} from "@/features/commercial-context/activeCommercialContextUtils";

type AnchorCandidate = {
  row: GenericRecord;
  kind: "activation" | "event";
};

function moment(row: GenericRecord): [number, string] {
  const raw = text(row.effectief_vanaf || row.created_at);
  const parsed = Date.parse(raw);
  return [Number.isFinite(parsed) ? parsed : 0, text(row.id)];
}

function compareMoment(left: AnchorCandidate, right: AnchorCandidate): number {
  const leftMoment = moment(left.row);
  const rightMoment = moment(right.row);
  if (leftMoment[0] !== rightMoment[0]) return leftMoment[0] - rightMoment[0];
  if (left.kind !== right.kind) return left.kind === "activation" ? -1 : 1;
  return leftMoment[1].localeCompare(rightMoment[1]);
}

function readCostComponents(row: GenericRecord): CostComponents {
  return Object.freeze({
    purchaseEx: round(number(row.inkoop ?? row.primaire_kosten)),
    packagingEx: round(number(row.verpakkingskosten)),
    indirectEx: round(number(row.indirecte_kosten ?? row.vaste_kosten)),
    exciseEx: round(number(row.accijns)),
    costPriceEx: round(number(row.kostprijs)),
  });
}

export function selectPlanningCostCandidate(params: {
  skuId: string;
  year: number;
  pricingMethod: "cost_plus" | "manual_rate";
  productId: string;
  activations: GenericRecord[];
  activationEvents: GenericRecord[];
  versionsById: Map<string, GenericRecord>;
  packagingComponentPrices: GenericRecord[];
}): PlanningCostResolution {
  if (params.pricingMethod === "manual_rate") {
    return {
      status: "not_required",
      source: "not_applicable",
      sourceId: "",
      activationId: "",
      costVersionId: "",
      costRowId: "",
      effectiveAt: "",
      historyProven: true,
      costPriceEx: null,
      components: null,
      warnings: [],
    };
  }

  const componentPrice = params.packagingComponentPrices.find(
    (row) =>
      number(row.jaar) === params.year &&
      text(row.verpakkingsonderdeel_id || row.packaging_component_id || row.component_id) ===
        params.productId &&
      number(row.prijs_per_stuk || row.price_per_unit || row.kostprijs) > 0
  );
  const activationRows = params.activations.filter(
    (row) => text(row.sku_id) === params.skuId && number(row.jaar) === params.year
  );
  const eventRows = params.activationEvents.filter(
    (row) => text(row.sku_id) === params.skuId && number(row.jaar) === params.year
  );
  const candidates: AnchorCandidate[] = [
    ...activationRows.map((row) => ({ row, kind: "activation" as const })),
    ...eventRows.map((row) => ({ row, kind: "event" as const })),
  ].filter((candidate) => text(candidate.row.kostprijsversie_id));

  if (candidates.length === 0 && componentPrice) {
    const value = round(
      number(
        componentPrice.prijs_per_stuk ||
          componentPrice.price_per_unit ||
          componentPrice.kostprijs
      )
    );
    return {
      status: "resolved",
      source: "packaging_component_price",
      sourceId: text(componentPrice.id),
      activationId: "",
      costVersionId: "",
      costRowId: text(componentPrice.id),
      effectiveAt: "",
      historyProven: true,
      costPriceEx: value,
      components: Object.freeze({
        purchaseEx: 0,
        packagingEx: value,
        indirectEx: 0,
        exciseEx: 0,
        costPriceEx: value,
      }),
      warnings: [],
    };
  }

  if (candidates.length === 0) {
    return unresolvedPlanningCost("missing_activation", "planning_activation_missing");
  }

  const approvedRebaselines = eventRows
    .filter(
      (row) =>
        text(row.action).toLowerCase() === "explicit_rebaseline" &&
        Boolean(record(row.metadata).approved) &&
        text(row.kostprijsversie_id)
    )
    .map((row) => ({ row, kind: "event" as const }))
    .sort(compareMoment);
  const selected = approvedRebaselines.length
    ? approvedRebaselines[approvedRebaselines.length - 1]
    : candidates.slice().sort(compareMoment)[0];
  const source = approvedRebaselines.length
    ? "explicit_approved_rebaseline"
    : "first_observable_activation";
  const costVersionId = text(selected.row.kostprijsversie_id);
  const activation = activationRows.find(
    (row) => text(row.kostprijsversie_id) === costVersionId
  );
  const version = params.versionsById.get(costVersionId);
  const historyProven = eventRows.length > 0 || activationRows.length > 1;
  const common = {
    source,
    sourceId: text(selected.row.id),
    activationId: text(activation?.id),
    costVersionId,
    effectiveAt: text(selected.row.effectief_vanaf || selected.row.created_at),
    historyProven,
  } as const;

  if (!version) {
    return {
      ...common,
      status: "missing_cost_version",
      costRowId: "",
      costPriceEx: null,
      components: null,
      warnings: ["planning_cost_version_missing"],
    };
  }
  const costRows = Array.isArray(version.cost_lines)
    ? (version.cost_lines as GenericRecord[])
    : [];
  const costRow = costRows.find((row) => text(row.sku_id) === params.skuId);
  if (!costRow) {
    return {
      ...common,
      status: "missing_cost_row",
      costRowId: "",
      costPriceEx: null,
      components: null,
      warnings: ["canonical_cost_row_missing"],
    };
  }
  const components = readCostComponents(costRow);
  if (components.costPriceEx <= 0) {
    return {
      ...common,
      status: "invalid_cost",
      costRowId: text(costRow.id),
      costPriceEx: components.costPriceEx,
      components,
      warnings: ["planning_cost_non_positive"],
    };
  }
  return {
    ...common,
    status: "resolved",
    costRowId: text(costRow.id),
    costPriceEx: components.costPriceEx,
    components,
    warnings: historyProven ? [] : ["planning_anchor_history_unproven"],
  };
}

function unresolvedPlanningCost(
  status: PlanningCostResolution["status"],
  warning: string
): PlanningCostResolution {
  return {
    status,
    source: "unresolved",
    sourceId: "",
    activationId: "",
    costVersionId: "",
    costRowId: "",
    effectiveAt: "",
    historyProven: false,
    costPriceEx: null,
    components: null,
    warnings: [warning],
  };
}
