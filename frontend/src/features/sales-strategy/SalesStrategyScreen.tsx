import { PageShell } from "@/components/PageShell";
import { ActiveSalesStrategyWorkspace } from "@/features/sales-strategy/ActiveSalesStrategyWorkspace";
import type { SalesStrategyScreenModel } from "@/features/sales-strategy/salesStrategyScreenModel";

export function SalesStrategyScreen({ model }: { model: SalesStrategyScreenModel }) {
  return (
    <PageShell
      title="Verkoopstrategie"
      subtitle="Beheer per jaar de verkoopprijzen per verpakking. We sturen op opslag en verkoopprijs; marge wordt afgeleid."
      activePath="/verkoopstrategie"
      navigation={model.navigation}
    >
      <ActiveSalesStrategyWorkspace initialProjection={model.projection} />
    </PageShell>
  );
}
