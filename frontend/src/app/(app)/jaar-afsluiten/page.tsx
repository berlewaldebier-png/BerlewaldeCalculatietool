import { JaarAfsluitenWizard } from "@/components/jaar-afsluiten/JaarAfsluitenWizard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function JaarAfsluitenPage() {
  const bootstrap = await getBootstrap(["auth-status", "vaste-kosten", "incidentele-kosten", "productie"], true, "/jaar-afsluiten");
  const navigation = bootstrap.navigation ?? [];
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any[]>) ?? {};
  const incidenteleKosten = (bootstrap.datasets["incidentele-kosten"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};

  return (
    <PageShell
      title="Jaar afsluiten"
      subtitle="Controleer realisatie, maak een jaarafsluiting en bereid het volgende jaar voor."
      activePath="/jaar-afsluiten"
      navigation={navigation}
    >
      <JaarAfsluitenWizard
        vasteKosten={vasteKosten}
        incidenteleKosten={incidenteleKosten}
        productie={productie}
      />
    </PageShell>
  );
}
