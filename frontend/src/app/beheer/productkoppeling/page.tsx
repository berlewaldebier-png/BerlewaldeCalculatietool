import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductkoppelingPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/productkoppeling");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Productkoppeling"
      subtitle="Koppel Douano producten aan actieve kostprijscombinaties (bier + verpakking)."
      activePath="/beheer"
      navigation={navigation}
    >
      <DouanoProductMappingCard />
    </PageShell>
  );
}

