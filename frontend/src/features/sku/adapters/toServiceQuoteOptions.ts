import { normalizeText } from "@/components/offerte-samenstellen/quoteUtils";
import type { ProductOption } from "@/components/offerte-samenstellen/types";
import type { CentralSkuRow } from "@/features/sku/centralSkuIndex";

export function toServiceQuoteOptions(rows: CentralSkuRow[]): ProductOption[] {
  const options: ProductOption[] = [];
  const serviceRows = rows.filter((row) => row.pricingMethod === "manual_rate");
  for (const service of serviceRows) {
    const optionId = `sku:${service.skuId}`;
    if (service.manualRateEx <= 0) continue;
    options.push({
      optionId,
      bierId: `sku:${service.skuId}`,
      productId: "",
      label: service.label,
      bierName: service.label,
      packLabel: service.uom,
      salesUnitLabel: "stuk",
      unitsPerLayer: null,
      unitsPerPallet: null,
      contributesToLiters: false,
      contributesToMargin: true,
      litersPerUnit: 0,
      staffelCompatibilityKey: `service::${normalizeText(service.uom).toLowerCase()}`,
      staffelCompatibilityLabel: service.uom,
      costPriceEx: 0,
      standardPriceEx: service.manualRateEx,
      vatRatePct: service.btwPct,
      kostprijsversieId: "",
    });
  }
  return options;
}

