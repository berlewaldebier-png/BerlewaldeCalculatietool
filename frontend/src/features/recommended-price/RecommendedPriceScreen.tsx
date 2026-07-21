import { AdviesprijzenWorkspace } from "@/components/AdviesprijzenWorkspace";
import { PageShell } from "@/components/PageShell";
import type { RecommendedPriceScreenModel } from "@/features/recommended-price/recommendedPriceScreenModel";

export function RecommendedPriceScreen({ model }: { model: RecommendedPriceScreenModel }) {
  return (
    <PageShell
      title="Adviesprijzen"
      subtitle="Beheer de adviesopslag per kanaal (sell-out)."
      activePath="/adviesprijzen"
      navigation={model.navigation}
    >
      <AdviesprijzenWorkspace {...model.workspace} />
    </PageShell>
  );
}
