import { RecommendedPriceScreen } from "@/features/recommended-price/RecommendedPriceScreen";
import {
  buildRecommendedPriceScreenModel,
  RECOMMENDED_PRICE_DATASET_KEYS,
  type RecommendedPriceDatasets,
} from "@/features/recommended-price/recommendedPriceScreenModel";
import { getBootstrap } from "@/lib/apiServer";

export default async function AdviesprijzenPage() {
  const bootstrap = await getBootstrap<RecommendedPriceDatasets>(
    [...RECOMMENDED_PRICE_DATASET_KEYS],
    true,
    "/adviesprijzen"
  );
  return <RecommendedPriceScreen model={buildRecommendedPriceScreenModel(bootstrap)} />;
}

