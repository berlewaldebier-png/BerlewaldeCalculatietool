import { notFound } from "next/navigation";

import { PageShell } from "@/components/PageShell";
import { YearsetDossier } from "@/components/YearsetDossier";
import { getBootstrap } from "@/lib/apiServer";


export default async function YearsetDossierPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const resolved = await params;
  const year = Number(resolved.year || 0);
  if (!Number.isInteger(year) || year <= 0) notFound();

  const returnPath = `/beheer/jaarsets/${encodeURIComponent(String(year))}`;
  const bootstrap = await getBootstrap(["auth-status"], true, returnPath);
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title={`Jaarset ${year}`}
      subtitle="Alleen-lezen dossier van het vastgelegde Plan, de SKU-kostprijzen en het prijsbeleid."
      activePath="/beheer"
      navigation={navigation}
    >
      <YearsetDossier year={year} />
    </PageShell>
  );
}
