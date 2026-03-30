import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { NestedCollectionEditor } from "@/components/NestedCollectionEditor";
import { PageShell } from "@/components/PageShell";
import {
  getBasisproducten,
  getNavigation,
  getSamengesteldeProducten,
  getVerpakkingsonderdelen
} from "@/lib/api";

export default async function ProductenVerpakkingPage() {
  const [navigation, verpakkingsonderdelen, basisproducten, samengestelde] =
    await Promise.all([
      getNavigation(),
      getVerpakkingsonderdelen(),
      getBasisproducten(),
      getSamengesteldeProducten()
    ]);

  const verpakkingsopties = verpakkingsonderdelen.map((row) => {
    const key = String(row.component_key ?? row.id ?? "");
    const prijsPerStuk = Number(row.prijs_per_stuk ?? 0);
    return {
      value: key,
      label: `${String(row.omschrijving ?? "")} (${Number(row.jaar ?? 0)})`,
      payload: {
        omschrijving: String(row.omschrijving ?? ""),
        verpakkingsonderdeel_id: String(row.id ?? ""),
        verpakkingsonderdeel_key: key,
        prijs_per_stuk: prijsPerStuk,
        totale_kosten: prijsPerStuk
      }
    };
  });

  const basisproductOpties = [
    ...basisproducten.map((row) => {
      const id = String(row.id ?? "");
      const inhoud = Number(row.inhoud_per_eenheid_liter ?? 0);
      const verpakkingskosten = Number(row.totale_verpakkingskosten ?? 0);
      return {
        value: id,
        label: `${String(row.omschrijving ?? "")} (${Number(row.jaar ?? 0)})`,
        payload: {
          omschrijving: String(row.omschrijving ?? ""),
          basisproduct_id: id,
          inhoud_per_eenheid_liter: inhoud,
          verpakkingskosten_per_eenheid: verpakkingskosten,
          totale_inhoud_liter: inhoud,
          totale_verpakkingskosten: verpakkingskosten
        }
      };
    }),
    ...verpakkingsonderdelen
      .filter((row) => Boolean(row.beschikbaar_voor_samengesteld))
      .map((row) => {
        const componentId = String(row.id ?? "");
        const componentKey = `verpakkingsonderdeel:${componentId}`;
        const prijsPerStuk = Number(row.prijs_per_stuk ?? 0);
        return {
          value: componentKey,
          label: `${String(row.omschrijving ?? "")} (${Number(row.jaar ?? 0)})`,
          payload: {
            omschrijving: String(row.omschrijving ?? ""),
            basisproduct_id: componentKey,
            inhoud_per_eenheid_liter: 0,
            verpakkingskosten_per_eenheid: prijsPerStuk,
            totale_inhoud_liter: 0,
            totale_verpakkingskosten: prijsPerStuk
          }
        };
      })
  ];

  const verpakkingRows = verpakkingsonderdelen.map((row) => ({
    id: String(row.id ?? ""),
    component_key: String(row.component_key ?? ""),
    jaar: Number(row.jaar ?? 0),
    omschrijving: String(row.omschrijving ?? ""),
    hoeveelheid: Number(row.hoeveelheid ?? 0),
    prijs_per_stuk: Number(row.prijs_per_stuk ?? 0),
    beschikbaar_voor_samengesteld: Boolean(row.beschikbaar_voor_samengesteld)
  }));

  return (
    <PageShell
      title="Producten & verpakking"
      subtitle="Bewerk alle product- en verpakkingstabellen direct in de nieuwe web-UI."
      activePath="/producten-verpakking"
      navigation={navigation}
    >
      <DatasetTableEditor
        endpoint="/data/verpakkingsonderdelen"
        initialRows={verpakkingRows}
        addRowTemplate={{
          id: "",
          component_key: "",
          jaar: new Date().getFullYear(),
          omschrijving: "",
          hoeveelheid: 1,
          prijs_per_stuk: 0,
          beschikbaar_voor_samengesteld: false
        }}
        columns={[
          { key: "id", label: "ID", width: "150px" },
          { key: "jaar", label: "Jaar", type: "number", width: "110px" },
          { key: "omschrijving", label: "Omschrijving", width: "280px" },
          { key: "hoeveelheid", label: "Hoeveelheid", type: "number", width: "140px" },
          { key: "prijs_per_stuk", label: "Prijs per stuk", type: "number", width: "150px" },
          {
            key: "beschikbaar_voor_samengesteld",
            label: "Beschikbaar voor samengesteld",
            type: "checkbox",
            width: "220px"
          }
        ]}
        title="Verpakkingsonderdelen"
        description="Deze tabel is nu direct bewerkbaar in de nieuwe UI."
      />
      <NestedCollectionEditor
        endpoint="/data/basisproducten"
        initialRows={basisproducten}
        addRowTemplate={{
          id: "",
          jaar: new Date().getFullYear(),
          omschrijving: "",
          inhoud_per_eenheid_liter: 0,
          onderdelen: [],
          totale_verpakkingskosten: 0
        }}
        fields={[
          { key: "id", label: "ID" },
          { key: "jaar", label: "Jaar", type: "number" },
          { key: "omschrijving", label: "Omschrijving" },
          {
            key: "inhoud_per_eenheid_liter",
            label: "Inhoud per eenheid (liter)",
            type: "number"
          },
          {
            key: "totale_verpakkingskosten",
            label: "Totale verpakkingskosten",
            type: "number"
          }
        ]}
        nestedKey="onderdelen"
        nestedLabel="Onderdelen"
        nestedRowTemplate={{
          hoeveelheid: 1,
          omschrijving: "",
          totale_kosten: 0,
          prijs_per_stuk: 0,
          verpakkingsonderdeel_id: "",
          verpakkingsonderdeel_key: ""
        }}
        nestedFields={[
          {
            key: "verpakkingsonderdeel_key",
            label: "Verpakkingsonderdeel",
            type: "select",
            options: verpakkingsopties
          },
          { key: "omschrijving", label: "Omschrijving" },
          { key: "hoeveelheid", label: "Hoeveelheid", type: "number" },
          { key: "prijs_per_stuk", label: "Prijs per stuk", type: "number" },
          { key: "totale_kosten", label: "Totale kosten", type: "number", readOnly: true }
        ]}
        nestedComputedFields={[
          {
            targetKey: "totale_kosten",
            leftKey: "hoeveelheid",
            rightKey: "prijs_per_stuk"
          }
        ]}
        parentAggregates={[
          {
            targetKey: "totale_verpakkingskosten",
            sourceKey: "totale_kosten"
          }
        ]}
        title="Basisproducten"
        description="De hoofdvelden en gekoppelde onderdelen zijn nu direct bewerkbaar als regels in de kaart."
      />
      <NestedCollectionEditor
        endpoint="/data/samengestelde-producten"
        initialRows={samengestelde}
        addRowTemplate={{
          id: "",
          jaar: new Date().getFullYear(),
          omschrijving: "",
          basisproducten: [],
          totale_inhoud_liter: 0,
          totale_verpakkingskosten: 0
        }}
        fields={[
          { key: "id", label: "ID" },
          { key: "jaar", label: "Jaar", type: "number" },
          { key: "omschrijving", label: "Omschrijving" },
          { key: "totale_inhoud_liter", label: "Totale inhoud (liter)", type: "number" },
          {
            key: "totale_verpakkingskosten",
            label: "Totale verpakkingskosten",
            type: "number"
          }
        ]}
        nestedKey="basisproducten"
        nestedLabel="Basisproducten"
        nestedRowTemplate={{
          aantal: 1,
          omschrijving: "",
          basisproduct_id: "",
          totale_inhoud_liter: 0,
          inhoud_per_eenheid_liter: 0,
          totale_verpakkingskosten: 0,
          verpakkingskosten_per_eenheid: 0
        }}
        nestedFields={[
          {
            key: "basisproduct_id",
            label: "Basisproduct / onderdeel",
            type: "select",
            options: basisproductOpties
          },
          { key: "omschrijving", label: "Omschrijving" },
          { key: "aantal", label: "Aantal", type: "number" },
          {
            key: "inhoud_per_eenheid_liter",
            label: "Inhoud per eenheid (liter)",
            type: "number"
          },
          {
            key: "verpakkingskosten_per_eenheid",
            label: "Verpakkingskosten per eenheid",
            type: "number"
          },
          {
            key: "totale_inhoud_liter",
            label: "Totale inhoud (liter)",
            type: "number",
            readOnly: true
          },
          {
            key: "totale_verpakkingskosten",
            label: "Totale verpakkingskosten",
            type: "number",
            readOnly: true
          }
        ]}
        nestedComputedFields={[
          {
            targetKey: "totale_inhoud_liter",
            leftKey: "aantal",
            rightKey: "inhoud_per_eenheid_liter"
          },
          {
            targetKey: "totale_verpakkingskosten",
            leftKey: "aantal",
            rightKey: "verpakkingskosten_per_eenheid"
          }
        ]}
        parentAggregates={[
          {
            targetKey: "totale_inhoud_liter",
            sourceKey: "totale_inhoud_liter"
          },
          {
            targetKey: "totale_verpakkingskosten",
            sourceKey: "totale_verpakkingskosten"
          }
        ]}
        title="Samengestelde producten"
        description="Ook hier is de samenstelling nu direct als regels te beheren, zonder JSON-blokken in de UI."
      />
    </PageShell>
  );
}
