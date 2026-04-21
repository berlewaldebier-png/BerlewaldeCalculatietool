import { calcSellInExFromOpslagPct } from "@/lib/pricingEngine";
import type {
  GenericRecord,
  ProductIndexResult,
  QuoteChannel,
} from "@/components/offerte-samenstellen/types";
import { clampNumber, normalizeText } from "@/components/offerte-samenstellen/quoteUtils";

function channelToStrategyKey(channel: QuoteChannel): string | null {
  if (channel === "Horeca") return "horeca";
  if (channel === "Retail") return "retail";
  return null;
}

type BuildProductOptionsParams = {
  year: number;
  channel: QuoteChannel;
  bieren: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
};

export function buildQuoteableProductOptions(
  params: BuildProductOptionsParams
): ProductIndexResult {
  const warnings: string[] = [];
  const strategyKey = channelToStrategyKey(params.channel);
  if (!strategyKey) {
    warnings.push(
      `Geen verkoopstrategie-prijzen bekend voor kanaal '${params.channel}'. Standaardprijzen blijven 0 tot je een ondersteund kanaal kiest.`
    );
  }

  const bierNameById = new Map<string, string>();
  for (const record of params.bieren) {
    const id = normalizeText((record as any).id);
    if (!id) continue;
    bierNameById.set(
      id,
      normalizeText((record as any).biernaam || (record as any).naam || id)
    );
  }

  const masterByProductId = new Map<string, { pack: string; litersPerUnit: number }>();
  for (const record of params.basisproducten) {
    const id = normalizeText((record as any).id);
    if (!id) continue;
    masterByProductId.set(id, {
      pack: normalizeText((record as any).omschrijving || (record as any).verpakking || id),
      litersPerUnit: clampNumber((record as any).inhoud_per_eenheid_liter, 0),
    });
  }
  for (const record of params.samengesteldeProducten) {
    const id = normalizeText((record as any).id);
    if (!id) continue;
    masterByProductId.set(id, {
      pack: normalizeText((record as any).omschrijving || (record as any).verpakking || id),
      litersPerUnit: clampNumber((record as any).inhoud_per_eenheid_liter, 0),
    });
  }

  const versionById = new Map<string, GenericRecord>();
  for (const record of params.kostprijsversies) {
    const id = normalizeText((record as any).id);
    if (id) versionById.set(id, record);
  }

  const verkoopRowsForYear = params.verkoopprijzen.filter(
    (row) => clampNumber((row as any).jaar, 0) === params.year
  );

  const productStrategyByKey = new Map<string, GenericRecord>();
  const packagingStrategyByProductId = new Map<string, GenericRecord>();
  for (const row of verkoopRowsForYear) {
    const recordType = normalizeText((row as any).record_type);
    if (recordType === "verkoopstrategie_product") {
      const bierId = normalizeText((row as any).bier_id);
      const productId = normalizeText((row as any).product_id);
      if (!bierId || !productId) continue;
      productStrategyByKey.set(`${bierId}:${productId}`, row);
    } else if (recordType === "verkoopstrategie_verpakking") {
      const productId = normalizeText((row as any).product_id);
      if (!productId) continue;
      packagingStrategyByProductId.set(productId, row);
    }
  }

  const activationRows = params.kostprijsproductactiveringen.filter(
    (row) => clampNumber((row as any).jaar, 0) === params.year
  );

  const options: ProductIndexResult["options"] = [];
  const seen = new Set<string>();

  for (const activation of activationRows) {
    const bierId = normalizeText((activation as any).bier_id);
    const productId = normalizeText((activation as any).product_id);
    const kostprijsversieId = normalizeText((activation as any).kostprijsversie_id);
    if (!bierId || !productId || !kostprijsversieId) continue;

    const key = `${bierId}:${productId}:${kostprijsversieId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const master = masterByProductId.get(productId);
    const packLabel =
      master?.pack || normalizeText((activation as any).verpakking || productId);
    const litersPerUnit = master?.litersPerUnit ?? 0;

    const version = versionById.get(kostprijsversieId);
    const snapshot = (version as any)?.resultaat_snapshot as any;
    const basisgegevens = (version as any)?.basisgegevens as any;
    const btwTariefRaw = normalizeText(basisgegevens?.btw_tarief ?? "");
    const vatRatePct = clampNumber(btwTariefRaw.replace("%", ""), 0) || 0;
    const products = snapshot?.producten ?? {};
    const listA = Array.isArray(products?.basisproducten) ? products.basisproducten : [];
    const listB = Array.isArray(products?.samengestelde_producten)
      ? products.samengestelde_producten
      : [];
    const match = [...listA, ...listB].find(
      (row) => normalizeText(row?.product_id) === productId
    );
    const costPriceEx = clampNumber(match?.kostprijs, 0);

    let standardPriceEx = 0;
    if (strategyKey) {
      const productStrategy = productStrategyByKey.get(`${bierId}:${productId}`);
      const packagingStrategy = packagingStrategyByProductId.get(productId);
      const priceMap =
        ((productStrategy as any)?.sell_in_prices as Record<string, unknown>) ||
        ((productStrategy as any)?.kanaalprijzen as Record<string, unknown>) ||
        ((packagingStrategy as any)?.sell_in_prices as Record<string, unknown>) ||
        ((packagingStrategy as any)?.kanaalprijzen as Record<string, unknown>) ||
        {};
      const opslagMap =
        ((productStrategy as any)?.sell_in_margins as Record<string, unknown>) ||
        ((productStrategy as any)?.kanaalmarges as Record<string, unknown>) ||
        ((packagingStrategy as any)?.sell_in_margins as Record<string, unknown>) ||
        ((packagingStrategy as any)?.kanaalmarges as Record<string, unknown>) ||
        {};

      const explicit = clampNumber(priceMap?.[strategyKey], 0);
      if (explicit > 0) {
        standardPriceEx = explicit;
      } else {
        const opslagPct = clampNumber(opslagMap?.[strategyKey], 0);
        if (opslagPct > 0 && costPriceEx > 0) {
          standardPriceEx = calcSellInExFromOpslagPct(costPriceEx, opslagPct);
        }
      }
    }

    const bierName = bierNameById.get(bierId) || bierId;
    const optionId = `beer:${bierId}:product:${productId}`;

    options.push({
      optionId,
      bierId,
      productId,
      label: `${bierName} · ${packLabel}`,
      bierName,
      packLabel,
      litersPerUnit,
      costPriceEx,
      standardPriceEx,
      vatRatePct,
      kostprijsversieId,
    });
  }

  options.sort((a, b) => a.label.localeCompare(b.label));
  if (options.length === 0) {
    warnings.push(
      `Geen actieve kostprijsproductactiveringen gevonden voor jaar ${params.year}. Draai eerst reset+seed of activeer kostprijzen.`
    );
  }

  if (options.length > 0 && options.every((row) => row.vatRatePct === 0)) {
    warnings.push(
      "BTW-tarief ontbreekt in kostprijsversies (basisgegevens.btw_tarief). BTW toggle toont dan alleen ex prijzen."
    );
  }

  return { options, warnings };
}
