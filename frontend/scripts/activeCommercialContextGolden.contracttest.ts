import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

type GenericRecord = Record<string, any>;

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
  audit: GenericRecord;
  input: {
    channels: GenericRecord[];
    beers: GenericRecord[];
    skus: GenericRecord[];
    articles: GenericRecord[];
    costVersions: GenericRecord[];
    activations: GenericRecord[];
    sellingPrices: GenericRecord[];
    advicePrices: GenericRecord[];
    packagingComponentPrices: GenericRecord[];
  };
  historicalQuotes: GenericRecord[];
  historicalActualSnapshots: GenericRecord[];
  activeBreakEvenPlans: GenericRecord[];
  expected: GenericRecord | null;
};

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

// These imports deliberately call the production derivations. The golden runner must not
// reproduce pricing or source-selection formulas of its own.
const { buildCentralSkuIndex } = require("../src/features/sku/centralSkuIndex") as typeof import("../src/features/sku/centralSkuIndex");
const { buildQuoteableProductOptions } = require("../src/components/offerte-samenstellen/dataSources") as typeof import("../src/components/offerte-samenstellen/dataSources");
const {
  buildAdviesOpslagByChannel,
  buildChannelDefaultOpslag,
  buildProductCostRows,
  getSellInPriceEx,
  normalizeAdviesprijsRows,
  normalizeChannels,
} = require("../src/components/adviesprijzen/adviesprijzenDerivations") as typeof import("../src/components/adviesprijzen/adviesprijzenDerivations");
const { buildBreakEvenProductLines } = require("../src/components/break-even/breakEvenUtils") as typeof import("../src/components/break-even/breakEvenUtils");
const { calcAdviesprijsInclBtwRange } = require("../src/lib/pricingEngine") as typeof import("../src/lib/pricingEngine");

const fixturePath = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "active-commercial-context.synthetic.golden.json"
);

