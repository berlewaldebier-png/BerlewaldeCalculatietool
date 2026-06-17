import { JaarAfsluitenWizard } from "@/components/jaar-afsluiten/JaarAfsluitenWizard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function JaarAfsluitenPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/jaar-afsluiten");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Jaar afsluiten"
      subtitle="Controleer realisatie, maak een jaarafsluiting en bereid het volgende jaar voor."
      activePath="/jaar-afsluiten"
      navigation={navigation}
    >
      <JaarAfsluitenWizard />
    </PageShell>
  );
}
