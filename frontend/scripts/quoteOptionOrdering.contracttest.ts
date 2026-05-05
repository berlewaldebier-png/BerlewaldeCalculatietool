import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installAtAliasResolverForCompiledTests() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
}

function run() {
  installAtAliasResolverForCompiledTests();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildQuoteableProductOptions } = require("../src/components/offerte-samenstellen/dataSources") as {
    buildQuoteableProductOptions: typeof import("../src/components/offerte-samenstellen/dataSources").buildQuoteableProductOptions;
  };

  const year = 2025;

  const result = buildQuoteableProductOptions({
    year,
    channel: "Horeca",
    channels: [{ code: "horeca", default_marge_pct: 40 }],
    bieren: [
      { id: "beer-a", biernaam: "A Bier" },
      { id: "beer-b", biernaam: "B Bier" },
    ],
    skus: [
      {
        id: "sku-a",
        kind: "beer_format",
        beer_id: "beer-a",
        format_article_id: "fmt-a",
        name: "A Bier - Fles",
      },
      {
        id: "sku-b",
        kind: "beer_format",
        beer_id: "beer-b",
        format_article_id: "fmt-b",
        name: "B Bier - Fles",
      },
      {
        id: "sku-service-z",
        kind: "article",
        article_id: "article-z",
        name: "Z Service",
        payload: { manual_rate_ex: 100 },
      },
    ],
    articles: [
      { id: "fmt-a", kind: "format", name: "Fles A", uom: "stuk", content_liter: 0.33 },
      { id: "fmt-b", kind: "format", name: "Fles B", uom: "stuk", content_liter: 0.33 },
      { id: "article-z", kind: "article", name: "Z Service", uom: "uur", payload: { sellable_subtype: "dienst" } },
    ],
    kostprijsversies: [
      {
        id: "kpv",
        basisgegevens: { btw_tarief: "21%" },
        resultaat_snapshot: {
          producten: {
            basisproducten: [
              { sku_id: "sku-a", product_id: "fmt-a", kostprijs: 1, vaste_kosten: 0.1 },
              { sku_id: "sku-b", product_id: "fmt-b", kostprijs: 1, vaste_kosten: 0.1 },
            ],
            samengestelde_producten: [],
          },
        },
      },
    ],
    kostprijsproductactiveringen: [
      { id: "act-a", sku_id: "sku-a", jaar: year, effectief_vanaf: "2026-01-01T00:00:00Z", effectief_tot: "", kostprijsversie_id: "kpv", bier_id: "beer-a", product_id: "fmt-a" },
      { id: "act-b", sku_id: "sku-b", jaar: year, effectief_vanaf: "2026-01-01T00:00:00Z", effectief_tot: "", kostprijsversie_id: "kpv", bier_id: "beer-b", product_id: "fmt-b" },
    ],
    verkoopprijzen: [],
    basisproducten: [],
    samengesteldeProducten: [],
  });

  const optionIds = result.options.map((o) => o.optionId);

  // Ordering invariant (current behavior):
  // - Product facts are sorted by label (from buildProductFacts)
  // - Services are appended afterwards (in buildQuoteableProductOptions)
  const expectedFirstTwo = ["sku:sku-a", "sku:sku-b"];
  assert(
    optionIds[0] === expectedFirstTwo[0] && optionIds[1] === expectedFirstTwo[1],
    `Expected first two options to be ${expectedFirstTwo.join(", ")}, got ${optionIds.slice(0, 2).join(", ")}`
  );

  const last = optionIds[optionIds.length - 1];
  assert(
    last === "sku:sku-service-z",
    `Expected service to be appended last, got last=${last}`
  );
}

run();
console.log("quoteOptionOrdering contracttest OK");

