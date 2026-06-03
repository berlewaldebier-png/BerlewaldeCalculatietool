import { InkoopFacturenManager } from "@/components/InkoopFacturenManager";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function InkoopfacturenPage() {
  const bootstrap = await getBootstrap(
    ["kostprijsversies", "basisproducten", "samengestelde-producten"],
    true,
    "/inkoopfacturen"
  );
  const navigation = bootstrap.navigation ?? [];
  const kostprijsversies = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];

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
