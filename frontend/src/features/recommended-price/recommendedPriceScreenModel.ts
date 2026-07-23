import type { AdviesprijzenWorkspaceProps } from "@/components/AdviesprijzenWorkspace";
import type { BootstrapResponse, NavigationItem } from "@/lib/apiShared";

type GenericRecord = Record<string, unknown>;

export const RECOMMENDED_PRICE_DATASET_KEYS = [
  "channels",
  "adviesprijzen",
  "productie",
  "verkoopprijzen",
  "bieren",
  "skus",
  "articles",
  "kostprijsversies",
  "kostprijsproductactiveringen",
  "packaging-components",
  "packaging-component-price-versions",
] as const;

export type RecommendedPriceDatasets = Record<string, unknown> & {
  channels?: GenericRecord[];
  adviesprijzen?: GenericRecord[];
  productie?: unknown;
  verkoopprijzen?: GenericRecord[];
  bieren?: GenericRecord[];
  skus?: GenericRecord[];
  articles?: GenericRecord[];
  kostprijsversies?: GenericRecord[];
  kostprijsproductactiveringen?: GenericRecord[];
  "packaging-components"?: GenericRecord[];
  "packaging-component-price-versions"?: GenericRecord[];
};

export type RecommendedPriceScreenModel = {
  navigation: NavigationItem[];
  workspace: AdviesprijzenWorkspaceProps;
};

function asRows(value: unknown): GenericRecord[] {
  return Array.isArray(value) ? value as GenericRecord[] : [];
}

function asProductionMap(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildRecommendedPriceScreenModel(
  bootstrap: BootstrapResponse<RecommendedPriceDatasets>
): RecommendedPriceScreenModel {
  const datasets = bootstrap.datasets;
  return {
    navigation: bootstrap.navigation ?? [],
    workspace: {
      initialChannels: asRows(datasets.channels),
      initialAdviesprijzen: asRows(datasets.adviesprijzen),
      initialProductie: asProductionMap(datasets.productie),
      initialVerkoopprijzen: asRows(datasets.verkoopprijzen),
      initialBieren: asRows(datasets.bieren),
      initialSkus: asRows(datasets.skus),
      initialArticles: asRows(datasets.articles),
      initialKostprijsversies: asRows(datasets.kostprijsversies),
      initialKostprijsproductactiveringen: asRows(datasets.kostprijsproductactiveringen),
      initialPackagingComponents: asRows(datasets["packaging-components"]),
      initialPackagingComponentPriceVersions: asRows(datasets["packaging-component-price-versions"]),
    },
  };
}
