import { useMemo } from "react";

import { text, toNumber, type GenericRecord } from "@/features/sku-composition/skuCompositionUtils";

export function useSkuCompositionIndexes(args: {
  year: number;
  packagingComponentPrices: GenericRecord[];
  articles: GenericRecord[];
  bomLines: GenericRecord[];
}) {
  const { year, packagingComponentPrices, articles, bomLines } = args;

  const packagingCostById = useMemo(() => {
    const map = new Map<string, number>();
    (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row) => {
      const rowYear = toNumber((row as any).jaar, 0);
      if (rowYear !== Number(year || 0)) return;
      const id = text((row as any).verpakkingsonderdeel_id || (row as any).packaging_component_id);
      if (!id) return;
      map.set(id, toNumber((row as any).prijs_per_stuk, 0));
    });
    return map;
  }, [packagingComponentPrices, year]);

  const articlesById = useMemo(() => {
    const map = new Map<string, GenericRecord>();
    (Array.isArray(articles) ? articles : []).forEach((row) => {
      const id = text((row as any).id);
      if (id) map.set(id, row);
    });
    return map;
  }, [articles]);

  const bomByParent = useMemo(() => {
    const map = new Map<string, GenericRecord[]>();
    (Array.isArray(bomLines) ? bomLines : []).forEach((row) => {
      const parent = text((row as any).parent_article_id);
      if (!parent) return;
      const next = map.get(parent) ?? [];
      next.push(row);
      map.set(parent, next);
    });
    return map;
  }, [bomLines]);

  return { packagingCostById, articlesById, bomByParent };
}

