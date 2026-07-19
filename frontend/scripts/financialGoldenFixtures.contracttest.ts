import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  calcAdviesprijsInclBtwRange,
  calcMarginPctFromOpslagPct,
  calcOfferLineTotals,
  calcOfferLineTotalsWithGratis,
  calcOpslagPctFromSellInEx,
  calcSellInExFromOpslagPct,
  fromInclBtw,
  round2,
  roundDownTo5Cents,
  toInclBtw
} from "../src/lib/pricingEngine";

type GoldenOperation =
  | "markup-and-margin"
  | "quote-line-totals"
  | "quote-line-totals-with-free"
  | "vat-round-trip"
  | "advice-price-range"
  | "rounding";

type GoldenCase = {
  id: string;
  operation: GoldenOperation;
  classification: "observed";
  decisionStatus: "needs-human-approval" | "approved";
  purpose: string;
  input: Record<string, unknown>;
  expected: unknown;
};

type GoldenFixtureSet = {
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
    unit: string;
    precision: string;
    rounding: string;
  };
  cases: GoldenCase[];
};

const fixturePath = resolve(process.cwd(), "scripts", "fixtures", "pricing-engine.golden.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixtureSet;

equal(fixtures.schemaVersion, 1, "Unexpected financial fixture schema");
equal(fixtures.fixtureSet, "RF-010-core-pricing-engine");
equal(fixtures.contract.module, "frontend/src/lib/pricingEngine.ts");
ok(fixtures.cases.length > 0, "Financial fixture set must not be empty");

const caseIds = fixtures.cases.map((fixture) => fixture.id);
equal(new Set(caseIds).size, caseIds.length, "Financial fixture IDs must be unique");

for (const fixture of fixtures.cases) {
  equal(fixture.classification, "observed", `${fixture.id}: golden values must be observed, not inferred`);
  ok(fixture.purpose.trim(), `${fixture.id}: purpose is required`);
  for (const [key, value] of Object.entries(fixture.input)) {
    equal(typeof value, "number", `${fixture.id}: input ${key} must be a JSON number`);
  }
  const actual = runFixture(fixture);
  deepStrictEqual(actual, fixture.expected, `${fixture.id}: pricing output differs from the golden baseline`);
}

if (fixtures.approval.status === "approved") {
  ok(fixtures.approval.approvedBy, "Approved fixtures require an approver");
  ok(fixtures.approval.approvedAt, "Approved fixtures require an approval date");
  for (const fixture of fixtures.cases) {
    equal(fixture.decisionStatus, "approved", `${fixture.id}: approved fixture set contains an unapproved case`);
  }
}

console.log(`financialGoldenFixtures contracttest OK (${fixtures.cases.length} cases; ${fixtures.approval.status})`);

function runFixture(fixture: GoldenCase): unknown {
  const input = fixture.input;

  switch (fixture.operation) {
    case "markup-and-margin": {
      const costEx = input.costEx as number;
      const markupPct = input.markupPct as number;
      const sellInEx = calcSellInExFromOpslagPct(costEx, markupPct);
      return {
        sellInEx,
        marginPct: calcMarginPctFromOpslagPct(markupPct),
        roundTripMarkupPct: calcOpslagPctFromSellInEx(costEx, sellInEx)
      };
    }
    case "quote-line-totals":
      return calcOfferLineTotals(input as Parameters<typeof calcOfferLineTotals>[0]);
    case "quote-line-totals-with-free":
      return calcOfferLineTotalsWithGratis(input as Parameters<typeof calcOfferLineTotalsWithGratis>[0]);
    case "vat-round-trip": {
      const priceEx = input.priceEx as number;
      const vatPct = input.vatPct as number;
      const priceIncl = toInclBtw(priceEx, vatPct);
      return { priceIncl, priceExRoundTrip: fromInclBtw(priceIncl, vatPct) };
    }
    case "advice-price-range":
      return calcAdviesprijsInclBtwRange(input as Parameters<typeof calcAdviesprijsInclBtwRange>[0]);
    case "rounding":
      return {
        round2: round2(input.round2Value),
        roundDown5Cents: roundDownTo5Cents(input.roundDown5CentsValue as number)
      };
    default:
      return assertNever(fixture.operation);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported financial golden operation: ${String(value)}`);
}
