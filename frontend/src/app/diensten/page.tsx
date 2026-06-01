import { PageShell } from "@/components/PageShell";
import { DienstenWorkspace } from "@/components/DienstenWorkspace";
import { getBootstrap } from "@/lib/apiServer";

export default async function DienstenPage() {
  const bootstrap = await getBootstrap(["skus", "articles"], true, "/diensten");
  const navigation = bootstrap.navigation ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];

  return (
    <PageShell
      title="Diensten"
      subtitle="Read-only overzicht van service-SKU’s. Aanmaken gebeurt voorlopig via Beheer → Productkoppeling."
      activePath="/diensten"
      navigation={navigation}
    >
      <DienstenWorkspace skus={skus} articles={articles} />
    </PageShell>
  );
}

