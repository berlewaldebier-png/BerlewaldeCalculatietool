import { AdviesprijzenWorkspace } from "@/components/AdviesprijzenWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function AdviesprijzenPage() {
  const bootstrap = await getBootstrap(["channels", "adviesprijzen", "productie"], true, "/adviesprijzen");
  const navigation = bootstrap.navigation ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const adviesprijzen = (bootstrap.datasets["adviesprijzen"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};

  return (
    <PageShell
      title="Adviesprijzen"
      subtitle="Beheer de adviesopslag per kanaal (sell-out)."
      activePath="/adviesprijzen"
      navigation={navigation}
    >
      <AdviesprijzenWorkspace initialChannels={channels} initialAdviesprijzen={adviesprijzen} initialProductie={productie} />
    </PageShell>
  );
}

