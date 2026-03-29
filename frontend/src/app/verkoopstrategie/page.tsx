import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getBerekeningen,
  getBieren,
  getNavigation,
  getSamengesteldeProducten,
  getVerkoopprijzen
} from "@/lib/api";

export default async function VerkoopstrategiePage() {
  const [navigation, verkoopprijzen, basisproducten, samengesteldeProducten, bieren, berekeningen] =
    await Promise.all([
      getNavigation(),
      getVerkoopprijzen(),
      getBasisproducten(),
      getSamengesteldeProducten(),
      getBieren(),
      getBerekeningen()
    ]);

  return (
    <PageShell
      title="Verkoopstrategie"
      subtitle="Beheer verkoopstrategie per jaar. Verpakkingen komen automatisch uit Producten & verpakking, met daarnaast een jaaroverzicht van de bieren."
      activePath="/verkoopstrategie"
      navigation={navigation}
    >
      <VerkoopstrategieWorkspace
        endpoint="/data/verkoopprijzen"
        verkoopprijzen={verkoopprijzen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        bieren={bieren}
        berekeningen={berekeningen}
      />
    </PageShell>
  );
}
