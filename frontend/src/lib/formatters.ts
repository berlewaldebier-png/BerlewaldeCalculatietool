"use client";

// Centralized number formatting to keep tables consistent across the app.
// NOTE: Keep these pure and UI-agnostic; components can wrap values as needed.

const EUR_FORMATTER = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const NUMBER_0_2 = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const NUMBER_2 = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const PERCENT_0_2 = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundTo(value: unknown, decimals: number) {
  const n = toFiniteNumber(value, 0);
  const factor = 10 ** Math.max(0, Math.min(6, Math.floor(decimals)));
  return Math.round(n * factor) / factor;
}

export function formatMoneyEUR(value: unknown) {
  const n = toFiniteNumber(value, 0);
  return EUR_FORMATTER.format(n);
}

export function formatNumber0to2(value: unknown) {
  const n = toFiniteNumber(value, 0);
  return NUMBER_0_2.format(n);
}

export function formatNumber2(value: unknown) {
  const n = toFiniteNumber(value, 0);
  return NUMBER_2.format(n);
}

export function formatPercent0to2(value: unknown, { suffix = "%" }: { suffix?: string } = {}) {
  const n = toFiniteNumber(value, 0);
  return `${PERCENT_0_2.format(n)}${suffix}`;
}

