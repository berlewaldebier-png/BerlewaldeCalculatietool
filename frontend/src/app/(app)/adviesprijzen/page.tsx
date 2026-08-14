import { RecommendedPriceScreen } from "@/features/recommended-price/RecommendedPriceScreen";
import type { ActiveRecommendedPriceProjection } from "@/features/recommended-price/activeRecommendedPriceModel";
import { buildRecommendedPriceScreenModel } from "@/features/recommended-price/recommendedPriceScreenModel";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

export default async function AdviesprijzenPage() {
  const [bootstrap, projection] = await Promise.all([
    getBootstrap([], true, "/adviesprijzen"),
    apiGetServer<ActiveRecommendedPriceProjection>(
      "/meta/commercial-yearsets/active/recommended-prices",
      "/adviesprijzen"
    ),
  ]);
  return (
    <RecommendedPriceScreen
      model={buildRecommendedPriceScreenModel(bootstrap.navigation ?? [], projection)}
    />
  );
}

