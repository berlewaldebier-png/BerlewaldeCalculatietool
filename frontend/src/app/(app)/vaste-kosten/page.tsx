import { PageShell } from "@/components/PageShell";
import { VasteKostenClient } from "@/components/VasteKostenClient";
import { getBootstrap } from "@/lib/apiServer";

export default async function VasteKostenPage() {
  const bootstrap = await getBootstrap(["vaste-kosten", "productie", "cost-pools"], true, "/vaste-kosten");
  const navigation = bootstrap.navigation ?? [];
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const pools = (bootstrap.datasets["cost-pools"] as any[]) ?? [];

  return (
    <PageShell
      title="Vaste kosten"
      subtitle="Beheer vaste kosten per jaar in een echte tabelweergave. Opslag blijft tijdelijk JSON."
      activePath="/vaste-kosten"
      navigation={navigation}
    >
      <VasteKostenClient vasteKosten={vasteKosten} productie={productie} pools={pools} />
    </PageShell>
  );
}
