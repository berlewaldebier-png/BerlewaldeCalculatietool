import { PageShell } from "@/components/PageShell";
import { ReceptHercalculatieManager } from "@/components/ReceptHercalculatieManager";
import { getBerekeningen, getNavigation } from "@/lib/api";

export default async function ReceptHercalculatiePage() {
  const [navigation, berekeningen] = await Promise.all([getNavigation(), getBerekeningen()]);

  return (
    <PageShell
      title="Recept hercalculeren"
      subtitle="Start nieuwe concept-hercalculaties op basis van definitieve eigen-productieberekeningen."
      activePath="/recept-hercalculatie"
      navigation={navigation}
    >
      <ReceptHercalculatieManager initialRows={berekeningen} />
    </PageShell>
  );
}
