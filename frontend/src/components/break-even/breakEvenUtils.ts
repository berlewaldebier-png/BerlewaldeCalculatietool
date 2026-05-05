import { buildProductFacts } from "@/lib/productFacts";

type GenericRecord = Record<string, unknown>;

export type BreakEvenMixMode = "product" | "packaging";
export type BreakEvenConfigKind = "basis" | "scenario";
export type BreakEvenScenarioType =
  | "pricing"
  | "costs"
  | "volume"
  | "combined"
  | "custom";
export type BreakEvenScenarioAdjustmentType =
  | "price_pct"
  | "fixed_cost_eur"
  | "fixed_cost_pct"
  | "variable_cost_pct"
  | "volume_mix_pct";

export type BreakEvenScenarioAdjustment = {
  id: string;
  type: BreakEvenScenarioAdjustmentType;
  value: number;
  target_key: string;
  target_label: string;
};

export type BreakEvenConfig = {
  id: string;
  jaar: number;
  naam: string;
  kind: BreakEvenConfigKind;
  scenario_type: BreakEvenScenarioType | null;
  parent_config_id: string | null;
  is_active_for_quotes: boolean;
  mix_mode: BreakEvenMixMode;
  product_mix: Record<string, number>;
  packaging_mix: Record<string, number>;
  price_overrides: Record<string, number>;
  fixed_cost_adjustment: number;
  adjustments: BreakEvenScenarioAdjustment[];
  created_at?: string;
  updated_at?: string;
};

export type BreakEvenProductLine = {
  ref: string;
  bierId: string;
  productId: string;
  label: string;
  packLabel: string;
  packType: string;
  litersPerUnit: number;
  sellInEx: number;
  costPriceEx: number;
  fixedCostAllocationEx: number;
  variableCostEx: number;
  sellInPerLiter: number;
  variableCostPerLiter: number;
  contributionPerLiter: number;
  warnings: string[];
};

export type BreakEvenPackSummary = {
  key: string;
  label: string;
  productCount: number;
  liters: number;
  sellInPerLiter: number;
  variableCostPerLiter: number;
  contributionPerLiter: number;
};

export type BreakEvenMixLine = {
  key: string;
  label: string;
  mixPct: number;
  sellInPerLiter: number;
  variableCostPerLiter: number;
  contributionPerLiter: number;
  weightedSellInPerLiter: number;
  weightedVariableCostPerLiter: number;
  weightedContributionPerLiter: number;
  warnings: string[];
};

export type BreakEvenResult = {
  fixedCostsTotal: number;
  adjustedFixedCostsTotal: number;
  fixedCostAdjustment: number;
  weightedSellInPerLiter: number;
  weightedVariableCostPerLiter: number;
  weightedContributionPerLiter: number;
  contributionMarginPct: number;
  breakEvenLiters: number;
  breakEvenRevenue: number;
  mixTotalPct: number;
  mixLines: BreakEvenMixLine[];
  warnings: string[];
};

export type BreakEvenStandaloneProductResult = {
  ref: string;
  label: string;
  breakEvenLiters: number;
  breakEvenRevenue: number;
  sellInPerLiter: number;
  variableCostPerLiter: number;
  contributionPerLiter: number;
  warnings: string[];
};

