/* eslint-disable no-console */
/**
 * Regenerate demo seed bundles by filtering a known-good historical seed commit to a single demo year.
 *
 * Why: keeps demo seeds deterministic (no stray 2026 rows) and avoids depending on current DB state.
 *
 * Usage (from repo root):
 *   node scripts/regenerate_seeds_2025.js
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const COMMIT = process.env.SEED_SOURCE_COMMIT || "4c28527";
const YEAR = Number(process.env.SEED_YEAR || 2025);

if (!Number.isFinite(YEAR) || YEAR <= 0) {
  throw new Error(`Invalid SEED_YEAR: ${process.env.SEED_YEAR}`);
}

function getFromGit(relPath) {
  const cmd = `git show ${COMMIT}:${relPath}`;
  return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 });
}

function unwrapLegacyWrapper(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (Object.prototype.hasOwnProperty.call(payload, "Count") && Object.prototype.hasOwnProperty.call(payload, "value")) {
    return payload.value;
  }
  return payload;
}

function filterListToYear(rows, profile, datasetName) {
  if (!Array.isArray(rows)) return rows;

  const allowedVerkoopRecordTypes = new Set(["jaarstrategie", "verkoopstrategie_verpakking"]);

  return rows.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;

    const rowYear = row.jaar ?? row.year;
    if (rowYear != null) {
      const y = Number(rowYear);
      if (Number.isFinite(y) && y !== YEAR) return false;
    }

    if (profile === "demo_foundation" && datasetName === "verkoopprijzen") {
      if (String(row.bier_id ?? "").trim()) return false;
      const rt = String(row.record_type ?? "").trim();
      if (rt && !allowedVerkoopRecordTypes.has(rt)) return false;
    }

    return true;
  });
}

function filterBundle(bundle, profile) {
  const out = { ...bundle };
  out.source_year = YEAR;
  out.created_at = new Date().toISOString().replace(/\.\\d{3}Z$/, "+00:00");

  const datasets = bundle.datasets || {};
  const filtered = {};

  for (const [name, raw] of Object.entries(datasets)) {
    let payload = unwrapLegacyWrapper(raw);

    // Year-keyed dict datasets: keep only YEAR when present.
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if ((name === "productie" || name === "vaste-kosten") && Object.prototype.hasOwnProperty.call(payload, String(YEAR))) {
        filtered[name] = { [String(YEAR)]: payload[String(YEAR)] };
        continue;
      }
    }

    if (Array.isArray(payload)) {
      filtered[name] = filterListToYear(payload, profile, name);
      continue;
    }

    filtered[name] = payload;
  }

  out.datasets = filtered;
  return out;
}

function writeSeed(profile) {
  const rel = profile === "demo_full" ? "seeds/demo_full.seed.json" : "seeds/demo_foundation.seed.json";
  const raw = getFromGit(rel);
  const bundle = JSON.parse(raw);
  const filtered = filterBundle(bundle, profile);
  const dest = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(filtered, null, 2) + "\n", "utf8");
  console.log(`Wrote ${rel} (commit=${COMMIT}, year=${YEAR})`);
}

writeSeed("demo_foundation");
writeSeed("demo_full");

