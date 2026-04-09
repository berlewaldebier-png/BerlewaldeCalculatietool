import { apiGetServer } from "@/lib/apiServer";
import { KostprijsActivatieClient } from "@/components/KostprijsActivatieClient";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function KostprijsActivatiePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const sourceYear = Number(
    Array.isArray(searchParams.source_year) ? searchParams.source_year[0] : searchParams.source_year ?? 0
  );
  const targetYear = Number(
    Array.isArray(searchParams.target_year) ? searchParams.target_year[0] : searchParams.target_year ?? 0
  );
  const plan =
    sourceYear > 0 && targetYear > 0
      ? await apiGetServer<any>(`/meta/kostprijs-activatie-plan?source_year=${sourceYear}&target_year=${targetYear}`, `/kostprijs-activatie?source_year=${sourceYear}&target_year=${targetYear}`)
      : { source_year: sourceYear, target_year: targetYear, rows: [] };

  return <KostprijsActivatieClient initialPlan={plan} />;
}

