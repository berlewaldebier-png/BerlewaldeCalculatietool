import { PageShell } from "@/components/PageShell";
import { ReceptHercalculatieManager } from "@/components/ReceptHercalculatieManager";
import { getBootstrap } from "@/lib/apiServer";

export default async function ReceptHercalculatiePage() {
  const bootstrap = await getBootstrap(
    ["berekeningen", "basisproducten", "samengestelde-producten", "kostprijsproductactiveringen"],
    true,
    "/recept-hercalculatie"
  );
  const navigation = bootstrap.navigation ?? [];
  const berekeningen = (bootstrap.datasets["berekeningen"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];

  return (
    <PageShell
      title="Recept hercalculeren"
      subtitle="Start nieuwe concept-hercalculaties op basis van definitieve eigen-productieberekeningen."
      activePath="/recept-hercalculatie"
      navigation={navigation}
    >
      <ReceptHercalculatieManager
        initialRows={berekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
      />
    </PageShell>
  );
}
