import { DataQualityIntegrationWorkspace } from "@/components/beheer/DataQualityIntegrationWorkspace";
import { PageShell } from "@/components/PageShell";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DatakwaliteitPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolved = searchParams ? await searchParams : {};
  const yearRaw = typeof resolved.year === "string" ? resolved.year : "";
  const bootstrap = await getBootstrap(["auth-status", "skus", "articles", "productie"], true, "/beheer/api");
  const navigation = bootstrap.navigation ?? [];
  const skus = (bootstrap.datasets["skus"] as any[]) ?? [];
  const articles = (bootstrap.datasets["articles"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const currentYear = new Date().getFullYear();
  const productionYears = Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
  const defaultYear = productionYears.includes(currentYear)
    ? currentYear
    : productionYears.filter((year) => year < currentYear).at(-1) ?? productionYears.at(-1) ?? currentYear;
  const statusYear = Number(yearRaw) || defaultYear;

  const setupStatusPayload = await apiGetServer<{ result: any }>(
    `/meta/setup/status?year=${encodeURIComponent(String(statusYear))}`,
    "/beheer/api"
  );

  return (
    <PageShell
      title="Datakwaliteit"
      subtitle="Werkvoorraad voor productkoppelingen, LOT-dekking, kostprijsbronnen en uitzonderingen."
      activePath="/beheer"
      navigation={navigation}
    >
      <DataQualityIntegrationWorkspace
        initialStatus={setupStatusPayload.result}
        skus={skus}
        articles={articles}
      />
    </PageShell>
  );
}
