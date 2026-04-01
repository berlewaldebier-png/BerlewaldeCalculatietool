import { InkoopFacturenManager } from "@/components/InkoopFacturenManager";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getKostprijsversies,
  getNavigation,
  getSamengesteldeProducten
} from "@/lib/api";

export default async function InkoopfacturenPage() {
  const [navigation, kostprijsversies, basisproducten, samengesteldeProducten] = await Promise.all([
    getNavigation(),
    getKostprijsversies(),
    getBasisproducten(),
    getSamengesteldeProducten()
  ]);

  return (
    <PageShell
      title="Inkoopfacturen"
      subtitle="Beheer facturen als bron voor nieuwe inkoop-kostprijsversies."
      activePath="/inkoopfacturen"
      navigation={navigation}
    >
      <InkoopFacturenManager
        initialRows={kostprijsversies}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
      />
    </PageShell>
  );
}
