import { VerkoopstrategieWorkspace } from "@/components/VerkoopstrategieWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function VerkoopstrategiePage() {
  const bootstrap = await getBootstrap(
    [
      "productie",
      "verkoopprijzen",
      "basisproducten",
      "samengestelde-producten",
      "bieren",
      "berekeningen",
      "channels",
      "kostprijsproductactiveringen"
    ],
    true,
    "/verkoopstrategie"
  );
  const navigation = bootstrap.navigation ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as any) ?? {};
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const berekeningen = (bootstrap.datasets["berekeningen"] as any[]) ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];

  return (
    <PageShell
      title="Verkoopstrategie"
      subtitle="Beheer per jaar de verkoopprijzen per verpakking. We sturen op opslag en verkoopprijs; marge wordt afgeleid."
      activePath="/verkoopstrategie"
      navigation={navigation}
    >
      <VerkoopstrategieWorkspace
        endpoint="/data/verkoopprijzen"
        verkoopprijzen={verkoopprijzen}
        productie={productie}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        bieren={bieren}
        berekeningen={berekeningen}
        channels={channels}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
      />
    </PageShell>
  );
}
