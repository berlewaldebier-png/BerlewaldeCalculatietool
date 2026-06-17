import { PageShell } from "@/components/PageShell";
import { SetupWorkspace } from "@/components/setup/SetupWorkspace";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SetupPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const yearParam = typeof resolvedSearchParams.year === "string" ? Number(resolvedSearchParams.year) : 2025;
  const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : 2025;
  const [bootstrap, statusPayload] = await Promise.all([
    getBootstrap(["auth-status"], true, "/setup"),
    apiGetServer<{ result: any }>(`/meta/setup/status?year=${encodeURIComponent(String(year))}`, "/setup"),
  ]);

  return (
    <PageShell
      title="Setup"
      subtitle="Richt de applicatie opnieuw op vanuit Douano, kostprijzen en LOT-dekking."
      activePath="/setup"
      navigation={bootstrap.navigation ?? []}
    >
      <SetupWorkspace initialStatus={statusPayload.result} />
    </PageShell>
  );
}
