import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  auditYearTransitionSkuParity,
  buildYearTransitionFingerprintManifest,
  type YearTransitionParityInput,
  type YearTransitionParityReport,
} from "./yearTransitionSkuParity";

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

const { buildActiveRows } = require("../src/components/kostprijsbeheer/kostprijsBeheerDerivations") as typeof import("../src/components/kostprijsbeheer/kostprijsBeheerDerivations");

type GoldenFixture = {
  schemaVersion: number;
  fixtureSet: string;
  baselineCommit: string;
  capturedAt: string;
  approval: {
    status: "pending-human-approval" | "approved";
    approvedBy: string | null;
    approvedAt: string | null;
  };
  input: YearTransitionParityInput;
  expected: YearTransitionParityReport;
};

if (process.env.RF010C_PRIVATE_CAPTURE_STDIN === "1") {
  const privateInput = JSON.parse(readFileSync(0, "utf8")) as YearTransitionParityInput;
  const privateReport = auditYearTransitionSkuParity(privateInput);
  const privateManifest = buildYearTransitionFingerprintManifest(privateInput, privateReport);
  if (process.env.RF010C_PRINT_PRIVATE_MANIFEST === "1") {
    console.log(JSON.stringify(privateManifest, null, 2));
    process.exit(0);
  }
  const privateManifestPath = path.resolve(
    process.cwd(),
    "scripts",
    "fixtures",
    "year-transition-sku-parity.private.fingerprints.json"
  );
  const expectedPrivateManifest = JSON.parse(readFileSync(privateManifestPath, "utf8"));
  deepStrictEqual(
    privateManifest.fingerprints,
    expectedPrivateManifest.fingerprints,
    "Private year-transition SKU parity differs from the RF-010C fingerprint baseline"
  );
  deepStrictEqual(
    privateManifest.audit,
    expectedPrivateManifest.audit,
    "Private year-transition SKU parity counts/reasons differ from the RF-010C baseline"
  );
  console.log(
    `private year-transition SKU parity audit OK (${privateInput.sourceYear}->${privateInput.targetYear}; hashes/reason counts only)`
  );
  process.exit(0);
}

const fixturePath = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "year-transition-sku-parity.synthetic.golden.json"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;

equal(fixture.schemaVersion, 1, "Unexpected RF-010C fixture schema");
equal(fixture.fixtureSet, "RF-010C-year-transition-sku-parity-synthetic");
ok(fixture.baselineCommit.trim(), "RF-010C requires a baseline commit");
equal(fixture.input.sourceYear, 2025);
equal(fixture.input.targetYear, 2026);

const report = auditYearTransitionSkuParity(fixture.input);
deepStrictEqual(report, fixture.expected, "Year-transition SKU parity differs from the observed golden fixture");

deepStrictEqual(
  report.duplicateSourceSkuIds,
  [],
  "Synthetic canonical source contains a physical duplicate SKU"
);
deepStrictEqual(
  report.duplicateTargetSkuIds,
  [],
  "Synthetic canonical target contains a physical duplicate SKU"
);
deepStrictEqual(
  report.duplicateUiProjectionSkuIds,
  ["sku-005"],
  "The UI fan-out characterization must remain separate from physical SKU identity"
);

const unavailableKeg = report.readiness.find(
  (row) => row.beerId === "beer-001" && row.formatCode === "keg"
);
equal(unavailableKeg?.state, "not_applicable", "A format that does not exist must be n.v.t.");
const missingTargetKeg = report.readiness.find(
  (row) => row.beerId === "beer-002" && row.formatCode === "keg"
);
equal(
  missingTargetKeg?.state,
  "not_activated",
  "An existing source SKU missing from the target must not be labelled n.v.t."
);
const zeroCost = report.targetReadiness.find((row) => row.skuId === "sku-006");
equal(zeroCost?.state, "cost_non_positive", "A zero cost must not be labelled n.v.t.");

const recalculatedPurchase = fixture.input.targetRows.find((row) => row.skuId === "sku-004");
equal(recalculatedPurchase?.classification, "basis");
equal(recalculatedPurchase?.provenance.kind, "recalculated_from_year");
equal(recalculatedPurchase?.provenance.sourceYear, 2025);

characterizeCurrentUiProjectionFanOut();
characterizeBlockingIdentityAndReadinessCases();

if (fixture.approval.status === "approved") {
  ok(fixture.approval.approvedBy, "Approved RF-010C fixtures require an approver");
  ok(fixture.approval.approvedAt, "Approved RF-010C fixtures require an approval date");
}

