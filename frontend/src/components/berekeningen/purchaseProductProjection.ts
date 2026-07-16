import type { GenericRecord } from "@/components/berekeningen/berekeningenWizardUtils";

export type SelectedPurchaseProduct = {
  product: GenericRecord;
  prijsPerEenheid: number;
};

const PACKAGING_COMPONENT_PREFIX = "verpakkingsonderdeel:";

export function expandSelectedInkoopProductsToBasisproducten(
  selectedProducts: SelectedPurchaseProduct[],
  basisproducten: GenericRecord[]
): SelectedPurchaseProduct[] {
  const basisLookup = new Map(
    basisproducten
      .map((product) => [String(product.id ?? "").trim(), product] as const)
      .filter(([productId]) => Boolean(productId))
  );
  const expanded: SelectedPurchaseProduct[] = [];
  const seen = new Set<string>();

  for (const item of selectedProducts) {
    const productId = String(item.product.id ?? "").trim();
    if (productId && !seen.has(productId)) {
      expanded.push(item);
      seen.add(productId);
    }

    const onderdelen = Array.isArray(item.product.basisproducten)
      ? (item.product.basisproducten as GenericRecord[])
      : [];

    for (const onderdeel of onderdelen) {
      const basisId = String(onderdeel.basisproduct_id ?? "").trim();
      if (!basisId || basisId.startsWith(PACKAGING_COMPONENT_PREFIX) || seen.has(basisId)) {
        continue;
      }
      const basisproduct = basisLookup.get(basisId);
      if (!basisproduct) {
        continue;
      }
      const aantal = Number(onderdeel.aantal ?? 0);

      expanded.push({
        product: basisproduct,
        prijsPerEenheid: aantal > 0 ? item.prijsPerEenheid / aantal : item.prijsPerEenheid,
      });
      seen.add(basisId);
    }
  }

  return expanded;
}
