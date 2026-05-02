import { PageShell } from "@/components/PageShell";
import { ProductenVerpakkingWorkspace } from "@/components/ProductenVerpakkingWorkspace";
import { getBootstrap } from "@/lib/apiServer";

type GenericRecord = Record<string, unknown>;

function unwrapList(value: unknown): GenericRecord[] {
  if (Array.isArray(value)) return value as GenericRecord[];
  if (value && typeof value === "object") {
    const data = (value as any).data;
    if (Array.isArray(data)) return data as GenericRecord[];
  }
  return [];
}

export default async function ProductenVerpakkingPage() {
  const bootstrap = await getBootstrap(
    [
      "packaging-components",
      "base-product-masters",
      "composite-product-masters",
      "catalog-products",
      "glasmaten",
      "packaging-component-prices",
      "bieren",
      "productie",
      "kostprijsversies",
      "kostprijsproductactiveringen"
    ],
    true,
    "/producten-verpakking"
  );

  const navigation = bootstrap.navigation ?? [];
  const verpakkingsonderdelen = unwrapList(bootstrap.datasets["packaging-components"]);
  const basisproducten = unwrapList(bootstrap.datasets["base-product-masters"]);
  const samengestelde = unwrapList(bootstrap.datasets["composite-product-masters"]);
  const catalogusproducten = unwrapList(bootstrap.datasets["catalog-products"]);
  const glasmaten = unwrapList(bootstrap.datasets["glasmaten"]);
  const verpakkingsonderdeelPrijzen = unwrapList(bootstrap.datasets["packaging-component-prices"]);
  const bieren = unwrapList(bootstrap.datasets["bieren"]);
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const kostprijsversies = unwrapList(bootstrap.datasets["kostprijsversies"]);
  const kostprijsproductactiveringen = unwrapList(bootstrap.datasets["kostprijsproductactiveringen"]);

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
        glasmaten={glasmaten}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
        bieren={bieren}
        productie={productie}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
      />
    </PageShell>
  );
}

