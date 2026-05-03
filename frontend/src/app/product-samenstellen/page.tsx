import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";
import { ProductSamenstellenWizard } from "@/features/sku-composition/ProductSamenstellenWizard";

export default async function ProductSamenstellenPage() {
  const bootstrap = await getBootstrap(
    [
      "channels",
      "verkoopprijzen",
      "productie",
      "skus",
      "articles",
      "bom-lines",
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "packaging-components",
      "packaging-component-prices",
    ],
    true,
    "/product-samenstellen"
  );

  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const bomLines = (bootstrap.datasets["bom-lines"] as any[]) ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const packagingComponents = (bootstrap.datasets["packaging-components"] as any[]) ?? [];
  const packagingComponentPrices = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];

  const yearOptions = Object.keys(productie)
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => right - left);
  const year = yearOptions.length > 0 ? yearOptions[0] : new Date().getFullYear();

  return (
    <PageShell
      title="Product samenstellen"
      subtitle="Maak afvuleenheden en verkoopbare artikelen op basis van centrale SKU’s en verpakkingsonderdelen."
      activePath="/product-samenstellen"
      navigation={navigation}
    >
      <ProductSamenstellenWizard
        year={year}
        channels={channels}
        verkoopprijzen={verkoopprijzen}
        skus={skus}
        articles={articles}
        bomLines={bomLines}
        kostprijsversies={kostprijsversies}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        packagingComponents={packagingComponents}
        packagingComponentPrices={packagingComponentPrices}
      />
    </PageShell>
  );
}

