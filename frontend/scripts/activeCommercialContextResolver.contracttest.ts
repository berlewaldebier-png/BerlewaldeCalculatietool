import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  ActiveCommercialContextInput,
} from "../src/features/commercial-context/activeCommercialContextResolver";

type GenericRecord = Record<string, any>;

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
  readActiveCommercialContext,
  resolveActiveCommercialContext,
} = require("../src/features/commercial-context/activeCommercialContextResolver") as typeof import("../src/features/commercial-context/activeCommercialContextResolver");

const fixturePath = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "active-commercial-context.synthetic.golden.json"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GenericRecord;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildInput(year: number): ActiveCommercialContextInput {
  const input = clone(fixture.input) as GenericRecord;
  for (const version of input.costVersions as GenericRecord[]) {
    for (const [index, row] of (version.cost_lines ?? []).entries()) {
      row.id ||= `${version.id}-row-${index + 1}`;
    }
  }
  const activations = input.activations as GenericRecord[];
  return {
    operationalYear: year,
    channels: input.channels,
    beers: input.beers,
    skus: input.skus,
    articles: input.articles,
    costVersions: input.costVersions,
    activations,
    activationEvents: activations.map((row) => ({
      id: `event-${row.id}`,
      action: "activate",
      sku_id: row.sku_id,
      jaar: row.jaar,
      kostprijsversie_id: row.kostprijsversie_id,
      effectief_vanaf: row.effectief_vanaf,
      metadata: {},
    })),
    sellingPrices: input.sellingPrices,
    advicePrices: input.advicePrices,
    packagingComponentPrices: input.packagingComponentPrices,
    activeBreakEvenPlans: clone(fixture.activeBreakEvenPlans),
    basisProducts: [],
    composedProducts: [],
  };
}

function sku(result: ReturnType<typeof resolveActiveCommercialContext>, id: string) {
  const item = result.skus.find((row) => row.skuId === id);
  ok(item, `Expected resolver result for ${id}`);
  return item;
}

function costVersion(id: string, cost: number): GenericRecord {
  return {
    id,
    jaar: 2026,
    status: "definitief",
    type: "inkoop",
    basisgegevens: { jaar: 2026, sku_id: "sku-001", btw_tarief: "21%" },
    cost_lines: [
      {
        id: `${id}-row`,
        sku_id: "sku-001",
        product_id: "article-001",
        inkoop: cost - 0.6,
        verpakkingskosten: 0.18,
        indirecte_kosten: 0.15,
        accijns: 0.27,
        kostprijs: cost,
      },
    ],
  };
}

