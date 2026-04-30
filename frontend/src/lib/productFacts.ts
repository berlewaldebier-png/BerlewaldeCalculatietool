import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";

type GenericRecord = Record<string, unknown>;

export type ProductFact = {
  ref: string;
  bierId: string;
  productId: string;
  kostprijsversieId: string;
  bierName: string;
  packLabel: string;
  packType: string;
  label: string;
  litersPerUnit: number;
  costPriceEx: number;
  fixedCostAllocationEx: number;
  variableCostEx: number;
  sellInEx: number;
  vatRatePct: number;
  warnings: string[];
};

type BuildProductFactsParams = {
  year: number;
  channelCode?: string | null;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  litersPerUnitOverrides?: Map<string, number>;
  scenarioLabelSuffix?: string;
};

type ProductMaster = {
  packLabel: string;
  litersPerUnit: number;
  packType: string;
};

export function buildProductFacts(params: BuildProductFactsParams) {
  const warnings: string[] = [];
  const bierNameById = new Map<string, string>();
  params.bieren.forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    bierNameById.set(id, text((row as any).biernaam || (row as any).naam || id));
  });

  const productMasterById = buildProductMasterById(
    params.basisproducten,
    params.samengesteldeProducten
  );

  const versionById = new Map<string, GenericRecord>();
  params.kostprijsversies.forEach((row) => {
    const id = text((row as any).id);
    if (id) versionById.set(id, row);
  });

  const sellInLookup = buildSellInLookup(params.verkoopprijzen, params.year);
  const channelDefaultOpslag = buildChannelDefaultOpslagMap(params.channels);
  const facts: ProductFact[] = [];
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
      const snapshotRow = getSnapshotProductRow(version, productId);
      const master = productMasterById.get(productId);
      const packLabel =
        master?.packLabel || text((snapshotRow as any).verpakking || productId);
      const litersPerUnit =
        master?.litersPerUnit ||
        toNumber(
          (snapshotRow as any).liters_per_product ??
            (snapshotRow as any).totale_inhoud_liter ??
            (snapshotRow as any).inhoud_per_eenheid_liter,
          0
        );
      const costPriceEx = toNumber((snapshotRow as any).kostprijs, 0);
      const fixedCostAllocationEx = toNumber(
        (snapshotRow as any).vaste_kosten ?? (snapshotRow as any).vaste_directe_kosten,
        0
      );
      const variableCostEx = Math.max(0, costPriceEx - fixedCostAllocationEx);
      const vatRatePct = readVatRatePct(version);
      const warningsForFact: string[] = [];

      if (litersPerUnit <= 0) warningsForFact.push("Literinhoud ontbreekt.");
      if (costPriceEx <= 0) warningsForFact.push("Kostprijs ontbreekt.");
      if (fixedCostAllocationEx <= 0)
        warningsForFact.push("Vaste kostentoerekening ontbreekt.");

      const overrideLitersPerUnit = params.litersPerUnitOverrides?.get(productId) ?? null;
      const hasOverride =
        Number.isFinite(overrideLitersPerUnit as number) &&
        (overrideLitersPerUnit as number) > 0;
      const baselineLitersPerUnit = litersPerUnit > 0 ? litersPerUnit : 0.001;
      const costPerLiter = costPriceEx / baselineLitersPerUnit;
      const fixedPerLiter = fixedCostAllocationEx / baselineLitersPerUnit;
      const variablePerLiter = variableCostEx / baselineLitersPerUnit;

      const effectiveLitersPerUnit = hasOverride
        ? (overrideLitersPerUnit as number)
        : litersPerUnit;
      const effectiveCostPriceEx = hasOverride
        ? costPerLiter * effectiveLitersPerUnit
        : costPriceEx;
      const effectiveFixedCostAllocationEx = hasOverride
        ? fixedPerLiter * effectiveLitersPerUnit
        : fixedCostAllocationEx;
      const effectiveVariableCostEx = hasOverride
        ? variablePerLiter * effectiveLitersPerUnit
        : variableCostEx;
      const effectiveLabelSuffix = hasOverride
        ? params.scenarioLabelSuffix ?? " (scenario)"
        : "";

      let sellInEx = 0;
      if (params.channelCode) {
        sellInEx = resolveSellInPriceEx({
          bierId,
          productId,
          costPriceEx: effectiveCostPriceEx,
          channelCode: params.channelCode,
          lookup: sellInLookup,
          channelDefaultOpslag,
        }).sellInEx;
        if (sellInEx <= 0) warningsForFact.push("Sell-in prijs ontbreekt.");
      }

      const bierName = bierNameById.get(bierId) || bierId;
      facts.push({
        ref,
        bierId,
        productId,
        kostprijsversieId,
        bierName,
        packLabel,
        packType: master?.packType || inferPackType(packLabel),
        label: `${bierName} · ${packLabel}${effectiveLabelSuffix}`,
        litersPerUnit: effectiveLitersPerUnit,
        costPriceEx: effectiveCostPriceEx,
        fixedCostAllocationEx: effectiveFixedCostAllocationEx,
        variableCostEx: effectiveVariableCostEx,
        sellInEx,
        vatRatePct,
        warnings: warningsForFact,
      });
    });

  if (facts.length === 0) {
    warnings.push(
      `Geen actieve kostprijsproductactiveringen gevonden voor jaar ${params.year}.`
    );
  }

  return {
    warnings,
    facts: facts.sort((a, b) => a.label.localeCompare(b.label)),
    byRef: new Map(facts.map((fact) => [fact.ref, fact])),
  };
}

function buildProductMasterById(
  basisproducten: GenericRecord[],
  samengesteldeProducten: GenericRecord[]
) {
  const map = new Map<string, ProductMaster>();

  basisproducten.forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    const packLabel = text((row as any).omschrijving || (row as any).verpakking || id);
    map.set(id, {
      packLabel,
      packType: inferPackType(packLabel),
      litersPerUnit: toNumber(
        (row as any).inhoud_per_eenheid_liter ?? (row as any).liters_per_product,
        0
      ),
    });
  });

  samengesteldeProducten.forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    const packLabel = text((row as any).omschrijving || (row as any).verpakking || id);
    map.set(id, {
      packLabel,
      packType: inferPackType(packLabel),
      litersPerUnit: toNumber(
        (row as any).totale_inhoud_liter ??
          (row as any).liters_per_product ??
          (row as any).inhoud_per_eenheid_liter,
        0
      ),
    });
  });

  return map;
}

function getSnapshotProductRow(version: GenericRecord | undefined, productId: string) {
  const snapshotProducts = ((version as any)?.resultaat_snapshot?.producten ?? {}) as Record<
    string,
    unknown
  >;
  const productRows = [
    ...(Array.isArray(snapshotProducts.basisproducten) ? snapshotProducts.basisproducten : []),
    ...(Array.isArray(snapshotProducts.samengestelde_producten)
      ? snapshotProducts.samengestelde_producten
      : []),
  ] as GenericRecord[];

  return (
    productRows.find((row) => text((row as any).product_id) === productId) ?? {}
  );
}

function readVatRatePct(version: GenericRecord | undefined) {
  const raw = text((version as any)?.basisgegevens?.btw_tarief ?? "").replace("%", "");
  return toNumber(raw, 0);
}

function inferPackType(packLabel: string) {
  const lower = packLabel.toLowerCase();
  if (lower.includes("fust")) return "fust";
  if (lower.includes("doos")) return "doos";
  return "fles";
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
