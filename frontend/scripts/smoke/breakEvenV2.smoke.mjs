// Smoke test for Break-even v2 (requires running app)
// Usage:
//   node ./scripts/smoke/breakEvenV2.smoke.mjs --year 2025
// Optional:
//   BASE_URL=http://localhost:3000 node ./scripts/smoke/breakEvenV2.smoke.mjs --year 2025

const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

function getArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const year = Number(getArg("--year", "2025"));
if (!Number.isFinite(year) || year < 2000) {
  console.error("Invalid --year");
  process.exit(2);
}

async function getJson(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof json?.detail === "string" ? json.detail : res.statusText;
    throw new Error(`${res.status} ${detail}`);
  }
  return json;
}

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

function num(value) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

const result = await getJson(`/api/integrations/douano/sales-by-sku?year=${encodeURIComponent(String(year))}&basis=invoice`);
const payload = result?.result ?? result;

assert(payload && typeof payload === "object", "payload is object");
assert(payload.year === year, "payload.year matches");
assert(Array.isArray(payload.items), "payload.items is array");

const items = payload.items;
const totalUnits = items.reduce((sum, r) => sum + num(r.units), 0);
const totalRevenue = items.reduce((sum, r) => sum + num(r.net_revenue_ex), 0);
const totalCost = items.reduce((sum, r) => sum + num(r.cost_total_ex), 0);

assert(totalUnits >= 0, "totalUnits >= 0");
assert(totalRevenue >= 0, "totalRevenue >= 0");
assert(totalCost >= 0, "totalCost >= 0");

console.log(JSON.stringify({
  ok: true,
  year,
  items: items.length,
  totals: { units: totalUnits, revenue_ex: totalRevenue, cost_ex: totalCost },
  unmapped_revenue_ex: num(payload?.unmapped?.total_net_revenue_ex),
}, null, 2));

