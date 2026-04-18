"use client";

import { formatMoneyEUR, formatPercent0to2, formatNumber2 } from "@/lib/formatters";

export function ReadonlyMoneyCell({ value }: { value: unknown }) {
  return <div className="dataset-input dataset-input-readonly">{formatMoneyEUR(value)}</div>;
}

export function ReadonlyPercentCell({ value }: { value: unknown }) {
  return <div className="dataset-input dataset-input-readonly">{formatPercent0to2(value)}</div>;
}

export function ReadonlyNumber2Cell({ value }: { value: unknown }) {
  return <div className="dataset-input dataset-input-readonly">{formatNumber2(value)}</div>;
}

export function ReadonlyTextCell({ value }: { value: unknown }) {
  return <div className="dataset-input dataset-input-readonly">{String(value ?? "")}</div>;
}

