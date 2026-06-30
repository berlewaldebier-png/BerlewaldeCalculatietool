import { redirect } from "next/navigation";

type BreakEvenNextRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BreakEvenNextRedirectPage({ searchParams }: BreakEvenNextRedirectPageProps) {
  const params = await searchParams;
  const rawYear = Array.isArray(params?.year) ? params?.year[0] : params?.year;
  const year = String(rawYear || "").trim();
  redirect(year ? `/break-even?year=${encodeURIComponent(year)}` : "/break-even");
}
