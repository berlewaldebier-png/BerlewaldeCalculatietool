import assert from "node:assert/strict";

import {
  calculateComponentCostprice,
  calculateDerivedChildCostprice,
  calculateDirectSkuCostprice,
} from "../src/lib/costpriceCalculationEngine";

const direct = calculateDirectSkuCostprice({
  primaryCost: 22.75,
  packagingCost: 0,
  overheadCost: 11.25,
  exciseCost: 3.86,
  liters: 7.92,
  sourceLabel: "contracttest",
});
assert.equal(direct.status, "ok");
assert.equal(Number(direct.kostprijs.toFixed(2)), 37.86);

const child = calculateDerivedChildCostprice({
  parent: direct,
  factor: 24,
  extraPackagingCost: 0,
  parentLabel: "Doos 24 * 33cl",
});
assert.equal(child.status, "ok");
assert.equal(Number(child.primaire_kosten.toFixed(2)), 0.95);
assert.equal(Number(child.verpakkingskosten.toFixed(2)), 0);
assert.equal(Number(child.vaste_kosten.toFixed(2)), 0.47);
assert.equal(Number(child.accijns.toFixed(2)), 0.16);

const giftset = calculateComponentCostprice({
  parentArticleId: "giftset-2",
  year: 2026,
  bomLines: [
    {
      parent_article_id: "giftset-2",
      component_sku_id: "sku-fles-33cl",
      quantity: 2,
    },
    {
      parent_article_id: "giftset-2",
      component_article_id: "giftbox-2",
      quantity: 1,
    },
  ],
  skus: [
    {
      id: "sku-fles-33cl",
      name: "Fles 33cl",
      kind: "beer_format",
      format_article_id: "fmt-fles-33cl",
    },
  ],
  articles: [
    {
      id: "giftbox-2",
      name: "Geschenkdoos 2",
      kind: "packaging_component",
    },
  ],
  summaryRows: [
    {
      sku_id: "sku-fles-33cl",
      primaire_kosten: child.primaire_kosten,
      verpakkingskosten: child.verpakkingskosten,
      vaste_kosten: child.vaste_kosten,
      accijns: child.accijns,
      kostprijs: child.kostprijs,
    },
  ],
  packagingComponentPrices: [
    {
      jaar: 2026,
      verpakkingsonderdeel_id: "giftbox-2",
      prijs_per_stuk: 0.91,
    },
  ],
});

assert.equal(giftset.valid, true);
assert.equal(Number(giftset.primaire_kosten.toFixed(2)), 1.9);
assert.equal(Number(giftset.verpakkingskosten.toFixed(2)), 0.91);
assert.equal(Number(giftset.vaste_kosten.toFixed(2)), 0.94);
assert.equal(Number(giftset.accijns.toFixed(2)), 0.32);

console.log("costpriceCalculationEngine contracttest OK");
