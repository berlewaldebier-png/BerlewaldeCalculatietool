export type ActiveSalesStrategyBinding = {
  generation_id: string;
  run_id: string;
  operational_year: number;
  manifest_hash: string;
  validation_hash: string;
};

export type ActiveSalesStrategyItem = {
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
  cost_blocker_codes: string[];
  activation_list_price: number | null;
  list_price: number | null;
  price_state: "ready" | "missing" | "non_positive" | "ambiguous" | "not_applicable";
  price_required: boolean;
  price_reason_codes: string[];
  pricing_record_id: string;
  pricing_record_hash: string;
  pricing_updated_at: string;
  target_pricing_id: string;
  price_source: "target_record" | "sku_record" | "missing";
  editable: boolean;
  display_priority: number;
};

export type ActiveSalesStrategyGroup = {
  key: string;
  label: string;
  kind: string;
  priority: number;
  items: ActiveSalesStrategyItem[];
};

export type ActiveSalesStrategyProjection = {
  version: string;
  status: "ready" | "missing";
  read_only: boolean;
  can_edit: boolean;
  binding: ActiveSalesStrategyBinding | null;
  groups: ActiveSalesStrategyGroup[];
  summary: {
    sku_count: number;
    group_count: number;
    ready_price_count: number;
    missing_price_count: number;
    non_positive_price_count: number;
    ambiguous_price_count: number;
    not_applicable_price_count: number;
    compatibility_only_price_count: number;
  };
  reason_codes: string[];
};

export function activeSalesStrategyStatusLabel(item: ActiveSalesStrategyItem): string {
  if (item.price_state === "ready") return "prijs gezet";
  if (item.price_state === "missing") return "prijs ontbreekt";
  if (item.price_state === "non_positive") return "prijs moet groter zijn dan 0";
  if (item.price_state === "ambiguous") return "meerdere prijsrecords";
  return "niet van toepassing";
}

export function activeSalesStrategyStatusTone(item: ActiveSalesStrategyItem): "ok" | "warning" {
  return item.price_state === "ready" || item.price_state === "not_applicable" ? "ok" : "warning";
}

export function activeSalesStrategyMarkup(item: ActiveSalesStrategyItem, listPrice: number | null): number | null {
  const cost = Number(item.cost_price ?? 0);
  const price = Number(listPrice ?? 0);
  if (item.cost_state !== "ready" || cost <= 0 || price <= 0) return null;
  return ((price / cost) - 1) * 100;
}

export function filterActiveSalesStrategyGroups(
  groups: ActiveSalesStrategyGroup[],
  filter: string
): ActiveSalesStrategyGroup[] {
  const query = filter.trim().toLocaleLowerCase("nl-NL");
  if (!query) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.sku_name} ${item.sku_code}`.toLocaleLowerCase("nl-NL").includes(query)
      ),
    }))
    .filter((group) => group.items.length > 0);
}
