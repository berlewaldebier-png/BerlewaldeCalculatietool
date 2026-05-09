export type GenericRecord = Record<string, unknown>;

export type CompositionLine = {
  id: string;
  componentSkuId: string;
  qty: number;
};

export type GenericRecord = Record<string, unknown>;

export type PackagingLine = {
  id: string;
  kind: "packaging_component" | "format";
  componentId: string;
  qty: number;
};

export function text(value: unknown) {
  return String(value ?? "").trim();
}

export function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function slugifyId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || `new-${Date.now()}`;
}