{
  const input = buildInput(2026);
  const before = clone(input);
  const result = resolveActiveCommercialContext(input);
  const beerSku = sku(result, "sku-001");
  const serviceSku = sku(result, "sku-002");

  equal(result.operationalContext.year, 2026);
  equal(result.operationalContext.status, "candidate");
  equal(result.operationalContext.authority, "explicit_parameter");
  equal(result.operationalContext.activeYearsetAuthorityEstablished, false);
  equal(beerSku.planningCost.status, "resolved");
  equal(beerSku.planningCost.source, "first_observable_activation");
  equal(beerSku.planningCost.costVersionId, "cost-version-2026");
  equal(beerSku.planningCost.costRowId, "cost-version-2026-row-1");
  deepStrictEqual(beerSku.planningCost.components, {
    purchaseEx: 0.96,
    packagingEx: 0.18,
    indirectEx: 0.15,
    exciseEx: 0.27,
    costPriceEx: 1.56,
  });
  ok(Object.isFrozen(beerSku.planningCost.components));

  const horeca = beerSku.sellingPrices.find((row) => row.channelCode === "horeca");
  const retail = beerSku.sellingPrices.find((row) => row.channelCode === "retail");
  equal(horeca?.sellInEx, 2.75);
  equal(horeca?.source, "prijs");
  equal(horeca?.sourceRecordId, "sales-2026");
  equal(horeca?.sourceScope, "sku_product");
  equal(horeca?.sourceKey, "list");
  equal(retail?.sellInEx, 2.75);
  equal(retail?.sourceKey, "list");

  deepStrictEqual(
    beerSku.advicePrices.map((row) => ({
      channelCode: row.channelCode,
      adviceMarkupPct: row.markupPct,
      advicePriceInclVat: row.priceInclVat,
      adviceMinimumInclVat: row.minimumInclVat,
      adviceMaximumInclVat: row.maximumInclVat,
      customerMarginPct: row.customerMarginPct,
    })),
    [
      {
        channelCode: "horeca",
        adviceMarkupPct: 35,
        advicePriceInclVat: 4.45,
        adviceMinimumInclVat: 4.4,
        adviceMaximumInclVat: 4.5,
        customerMarginPct: 57.582022,
      },
      {
        channelCode: "retail",
        adviceMarkupPct: 28,
        advicePriceInclVat: 4.25,
        adviceMinimumInclVat: 4.2,
        adviceMaximumInclVat: 4.3,
        customerMarginPct: 55.585882,
      },
    ]
  );

  equal(serviceSku.planningCost.status, "not_required");
  equal(serviceSku.sellingPrices[0].source, "manual_rate");
  equal(serviceSku.readiness.quote, true);
  equal(serviceSku.readiness.breakEven, false);
  equal(serviceSku.readiness.advice, false);
  equal(result.breakEvenPlan.status, "resolved");
  equal(result.breakEvenPlan.planId, "plan-2026");
  deepStrictEqual(
    result.shadowComparison.differences.map((row) => ({
      consumer: row.consumer,
      field: row.field,
      skuId: row.skuId,
      channelCode: row.channelCode,
      reason: row.reason,
    })),
    [
      {
        consumer: "advice",
        field: "sell_in",
        skuId: "sku-001",
        channelCode: "horeca",
        reason: "current_advice_omits_sku_price_scope",
      },
      {
        consumer: "advice",
        field: "sell_in",
        skuId: "sku-001",
        channelCode: "retail",
        reason: "current_advice_omits_sku_price_scope",
      },
    ]
  );
  deepStrictEqual(input, before, "Resolver must not mutate source records");
}

{
  const input = buildInput(2026);
  input.costVersions.push(costVersion("cost-version-2026-later", 1.91));
  input.activations.push({
    id: "activation-2026-later",
    sku_id: "sku-001",
    jaar: 2026,
    kostprijsversie_id: "cost-version-2026-later",
    effectief_vanaf: "2026-05-01T00:00:00Z",
    effectief_tot: "",
  });
  input.activations = input.activations.map((row) =>
    row.id === "activation-2026"
      ? { ...row, effectief_tot: "2026-05-01T00:00:00Z" }
      : row
  );
  input.activationEvents = [
    ...(input.activationEvents ?? []),
    {
      id: "event-2026-later",
      action: "activate",
      sku_id: "sku-001",
      jaar: 2026,
      kostprijsversie_id: "cost-version-2026-later",
      effectief_vanaf: "2026-05-01T00:00:00Z",
      metadata: {},
    },
  ];

  const firstAnchor = resolveActiveCommercialContext(input);
  equal(sku(firstAnchor, "sku-001").planningCost.costVersionId, "cost-version-2026");
  ok(
    firstAnchor.shadowComparison.differences.some(
      (row) => row.field === "cost_version" && row.skuId === "sku-001"
    ),
    "Shadow comparison must expose the current latest-activation deviation"
  );

  input.activationEvents.push({
    id: "event-2026-approved-rebaseline",
    action: "explicit_rebaseline",
    sku_id: "sku-001",
    jaar: 2026,
    kostprijsversie_id: "cost-version-2026-later",
    effectief_vanaf: "2026-06-01T00:00:00Z",
    metadata: { approved: true, reason: "synthetic approval" },
  });
  const rebaselined = resolveActiveCommercialContext(input);
  equal(
    sku(rebaselined, "sku-001").planningCost.source,
    "explicit_approved_rebaseline"
  );
  equal(
    sku(rebaselined, "sku-001").planningCost.costVersionId,
    "cost-version-2026-later"
  );
}

