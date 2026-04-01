import { PageShell } from "@/components/PageShell";
import { PrijsvoorstelWorkspace } from "@/components/PrijsvoorstelWorkspace";
import {
  getBasisproducten,
  getBieren,
  getDataset,
  getKostprijsversies,
  getNavigation,
  getProductie,
  getPrijsvoorstellen,
  getSamengesteldeProducten,
  getVerkoopprijzen
} from "@/lib/api";

export default async function PrijsvoorstelPage() {
  const [
    navigation,
    voorstellen,
    productie,
    bieren,
    berekeningen,
    verkoopprijzen,
    channels,
    kostprijsproductactiveringen,
    basisproducten,
    samengesteldeProducten
  ] = await Promise.all([
    getNavigation(),
    getPrijsvoorstellen(),
    getProductie(),
    getBieren(),
    getKostprijsversies(),
    getVerkoopprijzen(),
    getDataset("channels"),
    getDataset("kostprijsproductactiveringen"),
    getBasisproducten(),
    getSamengesteldeProducten()
  ]);

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
      />
    </PageShell>
  );
}
