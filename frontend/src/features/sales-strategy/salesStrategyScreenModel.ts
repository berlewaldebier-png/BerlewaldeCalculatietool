import type { ActiveSalesStrategyProjection } from "@/features/sales-strategy/activeSalesStrategyModel";
import type { NavigationItem } from "@/lib/apiShared";

export type SalesStrategyScreenModel = {
  navigation: NavigationItem[];
  projection: ActiveSalesStrategyProjection;
};

export function buildSalesStrategyScreenModel(
  navigation: NavigationItem[],
  projection: ActiveSalesStrategyProjection
): SalesStrategyScreenModel {
  return {
    navigation,
    projection,
  };
}
