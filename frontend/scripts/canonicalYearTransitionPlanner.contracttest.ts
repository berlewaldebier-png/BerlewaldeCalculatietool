import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  CanonicalYearTransitionInput,
  FrozenPlanDraft,
} from "../src/features/year-transition/canonicalYearTransitionPlanner";

const Module = require("module") as any;
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown
) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const compiledRoot = path.resolve(__dirname, "..");
    const mapped = path.join(compiledRoot, "src", request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  planCanonicalYearTransition,
  readCanonicalYearTransitionPlan,
} = require("../src/features/year-transition/canonicalYearTransitionPlanner") as typeof import("../src/features/year-transition/canonicalYearTransitionPlanner");

const validInput = buildInput();
const before = JSON.stringify(validInput);
const result = planCanonicalYearTransition(validInput);

equal(JSON.stringify(validInput), before, "The read-only planner mutated its input snapshot");
equal(result.plannerVersion, "rf-011c-v1");
equal(result.readyForCandidateWrite, true);
deepStrictEqual(result.blockers, []);
deepStrictEqual(
  result.entries.map((row) => row.skuId),
  ["sku-bottle", "sku-box", "sku-gift", "sku-merch"],
  "One canonical source SKU must produce exactly one deterministic candidate entry"
);
equal(result.entries.find((row) => row.skuId === "sku-gift")?.classification, "composed");
equal(result.entries.find((row) => row.skuId === "sku-bottle")?.classification, "variant");
equal(result.entries.find((row) => row.skuId === "sku-gift")?.target.components?.kostprijs, 4.2);
equal(result.entries.find((row) => row.skuId === "sku-bottle")?.target.components?.kostprijs, 1.1);
deepStrictEqual(result.shadowComparison.duplicateUiSkuIds, ["sku-gift"]);
deepStrictEqual(result.shadowComparison.missingCurrentSkuIds, []);
deepStrictEqual(result.shadowComparison.extraCurrentSkuIds, []);
deepStrictEqual(result.shadowComparison.differingSkuIds, ["sku-gift"]);
equal(result.historicalRepresentations[0].differs, true);
deepStrictEqual(result.planForecast.plan.targets, result.planForecast.initialForecast.targets);
ok(
  result.planForecast.plan.targets !== result.planForecast.initialForecast.targets,
  "Initial Forecast must copy rather than alias the frozen Plan object"
);
equal(result.planForecast.plan.immutableAfterActivation, true);
equal(result.planForecast.initialForecast.exactlyMatchesPlan, true);

const reversed = planCanonicalYearTransition({
  ...buildInput(),
  skus: buildInput().skus.slice().reverse(),
  activations: buildInput().activations.slice().reverse(),
  targetYearInputs: buildInput().targetYearInputs.slice().reverse(),
  bomLines: buildInput().bomLines.slice().reverse(),
});
deepStrictEqual(reversed, result, "Input ordering must not change the canonical plan");

const clonedInput = buildInput();
const detachedResult = planCanonicalYearTransition(clonedInput);
(clonedInput.targetYearInputs[0] as Record<string, unknown>).primary_cost_ex = 999;
(clonedInput.frozenPlan!.targets as { revenue: number }).revenue = 999;
equal(detachedResult.entries.find((row) => row.skuId === "sku-box")?.target.components?.kostprijs, 24);
equal(detachedResult.planForecast.plan.targets?.revenue, 1000);

