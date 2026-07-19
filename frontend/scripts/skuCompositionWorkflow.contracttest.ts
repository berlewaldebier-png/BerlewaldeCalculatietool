import { deepStrictEqual, equal } from "node:assert/strict";
import path from "node:path";

type SkuCompositionIoModule = typeof import("../src/features/sku-composition/skuCompositionIo");

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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function run() {
  installAtAliasResolverForCompiledTests();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { saveSellableSkuBundle } =
    require("../src/features/sku-composition/skuCompositionIo") as SkuCompositionIoModule;

  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  try {
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({
        article_id: "bundle-zwaar-onder-de-boom",
        sku_id: "sku-bundle-zwaar-onder-de-boom",
      });
    };

    const saved = await saveSellableSkuBundle({
      apiBaseUrl: "/api",
      name: "Zwaar onder de boom",
      uom: "pakket",
      totalsLiters: 0.99,
      sellableKind: "product",
      bundleContext: "giftset",
      beerId: "",
      manualRateEx: 0,
      productGroup: "giftset",
      alcoholCategory: "normaal",
      packagingType: "geschenkdoos",
      composition: [
        { id: "line-juweel", componentSkuId: "sku-juweel-fles-33cl", qty: 2 },
        { id: "line-blond", componentSkuId: "sku-blond-fles-33cl", qty: 1 },
        { id: "line-glas", componentSkuId: "sku-glas-33cl", qty: 1 },
      ],
      packaging: [
        { id: "line-giftbox", kind: "packaging_component", componentId: "giftbox-zwaar", qty: 1 },
      ],
    });

    equal(requestUrl, "/api/data/sku-composition/upsert-bundle", "FLOW-COMPOSE-001 endpoint changed");
    equal(requestInit?.method, "POST", "FLOW-COMPOSE-001 method changed");
    deepStrictEqual(
      JSON.parse(String(requestInit?.body ?? "{}")),
      {
        name: "Zwaar onder de boom",
        uom: "pakket",
        totals_liters: 0.99,
        sellable_kind: "product",
        bundle_context: "giftset",
        beer_id: "",
        manual_rate_ex: 0,
        product_group: "giftset",
        alcohol_category: "normaal",
        packaging_type: "geschenkdoos",
        composition: [
          { component_sku_id: "sku-juweel-fles-33cl", qty: 2 },
          { component_sku_id: "sku-blond-fles-33cl", qty: 1 },
          { component_sku_id: "sku-glas-33cl", qty: 1 },
        ],
        packaging: [
          { kind: "packaging_component", component_id: "giftbox-zwaar", qty: 1 },
        ],
        edit_article_id: "",
        edit_sku_id: "",
      },
      "FLOW-COMPOSE-001 wizard-to-API composition payload changed",
    );
    deepStrictEqual(
      saved,
      { articleId: "bundle-zwaar-onder-de-boom", skuId: "sku-bundle-zwaar-onder-de-boom" },
      "FLOW-COMPOSE-001 saved identifiers changed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run()
  .then(() => console.log("skuCompositionWorkflow contracttest OK (FLOW-COMPOSE-001)"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
