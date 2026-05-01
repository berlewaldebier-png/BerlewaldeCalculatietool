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
    const normalized = (parsed as unknown[])
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const obj = row as Record<string, unknown>;
        const id = String(obj.id ?? "").trim();
        if (!id) return null;
        const createdAt = String(obj.createdAt ?? "").trim();
        const updatedAt = String(obj.updatedAt ?? "").trim();
        const name = String(obj.name ?? "").trim() || "Scenario";
        const year = Number(obj.year ?? 0) || 0;
        const overrides = Array.isArray(obj.overrides) ? (obj.overrides as unknown[]) : [];
        const notes = obj.notes != null ? String(obj.notes) : undefined;

        return {
          id,
          createdAt: createdAt || updatedAt || new Date(0).toISOString(),
          updatedAt: updatedAt || createdAt || new Date(0).toISOString(),
          name,
          year,
          overrides: overrides
            .filter((ov) => ov && typeof ov === "object")
            .map((ov) => ({
              productId: String((ov as any).productId ?? "").trim(),
              litersPerUnit:
                (ov as any).litersPerUnit == null ? undefined : Number((ov as any).litersPerUnit),
            }))
            .filter((ov) => ov.productId),
          notes,
        } satisfies ScenarioRecord;
      })
      .filter(Boolean) as ScenarioRecord[];

    const byId = new Map<string, ScenarioRecord>();
    for (const scenario of normalized) {
      const existing = byId.get(scenario.id);
      if (!existing) {
        byId.set(scenario.id, scenario);
        continue;
      }
      // Keep the most recently updated record for a given id.
      if (scenario.updatedAt.localeCompare(existing.updatedAt) > 0) {
        byId.set(scenario.id, scenario);
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
