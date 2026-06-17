import { PageShell } from "@/components/PageShell";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";
import {
  normalizeConfigList,
  type BreakEvenConfig,
} from "@/components/break-even/breakEvenUtils";
import { BreakEvenV2Workspace } from "@/components/break-even-v2/BreakEvenV2Workspace";
import type { RealizedSalesBySkuPayload } from "@/components/break-even-v2/breakEvenV2Utils";

type GenericRecord = Record<string, unknown>;

function computeBreakEvenYearsServer(args: {
  vasteKosten: Record<string, unknown> | null | undefined;
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const set = new Set<number>();
  Object.keys(args.vasteKosten ?? {}).forEach((key) => {
    const year = Number(key);
    if (Number.isFinite(year) && year > 0) set.add(year);
  });
  (Array.isArray(args.kostprijsproductactiveringen) ? args.kostprijsproductactiveringen : []).forEach((row) => {
    const year = Number(row.jaar ?? 0);
    if (Number.isFinite(year) && year > 0) set.add(year);
  });
  return Array.from(set).sort((a, b) => b - a);
}

async function loadInitialSales(
  year: number,
  basis: BreakEvenConfig["basis"]
): Promise<{ sales: RealizedSalesBySkuPayload | null; error: string }> {
  try {
    const payload = await apiGetServer<{ result?: RealizedSalesBySkuPayload }>(
      `/integrations/douano/sales-by-sku?year=${encodeURIComponent(String(year))}&basis=${encodeURIComponent(
        String(basis ?? "invoice")
      )}`,
      "/break-even"
    );
    return { sales: payload?.result ?? null, error: "" };
  } catch (error) {
    return {
      sales: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function BreakEvenPage() {
  const bootstrap = await getBootstrap(
    [
      "auth-status",
      "break-even-configuraties",
      "vaste-kosten",
      "channels",
      "bieren",
      "skus",
      "articles",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "verkoopprijzen",
      "basisproducten",
      "samengestelde-producten",
    ],
    true,
    "/break-even"
  );

  const datasets = bootstrap.datasets ?? {};
  const years = computeBreakEvenYearsServer({
    vasteKosten: (datasets["vaste-kosten"] as any) ?? {},
    kostprijsproductactiveringen: (datasets.kostprijsproductactiveringen as any) ?? [],
  });
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const configs = normalizeConfigList(datasets["break-even-configuraties"] ?? [], fallbackYear);
  const initialConfig =
    configs.find((config) => config.is_active_for_quotes) ?? configs[0] ?? null;
  const initialYear = initialConfig?.jaar ?? fallbackYear;
  const initialBasis = initialConfig?.basis ?? "invoice";
  const initialSales = await loadInitialSales(initialYear, initialBasis);

  return (
    <PageShell
      title="Break-even analyseren"
      subtitle="Van kostprijs naar break-even in een overzicht"
      activePath="/break-even"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenV2Workspace
        initialConfigs={datasets["break-even-configuraties"] ?? []}
        vasteKosten={(datasets["vaste-kosten"] as any) ?? {}}
        channels={(datasets.channels as any) ?? []}
        bieren={(datasets.bieren as any) ?? []}
        skus={(datasets.skus as any) ?? []}
        articles={(datasets.articles as any) ?? []}
        kostprijsversies={(datasets.kostprijsversies as any) ?? []}
        kostprijsproductactiveringen={(datasets.kostprijsproductactiveringen as any) ?? []}
        verkoopprijzen={(datasets.verkoopprijzen as any) ?? []}
        basisproducten={(datasets.basisproducten as any) ?? []}
        samengesteldeProducten={(datasets["samengestelde-producten"] as any) ?? []}
        initialSales={initialSales.sales}
        initialSalesError={initialSales.error}
        initialSalesYear={initialYear}
        initialSalesBasis={initialBasis}
      />
    </PageShell>
  );
}
