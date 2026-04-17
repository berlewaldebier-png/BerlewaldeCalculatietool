import { PageShell } from "@/components/PageShell";
import { ProductenVerpakkingWorkspace } from "@/components/ProductenVerpakkingWorkspace";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductenVerpakkingPage() {
  const bootstrap = await getBootstrap(
    [
      "packaging-components",
      "base-product-masters",
      "composite-product-masters",
      "catalog-products",
      "packaging-component-prices",
      "bieren"
    ],
    true,
    "/producten-verpakking"
  );

  const navigation = bootstrap.navigation ?? [];
  const verpakkingsonderdelen = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["base-product-masters"] as any[]) ?? [];
  const samengestelde = (bootstrap.datasets["composite-product-masters"] as any[]) ?? [];
  const catalogusproducten = (bootstrap.datasets["catalog-products"] as any[]) ?? [];
  const verpakkingsonderdeelPrijzen = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];

  return (
    <PageShell
      title="Producten & verpakking"
      subtitle="Beheer verpakkingsonderdelen, basisproducten en samengestelde producten als stamdata in een overzichtelijke workspace."
      activePath="/producten-verpakking"
      navigation={navigation}
    >
      <ProductenVerpakkingWorkspace
        verpakkingsonderdelen={verpakkingsonderdelen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengestelde}
        catalogusproducten={catalogusproducten}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
      />
    </PageShell>
  );
}

