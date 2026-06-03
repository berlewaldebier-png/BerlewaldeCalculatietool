import { PageShell } from "@/components/PageShell";
import { ProductClassificatieWorkspace } from "@/components/beheer/ProductClassificatieWorkspace";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductclassificatiePage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/productclassificatie");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Productclassificatie"
      subtitle="Beheer productgroepen, alcoholcategorieën en verpakkingstypen (dropdowns) voor SKU's."
      activePath="/beheer"
      navigation={navigation}
    >
      <ProductClassificatieWorkspace />
    </PageShell>
  );
}

