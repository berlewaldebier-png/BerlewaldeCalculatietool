import { apiRequestTextClient } from "@/lib/apiClient";
import { determineDefaultYear, toNumber, type GenericRecord } from "@/components/producten-verpakking/productenVerpakkingUtils";

export function buildAvailablePriceYears({
  productie,
  packagingPrices,
}: {
  productie: Record<string, unknown>;
  packagingPrices: GenericRecord[];
}) {
  const years = new Set<number>();
  const payload = productie && typeof productie === "object" ? productie : {};
  Object.keys(payload).forEach((key) => {
    const year = toNumber(key, 0);
    if (year > 0) years.add(year);
  });
  const productieYears = Array.from(years).sort((a, b) => b - a);

  if (productieYears.length > 0) {
    return { productieYears, availablePriceYears: productieYears, defaultYear: productieYears[0] ?? new Date().getFullYear() };
  }

  // Fallback when there is no production yet.
  const fallbackYears = new Set<number>();
  packagingPrices.forEach((row) => {
    const value = toNumber((row as any)?.jaar, 0);
    if (value > 0) fallbackYears.add(value);
  });
  const availablePriceYears = Array.from(fallbackYears).sort((a, b) => b - a);
  const defaultYear = determineDefaultYear(packagingPrices);
  return { productieYears: [], availablePriceYears, defaultYear };
}

export function buildYearPricesDraft({
  packagingMasters,
  packagingPrices,
  activeYearForPrices,
}: {
  packagingMasters: GenericRecord[];
  packagingPrices: GenericRecord[];
  activeYearForPrices: number;
}) {
  const draft: Record<string, number> = {};
  const priceByComponent = new Map<string, number>();
  packagingPrices
    .filter((row) => toNumber((row as any)?.jaar, 0) === activeYearForPrices)
    .forEach((row) => {
      const componentId = String(
        (row as any)?.verpakkingsonderdeel_id ?? (row as any)?.packaging_component_id ?? ""
      ).trim();
      if (!componentId) return;
      priceByComponent.set(componentId, toNumber((row as any)?.prijs_per_stuk, 0));
    });
  packagingMasters.forEach((row) => {
    const id = String((row as any)?.id ?? "").trim();
    if (!id) return;
    draft[id] = priceByComponent.get(id) ?? 0;
  });
  return draft;
}

export function buildYearPricesPayload({
  packagingMasters,
  packagingPrices,
  activeYearForPrices,
  yearPricesDraft,
}: {
  packagingMasters: GenericRecord[];
  packagingPrices: GenericRecord[];
  activeYearForPrices: number;
  yearPricesDraft: Record<string, number>;
}) {
  const otherYears = packagingPrices.filter((row) => toNumber((row as any)?.jaar, 0) !== activeYearForPrices);
  const existingRowsByComponent = new Map<string, GenericRecord>();
  packagingPrices
    .filter((row) => toNumber((row as any)?.jaar, 0) === activeYearForPrices)
    .forEach((row) => {
      const componentId = String((row as any)?.verpakkingsonderdeel_id ?? "").trim();
      if (!componentId) return;
      existingRowsByComponent.set(componentId, row);
    });

  const layerRows: GenericRecord[] = packagingMasters
    .map((component) => {
      const componentId = String((component as any)?.id ?? "").trim();
      if (!componentId) return null;
      const existing = existingRowsByComponent.get(componentId) ?? null;
      const price = toNumber(yearPricesDraft[componentId], 0);
      return {
        id: String((existing as any)?.id ?? ""),
        verpakkingsonderdeel_id: componentId,
        jaar: activeYearForPrices,
        prijs_per_stuk: price,
      } as GenericRecord;
    })
    .filter(Boolean) as GenericRecord[];

  return [...otherYears, ...layerRows];
}

export async function saveYearPricesLayer({
  activeYearForPrices,
  payload,
}: {
  activeYearForPrices: number;
  payload: GenericRecord[];
}) {
  await apiRequestTextClient("/data/packaging-component-prices", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return `Jaarprijzen voor ${activeYearForPrices} opgeslagen.`;
}

