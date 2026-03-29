import { InkoopFacturenManager } from "@/components/InkoopFacturenManager";
import { PageShell } from "@/components/PageShell";
import { getBerekeningen, getNavigation } from "@/lib/api";

export default async function InkoopfacturenPage() {
  const [navigation, berekeningen] = await Promise.all([getNavigation(), getBerekeningen()]);

  return (
    <PageShell
      title="Inkoopfacturen"
      subtitle="Beheer facturen per definitieve inkoopberekening in de nieuwe UI."
      activePath="/inkoopfacturen"
      navigation={navigation}
    >
      <InkoopFacturenManager initialRows={berekeningen} />
    </PageShell>
  );
}
