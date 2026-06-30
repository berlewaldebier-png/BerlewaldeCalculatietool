import { IncidenteleKostenClient } from "@/components/IncidenteleKostenClient";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function IncidenteleKostenPage() {
  const bootstrap = await getBootstrap(["incidentele-kosten", "vaste-kosten", "productie"], true, "/incidentele-kosten");
  const navigation = bootstrap.navigation ?? [];
  const rows = (bootstrap.datasets["incidentele-kosten"] as any[]) ?? [];
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any[]>) ?? {};
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};

  return (
    <PageShell
      title="Incidentele kosten"
      subtitle="Leg eenmalige kosten en afboekingen vast zonder de normale ABC-kostprijs te vervuilen."
      activePath="/incidentele-kosten"
      navigation={navigation}
    >
      <IncidenteleKostenClient rows={rows} vasteKosten={vasteKosten} productie={productie} />
    </PageShell>
  );
}
