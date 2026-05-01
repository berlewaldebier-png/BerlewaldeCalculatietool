import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";
import { ScenarioAnalyseApp } from "@/components/scenario/ScenarioAnalyseApp";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ScenarioAnalysePage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolved = searchParams ? await searchParams : {};
  const yearParam = Array.isArray(resolved.year) ? resolved.year[0] : resolved.year;
  const requestedYear = Number(yearParam ?? 0) || 0;

  const bootstrap = await getBootstrap(
    [
      "productie",
      "bieren",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "verkoopprijzen",
      "channels",
      "basisproducten",
      "samengestelde-producten",
    ],
    true,
    "/scenario-analyse"
  );

  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];

  const yearOptions = Object.keys(productie)
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => right - left);
  const defaultYear = yearOptions.length > 0 ? yearOptions[0] : new Date().getFullYear();
  const year = requestedYear > 0 ? requestedYear : defaultYear;

  return (
    <PageShell
      title="Scenario analyse"
      subtitle="Simuleer wat-als wijzigingen (bijv. 33cl → 30cl) en bekijk de impact op aantallen en kostprijs."
      activePath="/scenario-analyse"
      navigation={navigation}
    >
      <ScenarioAnalyseApp
        year={year}
        channels={channels}
        bieren={bieren}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
      />
    </PageShell>
  );
}

