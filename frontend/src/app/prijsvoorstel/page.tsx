import { PrijsvoorstelEditor } from "@/components/PrijsvoorstelEditor";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getBieren,
  getNavigation,
  getPrijsvoorstellen,
  getSamengesteldeProducten
} from "@/lib/api";

export default async function PrijsvoorstelPage() {
  const [navigation, voorstellen, bieren, basisproducten, samengesteldeProducten] = await Promise.all([
    getNavigation(),
    getPrijsvoorstellen(),
    getBieren(),
    getBasisproducten(),
    getSamengesteldeProducten()
  ]);

  const beerOptions = bieren.map((bier) => ({
    value: String(bier.id ?? ""),
    label: `${String(bier.biernaam ?? "")} (${Number(bier.alcoholpercentage ?? 0)}%)`
  }));

  const productOptions = [
    ...basisproducten.map((row) => ({
      value: `basis|${String(row.omschrijving ?? "").toLowerCase()}`,
      label: `Basis: ${String(row.omschrijving ?? "")}`
    })),
    ...samengesteldeProducten.map((row) => ({
      value: `samengesteld|${String(row.omschrijving ?? "").toLowerCase()}`,
      label: `Samengesteld: ${String(row.omschrijving ?? "")}`
    }))
  ];

  const rows = voorstellen.map((row) => ({
    id: String(row.id ?? ""),
    offertenummer: String(row.offertenummer ?? ""),
    status: String(row.status ?? ""),
    klantnaam: String(row.klantnaam ?? ""),
    contactpersoon: String(row.contactpersoon ?? ""),
    referentie: String(row.referentie ?? ""),
    datum_text: String(row.datum_text ?? ""),
    opmerking: String(row.opmerking ?? ""),
    jaar: Number(row.jaar ?? 0),
    voorsteltype: String(row.voorsteltype ?? ""),
    liters_basis: String(row.liters_basis ?? ""),
    kanaal: String(row.kanaal ?? ""),
    bier_key: String(row.bier_key ?? ""),
    product_bier_keys: Array.isArray(row.product_bier_keys) ? row.product_bier_keys : [],
    deleted_product_pairs: Array.isArray(row.deleted_product_pairs) ? row.deleted_product_pairs : [],
    staffels: Array.isArray(row.staffels) ? row.staffels : [],
    product_rows: Array.isArray(row.product_rows) ? row.product_rows : [],
    beer_rows: Array.isArray(row.beer_rows) ? row.beer_rows : [],
    last_step: Number(row.last_step ?? 1),
    finalized_at: String(row.finalized_at ?? "")
  }));

  return (
    <PageShell
      title="Prijsvoorstel maken"
      subtitle="Beheer prijsvoorstellen in de nieuwe kaarteditor. Staffels en voorstelregels zijn nu direct bewerkbaar zonder JSON-blokken."
      activePath="/prijsvoorstel"
      navigation={navigation}
    >
      <PrijsvoorstelEditor
        title="Prijsvoorstellen"
        description="De hoofdvelden, gekoppelde bieren, staffels en voorstelregels zijn nu direct bewerkbaar in de UI."
        endpoint="/data/prijsvoorstellen"
        initialRows={rows}
        beerOptions={beerOptions}
        productOptions={productOptions}
        addRowTemplate={{
          id: "",
          offertenummer: "",
          status: "concept",
          klantnaam: "",
          contactpersoon: "",
          referentie: "",
          datum_text: "",
          opmerking: "",
          jaar: new Date().getFullYear(),
          voorsteltype: "Op basis van producten",
          liters_basis: "een_bier",
          kanaal: "horeca",
          bier_key: "",
          product_bier_keys: [],
          deleted_product_pairs: [],
          staffels: [],
          product_rows: [],
          beer_rows: [],
          last_step: 1,
          finalized_at: ""
        }}
      />
    </PageShell>
  );
}
