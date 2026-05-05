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
  const { buildCentralSkuIndex } = require("../src/features/sku/centralSkuIndex") as {
    buildCentralSkuIndex: typeof import("../src/features/sku/centralSkuIndex").buildCentralSkuIndex;
  };

  const year = 2025;

  const channels = [
    { code: "horeca", default_marge_pct: 40 },
    { code: "retail", default_marge_pct: 30 },
  ];

  const verkoopprijzen: any[] = [];

  const skus = [
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
  ];

  const articles = [
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
  ];

  const kostprijsversies = [
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
  ];

  const kostprijsproductactiveringen = [
    {
      id: "activation-old",
      sku_id: "sku-blond-33cl",
      jaar: year,
      effectief_vanaf: "2026-01-01T00:00:00Z",
      effectief_tot: "",
      kostprijsversie_id: "kpv-blond-2025",
      bier_id: "beer-blond",
      product_id: "fmt-bottle-33cl",
    },
    {
      id: "activation-new",
      sku_id: "sku-blond-33cl",
      jaar: year,
      effectief_vanaf: "2026-02-01T00:00:00Z",
      effectief_tot: "",
      kostprijsversie_id: "kpv-blond-2025",
      bier_id: "beer-blond",
      product_id: "fmt-bottle-33cl",
    },
  ];

  const index = buildCentralSkuIndex({
    year,
    channels,
    verkoopprijzen,
    skus,
    articles,
    kostprijsversies,
    kostprijsproductactiveringen,
  });

  assert(index.rows.length > 0, "Expected at least one SKU row.");
  assert(
    index.bySkuId.size === index.rows.length,
    "Expected bySkuId to be a 1:1 map of rows."
  );

  const seen = new Set<string>();
  for (const row of index.rows) {
    assert(!seen.has(row.skuId), `Duplicate skuId in CentralSkuIndex rows: ${row.skuId}`);
    seen.add(row.skuId);
  }

  const blond = index.bySkuId.get("sku-blond-33cl");
  assert(blond, "Expected cost_plus beer_format SKU to exist in index.");
  assert(blond.isActive === true, "Expected active activation to make SKU isActive=true.");
  assert(
    blond.hasActiveCost === true,
    "Expected cost_plus SKU with kostprijs > 0 to have hasActiveCost=true."
  );
  assert(Math.abs(blond.kostprijsEx - 1.34) < 1e-9, "Expected kostprijsEx to come from snapshot row.");
  assert(blond.pricingMethod === "cost_plus", "Expected beer_format SKU to be cost_plus.");
  assert(blond.subtype === "bier", "Expected beer_format SKU to have subtype=bier.");

  const proeverij = index.bySkuId.get("sku-service-proeverij");
  assert(proeverij, "Expected manual_rate service SKU to exist in index.");
  assert(proeverij.pricingMethod === "manual_rate", "Expected service SKU to be manual_rate.");
  assert(proeverij.subtype === "dienst", "Expected service SKU to have subtype=dienst.");
  assert(
    proeverij.isActive === false,
    "Expected manual_rate services to be present without an activation."
  );
  assert(
    Math.abs(proeverij.manualRateEx - 125) < 1e-9,
    "Expected service manualRateEx to be read from payload."
  );
}

run();

console.log("centralSkuIndex contracttest OK");