export function createBreakEvenScenarioAdjustment(
  type: BreakEvenScenarioAdjustmentType = "price_pct"
): BreakEvenScenarioAdjustment {
  return {
    id: `adj-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    type,
    value: 0,
    target_key: "",
    target_label: "",
  };
}

export function createBreakEvenConfig(
  year: number,
  kind: BreakEvenConfigKind = "basis"
): BreakEvenConfig {
  const now = new Date().toISOString();
  return {
    id: `be-${Date.now()}`,
    jaar: year,
    naam: kind === "scenario" ? `Scenario ${year}` : `Break-even basis ${year}`,
    kind,
    scenario_type: kind === "scenario" ? "custom" : null,
    parent_config_id: null,
    is_active_for_quotes: false,
    mix_mode: "product",
    product_mix: {},
    packaging_mix: {},
    price_overrides: {},
    fixed_cost_adjustment: 0,
    adjustments: [],
    created_at: now,
    updated_at: now,
  };
}

export function normalizeBreakEvenConfig(row: unknown, fallbackYear: number): BreakEvenConfig {
  const source = row && typeof row === "object" ? (row as GenericRecord) : {};
  const jaar = toNumber(source.jaar, fallbackYear);
  const id = String(source.id ?? "").trim() || `be-${jaar}-${Math.random().toString(16).slice(2)}`;
  const mixMode = source.mix_mode === "packaging" ? "packaging" : "product";
  const kind = source.kind === "scenario" ? "scenario" : "basis";
  const scenarioType = normalizeScenarioType(source.scenario_type);
  const parentConfigId = String(source.parent_config_id ?? "").trim() || null;

  return {
    id,
    jaar,
    naam: String(source.naam ?? `Break-even ${jaar}`),
    kind,
    scenario_type: kind === "scenario" ? scenarioType ?? "custom" : null,
    parent_config_id: kind === "scenario" ? parentConfigId : null,
    is_active_for_quotes: Boolean(source.is_active_for_quotes),
    mix_mode: mixMode,
    product_mix: normalizeNumberMap(source.product_mix),
    packaging_mix: normalizeNumberMap(source.packaging_mix),
    price_overrides: normalizeNumberMap(source.price_overrides),
    fixed_cost_adjustment: toNumber(source.fixed_cost_adjustment, 0),
    adjustments: normalizeAdjustments(source.adjustments),
    created_at: typeof source.created_at === "string" ? source.created_at : undefined,
    updated_at: typeof source.updated_at === "string" ? source.updated_at : undefined,
  };
}

export function normalizeConfigList(rows: unknown, fallbackYear: number) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeBreakEvenConfig(row, fallbackYear));
}

export function createScenarioFromBase(base: BreakEvenConfig) {
  const now = new Date().toISOString();
  return {
    ...base,
    id: `be-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    naam: `${base.naam} scenario`,
    kind: "scenario" as const,
    scenario_type: "custom" as const,
    parent_config_id: base.id,
    is_active_for_quotes: false,
    adjustments: [],
    created_at: now,
    updated_at: now,
  };
}

export function deriveScenarioTypeFromAdjustments(
  adjustments: BreakEvenScenarioAdjustment[]
): BreakEvenScenarioType {
  const hasPricing = adjustments.some((adjustment) => adjustment.type === "price_pct");
  const hasCosts = adjustments.some(
    (adjustment) =>
      adjustment.type === "fixed_cost_eur" ||
      adjustment.type === "fixed_cost_pct" ||
      adjustment.type === "variable_cost_pct"
  );
  const hasVolume = adjustments.some(
    (adjustment) => adjustment.type === "volume_mix_pct"
  );

  const groupCount = [hasPricing, hasCosts, hasVolume].filter(Boolean).length;
  if (groupCount === 0) return "custom";
  if (groupCount > 1) return "combined";
  if (hasPricing) return "pricing";
  if (hasCosts) return "costs";
  return "volume";
}

export function buildBreakEvenProductLines(params: {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
}) {
  const factsIndex = buildProductFacts({
    ...params,
    channelCode: "horeca",
    onlyReady: true,
  });

  return factsIndex.facts.map((fact) => ({
    ref: fact.ref,
    bierId: fact.bierId,
    productId: fact.productId,
    label: fact.label.replace(" · ", " - "),
    packLabel: fact.packLabel,
    packType: fact.packType,
    litersPerUnit: fact.litersPerUnit,
    sellInEx: fact.sellInEx,
    costPriceEx: fact.costPriceEx,
    fixedCostAllocationEx: fact.fixedCostAllocationEx,
    variableCostEx: fact.variableCostEx,
    sellInPerLiter: fact.litersPerUnit > 0 ? fact.sellInEx / fact.litersPerUnit : 0,
    variableCostPerLiter:
      fact.litersPerUnit > 0 ? fact.variableCostEx / fact.litersPerUnit : 0,
    contributionPerLiter:
      fact.litersPerUnit > 0
        ? (fact.sellInEx - fact.variableCostEx) / fact.litersPerUnit
        : 0,
    warnings: [...fact.warnings],
  }));
}

