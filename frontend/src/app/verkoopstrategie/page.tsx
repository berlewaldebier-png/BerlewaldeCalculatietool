import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getBerekeningen,
  getBieren,
  getDataset,
  getNavigation,
  getSamengesteldeProducten,
  getVerkoopprijzen
} from "@/lib/api";

export default async function VerkoopstrategiePage() {
  const [navigation, verkoopprijzen, basisproducten, samengesteldeProducten, bieren, berekeningen, channels] =
    await Promise.all([
      getNavigation(),
      getVerkoopprijzen(),
      getBasisproducten(),
      getSamengesteldeProducten(),
      getBieren(),
      getBerekeningen(),
      getDataset("channels")
    ]);

  return (
    <PageShell
      title="Verkoopstrategie"
      subtitle="Beheer per jaar sell-in en sell-out per verpakking. Sell-in stuurt op onze marge en verkoopprijs; sell-out op de adviesverkoopprijs voor de markt."
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
        channels={channels}
      />
    </PageShell>
  );
}
