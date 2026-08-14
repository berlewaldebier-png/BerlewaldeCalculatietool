import type { AdviesprijzenWorkspaceProps } from "@/components/AdviesprijzenWorkspace";
import type { ActiveRecommendedPriceProjection } from "@/features/recommended-price/activeRecommendedPriceModel";
import type { NavigationItem } from "@/lib/apiShared";

export type RecommendedPriceScreenModel = {
  navigation: NavigationItem[];
  workspace: AdviesprijzenWorkspaceProps;
};

export function buildRecommendedPriceScreenModel(
  navigation: NavigationItem[],
  projection: ActiveRecommendedPriceProjection
): RecommendedPriceScreenModel {
  return {
    navigation,
    workspace: { initialProjection: projection },
  };
}