characterizeMissingAndDuplicateTargetInputs();
characterizePlanAndForecastBlockers();
characterizeIdentityAndReadinessBlockers();
characterizeCalculationBlockersAndLabelIndependence();
characterizeInvalidYear();
characterizePerformance();
characterizeSourceBoundary();
characterizeReaderPort()
  .then(() => {
    console.log("canonicalYearTransitionPlanner contracttest OK (RF-011C; read-only)");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

function characterizeMissingAndDuplicateTargetInputs() {
  const missing = buildInput();
  missing.targetYearInputs = missing.targetYearInputs.filter(
    (row) => row.sku_id !== "sku-bottle"
  );
  const missingResult = planCanonicalYearTransition(missing);
  ok(hasBlocker(missingResult, "target_input_missing", "sku-bottle"));
  equal(missingResult.readyForCandidateWrite, false);

  const duplicate = buildInput();
  duplicate.targetYearInputs.push({ ...duplicate.targetYearInputs[0], id: "target-box-duplicate" });
  const duplicateResult = planCanonicalYearTransition(duplicate);
  ok(hasBlocker(duplicateResult, "duplicate_target_input", "sku-box"));
  equal(duplicateResult.readyForCandidateWrite, false);

  const extra = buildInput();
  extra.targetYearInputs.push({
    id: "target-extra",
    sku_id: "sku-not-in-source-year",
    product_id: "article-extra",
    calculation_mode: "direct",
  });
  const extraResult = planCanonicalYearTransition(extra);
  ok(hasBlocker(extraResult, "extra_target_input", "sku-not-in-source-year"));
}

function characterizePlanAndForecastBlockers() {
  const noPlan = buildInput();
  noPlan.frozenPlan = null;
  const noPlanResult = planCanonicalYearTransition(noPlan);
  deepStrictEqual(
    noPlanResult.planForecast.plan.blockers.map((row) => row.code),
    [
      "plan_contribution_missing",
      "plan_liters_missing",
      "plan_period_allocation_missing",
      "plan_revenue_missing",
      "plan_sku_allocation_missing",
      "plan_source_missing",
      "plan_units_missing",
      "plan_variable_cost_invalid",
    ]
  );
  equal(noPlanResult.planForecast.initialForecast.status, "blocked");
  equal(noPlanResult.planForecast.initialForecast.targets, null);

  const zeroPlan = buildInput();
  zeroPlan.frozenPlan = {
    ...zeroPlan.frozenPlan!,
    targets: { revenue: 0, variableCost: 0, contribution: 0, liters: 0, units: 0 },
  };
  const zeroResult = planCanonicalYearTransition(zeroPlan);
  ok(zeroResult.planForecast.plan.blockers.some((row) => row.code === "plan_revenue_missing"));
  ok(zeroResult.planForecast.plan.blockers.some((row) => row.code === "plan_contribution_missing"));

  const inconsistent = buildInput();
  inconsistent.frozenPlan = {
    ...inconsistent.frozenPlan!,
    targets: { ...inconsistent.frozenPlan!.targets, contribution: 500 },
  };
  const inconsistentResult = planCanonicalYearTransition(inconsistent);
  ok(
    inconsistentResult.planForecast.plan.blockers.some(
      (row) => row.code === "plan_totals_inconsistent"
    )
  );

  const mismatch = buildInput();
  mismatch.frozenPlan = {
    ...mismatch.frozenPlan!,
    periodAllocations: [
      { key: "2026-01", revenue: 999, variableCost: 400, contribution: 600, liters: 100, units: 200 },
    ],
  };
  const mismatchResult = planCanonicalYearTransition(mismatch);
  ok(
    mismatchResult.planForecast.plan.blockers.some(
      (row) => row.code === "plan_period_allocation_mismatch"
    )
  );
  equal(mismatchResult.planForecast.initialForecast.exactlyMatchesPlan, false);
}

function characterizeIdentityAndReadinessBlockers() {
  const scenario = buildInput();
  const bottle = scenario.targetYearInputs.find((row) => row.sku_id === "sku-bottle")!;
  bottle.product_id = "article-renamed-by-label";
  bottle.liters_per_unit = 0;
  bottle.ready_channels = ["horeca"];
  const result = planCanonicalYearTransition(scenario);
  ok(hasBlocker(result, "target_input_identity_mismatch", "sku-bottle"));
  ok(hasBlocker(result, "target_liters_missing", "sku-bottle"));
  ok(hasBlocker(result, "target_channel_missing", "sku-bottle"));
  equal(result.entries.length, 4, "A label/product mismatch may not fan out or invent a SKU");
}

function characterizeCalculationBlockersAndLabelIndependence() {
  const unresolvedSource = buildInput();
  const sourceVersion = unresolvedSource.costVersions.find(
    (row) => row.id === "version-2025-1"
  )!;
  sourceVersion.cost_lines = [];
  const unresolvedSourceResult = planCanonicalYearTransition(unresolvedSource);
  ok(hasBlocker(unresolvedSourceResult, "source_cost_unresolved", "sku-box"));

  const zeroTarget = buildInput();
  const boxInput = zeroTarget.targetYearInputs.find((row) => row.sku_id === "sku-box")!;
  boxInput.primary_cost_ex = 0;
  boxInput.packaging_cost_ex = 0;
  boxInput.overhead_cost_ex = 0;
  boxInput.excise_cost_ex = 0;
  const zeroTargetResult = planCanonicalYearTransition(zeroTarget);
  ok(hasBlocker(zeroTargetResult, "target_cost_non_positive", "sku-box"));

  const missingParent = buildInput();
  missingParent.targetYearInputs.find(
    (row) => row.sku_id === "sku-bottle"
  )!.parent_sku_id = "sku-unknown-parent";
  const missingParentResult = planCanonicalYearTransition(missingParent);
  ok(hasBlocker(missingParentResult, "derived_parent_missing", "sku-bottle"));

  const missingBom = buildInput();
  missingBom.bomLines.splice(0);
  const missingBomResult = planCanonicalYearTransition(missingBom);
  ok(hasBlocker(missingBomResult, "composed_bom_missing", "sku-gift"));

  const renamed = buildInput();
  renamed.skus.forEach((sku) => {
    sku.name = `Renamed ${sku.id}`;
  });
  deepStrictEqual(
    planCanonicalYearTransition(renamed),
    planCanonicalYearTransition(buildInput()),
    "Display labels must not participate in canonical identity or calculations"
  );
}

function characterizeInvalidYear() {
  const scenario = buildInput();
  scenario.targetYear = 2025;
  const result = planCanonicalYearTransition(scenario);
  ok(hasBlocker(result, "invalid_year_transition"));
  equal(result.readyForCandidateWrite, false);
}

function characterizePerformance() {
  const count = 250;
  const allocations = Array.from({ length: count }, (_, index) => ({
    key: `sku-${String(index).padStart(4, "0")}`,
    revenue: 1,
    variableCost: 0.4,
    contribution: 0.6,
    liters: 1,
    units: 1,
  }));
  const scenario: CanonicalYearTransitionInput = {
    sourceYear: 2025,
    targetYear: 2026,
    requiredChannels: [],
    skus: allocations.map((row) => ({
      id: row.key,
      kind: "beer_format",
      beer_id: `beer-${row.key}`,
      format_article_id: `article-${row.key}`,
    })),
    articles: allocations.map((row) => ({ id: `article-${row.key}` })),
    bomLines: [],
    costVersions: allocations.map((row) => ({
      id: `version-${row.key}`,
      jaar: 2025,
      status: "definitief",
      type: "inkoop",
      cost_lines: [
        {
          id: `cost-${row.key}`,
          sku_id: row.key,
          primaire_kosten: 1,
          verpakkingskosten: 1,
          vaste_kosten: 1,
          accijns: 1,
          kostprijs: 4,
        },
      ],
    })),
    activations: allocations.map((row) => ({
      id: `activation-${row.key}`,
      sku_id: row.key,
      jaar: 2025,
      kostprijsversie_id: `version-${row.key}`,
      effectief_vanaf: "2025-01-01T00:00:00Z",
    })),
    activationEvents: [],
    targetYearInputs: allocations.map((row) => ({
      id: `target-${row.key}`,
      sku_id: row.key,
      product_id: `article-${row.key}`,
      calculation_mode: "direct",
      primary_cost_ex: 1,
      packaging_cost_ex: 1,
      overhead_cost_ex: 1,
      excise_cost_ex: 1,
      liters_per_unit: 1,
      ready_channels: [],
    })),
    frozenPlan: {
      source: "new_year_preparation",
      targets: {
        revenue: count,
        variableCost: count * 0.4,
        contribution: count * 0.6,
        liters: count,
        units: count,
      },
      periodAllocations: [
        {
          key: "2026",
          revenue: count,
          variableCost: count * 0.4,
          contribution: count * 0.6,
          liters: count,
          units: count,
        },
      ],
      skuAllocations: allocations,
    },
  };
  const started = Date.now();
  const result = planCanonicalYearTransition(scenario);
  const elapsedMs = Date.now() - started;
  equal(result.entries.length, count);
  equal(result.readyForCandidateWrite, true);
  ok(elapsedMs < 5000, `Canonical planner took ${elapsedMs}ms for ${count} SKUs`);
}

function characterizeSourceBoundary() {
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "src/features/year-transition/canonicalYearTransitionPlanner.ts"
    ),
    "utf8"
  );
  for (const forbidden of [
    "ActiveCostRow",
    "NieuwJaarWizard",
    "react",
    "fetch(",
    "saveDataset",
    "activate",
  ]) {
    ok(!source.includes(forbidden), `Read-only planner contains forbidden dependency: ${forbidden}`);
  }
}

