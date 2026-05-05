import { ErpDashboard } from "@/components/erp-dashboard/ErpDashboard";
import { getBootstrap } from "@/lib/apiServer";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sinceRaw = searchParams?.since;
  const untilRaw = searchParams?.until;
  const yearRaw = searchParams?.year;
  const since = Array.isArray(sinceRaw) ? sinceRaw[0] : sinceRaw;
  const until = Array.isArray(untilRaw) ? untilRaw[0] : untilRaw;
  const year = Array.isArray(yearRaw) ? yearRaw[0] : yearRaw;
  const extraParams: Record<string, string> = {};
  if (since) extraParams.since = String(since);
  if (until) extraParams.until = String(until);
  if (year) extraParams.year = String(year);

  const nextPath = Object.keys(extraParams).length
    ? `/?${new URLSearchParams(extraParams).toString()}`
    : "/";
  const bootstrap = await getBootstrap(
    [
      "erp-dashboard",
      // Break-even context for dashboard target line (reuse existing frontend compute).
      "break-even-configuraties",
      "vaste-kosten",
      "channels",
      "bieren",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "verkoopprijzen",
      "skus",
      "articles",
      "basisproducten",
      "samengestelde-producten",
    ],
    true,
    nextPath,
    extraParams
  );
  const navigation = bootstrap.navigation ?? [];
  const payload = (bootstrap.datasets["erp-dashboard"] as any) ?? {
    range: { basis: "order", since: "", until: "" },
    kpis: null,
    trends: { revenue: [], orders: [] },
    tables: { top_customers: [], latest_orders: [], under_break_even: [], product_groups: [] },
    break_even: { year: 0, active_config: null },
    alerts: []
  };

  const breakEvenContext = {
    configs: bootstrap.datasets["break-even-configuraties"],
    vasteKosten: bootstrap.datasets["vaste-kosten"],
    channels: bootstrap.datasets["channels"],
    bieren: bootstrap.datasets["bieren"],
    kostprijsversies: bootstrap.datasets["kostprijsversies"],
    kostprijsproductactiveringen: bootstrap.datasets["kostprijsproductactiveringen"],
    verkoopprijzen: bootstrap.datasets["verkoopprijzen"],
    skus: bootstrap.datasets["skus"],
    articles: bootstrap.datasets["articles"],
    basisproducten: bootstrap.datasets["basisproducten"],
    samengesteldeProducten: bootstrap.datasets["samengestelde-producten"],
  };

  return <ErpDashboard navigation={navigation} payload={payload} breakEvenContext={breakEvenContext} />;
}
