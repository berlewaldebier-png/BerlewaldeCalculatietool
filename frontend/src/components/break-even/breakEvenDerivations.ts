"use client";

import { deriveScenarioTypeFromAdjustments, type BreakEvenConfig } from "@/components/break-even/breakEvenUtils";

type GenericRecord = Record<string, unknown>;

export function computeBreakEvenYears(args: {
  vasteKosten: Record<string, unknown> | null | undefined;
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const set = new Set<number>();
  Object.keys(args.vasteKosten ?? {}).forEach((key) => {
    const year = Number(key);
    if (Number.isFinite(year) && year > 0) set.add(year);
  });
  (Array.isArray(args.kostprijsproductactiveringen) ? args.kostprijsproductactiveringen : []).forEach((row) => {
    const year = Number((row as any).jaar ?? 0);
    if (Number.isFinite(year) && year > 0) set.add(year);
  });
  return Array.from(set).sort((a, b) => b - a);
}

export function resolveActiveBaseConfig(args: {
  activeConfig: BreakEvenConfig | null;
  configs: BreakEvenConfig[];
}) {
  if (!args.activeConfig) return null;
  if (args.activeConfig.kind === "basis") return args.activeConfig;
  return args.configs.find((config) => config.id === args.activeConfig?.parent_config_id) ?? null;
}

export function buildProductLineWarnings(productLines: Array<{ label: string; warnings: string[] }>) {
  return (Array.isArray(productLines) ? productLines : []).flatMap((line) =>
    (Array.isArray(line.warnings) ? line.warnings : []).map((warning) => `${line.label}: ${warning}`)
  );
}

export function groupBreakEvenConfigs(configs: BreakEvenConfig[]) {
  const bases = configs
    .filter((config) => config.kind === "basis")
    .sort((a, b) => {
      if (b.jaar !== a.jaar) return b.jaar - a.jaar;
      return a.naam.localeCompare(b.naam);
    });

  return bases.map((base) => ({
    base,
    scenarios: configs
      .filter((config) => config.kind === "scenario" && config.parent_config_id === base.id)
      .sort((a, b) => a.naam.localeCompare(b.naam)),
  }));
}

export function withTimestamp<T extends BreakEvenConfig>(config: T, patch: Partial<BreakEvenConfig>) {
  const nextConfig = {
    ...config,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (nextConfig.kind === "scenario") {
    return {
      ...nextConfig,
      scenario_type: deriveScenarioTypeFromAdjustments(nextConfig.adjustments),
    };
  }
  return nextConfig;
}

