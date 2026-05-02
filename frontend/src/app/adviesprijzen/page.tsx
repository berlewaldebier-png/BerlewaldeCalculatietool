import { AdviesprijzenWorkspace } from "@/components/AdviesprijzenWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function AdviesprijzenPage() {
  const bootstrap = await getBootstrap(
    [
      "channels",
      "adviesprijzen",
      "productie",
      "verkoopprijzen",
      "bieren",
      "skus",
      "articles",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "catalog-products",
      "packaging-components",
      "packaging-component-price-versions"
    ],
    true,
    "/adviesprijzen"
  );
  const navigation = bootstrap.navigation ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const adviesprijzen = (bootstrap.datasets["adviesprijzen"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const catalogusproducten = (bootstrap.datasets["catalog-products"] as any[]) ?? [];
  const verpakkingscomponenten = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const verpakkingscomponentPrijsversies = (bootstrap.datasets["packaging-component-price-versions"] as any[]) ?? [];

  return (
    <PageShell
      title="Adviesprijzen"
      subtitle="Beheer de adviesopslag per kanaal (sell-out)."
      activePath="/adviesprijzen"
      navigation={navigation}
    >
      <AdviesprijzenWorkspace
        initialChannels={channels}
        initialAdviesprijzen={adviesprijzen}
        initialProductie={productie}
        initialVerkoopprijzen={verkoopprijzen}
        initialBieren={bieren}
        initialSkus={skus}
        initialArticles={articles}
        initialKostprijsversies={kostprijsversies}
        initialKostprijsproductactiveringen={kostprijsproductactiveringen}
        initialCatalogusproducten={catalogusproducten}
        initialPackagingComponents={verpakkingscomponenten}
        initialPackagingComponentPriceVersions={verpakkingscomponentPrijsversies}
      />
    </PageShell>
  );
}

