import { ProductkoppelingWorkspace } from "@/components/ProductkoppelingWorkspace";
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
  const tab = typeof resolved.tab === "string" ? resolved.tab : "";

  const unmappedBasis = typeof resolved.unmapped_basis === "string" ? resolved.unmapped_basis : "";
  const unmappedYearRaw = typeof resolved.unmapped_year === "string" ? resolved.unmapped_year : "";
  const unmappedMatchType = typeof resolved.unmapped_match_type === "string" ? resolved.unmapped_match_type : "";
  const unmappedLineDescription =
    typeof resolved.unmapped_line_description === "string" ? resolved.unmapped_line_description : "";

  const initialUnmappedYear = unmappedYearRaw ? Number(unmappedYearRaw) : undefined;
  const initialUnmappedBasis = unmappedBasis === "order" ? "order" : "invoice";
  const initialUnmappedMatchType =
    unmappedMatchType === "douano_product_id" || unmappedMatchType === "product0_description"
      ? (unmappedMatchType as any)
      : undefined;
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/productkoppeling");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Productkoppeling"
      subtitle="Koppel Douano producten aan actieve kostprijscombinaties (bier + verpakking)."
      activePath="/beheer"
      navigation={navigation}
    >
      <ProductkoppelingWorkspace
        initialFilter={douanoProductId ? String(douanoProductId) : q}
        initialSkuId={skuId}
        initialTab={tab === "unmapped" ? "unmapped" : "mappings"}
        initialUnmappedBasis={initialUnmappedBasis}
        initialUnmappedYear={Number.isFinite(initialUnmappedYear as any) ? (initialUnmappedYear as any) : undefined}
        initialUnmappedMatchType={initialUnmappedMatchType}
        initialUnmappedLineDescription={unmappedLineDescription}
      />
    </PageShell>
  );
}
