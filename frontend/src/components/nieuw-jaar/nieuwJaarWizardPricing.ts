"use client";

import { computeVasteKostenTotals } from "@/lib/kostprijsEngine";
import {
  computeAccijnsForLiters as computeAccijnsForLitersEngine,
  computeFixedCostPerLiter as computeFixedCostPerLiterEngine,
} from "@/lib/kostprijsSnapshotEngine";

type GenericRecord = Record<string, unknown>;

export function calcSellInPrice(cost: number, marginPct: number) {
  const margin = Number(marginPct ?? 0);
  if (!Number.isFinite(margin)) return cost;
  if (margin >= 100) return cost;
  return cost / Math.max(0.0001, 1 - margin / 100);
}

export function computeHerverdelingTotals(rows: Array<Record<string, unknown>>) {
  return computeVasteKostenTotals(rows as any);
}

export function computeIndirectFixedCostPerInkoopLiter(args: {
  year: number;
  productieYear: unknown;
  vasteKostenRows: unknown;
}) {
  return computeFixedCostPerLiterEngine({
    calcType: "inkoop",
    year: args.year,
    productieYear: args.productieYear as any,
    vasteKostenRows: args.vasteKostenRows as any
  });
}

export function computeDirectFixedCostPerProductieLiter(args: {
  year: number;
  productieYear: unknown;
  vasteKostenRows: unknown;
}) {
  return computeFixedCostPerLiterEngine({
    calcType: "eigen_productie",
    year: args.year,
    productieYear: args.productieYear as any,
    vasteKostenRows: args.vasteKostenRows as any
  });
}

export function computeFixedCostPerLiter(args: {
  calcType: "inkoop" | "eigen_productie";
  year: number;
  productieYear: unknown;
  vasteKostenRows: unknown;
}) {
  return computeFixedCostPerLiterEngine({
    calcType: args.calcType,
    year: args.year,
    productieYear: args.productieYear as any,
    vasteKostenRows: args.vasteKostenRows as any
  });
}

export function computeAccijnsForLiters(args: {
  year: number;
  record: any;
  liters: number;
  tarievenHeffingenRow: any | null;
}) {
  const { year, record, liters, tarievenHeffingenRow } = args;
  const basis = typeof record?.basisgegevens === "object" && record?.basisgegevens ? record.basisgegevens : {};
  const bierSnap = typeof record?.bier_snapshot === "object" && record?.bier_snapshot ? record.bier_snapshot : {};
  if (!Number.isFinite(liters) || liters <= 0) return 0;
  if (!tarievenHeffingenRow) return 0;
  return computeAccijnsForLitersEngine({
    year,
    liters,
    basisgegevens: basis,
    bierSnapshot: bierSnap,
    tarievenHeffingenRow
  });
}