if (process.env.RF010A_PRIVATE_CAPTURE_STDIN === "1") {
  const privateCapture = JSON.parse(readFileSync(0, "utf8")) as GoldenFixture;
  const privateActual = canonicalize(buildExpected(privateCapture));
  const privateManifest = buildPrivateFingerprintManifest(privateCapture, privateActual);
  if (process.env.RF010A_PRINT_PRIVATE_MANIFEST === "1") {
    emitJsonTransferChunk(
      privateManifest,
      process.env.RF010A_PRINT_PRIVATE_MANIFEST_CHUNK_START,
      process.env.RF010A_PRINT_PRIVATE_MANIFEST_CHUNK_SIZE
    );
    console.log(JSON.stringify(privateManifest, null, 2));
    process.exit(0);
  }
  const manifestPath = path.resolve(
    process.cwd(),
    "scripts",
    "fixtures",
    "active-commercial-context.private.fingerprints.json"
  );
  const expectedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  deepStrictEqual(
    privateManifest.fingerprints,
    expectedManifest.fingerprints,
    "Private active commercial context differs from the RF-010A fingerprint baseline"
  );
  console.log(
    `private active commercial context audit OK (${privateManifest.audit.years.join(", ")}; no financial values emitted)`
  );
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;

equal(fixture.schemaVersion, 1, "Unexpected active-commercial-context fixture schema");
equal(fixture.fixtureSet, "RF-010A-active-commercial-context-synthetic");
ok(fixture.baselineCommit.trim(), "The fixture requires its baseline commit");
equal(
  fixture.audit.activationDuplicateKeys.length,
  0,
  "The captured baseline must not silently contain duplicate active SKU/year keys"
);

const actual = canonicalize(buildExpected(fixture));
emitTransferChunkIfRequested(actual);

ok(
  fixture.expected,
  "RF-010A expected output has not been recorded. Generate and review it before enabling the gate."
);
deepStrictEqual(
  actual,
  canonicalize(fixture.expected),
  "Active commercial context differs from the approved RF-010A golden baseline"
);

if (fixture.approval.status === "approved") {
  ok(fixture.approval.approvedBy, "Approved RF-010A fixtures require an approver");
  ok(fixture.approval.approvedAt, "Approved RF-010A fixtures require an approval date");
}

console.log(
  `activeCommercialContextGolden contracttest OK (${fixture.audit.years.join(", ")}; ${fixture.approval.status})`
);

function buildExpected(source: GoldenFixture) {
  const input = source.input;
  const years = (source.audit.years as number[]).map((year) => buildYearSnapshot(year, input));
  return {
    years,
    historicalQuotes: source.historicalQuotes,
    historicalActualSnapshots: source.historicalActualSnapshots,
    activeBreakEvenPlans: source.activeBreakEvenPlans,
  };
}

function buildYearSnapshot(year: number, input: GoldenFixture["input"]) {
  const common = {
    year,
    channels: input.channels,
    bieren: input.beers,
    skus: input.skus,
    articles: input.articles,
    kostprijsversies: input.costVersions,
    kostprijsproductactiveringen: input.activations,
    verkoopprijzen: input.sellingPrices,
    basisproducten: [] as GenericRecord[],
    samengesteldeProducten: [] as GenericRecord[],
  };
  const central = buildCentralSkuIndex({
    ...common,
    packagingComponentPrices: input.packagingComponentPrices,
  });
  const centralRows = central.rows.map((row) => ({
    skuId: row.skuId,
    costOrigin: row.costOrigin,
    costParentSkuId: row.costParentSkuId,
    subtype: row.subtype,
    pricingMethod: row.pricingMethod,
    uom: row.uom,
    contentLiter: number(row.contentLiter),
    isActive: row.isActive,
    hasActiveCost: row.hasActiveCost,
    costPriceEx: number(row.kostprijsEx),
    vatRatePct: number(row.btwPct),
    manualRateEx: number(row.manualRateEx),
    sellInExByChannel: numericRecord(row.sellInExByChannel),
    warnings: [...row.warnings],
  }));

  const quoteChannels = ["Horeca", "Retail"] as const;
  const quotes = quoteChannels.map((channel) => {
    const built = buildQuoteableProductOptions({ ...common, channel });
    return {
      channel,
      warnings: [...built.warnings],
      options: built.options.map((option) => ({
        optionId: option.optionId,
        costPriceEx: number(option.costPriceEx),
        standardPriceEx: number(option.standardPriceEx),
        standardPriceYear: option.standardPriceYear,
        vatRatePct: number(option.vatRatePct),
        litersPerUnit: number(option.litersPerUnit),
        kostprijsversieId: option.kostprijsversieId,
      })),
    };
  });

  const breakEven = buildBreakEvenProductLines(common).map((row) => ({
    ref: row.ref,
    litersPerUnit: number(row.litersPerUnit),
    sellInEx: number(row.sellInEx),
    costPriceEx: number(row.costPriceEx),
    fixedCostAllocationEx: number(row.fixedCostAllocationEx),
    variableCostEx: number(row.variableCostEx),
    sellInPerLiter: number(row.sellInPerLiter),
    variableCostPerLiter: number(row.variableCostPerLiter),
    contributionPerLiter: number(row.contributionPerLiter),
    warnings: [...row.warnings],
  }));

  const channels = normalizeChannels(input.channels).filter((row) => row.actief);
  const adviceRows = normalizeAdviesprijsRows(input.advicePrices);
  const adviceMarkup = buildAdviesOpslagByChannel(adviceRows, year);
  const adviceChannels = channels.filter((channel) => adviceMarkup.has(channel.code));
  const channelDefaults = buildChannelDefaultOpslag(channels);
  const skuById = new Map(input.skus.map((row) => [String(row.id ?? ""), row]));
  const beerById = new Map(input.beers.map((row) => [String(row.id ?? ""), row]));
  const articleNameById = new Map(
    input.articles.map((row) => [String(row.id ?? ""), String(row.name ?? row.id ?? "")])
  );
  const productCosts = buildProductCostRows({
    centralRows: central.rows,
    skuById,
    beerById,
    articleNameById,
  });
  const advice = adviceChannels.flatMap((channel) =>
    productCosts.map((row) => {
      const sellIn = getSellInPriceEx({
        row,
        channelCode: channel.code,
        verkoopprijzenRows: input.sellingPrices,
        selectedYear: year,
        channelDefaultOpslag: channelDefaults,
      });
      const adviceRange = calcAdviesprijsInclBtwRange({
        kostprijsEx: row.kostprijsEx,
        sellInEx: sellIn.sellInEx,
        adviesOpslagPct: adviceMarkup.get(channel.code) ?? 0,
        btwPct: row.btwPct,
      });
      return {
        channelCode: channel.code,
        skuId: row.skuId,
        costPriceEx: number(row.kostprijsEx),
        sellInEx: number(sellIn.sellInEx),
        sellInSource: sellIn.source,
        adviceMarkupPct: number(adviceMarkup.get(channel.code) ?? 0),
        advicePriceInclVat: number(adviceRange.inclRounded),
        adviceMinimumInclVat: number(adviceRange.min),
        adviceMaximumInclVat: number(adviceRange.max),
        customerMarginPct: number(adviceRange.margeKlantPct),
      };
    })
  );

  return {
    year,
    centralSkuContext: centralRows,
    newQuoteContext: quotes,
    advicePriceContext: advice,
    breakEvenPlanningContext: breakEven,
    discrepancies: buildDiscrepancies(centralRows, quotes, breakEven),
  };
}

function buildDiscrepancies(
  centralRows: GenericRecord[],
  quotes: GenericRecord[],
  breakEven: GenericRecord[]
) {
  const centralBySku = new Map(centralRows.map((row) => [row.skuId, row]));
  const quoteCostOrSellIn = quotes.flatMap((quote) => {
    const channelCode = String(quote.channel).toLowerCase();
    return quote.options.flatMap((option: GenericRecord) => {
      if (!String(option.optionId).startsWith("sku:")) return [];
      const skuId = String(option.optionId).slice(4);
      const central = centralBySku.get(skuId);
      if (!central) return [{ channelCode, skuId, kind: "quote-only" }];
      const expectedSellIn =
        central.pricingMethod === "manual_rate"
          ? number(central.manualRateEx)
          : number(central.sellInExByChannel[channelCode] ?? 0);
      const differences: GenericRecord[] = [];
      if (number(option.costPriceEx) !== number(central.costPriceEx)) {
        differences.push({
          channelCode,
          skuId,
          kind: "cost-price",
          central: number(central.costPriceEx),
          workflow: number(option.costPriceEx),
        });
      }
      if (number(option.standardPriceEx) !== expectedSellIn) {
        differences.push({
          channelCode,
          skuId,
          kind: "sell-in",
          central: expectedSellIn,
          workflow: number(option.standardPriceEx),
        });
      }
      return differences;
    });
  });
  const breakEvenCost = breakEven.flatMap((row) => {
    if (!String(row.ref).startsWith("sku:")) return [];
    const skuId = String(row.ref).slice(4);
    const central = centralBySku.get(skuId);
    if (!central) return [{ skuId, kind: "break-even-only" }];
    if (number(row.costPriceEx) === number(central.costPriceEx)) return [];
    return [{
      skuId,
      kind: "cost-price",
      central: number(central.costPriceEx),
      workflow: number(row.costPriceEx),
    }];
  });
  return { quoteCostOrSellIn, breakEvenCost };
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function numericRecord(value: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, number(item)])
  );
}

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])])
  );
}