function characterizeBlockingIdentityAndReadinessCases() {
  const source = fixture.input.sourceRows[0];
  const readyTarget = fixture.input.targetRows.find((row) => row.skuId === source.skuId)!;
  const targetWithoutCostRow = {
    ...readyTarget,
    planningCostRowId: "",
    costPositive: true,
  };
  const targetWithoutLiters = {
    ...readyTarget,
    skuId: "sku-no-liters",
    sourceSkuIds: [source.skuId],
    litersPositive: false,
  };
  const targetWithoutSellIn = {
    ...readyTarget,
    skuId: "sku-no-sell-in",
    sourceSkuIds: ["sku-003", "sku-004"],
    sellInReadyChannels: ["horeca"],
  };
  const scenario = auditYearTransitionSkuParity({
    sourceYear: 2025,
    targetYear: 2026,
    requiredChannels: ["horeca", "retail"],
    sourceRows: [source],
    targetRows: [
      targetWithoutCostRow,
      targetWithoutLiters,
      targetWithoutSellIn,
      { ...readyTarget },
    ],
    currentUiProjection: [],
    formatExpectations: [],
    historicalDossiers: [],
  });

  equal(
    scenario.targetReadiness.find((row) => row.skuId === source.skuId)?.state,
    "cost_row_missing",
    "An activated SKU without a canonical cost row must be distinct from a numeric zero"
  );
  equal(
    scenario.targetReadiness.find((row) => row.skuId === "sku-no-liters")?.state,
    "liters_missing"
  );
  deepStrictEqual(
    scenario.targetReadiness.find((row) => row.skuId === "sku-no-sell-in"),
    { skuId: "sku-no-sell-in", state: "sell_in_missing", missingChannels: ["retail"] }
  );
  deepStrictEqual(
    scenario.duplicateTargetSkuIds,
    [source.skuId],
    "Two physical target rows for one canonical SKU must block activation"
  );
  deepStrictEqual(
    scenario.oneToManySourceSkuIds,
    [source.skuId],
    "One source SKU may not silently become multiple target SKUs"
  );
  deepStrictEqual(
    scenario.manyToOneTargetSkuIds,
    ["sku-no-sell-in"],
    "Multiple source SKUs may not silently collapse into one target SKU"
  );

  const missingLineage = auditYearTransitionSkuParity({
    sourceYear: 2025,
    targetYear: 2026,
    requiredChannels: [],
    sourceRows: [source],
    targetRows: [{ ...readyTarget, sourcePlanningCostVersionId: "" }],
    currentUiProjection: [],
    formatExpectations: [],
    historicalDossiers: [],
  });
  deepStrictEqual(
    missingLineage.missingSourceVersionSkuIds,
    [source.skuId],
    "A recalculated target must retain its exact source cost-version lineage"
  );
}

console.log(
  `yearTransitionSkuParity contracttest OK (${fixture.input.sourceYear}->${fixture.input.targetYear}; ${fixture.approval.status})`
);

function characterizeCurrentUiProjectionFanOut() {
  const bundleSku = {
    id: "sku-bundle",
    kind: "article",
    article_id: "article-bundle",
    name: "Synthetic composed bundle",
    active: true,
    product_group: "giftset",
  };
  const componentA = {
    id: "sku-component-a",
    kind: "beer_format",
    beer_id: "beer-a",
    format_article_id: "article-format-a",
    name: "Synthetic component A",
  };
  const componentB = {
    id: "sku-component-b",
    kind: "beer_format",
    beer_id: "beer-b",
    format_article_id: "article-format-b",
    name: "Synthetic component B",
  };
  const version = {
    id: "version-bundle",
    jaar: 2025,
    status: "definitief",
    bier_id: "",
    type: "article",
    updated_at: "2025-12-31T00:00:00Z",
    cost_lines: [
      {
        sku_id: "sku-bundle",
        product_id: "article-bundle",
        product_type: "article",
        verpakking: "Synthetic composed bundle",
        kostprijs: 10,
      },
    ],
  };
  const projected = buildActiveRows({
    kostprijsproductactiveringen: [
      {
        sku_id: "sku-bundle",
        jaar: 2025,
        kostprijsversie_id: "version-bundle",
        effectief_vanaf: "2025-01-01T00:00:00Z",
      },
    ],
    selectedYear: 2025,
    search: "",
    activeSort: { key: "artikel", direction: "asc" },
    bierenById: new Map([
      ["beer-a", "Synthetic beer A"],
      ["beer-b", "Synthetic beer B"],
    ]),
    basisById: new Map(),
    skuById: new Map<string, Record<string, unknown>>([
      [bundleSku.id, bundleSku],
      [componentA.id, componentA],
      [componentB.id, componentB],
    ]),
    articleById: new Map<string, Record<string, unknown>>([
      ["article-bundle", { id: "article-bundle", name: "Synthetic composed bundle", active: true, product_group: "giftset" }],
    ]),
    bomLines: [
      { parent_article_id: "article-bundle", component_sku_id: "sku-component-a", quantity: 1 },
      { parent_article_id: "article-bundle", component_sku_id: "sku-component-b", quantity: 1 },
    ],
    samengesteldById: new Map(),
    berekeningenById: new Map<string, Record<string, unknown>>([[version.id, version]]),
    currentBerekeningen: [version],
    packagingComponentPrices: [],
  });

  equal(projected.length, 2, "Current display projection should fan the composed SKU into both Beer groups");
  deepStrictEqual(
    [...new Set(projected.map((row) => row.skuId))],
    ["sku-bundle"],
    "UI fan-out must still refer to one physical SKU"
  );
  deepStrictEqual(
    projected.map((row) => row.groupLabel).sort(),
    ["Synthetic beer A", "Synthetic beer B"],
    "Current grouping fan-out changed and must be reclassified before RF-011C"
  );
}
