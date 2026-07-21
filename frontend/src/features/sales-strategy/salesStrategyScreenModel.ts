import type { VerkoopstrategieWorkspaceProps } from "@/components/VerkoopstrategieWorkspace";
import type { BootstrapResponse, NavigationItem } from "@/lib/apiShared";

type GenericRecord = Record<string, unknown>;

export const SALES_STRATEGY_DATASET_KEYS = [
  "productie",
  "verkoopprijzen",
  "basisproducten",
  "samengestelde-producten",
  "bieren",
  "skus",
  "articles",
  "bom-lines",
  "berekeningen",
  "channels",
  "kostprijsproductactiveringen",
] as const;

export type SalesStrategyDatasets = Record<string, unknown> & {
  productie?: unknown;
  verkoopprijzen?: GenericRecord[];
  basisproducten?: GenericRecord[];
  "samengestelde-producten"?: GenericRecord[];
  bieren?: GenericRecord[];
  skus?: GenericRecord[];
  articles?: GenericRecord[];
  "bom-lines"?: GenericRecord[];
  berekeningen?: GenericRecord[];
  channels?: GenericRecord[];
  kostprijsproductactiveringen?: GenericRecord[];
};

export type SalesStrategyScreenModel = {
  navigation: NavigationItem[];
  workspace: VerkoopstrategieWorkspaceProps;
};

function asRows(value: unknown): GenericRecord[] {
  return Array.isArray(value) ? value as GenericRecord[] : [];
}

export function buildSalesStrategyScreenModel(
  bootstrap: BootstrapResponse<SalesStrategyDatasets>
): SalesStrategyScreenModel {
  const datasets = bootstrap.datasets;
  return {
    navigation: bootstrap.navigation ?? [],
    workspace: {
      endpoint: "/data/verkoopprijzen",
      verkoopprijzen: asRows(datasets.verkoopprijzen),
      productie: datasets.productie ?? {},
      basisproducten: asRows(datasets.basisproducten),
      samengesteldeProducten: asRows(datasets["samengestelde-producten"]),
      bieren: asRows(datasets.bieren),
      skus: asRows(datasets.skus),
      articles: asRows(datasets.articles),
      bomLines: asRows(datasets["bom-lines"]),
      berekeningen: asRows(datasets.berekeningen),
      channels: asRows(datasets.channels),
      kostprijsproductactiveringen: asRows(datasets.kostprijsproductactiveringen),
    },
  };
}
