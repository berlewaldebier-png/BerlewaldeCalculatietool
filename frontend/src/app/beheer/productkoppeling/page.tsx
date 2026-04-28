import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductkoppelingPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = searchParams ? await searchParams : {};
  const q = typeof resolved.q === "string" ? resolved.q : "";
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/productkoppeling");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Productkoppeling"
      subtitle="Koppel Douano producten aan actieve kostprijscombinaties (bier + verpakking)."
      activePath="/beheer"
      navigation={navigation}
    >
      <DouanoProductMappingCard initialFilter={q} />
    </PageShell>
  );
}
