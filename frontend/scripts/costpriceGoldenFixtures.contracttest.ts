import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { formatCurrencyDisplay } from "../src/components/berekeningen/berekeningenWizardFormatting";
import {
  calculateComponentCostprice,
  calculateDerivedChildCostprice,
  calculateDirectSkuCostprice,
  type CostpriceComponentLine,
  type CostpriceComponentResult,
  type CostpriceParts,
  type CostpriceCalculationResult,
} from "../src/lib/costpriceCalculationEngine";

type CostGoldenOperation = "direct-sku" | "derived-child" | "component-composition";

type CostGoldenCase = {
  id: string;
  operation: CostGoldenOperation;
  classification: "observed";
  decisionStatus: "needs-human-approval" | "approved";
  purpose: string;
  input: Record<string, unknown>;
  expected: unknown;
};

type CostGoldenFixtureSet = {
  schemaVersion: number;
  fixtureSet: string;
  baselineCommit: string;
  approval: {
    status: "pending-human-approval" | "approved";
    approvedBy: string | null;
    approvedAt: string | null;
  };
  contract: {
    module: string;
    owner: string;
    currency: string;
    rawPrecision: string;
    displayPrecision: string;
    formula: string;
  };
  cases: CostGoldenCase[];
};

const partKeys: Array<keyof CostpriceParts> = [
  "primaire_kosten",
  "verpakkingskosten",
  "vaste_kosten",
  "accijns",
  "kostprijs",
];

const fixturePath = resolve(process.cwd(), "scripts", "fixtures", "costprice-engine.golden.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as CostGoldenFixtureSet;

equal(fixtures.schemaVersion, 1, "Unexpected cost-price fixture schema");
equal(fixtures.fixtureSet, "RF-010-core-costprice-engine");
equal(fixtures.contract.module, "frontend/src/lib/costpriceCalculationEngine.ts");
ok(fixtures.cases.length > 0, "Cost-price fixture set must not be empty");

const caseIds = fixtures.cases.map((fixture) => fixture.id);
equal(new Set(caseIds).size, caseIds.length, "Cost-price fixture IDs must be unique");
deepStrictEqual(
  caseIds,
  [
    "COST-001-direct-purchased-sku",
    "COST-002-derived-basis-bottle",
    "COST-003-own-brewed-sku",
    "COST-004-composed-giftset",
    "COST-005-derived-extra-packaging",
    "COST-006-missing-primary-component",
    "COST-007-composition-without-bom",
    "COST-008-cyclic-composition",
    "COST-009-wizard-created-composed-product",
  ],
  "RF-010 core requires the complete approved COST-001 through COST-009 set",
);

for (const fixture of fixtures.cases) {
  equal(fixture.classification, "observed", `${fixture.id}: golden values must be observed, not inferred`);
  ok(fixture.purpose.trim(), `${fixture.id}: purpose is required`);
  validateInput(fixture);
  const actual = normalizeResult(runFixture(fixture));
  deepStrictEqual(actual, fixture.expected, `${fixture.id}: cost-price output differs from the golden baseline`);
}

if (fixtures.approval.status === "approved") {
  ok(fixtures.approval.approvedBy, "Approved cost-price fixtures require an approver");
  ok(fixtures.approval.approvedAt, "Approved cost-price fixtures require an approval date");
  for (const fixture of fixtures.cases) {
    equal(fixture.decisionStatus, "approved", `${fixture.id}: approved fixture set contains an unapproved case`);
  }
}

console.log(`costpriceGoldenFixtures contracttest OK (${fixtures.cases.length} cases; ${fixtures.approval.status})`);

function runFixture(fixture: CostGoldenCase): CostpriceCalculationResult | CostpriceComponentResult {
  switch (fixture.operation) {
    case "direct-sku":
      // COST-006 deliberately omits primaryCost. Validation permits that one
      // missing numeric field so the current undefined-to-zero behavior is executable.
      return calculateDirectSkuCostprice(
        fixture.input as unknown as Parameters<typeof calculateDirectSkuCostprice>[0],
      );
    case "derived-child":
      return calculateDerivedChildCostprice(
        fixture.input as unknown as Parameters<typeof calculateDerivedChildCostprice>[0],
      );
    case "component-composition":
      return calculateComponentCostprice(
        fixture.input as unknown as Parameters<typeof calculateComponentCostprice>[0],
      );
    default:
      return assertNever(fixture.operation);
  }
}

function normalizeResult(result: CostpriceCalculationResult | CostpriceComponentResult) {
  if ("status" in result) {
    return {
      status: result.status,
      ...normalizeParts(result),
      issues: result.issues,
      trace: result.trace,
    };
  }

  return {
    valid: result.valid,
    component_count: result.component_count,
    ...normalizeParts(result),
    issues: result.issues,
    components: result.components.map(normalizeComponent),
  };
}

function normalizeComponent(component: CostpriceComponentLine) {
  return {
    label: component.label,
    quantity: component.quantity,
    ...(component.component_sku_id ? { component_sku_id: component.component_sku_id } : {}),
    ...(component.component_article_id ? { component_article_id: component.component_article_id } : {}),
    valid: component.valid,
    ...normalizeParts(component),
    issues: component.issues,
  };
}

function normalizeParts(parts: CostpriceParts) {
  return {
    raw: Object.fromEntries(partKeys.map((key) => [key, parts[key]])),
    display: Object.fromEntries(partKeys.map((key) => [key, formatCurrencyDisplay(parts[key])])),
  };
}

function validateInput(fixture: CostGoldenCase) {
  const input = fixture.input;
  switch (fixture.operation) {
    case "direct-sku":
      optionalNumber(input, "primaryCost");
      requiredNumber(input, "packagingCost");
      requiredNumber(input, "overheadCost");
      requiredNumber(input, "exciseCost");
      requiredNumber(input, "liters");
      requiredString(input, "sourceLabel");
      return;
    case "derived-child":
      requiredRecord(input, "parent");
      requiredNumber(input, "factor");
      requiredNumber(input, "extraPackagingCost");
      requiredString(input, "parentLabel");
      for (const key of partKeys) requiredNumber(input.parent as Record<string, unknown>, key);
      return;
    case "component-composition":
      requiredString(input, "parentArticleId");
      requiredNumber(input, "year");
      for (const key of ["bomLines", "skus", "articles", "summaryRows", "packagingComponentPrices"]) {
        ok(Array.isArray(input[key]), `${fixture.id}: ${key} must be an array`);
      }
      return;
    default:
      assertNever(fixture.operation);
  }
}

function optionalNumber(source: Record<string, unknown>, key: string) {
  if (source[key] !== undefined) requiredNumber(source, key);
}

function requiredNumber(source: Record<string, unknown>, key: string | number | symbol) {
  equal(typeof source[String(key)], "number", `Fixture input ${String(key)} must be a number`);
}

function requiredString(source: Record<string, unknown>, key: string) {
  equal(typeof source[key], "string", `Fixture input ${key} must be a string`);
}

function requiredRecord(source: Record<string, unknown>, key: string) {
  ok(source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key]), `Fixture input ${key} must be an object`);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported cost-price golden operation: ${String(value)}`);
}
