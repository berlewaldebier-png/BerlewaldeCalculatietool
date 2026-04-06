import { NieuwJaarWizard } from "@/components/NieuwJaarWizard";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function NieuwJaarVoorbereidenPage() {
  const bootstrap = await getBootstrap(
    [
      "berekeningen",
      "kostprijsproductactiveringen",
      "basisproducten",
      "samengestelde-producten",
      "bieren",
      "productie",
      "vaste-kosten",
      "tarieven-heffingen",
      "verpakkingsonderdelen",
      "verkoopprijzen"
    ],
    true,
    "/nieuw-jaar-voorbereiden"
  );
  const navigation = bootstrap.navigation ?? [];
  const berekeningen = (bootstrap.datasets["berekeningen"] as any[]) ?? [];
  const kostprijsproductactiveringen = (bootstrap.datasets["kostprijsproductactiveringen"] as any[]) ?? [];
  const basisproducten = (bootstrap.datasets["basisproducten"] as any[]) ?? [];
  const samengesteldeProducten = (bootstrap.datasets["samengestelde-producten"] as any[]) ?? [];
  const bieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const vasteKosten = (bootstrap.datasets["vaste-kosten"] as Record<string, any>) ?? {};
  const tarieven = (bootstrap.datasets["tarieven-heffingen"] as any[]) ?? [];
  const verpakkingsonderdelen = (bootstrap.datasets["verpakkingsonderdelen"] as any[]) ?? [];
  const verkoopprijzen = (bootstrap.datasets["verkoopprijzen"] as any[]) ?? [];

  return (
    <PageShell
      title="Nieuw jaar voorbereiden"
      subtitle="Maak een nieuwe jaarset aan op basis van een bestaand bronjaar."
      activePath="/nieuw-jaar-voorbereiden"
      navigation={navigation}
    >
      <NieuwJaarWizard
        initialBerekeningen={berekeningen}
        initialKostprijsproductactiveringen={kostprijsproductactiveringen}
        initialBasisproducten={basisproducten}
        initialSamengesteldeProducten={samengesteldeProducten}
        initialBieren={bieren}
        initialProductie={productie}
        initialVasteKosten={vasteKosten}
        initialTarieven={tarieven}
        initialVerpakkingsonderdelen={verpakkingsonderdelen}
        initialVerkoopprijzen={verkoopprijzen}
      />
    </PageShell>
  );
}
