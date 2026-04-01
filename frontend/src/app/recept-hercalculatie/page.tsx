import { PageShell } from "@/components/PageShell";
import { ReceptHercalculatieManager } from "@/components/ReceptHercalculatieManager";
import {
  getBasisproducten,
  getBerekeningen,
  getDataset,
  getNavigation,
  getSamengesteldeProducten
} from "@/lib/api";

export default async function ReceptHercalculatiePage() {
  const [navigation, berekeningen, basisproducten, samengesteldeProducten, kostprijsproductactiveringen] =
    await Promise.all([
      getNavigation(),
      getBerekeningen(),
      getBasisproducten(),
      getSamengesteldeProducten(),
      getDataset("kostprijsproductactiveringen")
    ]);

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
