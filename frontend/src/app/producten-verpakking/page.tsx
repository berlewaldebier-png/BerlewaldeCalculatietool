import { PageShell } from "@/components/PageShell";
import { ProductenVerpakkingWorkspace } from "@/components/ProductenVerpakkingWorkspace";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductenVerpakkingPage() {
  const bootstrap = await getBootstrap(
    [
      "packaging-components",
      "base-product-masters",
      "composite-product-masters",
      "packaging-component-prices"
    ],
    true,
    "/producten-verpakking"
  );

  const navigation = bootstrap.navigation ?? [];
  const verpakkingsonderdelen = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["base-product-masters"] as any[]) ?? [];
  const samengestelde = (bootstrap.datasets["composite-product-masters"] as any[]) ?? [];
  const verpakkingsonderdeelPrijzen = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];

  return (
    <PageShell
      title="Producten & verpakking"
      subtitle="Beheer verpakkingsonderdelen, basisproducten en samengestelde producten als stamdata in één overzichtelijke workspace."
      activePath="/producten-verpakking"
      navigation={navigation}
    >
      <ProductenVerpakkingWorkspace
        verpakkingsonderdelen={verpakkingsonderdelen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengestelde}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
      />
    </PageShell>
  );
}

