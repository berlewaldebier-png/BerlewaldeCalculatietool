import { useMemo } from "react";
import { buildCentralSkuIndex, type CentralSkuRow } from "@/features/sku/centralSkuIndex";

type GenericRecord = Record<string, unknown>;

export type CentralSkuIndex = {
  rows: CentralSkuRow[];
  bySkuId: Map<string, CentralSkuRow>;
};

export function useCentralSkuIndex(params: {
  year: number;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}): CentralSkuIndex {
  const {
    year,
    channels,
    verkoopprijzen,
    skus,
    articles,
    kostprijsversies,
    kostprijsproductactiveringen,
  } = params;

  return useMemo(() => {
    return buildCentralSkuIndex({
      year,
      channels: Array.isArray(channels) ? channels : [],
      verkoopprijzen: Array.isArray(verkoopprijzen) ? verkoopprijzen : [],
      skus: Array.isArray(skus) ? skus : [],
      articles: Array.isArray(articles) ? articles : [],
      kostprijsversies: Array.isArray(kostprijsversies) ? kostprijsversies : [],
      kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
    });
  }, [year, channels, verkoopprijzen, skus, articles, kostprijsversies, kostprijsproductactiveringen]);
}

