import { NieuwJaarWizard } from "@/components/NieuwJaarWizard";
import { PageShell } from "@/components/PageShell";
import {
  getBerekeningen,
  getNavigation,
  getProductie,
  getTarievenHeffingen,
  getVasteKosten,
  getVerkoopprijzen,
  getVerpakkingsonderdelen
} from "@/lib/api";

export default async function NieuwJaarVoorbereidenPage() {
  const [
    navigation,
    berekeningen,
    productie,
    vasteKosten,
    tarieven,
    verpakkingsonderdelen,
    verkoopprijzen
  ] = await Promise.all([
    getNavigation(),
    getBerekeningen(),
    getProductie(),
    getVasteKosten(),
    getTarievenHeffingen(),
    getVerpakkingsonderdelen(),
    getVerkoopprijzen()
  ]);

  return (
    <PageShell
      title="Nieuw jaar voorbereiden"
      subtitle="Maak een nieuwe jaarset aan op basis van een bestaand bronjaar."
      activePath="/nieuw-jaar-voorbereiden"
      navigation={navigation}
    >
      <NieuwJaarWizard
        initialBerekeningen={berekeningen}
        initialProductie={productie}
        initialVasteKosten={vasteKosten}
        initialTarieven={tarieven}
        initialVerpakkingsonderdelen={verpakkingsonderdelen}
        initialVerkoopprijzen={verkoopprijzen}
      />
    </PageShell>
  );
}
