import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";

type GenericRecord = Record<string, unknown>;

export type BreakEvenMixMode = "product" | "packaging";

export type BreakEvenConfig = {
  id: string;
  jaar: number;
  naam: string;
  is_active_for_quotes: boolean;
  mix_mode: BreakEvenMixMode;
  product_mix: Record<string, number>;
  packaging_mix: Record<string, number>;
  price_overrides: Record<string, number>;
  fixed_cost_adjustment: number;
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

export function createBreakEvenConfig(year: number): BreakEvenConfig {
  const now = new Date().toISOString();
  return {
    id: `be-${Date.now()}`,
    jaar: year,
    naam: `Break-even ${year}`,
    is_active_for_quotes: false,
    mix_mode: "product",
    product_mix: {},
    packaging_mix: {},
    price_overrides: {},
    fixed_cost_adjustment: 0,
    created_at: now,
    updated_at: now,
  };
}

export function normalizeBreakEvenConfig(row: unknown, fallbackYear: number): BreakEvenConfig {
  const source = row && typeof row === "object" ? (row as GenericRecord) : {};
  const jaar = toNumber(source.jaar, fallbackYear);
  const id = String(source.id ?? "").trim() || `be-${jaar}-${Math.random().toString(16).slice(2)}`;
  const mixMode = source.mix_mode === "packaging" ? "packaging" : "product";

  return {
    id,
    jaar,
    naam: String(source.naam ?? `Break-even ${jaar}`),
    is_active_for_quotes: Boolean(source.is_active_for_quotes),
    mix_mode: mixMode,
    product_mix: normalizeNumberMap(source.product_mix),
    packaging_mix: normalizeNumberMap(source.packaging_mix),
    price_overrides: normalizeNumberMap(source.price_overrides),
    fixed_cost_adjustment: toNumber(source.fixed_cost_adjustment, 0),
    created_at: typeof source.created_at === "string" ? source.created_at : undefined,
    updated_at: typeof source.updated_at === "string" ? source.updated_at : undefined,
  };
}

export function normalizeConfigList(rows: unknown, fallbackYear: number) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeBreakEvenConfig(row, fallbackYear));
}

export function buildBreakEvenProductLines(params: {
  year: number;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
}) {
  const beerNameById = new Map<string, string>();
  params.bieren.forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    beerNameById.set(id, text((row as any).biernaam || (row as any).naam || id));
  });

  const masterByProductId = new Map<string, { pack: string; litersPerUnit: number }>();
  [...params.basisproducten, ...params.samengesteldeProducten].forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    masterByProductId.set(id, {
      pack: text((row as any).omschrijving || (row as any).verpakking || id),
      litersPerUnit: toNumber((row as any).inhoud_per_eenheid_liter, 0),
    });
  });

  const versionById = new Map<string, GenericRecord>();
  params.kostprijsversies.forEach((row) => {
    const id = text((row as any).id);
    if (id) versionById.set(id, row);
  });

  const sellInLookup = buildSellInLookup(params.verkoopprijzen, params.year);
  const channelDefaultOpslag = buildChannelDefaultOpslagMap(params.channels);

  const lines: BreakEvenProductLine[] = [];
  const seen = new Set<string>();

  params.kostprijsproductactiveringen
    .filter((row) => toNumber((row as any).jaar, 0) === params.year)
    .forEach((activation) => {
      const bierId = text((activation as any).bier_id);
      const productId = text((activation as any).product_id);
      const kostprijsversieId = text((activation as any).kostprijsversie_id);
      if (!bierId || !productId || !kostprijsversieId) return;

      const ref = `beer:${bierId}:product:${productId}`;
      if (seen.has(ref)) return;
      seen.add(ref);

      const version = versionById.get(kostprijsversieId);
      const snapshotProducts = ((version as any)?.resultaat_snapshot?.producten ?? {}) as Record<string, unknown>;
      const productRows = [
        ...(Array.isArray(snapshotProducts.basisproducten) ? snapshotProducts.basisproducten : []),
        ...(Array.isArray(snapshotProducts.samengestelde_producten) ? snapshotProducts.samengestelde_producten : []),
      ] as GenericRecord[];
      const snapshotRow = productRows.find((row) => text((row as any).product_id) === productId) ?? {};
      const master = masterByProductId.get(productId);
      const packLabel = master?.pack || text((snapshotRow as any).verpakking || productId);
      const litersPerUnit =
        master?.litersPerUnit ||
        toNumber((snapshotRow as any).liters_per_product ?? (snapshotRow as any).inhoud_per_eenheid_liter, 0);
      const costPriceEx = toNumber((snapshotRow as any).kostprijs, 0);
      const fixedCostAllocationEx = toNumber(
        (snapshotRow as any).vaste_kosten ?? (snapshotRow as any).vaste_directe_kosten,
        0
      );
      const variableCostEx = Math.max(0, costPriceEx - fixedCostAllocationEx);
      const sellInEx = resolveSellInPriceEx({
        bierId,
        productId,
        costPriceEx,
        channelCode: "horeca",
        lookup: sellInLookup,
        channelDefaultOpslag,
      }).sellInEx;
      const warnings: string[] = [];
      if (litersPerUnit <= 0) warnings.push("Literinhoud ontbreekt.");
      if (costPriceEx <= 0) warnings.push("Kostprijs ontbreekt.");
      if (fixedCostAllocationEx <= 0) warnings.push("Vaste kostentoerekening ontbreekt.");
      if (sellInEx <= 0) warnings.push("Sell-in prijs ontbreekt.");

      lines.push({
        ref,
        bierId,
        productId,
        label: `${beerNameById.get(bierId) || bierId} - ${packLabel}`,
        packLabel,
        packType: inferPackType(packLabel),
        litersPerUnit,
        sellInEx,
        costPriceEx,
        fixedCostAllocationEx,
        variableCostEx,
        sellInPerLiter: litersPerUnit > 0 ? sellInEx / litersPerUnit : 0,
        variableCostPerLiter: litersPerUnit > 0 ? variableCostEx / litersPerUnit : 0,
        contributionPerLiter:
          litersPerUnit > 0 ? (sellInEx - variableCostEx) / litersPerUnit : 0,
        warnings,
      });
    });

  return lines.sort((a, b) => a.label.localeCompare(b.label));
}

