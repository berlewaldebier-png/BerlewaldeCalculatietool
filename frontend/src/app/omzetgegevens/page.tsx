import { OmzetgegevensWorkspace } from "@/components/OmzetgegevensWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function OmzetgegevensPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/omzetgegevens");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Omzetgegevens"
      subtitle="Omzet, kostprijs en brutomarge per klant op basis van Douano sales-orders."
      activePath="/omzetgegevens"
      navigation={navigation}
    >
      <OmzetgegevensWorkspace />
    </PageShell>
  );
}

