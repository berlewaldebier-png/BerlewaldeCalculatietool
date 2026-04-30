export type ScenarioOverride = {
  productId: string;
  litersPerUnit?: number;
};

export type ScenarioRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  year: number;
  overrides: ScenarioOverride[];
  notes?: string;
};

const STORAGE_KEY = "calculatietool.scenarios.v1";

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function listScenarios(): ScenarioRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row && typeof row === "object") as ScenarioRecord[];
  } catch {
    return [];
  }
}

export function getScenario(id: string): ScenarioRecord | null {
  const all = listScenarios();
  return all.find((row) => row.id === id) ?? null;
}

export function upsertScenario(input: Omit<ScenarioRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  if (!isBrowser()) return null;
  const now = new Date().toISOString();
  const all = listScenarios();
  const id = input.id || createId();
  const existing = all.find((row) => row.id === id) ?? null;
  const createdAt = existing?.createdAt ?? now;
  const next: ScenarioRecord = {
    id,
    createdAt,
    updatedAt: now,
    name: String(input.name ?? "").trim() || "Scenario",
    year: Number(input.year ?? 0) || new Date().getFullYear(),
    overrides: Array.isArray(input.overrides) ? input.overrides : [],
    notes: input.notes ? String(input.notes) : undefined,
  };

  const without = all.filter((row) => row.id !== id);
  const merged = [next, ...without].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent("calculatietool-scenarios-changed"));
  return next;
}

export function deleteScenario(id: string) {
  if (!isBrowser()) return;
  const all = listScenarios();
  const next = all.filter((row) => row.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("calculatietool-scenarios-changed"));
}

export function buildLitersPerUnitOverrideMap(scenario: ScenarioRecord | null) {
  const map = new Map<string, number>();
  if (!scenario) return map;
  (Array.isArray(scenario.overrides) ? scenario.overrides : []).forEach((ov) => {
    const productId = String(ov?.productId ?? "").trim();
    const liters = Number(ov?.litersPerUnit ?? Number.NaN);
    if (!productId) return;
    if (!Number.isFinite(liters) || liters <= 0) return;
    map.set(productId, liters);
  });
  return map;
}

export function getScenarioLabel(scenario: ScenarioRecord | null) {
  if (!scenario) return "";
  const name = String(scenario.name ?? "").trim();
  const year = Number(scenario.year ?? 0) || 0;
  return `${name}${year ? ` (${year})` : ""}`;
}
