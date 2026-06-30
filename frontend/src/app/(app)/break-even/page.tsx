import { BreakEvenNextMockup } from "@/components/break-even-next/BreakEvenNextMockup";
import { PageShell } from "@/components/PageShell";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type BreakEvenPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function deriveYearOptions(productie: Record<string, unknown>) {
  return Object.keys(productie ?? {})
    .map((key) => Number(key))
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => a - b);
}

function chooseDefaultYear(yearOptions: number[]) {
  const currentYear = new Date().getFullYear();
  if (yearOptions.includes(currentYear)) return currentYear;
  return yearOptions[yearOptions.length - 1] ?? currentYear;
}

export default async function BreakEvenPage({ searchParams }: BreakEvenPageProps) {
  const bootstrap = await getBootstrap(["auth-status", "productie"], true, "/break-even");
  const params = await searchParams;
  const productie = (bootstrap.datasets["productie"] as Record<string, unknown>) ?? {};
  const yearOptions = deriveYearOptions(productie);
  const rawYear = Array.isArray(params?.year) ? params?.year[0] : params?.year;
  const requestedYear = Number.parseInt(String(rawYear || ""), 10);
  const defaultYear = chooseDefaultYear(yearOptions);
  const year = yearOptions.length > 0
    ? yearOptions.includes(requestedYear) ? requestedYear : defaultYear
    : requestedYear || defaultYear;
  let readModel: Record<string, unknown> | null = null;
  let readModelError = "";

  try {
    const response = await apiGetServer<{ item?: Record<string, unknown> }>(
      `/integrations/break-even/analysis-read-model?year=${encodeURIComponent(String(year))}&basis=invoice`,
      "/break-even"
    );
    readModel = response.item ?? null;
  } catch (err) {
    readModelError = err instanceof Error ? err.message : String(err);
  }

  return (
    <PageShell
      title="Break-even analyse"
      subtitle={`Stuurinformatie voor plan, actuals, reforecast, variantie en jaarafsluiting. Jaar ${year}.`}
      activePath="/break-even"
      navigation={bootstrap.navigation ?? []}
    >
      <BreakEvenNextMockup selectedYear={year} availableYears={yearOptions} readModel={readModel} readModelError={readModelError} />
    </PageShell>
  );
}
