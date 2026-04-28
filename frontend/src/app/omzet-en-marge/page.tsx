import { OmzetgegevensWorkspace } from "@/components/OmzetgegevensWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function OmzetEnMargePage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/omzet-en-marge");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Omzet & marge"
      subtitle="Omzet, kostprijs en brutomarge per klant op basis van Douano sales-orders."
      activePath="/omzet-en-marge"
      navigation={navigation}
    >
      <OmzetgegevensWorkspace />
    </PageShell>
  );
}

