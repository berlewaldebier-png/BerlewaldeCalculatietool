import {
  calcAdviesprijsInclBtwRange,
  calcMarginPctFromOpslagPct,
  calcOfferLineTotals,
  calcOpslagPctFromSellInEx,
  calcSellInExFromOpslagPct,
  roundDownTo5Cents
} from "../src/lib/pricingEngine";

function approxEqual(actual: number, expected: number, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`Expected ~${expected}, got ${actual}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

// 1) opslag -> sell-in, and derived margin contract
{
  const sell = calcSellInExFromOpslagPct(10, 50);
  approxEqual(sell, 15);
  const margin = calcMarginPctFromOpslagPct(50);
  approxEqual(margin, 33.3333333333, 1e-6);
  const opslagBack = calcOpslagPctFromSellInEx(10, 15);
  approxEqual(opslagBack, 50);
}

// 2) offer totals contract
{
  const totals = calcOfferLineTotals({ kostprijsEx: 2, offerPriceEx: 4, qty: 10, kortingPct: 25 });
  approxEqual(totals.omzet, 30);
  approxEqual(totals.kosten, 20);
  approxEqual(totals.kortingEur, 10);
  approxEqual(totals.winst, 10);
  approxEqual(totals.margePct, 33.3333333333, 1e-6);
}

// 3) advice price rounding contract
{
  const floored = roundDownTo5Cents(4.3318);
  approxEqual(floored, 4.3);

  const range = calcAdviesprijsInclBtwRange({
    kostprijsEx: 3.58,
    sellInEx: 3.58,
    adviesOpslagPct: 0,
    btwPct: 21
  });
  approxEqual(range.min, 4.25);
  approxEqual(range.max, 4.35);
  assert(range.margeKlantPct >= 0, "Expected non-negative customer margin");
}

console.log("pricingEngine contracttest OK");

