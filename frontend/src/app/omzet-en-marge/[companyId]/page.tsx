import { PageShell } from "@/components/PageShell";
import { OmzetEnMargeKlantDetail } from "@/components/OmzetEnMargeKlantDetail";
import { getBootstrap } from "@/lib/apiServer";

export default async function OmzetEnMargeKlantPage({
  params,
  searchParams
}: {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await params;
  const companyId = Number(resolved.companyId || 0) || 0;
  const sp = searchParams ? await searchParams : {};
  const onlyUnmapped = sp.only_unmapped === "true" || sp.onlyUnmapped === "true";
  const onlyMissingCost = sp.only_missing_cost === "true" || sp.onlyMissingCost === "true";
  const bootstrap = await getBootstrap(["auth-status"], true, `/omzet-en-marge/${encodeURIComponent(String(resolved.companyId || ""))}`);
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title={`Omzet & marge — klant ${companyId || "-"}`}
      subtitle="Detailregels, unmapped producten en margeberekening op basis van Douano orders."
      activePath="/omzet-en-marge"
      navigation={navigation}
    >
      <OmzetEnMargeKlantDetail
        companyId={companyId}
        initialOnlyUnmapped={Boolean(onlyUnmapped)}
        initialOnlyMissingCost={Boolean(onlyMissingCost)}
      />
    </PageShell>
  );
}
