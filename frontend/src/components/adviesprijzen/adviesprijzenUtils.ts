import { formatMoneyEUR } from "@/lib/formatters";
import { toFiniteNumber } from "@/lib/pricingEngine";

export function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function parseBtwPct(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function money(value: number) {
  return formatMoneyEUR(toFiniteNumber(value, 0));
}

