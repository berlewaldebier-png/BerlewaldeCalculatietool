import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductkoppelingPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = searchParams ? await searchParams : {};
  const q = typeof resolved.q === "string" ? resolved.q : "";
  const douanoProductId =
    typeof resolved.douano_product_id === "string" ? resolved.douano_product_id : "";
  const skuId = typeof resolved.sku_id === "string" ? resolved.sku_id : "";
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/productkoppeling");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Productkoppeling"
      subtitle="Koppel Douano producten aan actieve kostprijscombinaties (bier + verpakking)."
      activePath="/beheer"
      navigation={navigation}
    >
      <DouanoProductMappingCard
        initialFilter={douanoProductId ? String(douanoProductId) : q}
        initialSkuId={skuId}
      />
    </PageShell>
  );
}
