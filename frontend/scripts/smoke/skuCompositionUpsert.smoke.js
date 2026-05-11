/**
 * Smoke test: verify atomic SKU composition upsert endpoints.
 *
 * Usage (from frontend/):
 *   node scripts/smoke/skuCompositionUpsert.smoke.js
 *
 * Env:
 *   API_BASE_URL (default: http://localhost:8000/api)
 */

const DEFAULT_BASE = "http://localhost:8000/api";

function baseUrl() {
  const raw = String(process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_BASE).trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
  // If someone passes "/api", assume local backend.
  if (raw.startsWith("/")) return `${DEFAULT_BASE}${raw}`.replace(/\/$/, "");
  return raw.replace(/\/$/, "");
}

let sessionCookie = "";

async function ensureLogin() {
  if (sessionCookie) return;
  const cookie = String(process.env.API_COOKIE || "").trim();
  const auth = String(process.env.API_AUTH || "").trim();
  if (cookie || auth) return;

  const username = String(process.env.API_USER || "").trim();
  const password = String(process.env.API_PASS || "").trim();
  if (!username || !password) return;

  const url = `${baseUrl()}/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Login mislukt (${res.status}): ${msg || res.statusText}`);
  }
  const setCookie = res.headers.get("set-cookie") || "";
  // Use cookie header value up to the first ';' (cookie pair only).
  const cookiePair = setCookie.split(";")[0].trim();
  if (cookiePair) sessionCookie = cookiePair;
}

async function httpJson(method, path, body) {
  const url = `${baseUrl()}${path}`;
  await ensureLogin();
  const headers = { "Content-Type": "application/json" };
  const cookie = String(process.env.API_COOKIE || "").trim();
  const auth = String(process.env.API_AUTH || "").trim();
  if (cookie) headers["Cookie"] = cookie;
  else if (sessionCookie) headers["Cookie"] = sessionCookie;
  if (auth) headers["Authorization"] = auth;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${path}: ${text || res.statusText}`);
  }
  return json;
}

function pickFirst(rows, predicate) {
  for (const row of rows) {
    if (predicate(row)) return row;
  }
  return null;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.TZ-]/g, "");
  const formatName = `Smoke fmt 33cl ${stamp}`;
  const bundleName = `Smoke bundle 12x33cl ${stamp}`;

  const skusPayload = await httpJson("GET", "/data/skus", null);
  const skus = Array.isArray(skusPayload?.data) ? skusPayload.data : [];
  const componentSku = pickFirst(
    skus,
    (row) => String(row?.kind || "").toLowerCase() === "beer_format" && row?.active !== false
  );
  if (!componentSku) throw new Error("Geen component SKU gevonden (kind=beer_format).");

  const articlesPayload = await httpJson("GET", "/data/articles", null);
  const articles = Array.isArray(articlesPayload?.data) ? articlesPayload.data : [];
  const packagingComponent = pickFirst(
    articles,
    (row) => String(row?.kind || "").toLowerCase() === "packaging_component"
  );
  if (!packagingComponent) throw new Error("Geen packaging component gevonden (articles.kind=packaging_component).");

  const upsertFormat = await httpJson("POST", "/data/sku-composition/upsert-format", {
    name: formatName,
    uom: "stuk",
    totals_liters: 0.33,
    afvul_parts: [
      { kind: "packaging_component", component_id: String(packagingComponent.id), qty: 1 },
    ],
  });
  const formatId = String(upsertFormat?.article_id || "").trim();
  if (!formatId) throw new Error("upsert-format: article_id ontbreekt.");

  const upsertBundle = await httpJson("POST", "/data/sku-composition/upsert-bundle", {
    name: bundleName,
    uom: "pakket",
    totals_liters: 3.96,
    sellable_kind: "product",
    product_group: "giftset",
    alcohol_category: "normaal",
    packaging_type: "",
    composition: [{ component_sku_id: String(componentSku.id), qty: 12 }],
    packaging: [{ kind: "packaging_component", component_id: String(packagingComponent.id), qty: 1 }],
  });
  const articleId = String(upsertBundle?.article_id || "").trim();
  const skuId = String(upsertBundle?.sku_id || "").trim();
  if (!articleId || !skuId) throw new Error("upsert-bundle: sku_id/article_id ontbreekt.");

  const bomPayload = await httpJson("GET", "/data/bom-lines", null);
  const bomLines = Array.isArray(bomPayload?.data) ? bomPayload.data : [];
  const bundleBom = bomLines.filter((row) => String(row?.parent_article_id || "").trim() === articleId);
  if (bundleBom.length < 2) throw new Error(`BOM voor bundle ontbreekt/te klein (gevonden ${bundleBom.length}).`);
  const hasSkuLine = bundleBom.some((row) => String(row?.component_sku_id || "").trim() === skuId ? false : String(row?.component_sku_id || "").trim());
  const hasPkgLine = bundleBom.some((row) => String(row?.component_article_id || "").trim());
  if (!hasSkuLine) throw new Error("BOM mist component_sku_id regels.");
  if (!hasPkgLine) throw new Error("BOM mist component_article_id regels.");

  const skusAfterPayload = await httpJson("GET", "/data/skus", null);
  const skusAfter = Array.isArray(skusAfterPayload?.data) ? skusAfterPayload.data : [];
  const savedSku = skusAfter.find((row) => String(row?.id || "").trim() === skuId);
  if (!savedSku) throw new Error("SKU niet gevonden na upsert.");

  console.log("OK");
  console.log(JSON.stringify({ format_id: formatId, bundle_article_id: articleId, bundle_sku_id: skuId }, null, 2));
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exitCode = 1;
});
