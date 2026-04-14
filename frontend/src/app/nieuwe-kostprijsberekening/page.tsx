import { KostprijsBeheerWorkspace } from "@/components/KostprijsBeheerWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NieuweKostprijsberekeningPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const bootstrap = await getBootstrap(
    [
      "kostprijsversies",
      "kostprijsproductactiveringen",
      "basisproducten",
      "samengestelde-producten",
      "bieren",
      "productie",
      "vaste-kosten",
      "tarieven-heffingen",
      "packaging-component-prices"
    ],
    true,
    "/nieuwe-kostprijsberekening"
  );
  const navigation = bootstrap.navigation ?? [];
  const berekeningen = (bootstrap.datasets["kostprijsversies"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const tarievenHeffingen = (bootstrap.datasets["tarieven-heffingen"] as any[]) ?? [];
  const packagingComponentPrices = (bootstrap.datasets["packaging-component-prices"] as any[]) ?? [];

  const mode = typeof resolvedSearchParams.mode === "string" ? resolvedSearchParams.mode : "";
  const filter = typeof resolvedSearchParams.filter === "string" ? resolvedSearchParams.filter : "";
  const focus = typeof resolvedSearchParams.focus === "string" ? resolvedSearchParams.focus : "";

  return (
    <PageShell
      title="Kostprijs beheren"
      subtitle="Start een nieuwe kostprijsversie of open een bestaand dossier en werk het verder uit in de wizard."
      activePath="/nieuwe-kostprijsberekening"
      navigation={navigation}
    >
      <KostprijsBeheerWorkspace
        berekeningen={berekeningen}
        kostprijsproductactiveringen={kostprijsproductactiveringen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        bieren={bieren}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
        packagingComponentPrices={packagingComponentPrices}
        initialMode={mode}
        initialFilter={filter}
        initialFocus={focus}
      />
    </PageShell>
  );
}
