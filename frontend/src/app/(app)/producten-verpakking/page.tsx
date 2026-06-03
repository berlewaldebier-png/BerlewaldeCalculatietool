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
      "productie",
      "channels",
      "verkoopprijzen",
      "packaging-components",
      "glasmaten",
      "packaging-component-prices",
      "articles",
      "skus",
      "bom-lines",
      "kostprijsversies",
      "kostprijsproductactiveringen"
    ],
    true,
    "/producten-verpakking"
  );

  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] ?? {}) as Record<string, unknown>;
  const channels = unwrapList(bootstrap.datasets["channels"]);
  const verkoopprijzen = unwrapList(bootstrap.datasets["verkoopprijzen"]);
  const verpakkingsonderdelen = unwrapList(bootstrap.datasets["packaging-components"]);
  const glasmaten = unwrapList(bootstrap.datasets["glasmaten"]);
  const verpakkingsonderdeelPrijzen = unwrapList(bootstrap.datasets["packaging-component-prices"]);
  const articles = unwrapList(bootstrap.datasets["articles"]);
  const skus = unwrapList(bootstrap.datasets["skus"]);
  const bomLines = unwrapList(bootstrap.datasets["bom-lines"]);
  const kostprijsversies = unwrapList(bootstrap.datasets["kostprijsversies"]);
  const kostprijsproductactiveringen = unwrapList(bootstrap.datasets["kostprijsproductactiveringen"]);

  return (
    <PageShell
      title="Producten & verpakking"
      subtitle="Beheer verpakkingsonderdelen, glasmaten en verkoopbare artikelen op basis van de centrale SKU-lijst."
      activePath="/producten-verpakking"
      navigation={navigation}
    >
      <ProductenVerpakkingWorkspace
        productie={productie}
        channels={channels}
        verkoopprijzen={verkoopprijzen}
        verpakkingsonderdelen={verpakkingsonderdelen}
        glasmaten={glasmaten}
        verpakkingsonderdeelPrijzen={verpakkingsonderdeelPrijzen}
        articles={articles}
        skus={skus}
        bomLines={bomLines}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
      />
    </PageShell>
  );
}

