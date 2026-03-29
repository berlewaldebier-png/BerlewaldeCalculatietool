import { BerekeningenWizard } from "@/components/BerekeningenWizard";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getBerekeningen,
  getNavigation,
  getProductie,
  getSamengesteldeProducten,
  getTarievenHeffingen,
  getVasteKosten
} from "@/lib/api";

export default async function NieuweKostprijsberekeningPage() {
  const [
    navigation,
    berekeningen,
    basisproducten,
    samengesteldeProducten,
    productie,
    vasteKosten,
    tarievenHeffingen
  ] = await Promise.all([
    getNavigation(),
    getBerekeningen(),
    getBasisproducten(),
    getSamengesteldeProducten(),
    getProductie(),
    getVasteKosten(),
    getTarievenHeffingen()
  ]);

  return (
    <PageShell
      title="Nieuwe kostprijsberekening"
      subtitle="Nieuwe wizard met verticale stappen, overzicht van berekeningen en directe bewerking van de kernvelden."
      activePath="/nieuwe-kostprijsberekening"
      navigation={navigation}
    >
      <BerekeningenWizard
        initialRows={berekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
      />
    </PageShell>
  );
}