export function calculateBreakEvenResult(
  config: BreakEvenConfig,
  lines: BreakEvenProductLine[],
  vasteKosten: Record<string, unknown>
): BreakEvenResult {
  const fixedCostsTotal = calculateFixedCostsTotal(vasteKosten, config.jaar);
  const scenarioAdjustments = Array.isArray(config.adjustments) ? config.adjustments : [];
  const priceMultiplier = multiplyAdjustmentFactors(scenarioAdjustments, "price_pct");
  const variableCostMultiplier = multiplyAdjustmentFactors(
    scenarioAdjustments,
    "variable_cost_pct"
  );
  const adjustedFixedCostsTotal = applyFixedCostAdjustments(
    Math.max(0, fixedCostsTotal + config.fixed_cost_adjustment),
    scenarioAdjustments
  );
  const mixEntries = buildEffectiveMixEntries(config, lines, scenarioAdjustments);
  const warnings: string[] = [];
  const mixLines: BreakEvenMixLine[] = [];
  let mixTotalPct = 0;
  let weightedSellInPerLiter = 0;
  let weightedVariableCostPerLiter = 0;
  let weightedContributionPerLiter = 0;

  if (lines.length === 0) {
    warnings.push(`Geen actieve kostprijsproducten gevonden voor ${config.jaar}.`);
  }
  if (fixedCostsTotal <= 0) {
    warnings.push(`Geen vaste kosten gevonden voor ${config.jaar}.`);
  }

  if (config.mix_mode === "packaging") {
    const packSummaries = calculateBreakEvenPackSummaries(lines, {
      priceOverrides: config.price_overrides,
      priceMultiplier,
      variableCostMultiplier,
    });
    const byPack = new Map(packSummaries.map((summary) => [summary.key, summary]));
    Object.entries(mixEntries).forEach(([packType, pct]) => {
      const mixPct = Math.max(0, toNumber(pct, 0));
      const group = byPack.get(packType);
      if (!group) {
        warnings.push(`Verpakkingstype "${packType}" staat nog in de mix, maar bestaat niet meer voor ${config.jaar}.`);
        return;
      }
      if (mixPct <= 0) return;
      const weight = mixPct / 100;
      mixTotalPct += mixPct;
      weightedSellInPerLiter += weight * group.sellInPerLiter;
      weightedVariableCostPerLiter += weight * group.variableCostPerLiter;
      weightedContributionPerLiter += weight * group.contributionPerLiter;
      mixLines.push(createMixLine(packType, group.label, mixPct, group, group.productCount <= 0 ? ["Geen producten gevonden."] : []));
    });
  } else {
    const byRef = new Map(lines.map((line) => [line.ref, line]));
    Object.entries(mixEntries).forEach(([ref, pct]) => {
      const mixPct = Math.max(0, toNumber(pct, 0));
      const line = byRef.get(ref);
      if (!line) {
        warnings.push(`Product "${ref}" staat nog in de mix, maar bestaat niet meer voor ${config.jaar}.`);
        return;
      }
      if (mixPct <= 0) return;
      const sellIn = (config.price_overrides[ref] || line.sellInEx) * priceMultiplier;
      const sellInPerLiter = line.litersPerUnit > 0 ? sellIn / line.litersPerUnit : 0;
      const variableCostPerLiter =
        line.litersPerUnit > 0
          ? (line.variableCostEx * variableCostMultiplier) / line.litersPerUnit
          : 0;
      const contribution = sellInPerLiter - variableCostPerLiter;
      const weight = mixPct / 100;
      mixTotalPct += mixPct;
      weightedSellInPerLiter += weight * sellInPerLiter;
      weightedVariableCostPerLiter += weight * variableCostPerLiter;
      weightedContributionPerLiter += weight * contribution;
      line.warnings.forEach((warning) => warnings.push(`${line.label}: ${warning}`));
      mixLines.push(
        createMixLine(
          ref,
          line.label,
          mixPct,
          {
            sellInPerLiter,
            variableCostPerLiter,
            contributionPerLiter: contribution,
          },
          line.warnings
        )
      );
    });
  }

  if (mixLines.length === 0) {
    warnings.push("Vul minimaal een mixregel groter dan 0% in.");
  }
  if (Math.abs(mixTotalPct - 100) > 0.01) {
    warnings.push(`Mix telt op tot ${round(mixTotalPct)}% in plaats van 100%.`);
  }
  if (weightedContributionPerLiter <= 0) {
    warnings.push("Gewogen contributiemarge per liter is 0 of lager.");
  }

  const breakEvenLiters =
    weightedContributionPerLiter > 0 ? adjustedFixedCostsTotal / weightedContributionPerLiter : 0;
  const breakEvenRevenue = breakEvenLiters * weightedSellInPerLiter;
  const contributionMarginPct =
    weightedSellInPerLiter > 0 ? (weightedContributionPerLiter / weightedSellInPerLiter) * 100 : 0;

  return {
    fixedCostsTotal,
    adjustedFixedCostsTotal,
    fixedCostAdjustment: config.fixed_cost_adjustment,
    weightedSellInPerLiter,
    weightedVariableCostPerLiter,
    weightedContributionPerLiter,
    contributionMarginPct,
    breakEvenLiters,
    breakEvenRevenue,
    mixTotalPct,
    mixLines,
    warnings,
  };
}