function buildPrivateFingerprintManifest(source: GoldenFixture, actual: GenericRecord) {
  const years = (actual.years as GenericRecord[]).map((year) => ({
    year: year.year,
    centralSkuContext: fingerprintRows(year.centralSkuContext, "skuId"),
    newQuoteContext: (year.newQuoteContext as GenericRecord[]).map((quote) => ({
      channel: quote.channel,
      warnings: digest(quote.warnings),
      options: fingerprintRows(quote.options, "optionId"),
    })),
    advicePriceContext: fingerprintRows(
      year.advicePriceContext,
      (row) => `${row.channelCode}:${row.skuId}`
    ),
    breakEvenPlanningContext: fingerprintRows(year.breakEvenPlanningContext, "ref"),
    discrepancies: {
      quoteCostOrSellInCount: year.discrepancies.quoteCostOrSellIn.length,
      breakEvenCostCount: year.discrepancies.breakEvenCost.length,
      fingerprint: digest(year.discrepancies),
    },
    wholeYear: digest(year),
  }));
  return {
    schemaVersion: 1,
    fixtureSet: "RF-010A-private-commercial-context-fingerprints",
    baselineCommit: source.baselineCommit,
    capturedAt: source.capturedAt,
    source: {
      classification: "read-only-development-fingerprint",
      rawIdentifiersStored: false,
      financialValuesStored: false,
      hash: "SHA-256 of canonical pseudonymized workflow output",
    },
    approval: {
      status: "pending-human-approval",
      approvedBy: null,
      approvedAt: null,
    },
    audit: {
      years: source.audit.years,
      counts: source.audit.counts,
      activationDuplicateKeyCount: source.audit.activationDuplicateKeys.length,
      activationUnknownSkuCount: source.audit.activationUnknownSkus.length,
      activationUnknownVersionCount: source.audit.activationUnknownVersions.length,
      activationWithoutCanonicalCostLineCount:
        source.audit.activationWithoutCanonicalCostLine.length,
      activationWithoutAnyCostRepresentationCount:
        source.audit.activationWithoutAnyCostRepresentation.length,
    },
    fingerprints: {
      years,
      historicalQuotes: fingerprintRows(actual.historicalQuotes, "id"),
      historicalActualSnapshots: fingerprintHistoricalActuals(
        actual.historicalActualSnapshots
      ),
      activeBreakEvenPlans: fingerprintRows(actual.activeBreakEvenPlans, "id"),
      wholeContext: digest(actual),
    },
  };
}

