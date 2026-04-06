import { PageShell } from "@/components/PageShell";
import { PrijsvoorstelWorkspace } from "@/components/PrijsvoorstelWorkspace";
import { getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PrijsvoorstelPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const bootstrap = await getBootstrap(
    [
      "prijsvoorstellen",
      "productie",
      "bieren",
      "kostprijsversies",
      "verkoopprijzen",
      "channels",
      "kostprijsproductactiveringen",
      "basisproducten",
      "samengestelde-producten"
    ],
    true,
    "/prijsvoorstel"
  );
  const navigation = bootstrap.navigation ?? [];
  const voorstellen = (bootstrap.datasets["prijsvoorstellen"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const berekeningen = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];
  const channels = (bootstrap.datasets["channels"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];

  const mode = typeof resolvedSearchParams.mode === "string" ? resolvedSearchParams.mode : "";
  const filter = typeof resolvedSearchParams.filter === "string" ? resolvedSearchParams.filter : "";
  const focus = typeof resolvedSearchParams.focus === "string" ? resolvedSearchParams.focus : "";

  const yearOptions = Object.keys(productie)
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => right - left);

  return (
    <PageShell
      title="Prijsvoorstel beheren"
      subtitle="Start een nieuw prijsvoorstel of open een bestaand voorstel in de nieuwe wizardflow."
      activePath="/prijsvoorstel"
      navigation={navigation}
    >
      <PrijsvoorstelWorkspace
        voorstellen={voorstellen}
        yearOptions={yearOptions}
        bieren={bieren}
        berekeningen={berekeningen}
        verkoopprijzen={verkoopprijzen}
        channels={channels}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        initialMode={mode}
        initialFilter={filter}
        initialFocus={focus}
      />
    </PageShell>
  );
}