export function calculateStandaloneBreakEvenProducts(
  config: BreakEvenConfig,
  lines: BreakEvenProductLine[],
  vasteKosten: Record<string, unknown>
) {
  const fixedCostsTotal = calculateFixedCostsTotal(vasteKosten, config.jaar);
  const scenarioAdjustments = Array.isArray(config.adjustments) ? config.adjustments : [];
  const priceMultiplier = multiplyAdjustmentFactors(scenarioAdjustments, "price_pct");
  const variableCostMultiplier = multiplyAdjustmentFactors(
    scenarioAdjustments,
    "variable_cost_pct"
  );
  const adjustedFixedCostsTotal = applyFixedCostAdjustments(
    Math.max(0, fixedCostsTotal + config.fixed_cost_adjustment),
    scenarioAdjustments
  );

  return lines
    .map((line) => {
      const sellInEx = (config.price_overrides[line.ref] || line.sellInEx) * priceMultiplier;
      const sellInPerLiter = line.litersPerUnit > 0 ? sellInEx / line.litersPerUnit : 0;
      const variableCostPerLiter =
        line.litersPerUnit > 0
          ? (line.variableCostEx * variableCostMultiplier) / line.litersPerUnit
          : 0;
      const contributionPerLiter = sellInPerLiter - variableCostPerLiter;
      const warnings = [...line.warnings];

      if (contributionPerLiter <= 0) {
        warnings.push("Contributie per liter is 0 of lager.");
      }

      const breakEvenLiters =
        contributionPerLiter > 0 ? adjustedFixedCostsTotal / contributionPerLiter : 0;
      const breakEvenRevenue = breakEvenLiters * sellInPerLiter;

      return {
        ref: line.ref,
        label: line.label,
        breakEvenLiters,
        breakEvenRevenue,
        sellInPerLiter,
        variableCostPerLiter,
        contributionPerLiter,
        warnings,
      } satisfies BreakEvenStandaloneProductResult;
    })
    .sort((a, b) => a.breakEvenRevenue - b.breakEvenRevenue);
}

export function calculateFixedCostsTotal(vasteKosten: Record<string, unknown>, year: number) {
  const rows = Array.isArray(vasteKosten[String(year)]) ? (vasteKosten[String(year)] as GenericRecord[]) : [];
  return rows.reduce((sum, row) => sum + toNumber((row as any).bedrag_per_jaar, 0), 0);
}

export function calculateBreakEvenPackSummaries(
  lines: BreakEvenProductLine[],
  options:
    | Record<string, number>
    | {
        priceOverrides?: Record<string, number>;
        priceMultiplier?: number;
        variableCostMultiplier?: number;
      }
) {
  const resolvedOptions =
    isNumberMap(options)
      ? { priceOverrides: options, priceMultiplier: 1, variableCostMultiplier: 1 }
      : {
          priceOverrides: options.priceOverrides ?? {},
          priceMultiplier: options.priceMultiplier ?? 1,
          variableCostMultiplier: options.variableCostMultiplier ?? 1,
        };
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      productCount: number;
      liters: number;
      sellIn: number;
      variable: number;
      sellInPerLiter: number;
      variableCostPerLiter: number;
      contributionPerLiter: number;
    }
  >();

  lines.forEach((line) => {
    if (line.litersPerUnit <= 0) return;
    const current = groups.get(line.packType) ?? {
      key: line.packType,
      label: formatPackTypeLabel(line.packType),
      productCount: 0,
      liters: 0,
      sellIn: 0,
      variable: 0,
      sellInPerLiter: 0,
      variableCostPerLiter: 0,
      contributionPerLiter: 0,
    };
    current.productCount += 1;
    current.liters += line.litersPerUnit;
    current.sellIn +=
      (resolvedOptions.priceOverrides[line.ref] || line.sellInEx) *
      resolvedOptions.priceMultiplier;
    current.variable += line.variableCostEx * resolvedOptions.variableCostMultiplier;
    groups.set(line.packType, current);
  });

  groups.forEach((group) => {
    group.sellInPerLiter = group.liters > 0 ? group.sellIn / group.liters : 0;
    group.variableCostPerLiter = group.liters > 0 ? group.variable / group.liters : 0;
    group.contributionPerLiter = group.sellInPerLiter - group.variableCostPerLiter;
  });

  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    Number.isFinite(value) ? value : 0
  );
}

export function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNumberMap(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, raw]) => [key, toNumber(raw, 0)] as const)
      .filter(([key]) => key.trim())
  );
}

