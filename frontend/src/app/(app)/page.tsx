import { ErpDashboard } from "@/components/erp-dashboard/ErpDashboard";
import { getBootstrap } from "@/lib/apiServer";
import type { ErpDashboardPayload } from "@/lib/apiShared";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = (await searchParams) ?? {};
  const sinceRaw = resolved.since;
  const untilRaw = resolved.until;
  const yearRaw = resolved.year;
  const basisRaw = resolved.basis;
  const skuRaw = (resolved as any).sku_id;
  const since = Array.isArray(sinceRaw) ? sinceRaw[0] : sinceRaw;
  const until = Array.isArray(untilRaw) ? untilRaw[0] : untilRaw;
  const year = Array.isArray(yearRaw) ? yearRaw[0] : yearRaw;
  const basis = Array.isArray(basisRaw) ? basisRaw[0] : basisRaw;
  const sku_id = Array.isArray(skuRaw) ? skuRaw[0] : skuRaw;
  const extraParams: Record<string, string> = {};
  if (since) extraParams.since = String(since);
  if (until) extraParams.until = String(until);
  if (year) extraParams.year = String(year);
  if (basis) extraParams.basis = String(basis);
  if (sku_id) extraParams.sku_id = String(sku_id);

  const nextPath = Object.keys(extraParams).length
    ? `/?${new URLSearchParams(extraParams).toString()}`
    : "/";
  const bootstrap = await getBootstrap([], true, nextPath, extraParams);
  const navigation = bootstrap.navigation ?? [];
  // ERP dashboard data is fetched client-side to avoid long SSR bootstrap timeouts.
  const payload: ErpDashboardPayload = {
    range: { basis: "invoice", since: "", until: "" },
    kpis: null,
    trends: { revenue: [], orders: [] },
    tables: { top_customers: [], latest_orders: [], under_break_even: [], product_groups: [], packaging_types: [] },
    break_even: { year: 0, active_config: null },
    alerts: []
  };

  return (
    <ErpDashboard
      navigation={navigation}
      payload={payload}
      breakEvenContext={{}}
      initialFilters={{
        since: since ? String(since) : "",
        until: until ? String(until) : "",
        year: year ? String(year) : "",
        basis: basis ? String(basis) : "",
        ...(sku_id ? { sku_id: String(sku_id) } : {}),
      }}
    />
  );
}
