import { LotKostenWorkspace } from "@/components/lot-kosten/LotKostenWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function LotKostenPage() {
  const bootstrap = await getBootstrap(["auth-status", "skus"], true, "/beheer/lot-kosten");
  const navigation = bootstrap.navigation ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];

  return (
    <PageShell
      title="LOT kosten"
      subtitle="Importeer Voorraadhistoriek en beheer historische LOT kostprijzen."
      activePath="/beheer"
      navigation={navigation}
    >
      <LotKostenWorkspace skus={skus} />
    </PageShell>
  );
}
