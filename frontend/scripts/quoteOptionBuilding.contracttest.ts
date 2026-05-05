import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run() {
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

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildQuoteableProductOptions } = require("../src/components/offerte-samenstellen/dataSources") as {
    buildQuoteableProductOptions: typeof import("../src/components/offerte-samenstellen/dataSources").buildQuoteableProductOptions;
  };

  const year = 2025;

  const result = buildQuoteableProductOptions({
    year,
    channel: "Horeca",
    channels: [{ code: "horeca", default_marge_pct: 40 }],
    bieren: [{ id: "beer-blond", biernaam: "Berlewalde Blond" }],
    skus: [
      {
        id: "sku-blond-33cl",
        kind: "beer_format",
        beer_id: "beer-blond",
        format_article_id: "fmt-bottle-33cl",
        name: "Berlewalde blond - Fles 33cl",
      },
      {
        id: "sku-service-proeverij",
        kind: "article",
        article_id: "article-proeverij",
        name: "Proeverij",
        payload: { manual_rate_ex: 125 },
      },
    ],
    articles: [
      {
        id: "fmt-bottle-33cl",
        kind: "format",
        name: "Fles 33cl",
        uom: "stuk",
        content_liter: 0.33,
      },
      {
        id: "article-proeverij",
        kind: "article",
        name: "Proeverij",
        uom: "uur",
        payload: { sellable_subtype: "dienst" },
      },
    ],
    kostprijsversies: [
      {
        id: "kpv-blond-2025",
        basisgegevens: { btw_tarief: "21%" },
        resultaat_snapshot: {
          producten: {
            basisproducten: [
              {
                sku_id: "sku-blond-33cl",
                product_id: "fmt-bottle-33cl",
                kostprijs: 1.34,
                vaste_kosten: 0.12,
              },
            ],
            samengestelde_producten: [],
          },
        },
      },
    ],
    kostprijsproductactiveringen: [
      {
        id: "activation",
        sku_id: "sku-blond-33cl",
        jaar: year,
        effectief_vanaf: "2026-02-01T00:00:00Z",
        effectief_tot: "",
        kostprijsversie_id: "kpv-blond-2025",
        bier_id: "beer-blond",
        product_id: "fmt-bottle-33cl",
      },
    ],
    verkoopprijzen: [],
    basisproducten: [],
    samengesteldeProducten: [],
  });

  assert(Array.isArray(result.options), "Expected options array.");
  assert(result.options.length >= 2, "Expected at least 2 options (product + service).");

  const seen = new Set<string>();
  for (const option of result.options) {
    assert(!seen.has(option.optionId), `Duplicate optionId in options: ${option.optionId}`);
    seen.add(option.optionId);
  }

  const blond = result.options.find((opt) => opt.optionId === "sku:sku-blond-33cl");
  assert(blond, "Expected cost_plus SKU option to exist.");
  assert(Math.abs(blond.costPriceEx - 1.34) < 1e-9, "Expected cost price from snapshot.");
  assert(blond.standardPriceEx > 0, "Expected sell-in to be computed from default opslag.");

  const service = result.options.find((opt) => opt.optionId === "sku:sku-service-proeverij");
  assert(service, "Expected service SKU option to exist.");
  assert(service.costPriceEx === 0, "Expected service costPriceEx to be 0.");
  assert(
    Math.abs(service.standardPriceEx - 125) < 1e-9,
    "Expected service standardPriceEx to be manual rate."
  );
}

run();

console.log("quoteOptionBuilding contracttest OK");
