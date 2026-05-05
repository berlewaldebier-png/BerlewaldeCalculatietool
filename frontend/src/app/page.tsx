import { ErpDashboard } from "@/components/erp-dashboard/ErpDashboard";
import { getBootstrap } from "@/lib/apiServer";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sinceRaw = searchParams?.since;
  const untilRaw = searchParams?.until;
  const since = Array.isArray(sinceRaw) ? sinceRaw[0] : sinceRaw;
  const until = Array.isArray(untilRaw) ? untilRaw[0] : untilRaw;
  const extraParams: Record<string, string> = {};
  if (since) extraParams.since = String(since);
  if (until) extraParams.until = String(until);

  const nextPath = Object.keys(extraParams).length
    ? `/?${new URLSearchParams(extraParams).toString()}`
    : "/";
  const bootstrap = await getBootstrap(["erp-dashboard"], true, nextPath, extraParams);
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
