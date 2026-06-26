import type { GenericRecord, SetupCheck, SetupStatus } from "@/components/beheer/data-quality/DataQualityTypes";

export function pct(check: SetupCheck) {
  if (!check.total) return check.done ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((Number(check.current || 0) / Number(check.total || 1)) * 100)));
}

export function statusLabel(check: SetupCheck) {
  if (check.done) return "ok";
  if (check.current > 0) return "actie nodig";
  return "niet gestart";
}

export function valuePreview(row: GenericRecord) {
  const parts = [
    row.douano_name || row.product_name,
    row.sku_id,
    row.sku_code || row.sku,
    row.lot_number,
    row.transaction_number,
    row.oorzaak,
    row.cost_status,
    row.douano_product_id,
    row.actie,
    row.regels ? `${row.regels} regels` : "",
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" - ") : JSON.stringify(row);
}

export function rowMatchPayload(row: GenericRecord) {
  const douanoProductId = Number(row.douano_product_id ?? 0) || 0;
  if (douanoProductId > 0) {
    return {
      match_type: "douano_product_id",
      douano_product_id: douanoProductId,
      line_description: "",
    };
  }
  return {
    match_type: "product0_description",
    douano_product_id: 0,
    line_description: String(row.douano_name || row.product_name || "").trim(),
  };
}

export function missingRowKey(row: GenericRecord) {
  const match = rowMatchPayload(row);
  return `${match.match_type}:${match.douano_product_id}:${match.line_description}`;
}

export function searchableMissingRowText(row: GenericRecord) {
  return [
    valuePreview(row),
    row.douano_name,
    row.product_name,
    row.sku_id,
    row.sku_code,
    row.sku,
    row.lot_number,
    row.transaction_number,
    row.oorzaak,
    row.cost_status,
    row.douano_product_id,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

export function checkById(status: SetupStatus, ids: string[]) {
  return ids.map((id) => status.checks.find((check) => check.id === id)).filter(Boolean) as SetupCheck[];
}

export function qualityChecks(status: SetupStatus) {
  return checkById(status, [
    "douano_products",
    "sales_invoices",
    "product_mappings",
    "stock_history_sync",
    "stock_history_lots",
    "sales_rows_cost_source",
  ]);
}

export function hasMissing(checks: SetupCheck[]) {
  return checks.some((check) => Array.isArray(check.missing) && check.missing.length > 0);
}

export function flowHref(href?: string) {
  if (!href) return "";
  if (href === "/beheer/productkoppelingen") return "/beheer/productkoppeling";
  if (href === "/instellingen/kostprijsbeheer") return "/nieuwe-kostprijsberekening";
  return href;
}

export function skuLabel(row: GenericRecord) {
  const name = String(row.name || row.sku_name || "").trim();
  const code = String(row.code || row.sku || "").trim();
  return [name, code].filter(Boolean).join(" - ") || String(row.id || "");
}

export function defaultHistoricalDate(year: number) {
  const safeYear = Number(year || new Date().getFullYear()) || new Date().getFullYear();
  return `${safeYear}-01-01`;
}

export async function readDataSet<T = GenericRecord>(name: string): Promise<T[]> {
  const response = await fetch(`/api/data/${encodeURIComponent(name)}`, { cache: "no-store", credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((payload as any)?.detail || response.statusText));
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray((payload as any)?.items)) return (payload as any).items as T[];
  if (Array.isArray((payload as any)?.data)) return (payload as any).data as T[];
  return [];
}

export function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nl-NL");
}

export function syncDelta(stats?: GenericRecord) {
  if (!stats) return "-";
  const values = [
    ["opgehaald", stats.fetched],
    ["opgeslagen", stats.saved],
    ["upserted", stats.upserted],
    ["regels", stats.lines],
    ["zonder LOT", stats.missing_lot],
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${Number(value) || 0}`);
  return values.length ? values.join(" / ") : "-";
}
