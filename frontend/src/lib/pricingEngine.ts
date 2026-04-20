// Central pricing engine (pure functions).
// Single source of truth for:
// - markup (opslag) input
// - derived margin
// - sell-in pricing
// - offer totals (revenue/cost/margin)
// - adviesprijzen rounding rules

export function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundTo(value: unknown, decimals: number) {
  const n = toFiniteNumber(value, 0);
  const factor = 10 ** Math.max(0, Math.min(6, Math.floor(decimals)));
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

export const round2 = (value: unknown) => roundTo(value, 2);

export function parseNumberLoose(raw: string) {
  const cleaned = String(raw ?? "").trim().replace(",", ".");
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function clampPct(value: unknown, { min = 0, max = 9999 }: { min?: number; max?: number } = {}) {
  const n = toFiniteNumber(value, 0);
  return Math.min(max, Math.max(min, n));
}

// Sell-in price excluding VAT from cost and markup%.
export function calcSellInExFromOpslagPct(costEx: number, opslagPct: number) {
  const c = toFiniteNumber(costEx, 0);
  const o = clampPct(opslagPct, { min: 0, max: 9999 });
  return c * (1 + o / 100);
}

// Backwards compatible alias (legacy name used in components).
export const calcSellPriceFromOpslagPct = calcSellInExFromOpslagPct;

// Derived margin% (profit / revenue) from markup%.
export function calcMarginPctFromOpslagPct(opslagPct: number) {
  const o = clampPct(opslagPct, { min: 0, max: 9999 });
  return (o / Math.max(0.0001, 100 + o)) * 100;
}

// Markup% derived from sell-in and cost.
export function calcOpslagPctFromSellInEx(costEx: number, sellInEx: number) {
  const c = toFiniteNumber(costEx, 0);
  const p = toFiniteNumber(sellInEx, 0);
  if (c <= 0 || p <= 0) return 0;
  return Math.max(0, (p / c - 1) * 100);
}

// Backwards compatible alias (legacy name used in components).
export const calcOpslagPctFromSellInPrice = calcOpslagPctFromSellInEx;

// Margin% derived from sell-in and cost.
export function calcMarginPctFromSellInEx(costEx: number, sellInEx: number) {
  const c = toFiniteNumber(costEx, 0);
  const p = toFiniteNumber(sellInEx, 0);
  if (p <= 0) return 0;
  const m = (1 - c / p) * 100;
  if (!Number.isFinite(m)) return 0;
  return Math.min(99.9, Math.max(0, m));
}

export function applyDiscountPct(priceEx: number, kortingPct: number) {
  const p = toFiniteNumber(priceEx, 0);
  const k = clampPct(kortingPct, { min: 0, max: 100 });
  return p * Math.max(0, 1 - k / 100);
}

export function calcOfferLineTotals({
  kostprijsEx,
  offerPriceEx,
  qty,
  kortingPct,
  feeExPerUnit = 0,
  retourPct = 0
}: {
  kostprijsEx: number;
  offerPriceEx: number;
  qty: number;
  kortingPct: number;
  feeExPerUnit?: number;
  retourPct?: number;
}) {
  const q = Math.max(0, toFiniteNumber(qty, 0));
  const unitList = toFiniteNumber(offerPriceEx, 0);
  const unitNet = applyDiscountPct(unitList, kortingPct);
  const unitFee = Math.max(0, toFiniteNumber(feeExPerUnit, 0));
  const unitAfterFee = Math.max(0, unitNet - unitFee);
  const omzetBeforeRetour = q * unitAfterFee;
  const retour = clampPct(retourPct, { min: 0, max: 100 });
  const retourEur = omzetBeforeRetour * (retour / 100);
  const omzet = Math.max(0, omzetBeforeRetour - retourEur);
  const kosten = q * Math.max(0, toFiniteNumber(kostprijsEx, 0));
  const kortingEur = q * Math.max(0, unitList - unitNet);
  const feeEur = q * unitFee;
  const winst = omzet - kosten;
  const margePct = omzet > 0 ? (winst / omzet) * 100 : 0;
  return { omzet, kosten, kortingEur, feeEur, retourEur, winst, margePct };
}

export function calcOfferLineTotalsWithGratis({
  kostprijsEx,
  offerPriceEx,
  qty,
  freeQty
}: {
  kostprijsEx: number;
  offerPriceEx: number;
  qty: number;
  freeQty: number;
}) {
  const q = Math.max(0, toFiniteNumber(qty, 0));
  const free = Math.min(q, Math.max(0, toFiniteNumber(freeQty, 0)));
  const paid = Math.max(0, q - free);
  const unit = Math.max(0, toFiniteNumber(offerPriceEx, 0));
  const omzet = paid * unit;
  const kosten = q * Math.max(0, toFiniteNumber(kostprijsEx, 0));
  const kortingEur = free * unit;
  const winst = omzet - kosten;
  const margePct = omzet > 0 ? (winst / omzet) * 100 : 0;
  return { omzet, kosten, kortingEur, winst, margePct };
}

// X+Y gratis helpers ---------------------------------------------------------

export function calcGratisTotalFreeQtyFromPaid({
  totalPaidQty,
  requiredQty,
  freeQty
}: {
  totalPaidQty: number;
  requiredQty: number;
  freeQty: number;
}) {
  const paid = Math.max(0, Math.floor(toFiniteNumber(totalPaidQty, 0)));
  const req = Math.max(1, Math.floor(toFiniteNumber(requiredQty, 1)));
  const free = Math.max(1, Math.floor(toFiniteNumber(freeQty, 1)));
  const groups = Math.floor(paid / req);
  return Math.max(0, groups * free);
}

export function allocateGratisCheapest({
  units,
  totalFreeQty
}: {
  units: Array<{ ref: string; unitPriceEx: number; qtyPaid: number }>;
  totalFreeQty: number;
}) {
  const freeTotal = Math.max(0, Math.floor(toFiniteNumber(totalFreeQty, 0)));
  if (freeTotal <= 0) return new Map<string, number>();

  const sorted = units
    .map((unit) => ({
      ref: String(unit.ref ?? ""),
      unitPriceEx: Math.max(0, toFiniteNumber(unit.unitPriceEx, 0)),
      qtyPaid: Math.max(0, Math.floor(toFiniteNumber(unit.qtyPaid, 0)))
    }))
    .filter((unit) => unit.ref && unit.qtyPaid > 0)
    .sort((a, b) => a.unitPriceEx - b.unitPriceEx);

  const freeByRef = new Map<string, number>();
  let remaining = freeTotal;
  for (const unit of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, unit.qtyPaid);
    if (take > 0) {
      freeByRef.set(unit.ref, (freeByRef.get(unit.ref) ?? 0) + take);
      remaining -= take;
    }
  }

  return freeByRef;
}

export function computeGratisFreeByRefFromPaidRows({
  rows,
  requiredQty,
  freeQty,
  eligibleRefs
}: {
  rows: Array<{ included: boolean; ref: string; qtyPaid: number; unitPriceEx: number }>;
  requiredQty: number;
  freeQty: number;
  eligibleRefs: string[];
}) {
  const eligibleSet = new Set((eligibleRefs ?? []).filter(Boolean));
  const units: Array<{ ref: string; unitPriceEx: number; qtyPaid: number }> = [];
  let totalPaid = 0;

  for (const row of rows) {
    if (!row.included) continue;
    const qtyPaid = Math.max(0, Math.floor(toFiniteNumber(row.qtyPaid, 0)));
    if (qtyPaid <= 0) continue;
    const ref = String(row.ref ?? "");
    if (!ref) continue;
    if (eligibleSet.size > 0 && !eligibleSet.has(ref)) continue;
    const unitPriceEx = Math.max(0, toFiniteNumber(row.unitPriceEx, 0));
    units.push({ ref, unitPriceEx, qtyPaid });
    totalPaid += qtyPaid;
  }

  const totalFree = calcGratisTotalFreeQtyFromPaid({ totalPaidQty: totalPaid, requiredQty, freeQty });
  const freeByRef = allocateGratisCheapest({ units, totalFreeQty: totalFree });
  return { totalFree, freeByRef };
}

export function calcMarginPctFromRevenueCost(omzet: number, kosten: number) {
  const r = toFiniteNumber(omzet, 0);
  const c = toFiniteNumber(kosten, 0);
  if (r <= 0) return 0;
  return ((r - c) / r) * 100;
}

export function toInclBtw(priceEx: number, btwPct: number) {
  const p = toFiniteNumber(priceEx, 0);
  const b = clampPct(btwPct, { min: 0, max: 100 });
  return p * (1 + b / 100);
}

export function fromInclBtw(priceIncl: number, btwPct: number) {
  const p = toFiniteNumber(priceIncl, 0);
  const b = clampPct(btwPct, { min: 0, max: 100 });
  return (1 + b / 100) > 0 ? p / (1 + b / 100) : p;
}

export function roundDownTo5Cents(amount: number) {
  const n = Math.max(0, toFiniteNumber(amount, 0));
  return Math.floor(n * 20) / 20; // 0.05 steps
}

export function calcAdviesprijsInclBtwRange({
  kostprijsEx,
  sellInEx,
  adviesOpslagPct,
  btwPct
}: {
  kostprijsEx: number;
  sellInEx: number;
  adviesOpslagPct: number;
  btwPct: number;
}) {
  // Advice price is based on sell-in (ex) + advice markup, then VAT is applied, rounded down to 0.05.
  const sellEx = toFiniteNumber(sellInEx, 0);
  const opslag = clampPct(adviesOpslagPct, { min: 0, max: 9999 });
  const inclRaw = toInclBtw(sellEx * (1 + opslag / 100), btwPct);
  const inclRounded = roundDownTo5Cents(inclRaw);
  const min = Math.max(0, inclRounded - 0.05);
  const max = inclRounded + 0.05;

  // Margin for the customer is derived from advice price ex VAT.
  const adviesEx = fromInclBtw(inclRounded, btwPct);
  const margeKlantPct = calcMarginPctFromSellInEx(toFiniteNumber(kostprijsEx, 0), adviesEx);

  return { inclRounded, min, max, margeKlantPct };
}
