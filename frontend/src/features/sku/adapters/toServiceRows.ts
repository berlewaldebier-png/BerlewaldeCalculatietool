import { type CentralSkuRow } from "@/features/sku/centralSkuIndex";

export type ServiceRow = {
  skuId: string;
  label: string;
  uom: string;
  manualRateEx: number;
};

export function toServiceRows(rows: CentralSkuRow[]): ServiceRow[] {
  return rows
    .filter((row) => row.pricingMethod === "manual_rate")
    .filter((row) => row.subtype === "dienst")
    .filter((row) => row.manualRateEx > 0)
    .map((row) => ({ skuId: row.skuId, label: row.label, uom: row.uom, manualRateEx: row.manualRateEx }))
    .sort((a, b) => a.label.localeCompare(b.label, "nl-NL"));
}

