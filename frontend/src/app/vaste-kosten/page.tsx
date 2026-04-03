import { PageShell } from "@/components/PageShell";
import { VasteKostenClient } from "@/components/VasteKostenClient";
import { getBootstrap } from "@/lib/api";

export default async function VasteKostenPage() {
  const bootstrap = await getBootstrap(["vaste-kosten", "productie"], true);
  const navigation = bootstrap.navigation ?? [];
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};

  return (
    <PageShell
      title="Vaste kosten"
      subtitle="Beheer vaste kosten per jaar in een echte tabelweergave. Opslag blijft tijdelijk JSON."
      activePath="/vaste-kosten"
      navigation={navigation}
    >
      <VasteKostenClient vasteKosten={vasteKosten} productie={productie} />
    </PageShell>
  );
}
