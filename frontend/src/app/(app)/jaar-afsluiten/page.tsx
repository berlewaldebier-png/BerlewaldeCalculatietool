import { JaarAfsluitenWizard } from "@/components/jaar-afsluiten/JaarAfsluitenWizard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function JaarAfsluitenPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = (await props.searchParams) ?? {};
  const yearParam = Array.isArray(searchParams.year) ? searchParams.year[0] : searchParams.year;
  const bootstrap = await getBootstrap(["auth-status"], true, "/jaar-afsluiten");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Jaar afsluiten"
      subtitle="Controleer realisatie, maak een jaarafsluiting en bereid het volgende jaar voor."
      activePath="/jaar-afsluiten"
      navigation={navigation}
    >
      <JaarAfsluitenWizard initialYear={yearParam ?? ""} />
    </PageShell>
  );
}
