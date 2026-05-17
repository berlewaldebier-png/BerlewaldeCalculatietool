import {
  buildChannelDefaultOpslagMap,
  buildSellInLookup,
  resolveSellInPriceEx,
} from "@/components/offerte-samenstellen/sellInResolver";
import { getPackagingDefaultsForLabel } from "@/lib/packagingConfig";

type GenericRecord = Record<string, unknown>;

export type ProductFact = {
  ref: string;
  bierId: string;
  productId: string;
  kostprijsversieId: string;
  bierName: string;
  packLabel: string;
  packType: string;
  salesUnitLabel: string;
  unitsPerLayer: number | null;
  unitsPerPallet: number | null;
  contributesToLiters: boolean;
  contributesToMargin: boolean;
  label: string;
  litersPerUnit: number;
  costPriceEx: number;
  fixedCostAllocationEx: number;
  variableCostEx: number;
  sellInEx: number;
  sellInYear: number;
  vatRatePct: number;
  warnings: string[];
};

type BuildProductFactsParams = {
  year: number;
  channelCode?: string | null;
  onlyReady?: boolean;
  channels: GenericRecord[];
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus?: GenericRecord[];
  articles?: GenericRecord[];
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

function inferPackTypeFromFormatId(id: string) {
  const value = text(id).toLowerCase();
  if (value.includes("fust") || value.includes("keg")) return "fust";
  if (value.includes("doos") || value.includes("case")) return "doos";
  if (value.includes("fles")) return "fles";
  if (value.includes("blik")) return "blik";
  return "stuk";
}

export function buildProductFacts(params: BuildProductFactsParams) {
  const warnings: string[] = [];
  const onlyReady = Boolean(params.onlyReady);
  let skippedNotReady = 0;
  const bierNameById = new Map<string, string>();
  params.bieren.forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    bierNameById.set(id, text((row as any).biernaam || (row as any).naam || id));
  });
  const articleNameById = new Map<string, string>();
  (params.articles ?? []).forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    const name = text((row as any).name || (row as any).naam || id);
    articleNameById.set(id, name);
  });
  const articleById = new Map<string, GenericRecord>();
  (params.articles ?? []).forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    articleById.set(id, row);
  });

  const productMasterById = buildProductMasterById(
    params.basisproducten,
    params.samengesteldeProducten
  );

  const skuById = new Map<string, GenericRecord>();
  (params.skus ?? []).forEach((row) => {
    const id = text((row as any).id);
    if (id) skuById.set(id, row);
  });

  const formatById = new Map<string, ProductMaster>();
  (params.articles ?? []).forEach((row) => {
    const id = text((row as any).id);
    if (!id) return;
    const kind = text((row as any).kind).toLowerCase();
    if (kind !== "format") return;
    const packLabel = text((row as any).name || (row as any).naam || id);
    formatById.set(id, {
      packLabel,
      packType: text((row as any).uom || (row as any).eenheid || inferPackTypeFromFormatId(id)),
      litersPerUnit: toNumber((row as any).content_liter, 0),
    });
  });

  const versionById = new Map<string, GenericRecord>();
  params.kostprijsversies.forEach((row) => {
    const id = text((row as any).id);
    if (id) versionById.set(id, row);
  });

  const sellInLookup = buildSellInLookup(params.verkoopprijzen, params.year);
  const channelDefaultOpslag = buildChannelDefaultOpslagMap(params.channels);
  const facts: ProductFact[] = [];
  const seen = new Set<string>();

  const yearActivations = (Array.isArray(params.kostprijsproductactiveringen) ? params.kostprijsproductactiveringen : [])
    .filter((row) => toNumber((row as any).jaar, 0) === params.year);

  // Deterministic activation selection: if there are multiple activations per SKU/year,
  // pick the latest by effectief_vanaf (then updated_at). API ordering is not stable.
  const selectedActivations: GenericRecord[] = [];
  const activationBySku = new Map<string, GenericRecord>();
  const duplicates: Array<{ skuId: string; picked: string; skipped: string }> = [];

  const parseIso = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  yearActivations
    .slice()
    .sort((a, b) => {
      const skuA = text((a as any).sku_id);
      const skuB = text((b as any).sku_id);
      if (skuA !== skuB) return skuA.localeCompare(skuB);
      const effA = parseIso((a as any).effectief_vanaf);
      const effB = parseIso((b as any).effectief_vanaf);
      if (effA !== effB) return effB - effA;
      const updA = parseIso((a as any).updated_at) || parseIso((a as any).aangepast_op);
      const updB = parseIso((b as any).updated_at) || parseIso((b as any).aangepast_op);
      if (updA !== updB) return updB - updA;
      return text((b as any).id).localeCompare(text((a as any).id));
    })
    .forEach((activation) => {
      const skuId = text((activation as any).sku_id);
      if (!skuId) {
        selectedActivations.push(activation);
        return;
      }
      const existing = activationBySku.get(skuId) ?? null;
      if (!existing) {
        activationBySku.set(skuId, activation);
        selectedActivations.push(activation);
        return;
      }
      duplicates.push({
        skuId,
        picked: text((existing as any).id),
        skipped: text((activation as any).id),
      });
    });

  if (duplicates.length > 0) {
    const preview = duplicates.slice(0, 3).map((d) => `${d.skuId} (${d.picked})`).join(", ");
    warnings.push(
      `Meerdere kostprijsactivaties gevonden voor hetzelfde SKU (jaar ${params.year}). Laatste effectief_vanaf wordt gebruikt. Voorbeelden: ${preview}${duplicates.length > 3 ? "…" : ""}.`
    );
  }

  selectedActivations.forEach((activation) => {
      const skuId = text((activation as any).sku_id);
      const skuRow = skuId ? skuById.get(skuId) ?? null : null;
      const skuKind = text((skuRow as any)?.kind).toLowerCase();
      const bierId = text((activation as any).bier_id) || text((skuRow as any)?.beer_id);
      const productId =
        text((activation as any).product_id) ||
        text((skuRow as any)?.format_article_id) ||
        text((skuRow as any)?.article_id);
      const kostprijsversieId = text((activation as any).kostprijsversie_id);
      if (!productId || !kostprijsversieId) return;
      const effectiveBierId =
        bierId || (skuId && skuKind === "article" ? `sku:${skuId}` : "");
      if (!effectiveBierId) return;

      const ref = skuId ? `sku:${skuId}` : `beer:${bierId}:product:${productId}`;
      if (seen.has(ref)) return;
      seen.add(ref);

      const version = versionById.get(kostprijsversieId);
      const costLineRow = getCostLineRow(version, { skuId, productId });
      const master = formatById.get(productId) ?? productMasterById.get(productId);
      const isArticleSku = Boolean(skuId && skuKind === "article");
      const skuPackagingType = text((skuRow as any)?.packaging_type);
      const articleNameRaw = text((articleById.get(text((skuRow as any)?.article_id) || productId) as any)?.name) ||
        text((skuRow as any)?.name) ||
        "";
      const beerNameFromMaster = bierNameById.get(bierId) || bierId;
      const packLabelFromArticleName =
        bierId && articleNameRaw && articleNameRaw.toLowerCase().includes(beerNameFromMaster.toLowerCase())
          ? articleNameRaw.split(" - ").slice(1).join(" - ").trim()
          : "";
      const packLabel =
        master?.packLabel ||
        (isArticleSku && bierId ? (packLabelFromArticleName || skuPackagingType) : "") ||
        text((costLineRow as any).verpakking_label || (costLineRow as any).verpakking || productId);
      const litersPerUnit =
        master?.litersPerUnit ||
        toNumber(
          (costLineRow as any).liters_per_product ??
            (costLineRow as any).totale_inhoud_liter ??
            (costLineRow as any).inhoud_per_eenheid_liter,
          0
        );
      const fallbackArticleLiters =
        skuKind === "article" ? toNumber((articleById.get(productId) as any)?.content_liter, 0) : 0;
      const fallbackArticleCost =
        skuKind === "article" ? toNumber((version as any)?.kostprijs, 0) : 0;
      const baseLitersPerUnit = litersPerUnit > 0 ? litersPerUnit : fallbackArticleLiters;
      const costPriceEx =
        toNumber((costLineRow as any).kostprijs, 0) || fallbackArticleCost;
      const fixedCostAllocationEx = toNumber(
        (costLineRow as any).vaste_kosten ?? (costLineRow as any).vaste_directe_kosten,
        0
      );
      const variableCostEx = Math.max(0, costPriceEx - fixedCostAllocationEx);
      const vatRatePct = readVatRatePct(version);
      const warningsForFact: string[] = [];

      if (baseLitersPerUnit <= 0 && !isArticleSku) warningsForFact.push("Literinhoud ontbreekt.");
      if (costPriceEx <= 0) warningsForFact.push("Kostprijs ontbreekt.");
      if (fixedCostAllocationEx <= 0)
        warningsForFact.push("Vaste kostentoerekening ontbreekt.");

      const overrideLitersPerUnit =
        params.litersPerUnitOverrides?.get(skuId || productId) ?? null;
      const hasOverride =
        Number.isFinite(overrideLitersPerUnit as number) &&
        (overrideLitersPerUnit as number) > 0;
      const baselineLitersPerUnit = baseLitersPerUnit > 0 ? baseLitersPerUnit : 0.001;
      const costPerLiter = costPriceEx / baselineLitersPerUnit;
      const fixedPerLiter = fixedCostAllocationEx / baselineLitersPerUnit;
      const variablePerLiter = variableCostEx / baselineLitersPerUnit;

      const effectiveLitersPerUnit = hasOverride
        ? (overrideLitersPerUnit as number)
        : baseLitersPerUnit;
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

      const salesUnitLabel = skuPackagingType
        ? String(skuPackagingType).split("-")[0]?.trim().toLowerCase() ||
          master?.packType ||
          "stuk"
        : master?.packType || "stuk";

      const packagingDefaults = getPackagingDefaultsForLabel(salesUnitLabel);
      const unitsPerLayer = packagingDefaults.unitsPerLayer;
      const unitsPerPallet = packagingDefaults.unitsPerPallet;

      const contributesToMargin = true;
      const contributesToLiters =
        effectiveLitersPerUnit > 0 && salesUnitLabel !== "stuk";

      let sellInEx = 0;
      if (params.channelCode) {
        const resolved = resolveSellInPriceEx({
          skuId,
          bierId,
          productId,
          costPriceEx: effectiveCostPriceEx,
          channelCode: params.channelCode,
          lookup: sellInLookup,
          channelDefaultOpslag,
        });
        sellInEx = resolved.sellInEx;
        if (sellInLookup.resolvedYear !== params.year) {
          warningsForFact.push(
            `Sell-in prijs komt uit ${sellInLookup.resolvedYear} (fallback; offertejaar ${params.year}).`
          );
        }
        if (sellInEx <= 0) warningsForFact.push("Sell-in prijs ontbreekt.");
      }

      // SKU-aanpak: niet elk verkoopbaar artikel heeft liters (merch/dienst/bundles zonder inhoud).
      // Voor bier/formats blijven liters wel verplicht.
      const litersOk = isArticleSku ? true : effectiveLitersPerUnit > 0;
      const isReady =
        litersOk &&
        effectiveCostPriceEx > 0 &&
        (!params.channelCode || sellInEx > 0);
      if (onlyReady && !isReady) {
        skippedNotReady += 1;
        return;
      }

      const bierName = isArticleSku && bierId
        ? bierNameById.get(bierId) || bierId
        : isArticleSku
          ? articleNameById.get(text((skuRow as any)?.article_id) || productId) || packLabel
          : bierNameById.get(bierId) || bierId;
      facts.push({
        ref,
        bierId: effectiveBierId,
        productId,
        kostprijsversieId,
        bierName,
        packLabel,
        packType: master?.packType || salesUnitLabel,
        salesUnitLabel,
        unitsPerLayer,
        unitsPerPallet,
        contributesToLiters,
        contributesToMargin,
        label: `${bierName} · ${packLabel}${effectiveLabelSuffix}`,
        litersPerUnit: effectiveLitersPerUnit,
        costPriceEx: effectiveCostPriceEx,
        fixedCostAllocationEx: effectiveFixedCostAllocationEx,
        variableCostEx: effectiveVariableCostEx,
        sellInEx,
        sellInYear: sellInLookup.resolvedYear,
        vatRatePct,
        warnings: warningsForFact,
      });
    });

  if (facts.length === 0) {
    warnings.push(
      `Geen actieve kostprijsproductactiveringen gevonden voor jaar ${params.year}.`
    );
  }
  if (onlyReady && skippedNotReady > 0) {
    warnings.push(
      `${skippedNotReady} product(en) verborgen omdat kostprijs/literinhoud (of sell-in) ontbreekt.`
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
      packType: inferPackTypeFromFormatId(id) || inferPackType(packLabel),
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
      packType: inferPackTypeFromFormatId(id) || inferPackType(packLabel),
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

function getCostLineRow(version: GenericRecord | undefined, ids: { skuId: string; productId: string }) {
  const costLines = ((version as any)?.cost_lines ?? (version as any)?.costLines ?? []) as unknown;
  const rows = Array.isArray(costLines) ? (costLines as GenericRecord[]) : [];

  const skuId = text(ids.skuId);
  if (skuId) {
    const bySku = rows.find((row) => text((row as any).sku_id) === skuId);
    if (bySku) return bySku;
  }

  const productId = text(ids.productId);
  if (productId) {
    return rows.find((row) => text((row as any).product_id) === productId) ?? {};
  }
  return {};
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
