import type { VatDisplayMode } from "@/components/ui/VatDisplayToggle";
import { buildRecommendedPriceDisplayRow } from "@/features/recommended-price/recommendedPriceFormModel";

export type ActiveRecommendedPriceBinding = {
  generation_id: string;
  run_id: string;
  operational_year: number;
  manifest_hash: string;
  validation_hash: string;
};

export type ActiveRecommendedPriceChannel = {
  channel_code: string;
  channel_name: string;
  order: number;
  activation_advice_markup_pct: number | null;
  advice_markup_pct: number | null;
  markup_state: "ready" | "missing" | "invalid" | "ambiguous" | "blocked";
  reason_codes: string[];
  pricing_record_id: string;
  pricing_record_hash: string;
  pricing_updated_at: string;
  editable: boolean;
};

export type ActiveRecommendedPriceItem = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  beer_name: string;
  canonical_beer_id: string;
  subject_type: string;
  subject_id: string;
  sku_kind: string;
  scope_classification: string;
  cost_price: number | null;
  cost_state: "ready" | "missing_cost" | "not_applicable";
  list_price: number | null;
  price_state: "ready" | "missing" | "non_positive" | "ambiguous" | "not_applicable";
  price_required: boolean;
  vat_pct: number | null;
  vat_state: "ready" | "missing";
  advice_state: "ready" | "missing_cost" | "missing_sell_in" | "missing_vat" | "not_applicable";
  advice_reason_codes: string[];
};

export type ActiveRecommendedPriceGroup = {
  key: string;
  label: string;
  kind: string;
  priority: number;
  items: ActiveRecommendedPriceItem[];
};

export type ActiveRecommendedPriceProjection = {
  version: string;
  status: "ready" | "missing";
  read_only: boolean;
  can_edit: boolean;
  binding: ActiveRecommendedPriceBinding | null;
  channels: ActiveRecommendedPriceChannel[];
  groups: ActiveRecommendedPriceGroup[];
  summary: {
    sku_count: number;
    group_count: number;
    channel_count: number;
    ready_advice_sku_count: number;
    missing_cost_count: number;
    missing_sell_in_count: number;
    missing_vat_count: number;
    not_applicable_count: number;
    missing_channel_markup_count: number;
  };
  reason_codes: string[];
};

export type ActiveRecommendedPriceDisplayRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  ownerLabel: string;
  subjectType: string;
  status: ActiveRecommendedPriceItem["advice_state"] | "missing_channel_markup";
  kostprijsShown: number | null;
  sellInShown: number | null;
  adviesMinShown: number | null;
  adviesMaxShown: number | null;
  margeKlantPct: number | null;
  btwPct: number | null;
};

export function activeRecommendedPriceStatusLabel(
  status: ActiveRecommendedPriceDisplayRow["status"]
): string {
  if (status === "ready") return "berekend";
  if (status === "missing_cost") return "kostprijs ontbreekt";
  if (status === "missing_sell_in") return "sell-inprijs ontbreekt";
  if (status === "missing_vat") return "btw-tarief ontbreekt";
  if (status === "missing_channel_markup") return "kanaalopslag ontbreekt";
  return "niet van toepassing";
}

export function buildActiveRecommendedPriceDisplayRow({
  item,
  ownerLabel,
  adviceMarkupPct,
  vatDisplay,
}: {
  item: ActiveRecommendedPriceItem;
  ownerLabel: string;
  adviceMarkupPct: number | null;
  vatDisplay: VatDisplayMode;
}): ActiveRecommendedPriceDisplayRow {
  const channelReady = adviceMarkupPct !== null && Number.isFinite(adviceMarkupPct) && adviceMarkupPct >= 0;
  const status = item.advice_state === "ready" && !channelReady
    ? "missing_channel_markup"
    : item.advice_state;
  const cost = item.cost_price;
  const sellIn = item.list_price;
  const vat = item.vat_pct;
  if (
    status !== "ready" ||
    cost === null ||
    sellIn === null ||
    vat === null
  ) {
    return {
      skuId: item.sku_id,
      skuCode: item.sku_code,
      skuName: item.sku_name,
      ownerLabel,
      subjectType: item.subject_type,
      status,
      kostprijsShown: item.cost_state === "ready" ? cost : null,
      sellInShown: item.price_state === "ready" ? sellIn : null,
      adviesMinShown: null,
      adviesMaxShown: null,
      margeKlantPct: null,
      btwPct: vat,
    };
  }

  const calculated = buildRecommendedPriceDisplayRow({
    row: {
      skuId: item.sku_id,
      bierId: item.canonical_beer_id,
      biernaam: item.beer_name || ownerLabel,
      btwPct: vat,
      kostprijsversieId: "",
      productId: item.subject_id,
      productType: item.subject_type === "beer" ? "basis" : "catalog",
      verpakking: item.sku_name,
      kostprijsEx: cost,
    },
    sellInEx: sellIn,
    adviesOpslagPct: adviceMarkupPct as number,
    vatDisplay,
  });
  return {
    skuId: item.sku_id,
    skuCode: item.sku_code,
    skuName: item.sku_name,
    ownerLabel,
    subjectType: item.subject_type,
    status: "ready",
    kostprijsShown: calculated.kostprijsShown,
    sellInShown: calculated.sellInShown,
    adviesMinShown: calculated.adviesMinShown,
    adviesMaxShown: calculated.adviesMaxShown,
    margeKlantPct: calculated.margeKlantPct,
    btwPct: vat,
  };
}

export function filterActiveRecommendedPriceGroups(
  groups: ActiveRecommendedPriceGroup[],
  filter: string
): ActiveRecommendedPriceGroup[] {
  const query = filter.trim().toLocaleLowerCase("nl-NL");
  if (!query) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.sku_name} ${item.sku_code}`
          .toLocaleLowerCase("nl-NL")
          .includes(query)
      ),
    }))
    .filter((group) => group.items.length > 0);
}
