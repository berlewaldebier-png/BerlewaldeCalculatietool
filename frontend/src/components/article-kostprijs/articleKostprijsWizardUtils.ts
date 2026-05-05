export type GenericRecord = Record<string, unknown>;

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function text(value: unknown) {
  return String(value ?? "").trim();
}

export function nowIso() {
  return new Date().toISOString();
}

export function unwrapDatasetListPayload(value: unknown): GenericRecord[] | null {
  if (Array.isArray(value)) return value as GenericRecord[];
  if (value && typeof value === "object") {
    const data = (value as any).data;
    if (Array.isArray(data)) return data as GenericRecord[];
  }
  return null;
}

