import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";
import { OfferteSamenstellenApp } from "@/components/offerte-samenstellen/OfferteSamenstellenApp";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OfferteSamenstellenPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};

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
      "catalog-products",
      "packaging-components",
      "packaging-component-prices"
    ],
    true,
    "/offerte-samenstellen"
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
  const catalogusproducten = (bootstrap.datasets["catalog-products"] as any[]) ?? [];
  const verpakkingsonderdelen = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const verpakkingsonderdeelPrijzen = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];

  const yearOptions = Object.keys(productie)
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => right - left);

  const year = yearOptions.length > 0 ? yearOptions[0] : new Date().getFullYear();

  const mode = typeof resolvedSearchParams.mode === "string" ? resolvedSearchParams.mode : "";

  return (
    <PageShell
      title="Offerte samenstellen"
      subtitle="Bouw offertes op basis van standaardprijzen en breid ze uit met introducties, staffels, mix deals en services."
      activePath="/offerte-samenstellen"
      navigation={navigation}
    >
      <OfferteSamenstellenApp
        year={year}
        channels={channels}
        bieren={bieren}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        catalogusproducten={catalogusproducten}
        verpakkingsonderdelen={verpakkingsonderdelen}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
        initialMode={mode}
      />
    </PageShell>
  );
}
