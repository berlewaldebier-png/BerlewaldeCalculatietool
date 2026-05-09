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
  const { buildProductFacts } = require("../src/lib/productFacts") as {
    buildProductFacts: typeof import("../src/lib/productFacts").buildProductFacts;
  };

  const year = 2025;

  const result = buildProductFacts({
    year,
    channelCode: null,
    onlyReady: false,
    channels: [],
    verkoopprijzen: [],
    bieren: [{ id: "beer-blond", biernaam: "Berlewalde Blond" }],
    skus: [
      {
        id: "sku-blond-33cl",
        kind: "beer_format",
        beer_id: "beer-blond",
        format_article_id: "fmt-bottle-33cl",
        name: "Berlewalde blond - Fles 33cl",
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
    ],
    kostprijsversies: [
      {
        id: "kpv-blond-2025",
        basisgegevens: { btw_tarief: "21%" },
        cost_lines: [
          {
            sku_id: "sku-blond-33cl",
            product_id: "fmt-bottle-33cl",
            kostprijs: 1.34,
            vaste_kosten: 0.12,
          },
        ],
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
    // Duplicate activations for the same SKU/year must not create duplicate facts.
    kostprijsproductactiveringen: [
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
    ],
    basisproducten: [],
    samengesteldeProducten: [],
  });

  const blondFacts = result.facts.filter((f) => f.ref === "sku:sku-blond-33cl");
  assert(
    blondFacts.length === 1,
    `Expected exactly 1 fact for sku:sku-blond-33cl, got ${blondFacts.length}`
  );
}

run();
console.log("activationUniqueness contracttest OK");