function fingerprintHistoricalActuals(rows: GenericRecord[]) {
  const grouped = new Map<string, GenericRecord[]>();
  for (const row of rows) {
    const key = `${row.year}:${row.source_type}:${row.sku_id || "unmapped"}`;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return Array.from(grouped.entries())
    .map(([key, group]) => ({
      key,
      count: group.length,
      missingCostCount: group.filter((row) => row.missing_cost).length,
      fingerprint: digest(
        group.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)))
      ),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function fingerprintRows(
  rows: GenericRecord[],
  key: string | ((row: GenericRecord) => string)
) {
  return rows
    .map((row) => ({
      key: typeof key === "function" ? key(row) : String(row[key] ?? ""),
      fingerprint: digest(row),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function emitTransferChunkIfRequested(value: GenericRecord) {
  const startRaw = process.env.RF010A_PRINT_EXPECTED_CHUNK_START;
  if (startRaw === undefined) return;
  emitJsonTransferChunk(
    value,
    startRaw,
    process.env.RF010A_PRINT_EXPECTED_CHUNK_SIZE
  );
}

function emitJsonTransferChunk(
  value: GenericRecord,
  startRaw: string | undefined,
  sizeRaw: string | undefined
) {
  if (startRaw === undefined) return;
  const start = Math.max(0, Number(startRaw) || 0);
  const size = Math.max(1, Number(sizeRaw) || 12_000);
  const compact = JSON.stringify(value);
  console.log(JSON.stringify({
    sha256: createHash("sha256").update(compact).digest("hex"),
    total: compact.length,
    start,
    chunk: compact.slice(start, start + size),
  }));
  process.exit(0);
}
