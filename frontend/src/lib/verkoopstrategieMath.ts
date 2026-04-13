export const round2 = (v: number) => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;

export const parseNumberLoose = (raw: string) => {
  const cleaned = String(raw ?? "").trim().replace(",", ".");
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const calcSellPrice = (cost: number, margin: number) =>
  Number(margin ?? 0) >= 100 ? Number(cost ?? 0) : Number(cost ?? 0) / Math.max(0.0001, 1 - Number(margin ?? 0) / 100);

export const calcSellPriceFromOpslagPct = (cost: number, opslagPct: number) => {
  const c = Number(cost ?? 0);
  const o = Math.max(0, Number(opslagPct ?? 0));
  if (!Number.isFinite(c) || !Number.isFinite(o)) return 0;
  return c * (1 + o / 100);
};

export const calcMarginPctFromSellInPrice = (cost: number, sellInPrice: number) => {
  const c = Number(cost ?? 0);
  const p = Number(sellInPrice ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return 0;
  const margin = (1 - c / p) * 100;
  if (!Number.isFinite(margin)) return 0;
  return Math.min(99.9, Math.max(0, margin));
};

export const calcOpslagPctFromMarginPct = (marginPct: number) => {
  const m = Math.min(99.9, Math.max(0, Number(marginPct ?? 0)));
  if (m >= 99.9) return 9999;
  return (m / Math.max(0.0001, 100 - m)) * 100;
};

export const calcMarginPctFromOpslagPct = (opslagPct: number) => {
  const o = Math.max(0, Number(opslagPct ?? 0));
  return (o / Math.max(0.0001, 100 + o)) * 100;
};

export const calcOpslagPctFromSellInPrice = (cost: number, sellInPrice: number) => {
  const c = Number(cost ?? 0);
  const p = Number(sellInPrice ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0) return 0;
  const opslag = (p / c - 1) * 100;
  if (!Number.isFinite(opslag)) return 0;
  return Math.max(0, opslag);
};
