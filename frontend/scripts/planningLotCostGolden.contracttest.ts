import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

type GenericRecord = Record<string, any>;

const Module = require("module") as any;
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const compiledRoot = path.resolve(__dirname, "..");
    const mapped = path.join(compiledRoot, "src", request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { buildQuoteableProductOptions } = require("../src/components/offerte-samenstellen/dataSources") as typeof import("../src/components/offerte-samenstellen/dataSources");
const { buildBreakEvenProductLines } = require("../src/components/break-even/breakEvenUtils") as typeof import("../src/components/break-even/breakEvenUtils");

const fixturePath = path.resolve(process.cwd(), "scripts", "fixtures", "planning-lot-cost.synthetic.golden.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GenericRecord;
const input = fixture.input as GenericRecord;
const expected = fixture.expected as GenericRecord;

equal(fixture.schemaVersion, 1);
equal(fixture.fixtureSet, "RF-010B-planning-lot-cost-synthetic");
ok(fixture.baselineCommit, "RF-010B fixture requires its baseline commit");

const common = {
  year: 2026,
  channels: input.channels,
  bieren: input.beers,
  skus: input.skus,
  articles: input.articles,
  kostprijsversies: input.versions,
  kostprijsproductactiveringen: input.activations,
  verkoopprijzen: [],
  basisproducten: [],
  samengesteldeProducten: [],
};

// Deliberately execute today's production readers. This assertion freezes the
// known deviation: new work currently receives the latest activation, not the
// separately modelled/approved first planning anchor.
const quote = buildQuoteableProductOptions({ ...common, channel: "Horeca" });
const option = quote.options.find((row) => row.optionId === "sku:sku-case-24");
ok(option, "Synthetic purchased SKU must be quoteable");
equal(option.kostprijsversieId, expected.observedNewQuoteVersion);
equal(option.costPriceEx, expected.observedNewQuoteCost);

const breakEven = buildBreakEvenProductLines(common);
const breakEvenRow = breakEven.find((row) => row.ref === "sku:sku-case-24");
ok(breakEvenRow, "Synthetic purchased SKU must be present in Break-even");
equal(breakEvenRow.costPriceEx, expected.observedNewQuoteCost);

// A saved quote is a historical input, not rebuilt through today's selector.
equal(fixture.historicalQuote.costVersionId, expected.approvedPurchasedPlanningVersion);
equal(fixture.historicalQuote.costPriceEx, 14);

console.log("planningLotCostGolden contracttest OK (known latest-vs-first deviation frozen)");