{
  const missingVersionInput = buildInput(2026);
  missingVersionInput.activations = missingVersionInput.activations.map((row) =>
    row.sku_id === "sku-001"
      ? { ...row, kostprijsversie_id: "unknown-version" }
      : row
  );
  missingVersionInput.activationEvents = (missingVersionInput.activationEvents ?? []).map(
    (row) =>
      row.sku_id === "sku-001"
        ? { ...row, kostprijsversie_id: "unknown-version" }
        : row
  );
  missingVersionInput.activeBreakEvenPlans = [];
  const missingVersion = resolveActiveCommercialContext(missingVersionInput);
  equal(sku(missingVersion, "sku-001").planningCost.status, "missing_cost_version");
  equal(sku(missingVersion, "sku-001").sellingPrices[0].status, "missing");
  equal(missingVersion.breakEvenPlan.status, "missing");
  ok(
    missingVersion.completenessWarnings.some(
      (row) => row.code === "planning_cost_version_missing"
    )
  );

  const missingRowInput = buildInput(2026);
  missingRowInput.costVersions = missingRowInput.costVersions.map((row) =>
    row.id === "cost-version-2026" ? { ...row, cost_lines: [] } : row
  );
  const missingRow = resolveActiveCommercialContext(missingRowInput);
  equal(sku(missingRow, "sku-001").planningCost.status, "missing_cost_row");

  const missingActivationInput = buildInput(2026);
  missingActivationInput.activations = missingActivationInput.activations.filter(
    (row) => row.sku_id !== "sku-001"
  );
  missingActivationInput.activationEvents = (
    missingActivationInput.activationEvents ?? []
  ).filter((row) => row.sku_id !== "sku-001");
  const missingActivation = resolveActiveCommercialContext(missingActivationInput);
  equal(
    sku(missingActivation, "sku-001").planningCost.status,
    "missing_activation"
  );

  const missingAdviceInput = buildInput(2026);
  missingAdviceInput.advicePrices = [];
  const missingAdvice = resolveActiveCommercialContext(missingAdviceInput);
  equal(sku(missingAdvice, "sku-001").advicePrices[0].status, "missing");
  ok(
    missingAdvice.completenessWarnings.some(
      (row) => row.code === "advice_price_missing" && row.skuId === "sku-001"
    )
  );

  const ambiguousPlanInput = buildInput(2026);
  ambiguousPlanInput.activeBreakEvenPlans = [
    ...(ambiguousPlanInput.activeBreakEvenPlans ?? []),
    { id: "plan-2026-duplicate", jaar: 2026, status: "active", source: "synthetic" },
  ];
  const ambiguousPlan = resolveActiveCommercialContext(ambiguousPlanInput);
  equal(ambiguousPlan.breakEvenPlan.status, "ambiguous");
  equal(ambiguousPlan.breakEvenPlan.planId, "");
  deepStrictEqual(ambiguousPlan.breakEvenPlan.candidateIds, [
    "plan-2026",
    "plan-2026-duplicate",
  ]);
}

throws(
  () => resolveActiveCommercialContext({ ...buildInput(2026), operationalYear: 0 }),
  /explicit positive integer/
);

void (async () => {
  const input = buildInput(2026);
  const { operationalYear: _operationalYear, ...snapshot } = input;
  const calls: number[] = [];
  const result = await readActiveCommercialContext(2026, {
    readSnapshot: async (year) => {
      calls.push(year);
      return snapshot;
    },
  });
  deepStrictEqual(calls, [2026]);
  equal(result.operationalContext.year, 2026);
  console.log("activeCommercialContextResolver contracttest OK (RF-011A read-only resolver)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
