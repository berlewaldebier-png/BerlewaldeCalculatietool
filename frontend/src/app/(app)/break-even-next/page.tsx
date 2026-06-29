import { BreakEvenNextMockup } from "@/components/break-even-next/BreakEvenNextMockup";
import { PageShell } from "@/components/PageShell";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type BreakEvenNextPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BreakEvenNextPage({ searchParams }: BreakEvenNextPageProps) {
  const bootstrap = await getBootstrap(["auth-status"], true, "/break-even-next");
  const params = await searchParams;
  const rawYear = Array.isArray(params?.year) ? params?.year[0] : params?.year;
  const year = Number.parseInt(String(rawYear || "2025"), 10) || 2025;
  let readModel: Record<string, unknown> | null = null;
  let readModelError = "";

  try {
    const response = await apiGetServer<{ item?: Record<string, unknown> }>(
      `/integrations/break-even/analysis-read-model?year=${encodeURIComponent(String(year))}&basis=invoice`,
      "/break-even-next"
    );
    readModel = response.item ?? null;
  } catch (err) {
    readModelError = err instanceof Error ? err.message : String(err);
  }

  return (
    <PageShell
      title="Break-even next"
      subtitle={`Tijdelijke mock-up voor plan, actuals, reforecast, variantie en jaarafsluiting. Jaar ${year}.`}
      activePath="/break-even"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenNextMockup selectedYear={year} readModel={readModel} readModelError={readModelError} />
    </PageShell>
  );
}
