import { PageShell } from "@/components/PageShell";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";
import { OfferteSamenstellenApp } from "@/components/offerte-samenstellen/OfferteSamenstellenApp";
import type { QuoteCommercialContextResponse } from "@/features/commercial-context/quoteCommercialContext";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OfferteSamenstellenPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};

  const [bootstrap, commercialContext] = await Promise.all([
    getBootstrap(
      [
        "productie",
        "bieren",
        "skus",
        "articles",
        "kostprijsversies",
        "kostprijsproductactiveringen",
        "verkoopprijzen",
        "channels",
        "basisproducten",
        "samengestelde-producten",
        "packaging-components",
        "packaging-component-prices",
        "break-even-configuraties",
        "vaste-kosten",
        "cost-management-settings"
      ],
      true,
      "/offerte-samenstellen"
    ),
    apiGetServer<QuoteCommercialContextResponse>(
      "/quotes/commercial-context",
      "/offerte-samenstellen"
    ),
  ]);

  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const verpakkingsonderdelen = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const verpakkingsonderdeelPrijzen = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];
  const breakEvenConfiguraties = bootstrap.datasets["break-even-configuraties"] ?? [];
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const costManagementSettings = (bootstrap.datasets["cost-management-settings"] as Record<string, any>) ?? {};

  const yearOptions = Object.keys(productie)
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => right - left);

  const legacyYear = yearOptions.length > 0 ? yearOptions[0] : new Date().getFullYear();
  const year =
    commercialContext.status === "ready" && commercialContext.binding
      ? commercialContext.binding.operational_year
      : legacyYear;

  const mode = typeof resolvedSearchParams.mode === "string" ? resolvedSearchParams.mode : "";
  const draftId = typeof resolvedSearchParams.draft === "string" ? resolvedSearchParams.draft : null;
  const scenarioId = typeof resolvedSearchParams.scenario === "string" ? resolvedSearchParams.scenario : null;

  return (
    <PageShell
      title="Offerte samenstellen"
      subtitle="Bouw offertes op basis van standaardprijzen en breid ze uit met introducties, staffels, mix deals en services."
      activePath="/offerte-samenstellen"
      navigation={navigation}
    >
      <OfferteSamenstellenApp
        year={year}
        initialCommercialContext={commercialContext}
        channels={channels}
        bieren={bieren}
        productie={productie}
        costManagementSettings={costManagementSettings}
        skus={skus}
        articles={articles}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        verpakkingsonderdelen={verpakkingsonderdelen}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
        breakEvenConfiguraties={breakEvenConfiguraties}
        vasteKosten={vasteKosten}
        initialMode={mode}
        initialDraftId={draftId}
        scenarioId={scenarioId}
      />
    </PageShell>
  );
}
