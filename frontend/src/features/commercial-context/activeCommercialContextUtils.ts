import type { GenericRecord } from "@/features/commercial-context/activeCommercialContextTypes";

export function record(value: unknown): GenericRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenericRecord)
    : {};
}

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
