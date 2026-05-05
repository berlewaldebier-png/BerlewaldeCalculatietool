"use client";

import { clampNumber } from "@/components/nieuw-jaar/nieuwJaarWizardUtils";

export type IngredientRule = {
  prijs?: unknown;
  hoeveelheid?: unknown;
  benodigd_in_recept?: unknown;
};

export type EigenProductieOverride = {
  ingredienten?: IngredientRule[];
};

export function calculateEigenProductiePrijsPerEenheid(regel: Partial<IngredientRule>) {
  const prijs = Number(regel.prijs ?? 0);
  const hoeveelheid = Number(regel.hoeveelheid ?? 0);
  if (!Number.isFinite(prijs) || !Number.isFinite(hoeveelheid) || hoeveelheid <= 0) return 0;
  return prijs / hoeveelheid;
}

export function calculateEigenProductieKostenRecept(regel: Partial<IngredientRule>) {
  return calculateEigenProductiePrijsPerEenheid(regel) * Number(regel.benodigd_in_recept ?? 0);
}

export function computeEigenProductieReceptTotals(override: EigenProductieOverride | null, batchGrootteLiters: number) {
  const regels = override?.ingredienten ?? [];
  const leveranciersTotaal = regels.reduce((sum, regel) => sum + Number((regel as any)?.prijs ?? 0), 0);
  const receptTotaal = regels.reduce((sum, regel) => sum + calculateEigenProductieKostenRecept(regel), 0);
  const literPrijs = batchGrootteLiters > 0 ? receptTotaal / batchGrootteLiters : 0;
  return {
    leveranciersTotaal,
    receptTotaal,
    literPrijs
  };
}

// NOTE: In verkoopstrategie we persist opslag% as the source of truth (legacy field name `sell_in_margins`).
export function computeSellInPrice(cost: number, opslagPct: number) {
  const c = clampNumber(cost, 0);
  const o = clampNumber(opslagPct, 0);
  return c * (1 + o / 100);
}

export function computeMarginFromSellIn(cost: number, sellIn: number) {
  // Backwards-compatible name; this now returns opslag% derived from sell-in price.
  const c = clampNumber(cost, 0);
  const p = clampNumber(sellIn, 0);
  if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0) return 0;
  const opslag = (p / c - 1) * 100;
  if (!Number.isFinite(opslag)) return 0;
  return Math.max(0, opslag);
}