function normalizeAdjustments(value: unknown): BreakEvenScenarioAdjustment[] {
  const out: BreakEvenScenarioAdjustment[] = [];
  (Array.isArray(value) ? value : []).forEach((row) => {
    const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const type = normalizeAdjustmentType(source.type);
    if (!type) return;
    out.push({
      id: String(source.id ?? "").trim() || `adj-${Math.random().toString(16).slice(2, 8)}`,
      type,
      value: toNumber(source.value, 0),
      target_key: String(source.target_key ?? "").trim(),
      target_label: String(source.target_label ?? "").trim(),
    });
  });
  return out;
}

function normalizeAdjustmentType(value: unknown): BreakEvenScenarioAdjustmentType | null {
  const type = String(value ?? "").trim();
  if (
    type === "price_pct" ||
    type === "fixed_cost_eur" ||
    type === "fixed_cost_pct" ||
    type === "variable_cost_pct" ||
    type === "volume_mix_pct"
  ) {
    return type;
  }
  return null;
}

function normalizeScenarioType(value: unknown): BreakEvenScenarioType | null {
  const type = String(value ?? "").trim();
  if (
    type === "pricing" ||
    type === "costs" ||
    type === "volume" ||
    type === "combined" ||
    type === "custom"
  ) {
    return type;
  }
  return null;
}

function multiplyAdjustmentFactors(
  adjustments: BreakEvenScenarioAdjustment[],
  type: BreakEvenScenarioAdjustmentType
) {
  return adjustments
    .filter((adjustment) => adjustment.type === type)
    .reduce((factor, adjustment) => factor * (1 + adjustment.value / 100), 1);
}

function applyFixedCostAdjustments(
  baseValue: number,
  adjustments: BreakEvenScenarioAdjustment[]
) {
  let current = baseValue;
  adjustments.forEach((adjustment) => {
    if (adjustment.type === "fixed_cost_eur") {
      current += adjustment.value;
    }
    if (adjustment.type === "fixed_cost_pct") {
      current *= 1 + adjustment.value / 100;
    }
  });
  return Math.max(0, current);
}

function buildEffectiveMixEntries(
  config: BreakEvenConfig,
  lines: BreakEvenProductLine[],
  adjustments: BreakEvenScenarioAdjustment[]
) {
  const sourceEntries =
    config.mix_mode === "packaging" ? { ...config.packaging_mix } : { ...config.product_mix };
  const byRef = new Map(lines.map((line) => [line.ref, line]));

  adjustments
    .filter((adjustment) => adjustment.type === "volume_mix_pct")
    .forEach((adjustment) => {
      const targetKey = String(adjustment.target_key ?? "").trim();
      if (!targetKey) return;

      if (config.mix_mode === "packaging") {
        const current = toNumber(sourceEntries[targetKey], 0);
        sourceEntries[targetKey] = current * (1 + adjustment.value / 100);
        return;
      }

      const current = toNumber(sourceEntries[targetKey], 0);
      if (current > 0 || byRef.has(targetKey)) {
        sourceEntries[targetKey] = current * (1 + adjustment.value / 100);
      }
    });

  const total = Object.values(sourceEntries).reduce((sum, value) => sum + toNumber(value, 0), 0);
  if (total <= 0) return sourceEntries;

  return Object.fromEntries(
    Object.entries(sourceEntries).map(([key, value]) => [key, (toNumber(value, 0) / total) * 100])
  );
}

function isNumberMap(
  value: Record<string, number> | { priceOverrides?: Record<string, number> }
): value is Record<string, number> {
  return !("priceOverrides" in value);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function createMixLine(
  key: string,
  label: string,
  mixPct: number,
  values: {
    sellInPerLiter: number;
    variableCostPerLiter: number;
    contributionPerLiter: number;
  },
  warnings: string[]
): BreakEvenMixLine {
  const weight = mixPct / 100;
  return {
    key,
    label,
    mixPct,
    sellInPerLiter: values.sellInPerLiter,
    variableCostPerLiter: values.variableCostPerLiter,
    contributionPerLiter: values.contributionPerLiter,
    weightedSellInPerLiter: weight * values.sellInPerLiter,
    weightedVariableCostPerLiter: weight * values.variableCostPerLiter,
    weightedContributionPerLiter: weight * values.contributionPerLiter,
    warnings: [...warnings],
  };
}

function formatPackTypeLabel(packType: string) {
  if (packType === "doos") return "Doos";
  if (packType === "fust") return "Fust";
  if (packType === "fles") return "Fles";
  return packType;
}
