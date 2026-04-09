import { NieuwJaarWizard } from "@/components/NieuwJaarWizard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NieuwJaarVoorbereidenPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = (await props.searchParams) ?? {};
  const targetYearParam = Array.isArray(searchParams.target_year) ? searchParams.target_year[0] : searchParams.target_year;
  const requestedTargetYear = Number(targetYearParam ?? 0) || 0;

  const bootstrap = await getBootstrap(
    [
      "berekeningen",
      "kostprijsproductactiveringen",
      "basisproducten",
      "samengestelde-producten",
      "bieren",
      "productie",
      "vaste-kosten",
      "tarieven-heffingen",
      "packaging-components",
      "packaging-component-prices",
      "verkoopprijzen"
    ],
    true,
    "/nieuw-jaar-voorbereiden"
  );
  const navigation = bootstrap.navigation ?? [];
  const berekeningen = (bootstrap.datasets["berekeningen"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const tarieven = (bootstrap.datasets["tarieven-heffingen"] as any[]) ?? [];
  const packagingComponents = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const packagingComponentPrices = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];

  const yearSet = new Set<number>();
  Object.keys(productie ?? {}).forEach((key) => {
    if (/^\d+$/.test(key)) yearSet.add(Number(key));
  });
  Object.keys(vasteKosten ?? {}).forEach((key) => {
    if (/^\d+$/.test(key)) yearSet.add(Number(key));
  });
  (Array.isArray(tarieven) ? tarieven : []).forEach((row) => yearSet.add(Number((row as any)?.jaar ?? 0)));
  (Array.isArray(packagingComponentPrices) ? packagingComponentPrices : []).forEach((row) =>
    yearSet.add(Number((row as any)?.jaar ?? 0))
  );
  (Array.isArray(verkoopprijzen) ? verkoopprijzen : []).forEach((row) => yearSet.add(Number((row as any)?.jaar ?? 0)));
  (Array.isArray(berekeningen) ? berekeningen : []).forEach((row) =>
    yearSet.add(Number((((row as any)?.basisgegevens ?? {}) as any)?.jaar ?? 0))
  );
  const years = Array.from(yearSet).filter((year) => year > 0).sort((a, b) => a - b);
  const defaultSourceYear = years[years.length - 1] ?? new Date().getFullYear();
  const defaultTargetYear = defaultSourceYear + 1;
  const effectiveTargetYear = requestedTargetYear > 0 ? requestedTargetYear : defaultTargetYear;

  return (
    <PageShell
      title={`Nieuw jaar ${effectiveTargetYear} voorbereiden`}
      subtitle="Maak een nieuwe jaarset aan op basis van een bestaand bronjaar."
      activePath="/nieuw-jaar-voorbereiden"
      navigation={navigation}
    >
      <NieuwJaarWizard
        initialBerekeningen={berekeningen}
        initialKostprijsproductactiveringen={kostprijsproductactiveringen}
        initialBasisproducten={basisproducten}
        initialSamengesteldeProducten={samengesteldeProducten}
        initialBieren={bieren}
        initialProductie={productie}
        initialVasteKosten={vasteKosten}
        initialTarieven={tarieven}
        initialPackagingComponents={packagingComponents}
        initialPackagingComponentPrices={packagingComponentPrices}
        initialVerkoopprijzen={verkoopprijzen}
        initialTargetYear={requestedTargetYear > 0 ? requestedTargetYear : undefined}
      />
    </PageShell>
  );
}
