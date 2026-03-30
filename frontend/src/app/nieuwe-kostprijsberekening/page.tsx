import { KostprijsBeheerWorkspace } from "@/components/KostprijsBeheerWorkspace";
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
      title="Kostprijs beheren"
      subtitle="Start een nieuwe berekening of open een bestaand dossier en werk het verder uit in de wizard."
      activePath="/nieuwe-kostprijsberekening"
      navigation={navigation}
    >
      <KostprijsBeheerWorkspace
        berekeningen={berekeningen}
        basisproducten={basisproducten}
        samengesteldeProducten={samengesteldeProducten}
        productie={productie}
        vasteKosten={vasteKosten}
        tarievenHeffingen={tarievenHeffingen}
      />
    </PageShell>
  );
}
