export type SortDir = "asc" | "desc";

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function buildPageItems(current: number, total: number) {
  const clamp = (value: number) => Math.min(Math.max(1, value), total);
  const c = clamp(current);
  const items: Array<number | "..."> = [];
  if (total <= 1) return [1];
  items.push(1);

  const windowStart = Math.max(2, c - 2);
  const windowEnd = Math.min(total - 1, c + 2);
  if (windowStart > 2) items.push("...");
  for (let p = windowStart; p <= windowEnd; p += 1) items.push(p);
  if (windowEnd < total - 1) items.push("...");
  items.push(total);
  return items;
}

export function computeTotalPages(totalItems: number, pageSize: number) {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
}

export function clampPage(page: number, totalPages: number) {
  const t = Math.max(1, totalPages);
  return Math.min(Math.max(1, page), t);
}

export function slicePage<T>(rows: T[], page: number, pageSize: number) {
  if (pageSize <= 0) return rows;
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function compareNullableNumber(a: unknown, b: unknown, dir: SortDir) {
  const av = typeof a === "number" && Number.isFinite(a) ? a : Number(a);
  const bv = typeof b === "number" && Number.isFinite(b) ? b : Number(b);
  const aNum = Number.isFinite(av) ? av : -Infinity;
  const bNum = Number.isFinite(bv) ? bv : -Infinity;
  const delta = aNum - bNum;
  if (delta === 0) return 0;
  return dir === "asc" ? (delta < 0 ? -1 : 1) : delta < 0 ? 1 : -1;
}

export function compareText(a: unknown, b: unknown, dir: SortDir) {
  const at = normalizeText(a);
  const bt = normalizeText(b);
  if (at === bt) return 0;
  if (dir === "asc") return at < bt ? -1 : 1;
  return at < bt ? 1 : -1;
}