async function characterizeReaderPort() {
  const input = buildInput();
  const expected = planCanonicalYearTransition(input);
  let reads = 0;
  const actual = await readCanonicalYearTransitionPlan(2025, 2026, {
    async readSnapshot(sourceYear, targetYear) {
      reads += 1;
      equal(sourceYear, 2025);
      equal(targetYear, 2026);
      const { sourceYear: _source, targetYear: _target, ...snapshot } = input;
      return snapshot;
    },
  });
  equal(reads, 1);
  deepStrictEqual(actual, expected);
}

function hasBlocker(
  result: ReturnType<typeof planCanonicalYearTransition>,
  code: string,
  skuId?: string
) {
  return result.blockers.some(
    (row) => row.code === code && (skuId === undefined || row.skuId === skuId)
  );
}

function buildInput(): CanonicalYearTransitionInput & {
  targetYearInputs: Record<string, unknown>[];
  frozenPlan: FrozenPlanDraft | null;
  sourceYear: number;
  targetYear: number;
} {
  const skus = [
    {
      id: "sku-box",
      kind: "beer_format",
      beer_id: "beer-juweel",
      format_article_id: "article-box",
      name: "Synthetic box 24 x 33cl",
    },
    {
      id: "sku-bottle",
      kind: "beer_format",
      beer_id: "beer-juweel",
      format_article_id: "article-bottle",
      parent_sku_id: "sku-box",
      name: "Synthetic bottle 33cl",
    },
    {
      id: "sku-merch",
      kind: "article",
      article_id: "article-merch",
      name: "Synthetic merchandise",
    },
    {
      id: "sku-gift",
      kind: "article",
      article_id: "article-gift",
      name: "Synthetic composed gift",
    },
  ];
  const costVersions = skus.map((sku, index) => ({
    id: `version-2025-${index + 1}`,
    jaar: 2025,
    status: "definitief",
    type: index === 0 ? "inkoop" : "afgeleid",
    cost_lines: [
      {
        id: `cost-row-2025-${index + 1}`,
        sku_id: sku.id,
        product_id: sku.format_article_id ?? sku.article_id,
        primaire_kosten: index + 1,
        verpakkingskosten: 0.5,
        vaste_kosten: 0.25,
        accijns: 0.25,
        kostprijs: index + 2,
      },
    ],
  }));
  const activations = skus.map((sku, index) => ({
    id: `activation-2025-${index + 1}`,
    sku_id: sku.id,
    jaar: 2025,
    kostprijsversie_id: costVersions[index].id,
    effectief_vanaf: `2025-01-0${index + 1}T00:00:00Z`,
  }));
  const frozenPlan: FrozenPlanDraft = {
    source: "new_year_preparation",
    sourceRecordId: "new-year-draft-2026",
    targets: { revenue: 1000, variableCost: 400, contribution: 600, liters: 100, units: 200 },
    periodAllocations: [
      { key: "2026-01", revenue: 400, variableCost: 160, contribution: 240, liters: 40, units: 80 },
      { key: "2026-02", revenue: 600, variableCost: 240, contribution: 360, liters: 60, units: 120 },
    ],
    skuAllocations: [
      { key: "sku-box", revenue: 700, variableCost: 280, contribution: 420, liters: 70, units: 140 },
      { key: "sku-gift", revenue: 300, variableCost: 120, contribution: 180, liters: 30, units: 60 },
    ],
  };
  return {
    sourceYear: 2025,
    targetYear: 2026,
    requiredChannels: ["retail", "horeca"],
    skus,
    articles: [
      { id: "article-box", kind: "beer_format" },
      { id: "article-bottle", kind: "beer_format" },
      { id: "article-merch", kind: "merchandise" },
      { id: "article-gift", kind: "sellable_composed" },
    ],
    bomLines: [
      { id: "bom-gift-bottle", parent_article_id: "article-gift", component_sku_id: "sku-bottle", quantity: 2 },
      { id: "bom-gift-merch", parent_article_id: "article-gift", component_sku_id: "sku-merch", quantity: 1 },
    ],
    costVersions,
    activations,
    activationEvents: activations.map((row) => ({ ...row, id: `${row.id}-event`, action: "activated" })),
    externalMappings: skus.map((sku, index) => ({
      id: `mapping-${index + 1}`,
      sku_id: sku.id,
      douano_product_id: 22000 + index,
    })),
    packagingComponentPrices: [],
    targetYearInputs: [
      {
        id: "target-box",
        sku_id: "sku-box",
        product_id: "article-box",
        calculation_mode: "direct",
        primary_cost_ex: 12,
        packaging_cost_ex: 4,
        overhead_cost_ex: 4,
        excise_cost_ex: 4,
        liters_per_unit: 7.92,
        ready_channels: ["horeca", "retail"],
      },
      {
        id: "target-bottle",
        sku_id: "sku-bottle",
        product_id: "article-bottle",
        calculation_mode: "derived",
        parent_sku_id: "sku-box",
        parent_factor: 24,
        extra_packaging_cost_ex: 0.1,
        liters_per_unit: 0.33,
        ready_channels: ["retail", "horeca"],
      },
      {
        id: "target-merch",
        sku_id: "sku-merch",
        product_id: "article-merch",
        calculation_mode: "direct",
        primary_cost_ex: 0,
        packaging_cost_ex: 2,
        overhead_cost_ex: 0,
        excise_cost_ex: 0,
        liters_per_unit: 0,
        ready_channels: ["horeca", "retail"],
      },
      {
        id: "target-gift",
        sku_id: "sku-gift",
        product_id: "article-gift",
        calculation_mode: "composed",
        liters_per_unit: 0.66,
        ready_channels: ["horeca", "retail"],
      },
    ],
    frozenPlan,
    currentUiDerivedRows: [
      { sku_id: "sku-box", product_id: "article-box", product_type: "basis", target_cost: 24 },
      { sku_id: "sku-bottle", product_id: "article-bottle", product_type: "variant", target_cost: 1.1 },
      { sku_id: "sku-merch", product_id: "article-merch", product_type: "article", target_cost: 2 },
      { sku_id: "sku-gift", product_id: "article-gift", product_type: "basis", target_cost: 4.2 },
      { sku_id: "sku-gift", product_id: "article-gift", product_type: "basis", target_cost: 4.2 },
    ],
    historicalDossiers: [
      {
        versionId: "version-2025-4",
        originalSnapshot: { samengesteld: ["sku-gift"] },
        normalizedRows: { basis: ["sku-gift"] },
      },
    ],
  };
}
