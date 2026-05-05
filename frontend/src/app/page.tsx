import { ErpDashboard } from "@/components/erp-dashboard/ErpDashboard";
import { getBootstrap } from "@/lib/apiServer";

export default async function HomePage() {
  const bootstrap = await getBootstrap(["erp-dashboard"], true, "/");
  const navigation = bootstrap.navigation ?? [];
  const payload = (bootstrap.datasets["erp-dashboard"] as any) ?? {
    range: { basis: "order", since: "", until: "" },
    kpis: null,
    trends: { revenue: [], orders: [] },
    tables: { top_customers: [], latest_orders: [], under_break_even: [], product_groups: [] },
    break_even: { year: 0, active_config: null },
    alerts: []
  };

  return <ErpDashboard navigation={navigation} payload={payload} />;
}
