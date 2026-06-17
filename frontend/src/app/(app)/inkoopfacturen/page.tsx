import { InkoopFacturenWorkspace } from "@/components/InkoopFacturenWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function InkoopfacturenPage() {
  const bootstrap = await getBootstrap(
    [
      "kostprijsversies",
      "basisproducten",
      "samengestelde-producten",
      "skus",
      "bieren",
      "articles",
      "bom-lines",
      "productie",
      "vaste-kosten",
      "tarieven-heffingen",
      "kostprijsproductactiveringen",
      "productgroepen",
      "alcoholcategorieen",
      "verpakkingstypen",
      "packaging-component-prices",
    ],
    true,
    "/inkoopfacturen"
  );
  const navigation = bootstrap.navigation ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const bomLines = (bootstrap.datasets["bom-lines"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any[]>) ?? {};
  const tarievenHeffingen = (bootstrap.datasets["tarieven-heffingen"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const productgroepen = (bootstrap.datasets["productgroepen"] as any[]) ?? [];
  const alcoholcategorieen = (bootstrap.datasets["alcoholcategorieen"] as any[]) ?? [];
  const verpakkingstypen = (bootstrap.datasets["verpakkingstypen"] as any[]) ?? [];
  const packagingComponentPrices = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];

  return (
    <PageShell
      title="Inkoopfacturen"
      subtitle="Beheer facturen als bron voor nieuwe inkoop-kostprijsversies."
      activePath="/inkoopfacturen"
      navigation={navigation}
    >
      <InkoopFacturenWorkspace
        kostprijsversies={kostprijsversies}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        skus={skus}
        bieren={bieren}
        articles={articles}
        bomLines={bomLines}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        productgroepen={productgroepen}
        alcoholcategorieen={alcoholcategorieen}
        verpakkingstypen={verpakkingstypen}
        packagingComponentPrices={packagingComponentPrices}
      />
    </PageShell>
  );
}
