import { SalesStrategyScreen } from "@/features/sales-strategy/SalesStrategyScreen";
import type { ActiveSalesStrategyProjection } from "@/features/sales-strategy/activeSalesStrategyModel";
import { buildSalesStrategyScreenModel } from "@/features/sales-strategy/salesStrategyScreenModel";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

export default async function VerkoopstrategiePage() {
  const [bootstrap, projection] = await Promise.all([
    getBootstrap([], true, "/verkoopstrategie"),
    apiGetServer<ActiveSalesStrategyProjection>(
      "/meta/commercial-yearsets/active/sales-strategy",
      "/verkoopstrategie"
    ),
  ]);

  return (
    <SalesStrategyScreen
      model={buildSalesStrategyScreenModel(bootstrap.navigation ?? [], projection)}
    />
  );
}
