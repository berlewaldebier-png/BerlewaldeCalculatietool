import { type CentralSkuRow } from "@/features/sku/centralSkuIndex";
import { normalizeUom, type Uom } from "@/features/sku/adapters/common";

export type SellableSubtype = "bier" | "product" | "dienst";
export type PricingMethod = "cost_plus" | "manual_rate";

export type SellableTableRow = {
  skuId: string;
  label: string;
  subtype: SellableSubtype;
  pricingMethod: PricingMethod;
  uom: Uom;
  contentLiter: number;
  hasActiveCost: boolean;
  kostprijsEx: number;
  manualRateEx: number;
};

export function toSellableTableRows(rows: CentralSkuRow[]): SellableTableRow[] {
  return rows.map((row) => ({
    skuId: row.skuId,
    label: row.label,
    subtype: row.subtype === "dienst" ? "dienst" : row.subtype === "bier" ? "bier" : "product",
    pricingMethod: row.pricingMethod,
    uom: normalizeUom(row.uom),
    contentLiter: row.contentLiter,
    hasActiveCost: row.hasActiveCost,
    kostprijsEx: row.kostprijsEx,
    manualRateEx: row.manualRateEx,
  }));
}

