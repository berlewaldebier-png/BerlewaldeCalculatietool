import { SalesStrategyScreen } from "@/features/sales-strategy/SalesStrategyScreen";
import {
  buildSalesStrategyScreenModel,
  SALES_STRATEGY_DATASET_KEYS,
  type SalesStrategyDatasets,
} from "@/features/sales-strategy/salesStrategyScreenModel";
import { getBootstrap } from "@/lib/apiServer";

export default async function VerkoopstrategiePage() {
  const bootstrap = await getBootstrap<SalesStrategyDatasets>(
    [...SALES_STRATEGY_DATASET_KEYS],
    true,
    "/verkoopstrategie"
  );

  return <SalesStrategyScreen model={buildSalesStrategyScreenModel(bootstrap)} />;
}
