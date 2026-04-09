import { KostprijsActivatieClient } from "@/components/KostprijsActivatieClient";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function KostprijsActivatiePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const sourceYear = Number(
    Array.isArray(searchParams.source_year) ? searchParams.source_year[0] : searchParams.source_year ?? 0
  );
  const targetYear = Number(
    Array.isArray(searchParams.target_year) ? searchParams.target_year[0] : searchParams.target_year ?? 0
  );

  const nextPath = `/kostprijs-activatie?source_year=${sourceYear}&target_year=${targetYear}`;

  // Avoid throwing opaque RSC errors: fetch explicitly and redirect on 401.
  // We call Next's own API proxy (same process) so cookies/CSRF semantics stay consistent.
  const explicitOrigin = (process.env.CALCULATIETOOL_SERVER_ORIGIN ?? "").trim();
  const port = (process.env.PORT ?? "").trim() || "3000";
  const origin = explicitOrigin || `http://127.0.0.1:${port}`;
  await headers(); // keep request-scoped

  const cookieHeader = (await cookies()).toString();
  let plan: any = { source_year: sourceYear, target_year: targetYear, rows: [] };
  if (sourceYear > 0 && targetYear > 0) {
    const response = await fetch(
      `${origin}/api/meta/kostprijs-activatie-plan?source_year=${encodeURIComponent(String(sourceYear))}&target_year=${encodeURIComponent(
        String(targetYear)
      )}`,
      { cache: "no-store", headers: cookieHeader ? { cookie: cookieHeader } : undefined }
    );
    if (response.status === 401) {
      redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `API request failed (${response.status})`);
    }
    plan = await response.json();
  }

  return <KostprijsActivatieClient initialPlan={plan} />;
}