export function calculateBreakEvenResult(
  config: BreakEvenConfig,
  lines: BreakEvenProductLine[],
  vasteKosten: Record<string, unknown>
): BreakEvenResult {
  const fixedCostsTotal = calculateFixedCostsTotal(vasteKosten, config.jaar);
  const adjustedFixedCostsTotal = Math.max(0, fixedCostsTotal + config.fixed_cost_adjustment);
  const mixEntries = config.mix_mode === "packaging" ? config.packaging_mix : config.product_mix;
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
    const packSummaries = calculateBreakEvenPackSummaries(lines, config.price_overrides);
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
      const sellIn = config.price_overrides[ref] || line.sellInEx;
      const sellInPerLiter = line.litersPerUnit > 0 ? sellIn / line.litersPerUnit : 0;
      const contribution = sellInPerLiter - line.variableCostPerLiter;
      const weight = mixPct / 100;
      mixTotalPct += mixPct;
      weightedSellInPerLiter += weight * sellInPerLiter;
      weightedVariableCostPerLiter += weight * line.variableCostPerLiter;
      weightedContributionPerLiter += weight * contribution;
      line.warnings.forEach((warning) => warnings.push(`${line.label}: ${warning}`));
      mixLines.push(
        createMixLine(
          ref,
          line.label,
          mixPct,
          {
            sellInPerLiter,
            variableCostPerLiter: line.variableCostPerLiter,
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

export function calculateFixedCostsTotal(vasteKosten: Record<string, unknown>, year: number) {
  const rows = Array.isArray(vasteKosten[String(year)]) ? (vasteKosten[String(year)] as GenericRecord[]) : [];
  return rows.reduce((sum, row) => sum + toNumber((row as any).bedrag_per_jaar, 0), 0);
}

export function calculateBreakEvenPackSummaries(
  lines: BreakEvenProductLine[],
  priceOverrides: Record<string, number>
) {
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
    current.sellIn += priceOverrides[line.ref] || line.sellInEx;
    current.variable += line.variableCostEx;
    groups.set(line.packType, current);
  });

  groups.forEach((group) => {
    group.sellInPerLiter = group.liters > 0 ? group.sellIn / group.liters : 0;
    group.variableCostPerLiter = group.liters > 0 ? group.variable / group.liters : 0;
    group.contributionPerLiter = group.sellInPerLiter - group.variableCostPerLiter;
  });

  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function inferPackType(packLabel: string) {
  const lower = packLabel.toLowerCase();
  if (lower.includes("fust")) return "fust";
  if (lower.includes("doos")) return "doos";
  return "fles";
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

function text(value: unknown) {
  return String(value ?? "").trim();
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
