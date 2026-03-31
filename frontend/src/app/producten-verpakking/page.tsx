import { PageShell } from "@/components/PageShell";
import { ProductenVerpakkingWorkspace } from "@/components/ProductenVerpakkingWorkspace";
import {
  getDataset,
  getNavigation,
} from "@/lib/api";

export default async function ProductenVerpakkingPage() {
  const [navigation, verpakkingsonderdelen, basisproducten, samengestelde, verpakkingsonderdeelPrijzen] =
    await Promise.all([
      getNavigation(),
      getDataset("packaging-components"),
      getDataset("base-product-masters"),
      getDataset("composite-product-masters"),
      getDataset("packaging-component-prices")
    ]);

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
