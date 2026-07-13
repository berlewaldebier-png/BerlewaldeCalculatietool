import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { PageShell } from "@/components/PageShell";
import { ProductieDriverAutofill } from "@/components/productie/ProductieDriverAutofill";
import { getBootstrap } from "@/lib/apiServer";

export default async function ProductiePage() {
  const bootstrap = await getBootstrap(["productie"], true, "/productie");
  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] as Record<string, any>) ?? {};
  const rows = Object.entries(productie)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([jaar, rawValues]) => {
      const values = rawValues as Record<string, unknown>;
      return {
        jaar: Number(jaar),
        normal_inkoop_l: Number(values.normal_inkoop_l ?? values.hoeveelheid_inkoop_l ?? 0),
        normal_productie_l: Number(values.normal_productie_l ?? values.hoeveelheid_productie_l ?? 0),
        normal_contract_brew_l: Number(values.normal_contract_brew_l ?? 0),
        normal_shipments: Number(values.normal_shipments ?? 0),
        normal_orderlines: Number(values.normal_orderlines ?? 0),
        normal_sales_l: Number(values.normal_sales_l ?? values.sales_l ?? 0),
        sales_l: Number(values.sales_l ?? 0),
        hoeveelheid_inkoop_l: Number(values.hoeveelheid_inkoop_l ?? 0),
        hoeveelheid_productie_l: Number(values.hoeveelheid_productie_l ?? 0),
        realised_inkoop_l: Number(values.realised_inkoop_l ?? 0),
        realised_productie_l: Number(values.realised_productie_l ?? 0),
        realised_sales_l: Number(values.realised_sales_l ?? 0),
        batchgrootte_eigen_productie_l: Number(values.batchgrootte_eigen_productie_l ?? 0)
      };
    });
  const years = rows.map((row) => Number((row as any).jaar ?? 0)).filter((y) => Number.isFinite(y) && y > 0);

  return (
    <PageShell
      title="Productie"
      subtitle="Beheer driver-totalen per jaar. Normal capacity is de default basis voor overhead-verdeling."
      activePath="/productie"
      navigation={navigation}
    >
      <ProductieDriverAutofill availableYears={years} defaultYear={new Date().getFullYear() - 1} />
      <DatasetTableEditor
        endpoint="/data/productie"
        initialRows={rows}
        saveShape="recordByYear"
        addRowTemplate={{
          jaar: new Date().getFullYear(),
          normal_inkoop_l: 0,
          normal_productie_l: 0,
          normal_contract_brew_l: 0,
          normal_shipments: 0,
          normal_orderlines: 0,
          normal_sales_l: 0,
          sales_l: 0,
          hoeveelheid_inkoop_l: 0,
          hoeveelheid_productie_l: 0,
          realised_inkoop_l: 0,
          realised_productie_l: 0,
          realised_sales_l: 0,
          batchgrootte_eigen_productie_l: 0
        }}
        columns={[
          { key: "jaar", label: "Jaar", type: "number", width: "110px" },
          { key: "normal_inkoop_l", label: "Normale inkoop (L)", type: "number" },
          { key: "normal_productie_l", label: "Normale productie (L)", type: "number" },
          { key: "normal_contract_brew_l", label: "Normale contract brew (L)", type: "number" },
          { key: "normal_shipments", label: "Normale shipments (aantal)", type: "number" },
          { key: "normal_orderlines", label: "Normale orderregels (aantal)", type: "number" },
          { key: "normal_sales_l", label: "Normale verkoop (L)", type: "number" },
          { key: "sales_l", label: "Plan verkoop (L)", type: "number" },
          { key: "hoeveelheid_inkoop_l", label: "Plan inkoop in L", type: "number" },
          { key: "hoeveelheid_productie_l", label: "Plan productie in L", type: "number" },
          { key: "realised_inkoop_l", label: "Gerealiseerd inkoop (L)", type: "number", readOnly: true },
          { key: "realised_productie_l", label: "Gerealiseerd productie (L)", type: "number", readOnly: true },
          { key: "realised_sales_l", label: "Gerealiseerd verkoop (L)", type: "number", readOnly: true },
          {
            key: "batchgrootte_eigen_productie_l",
            label: "Batchgrootte eigen productie in L",
            type: "number"
          }
        ]}
        title="Productiedata"
        description="Planwaarden komen uit Nieuw jaar voorbereiden. Gerealiseerde liters worden na Jaar afsluiten read-only gevuld; ze overschrijven de planwaarden niet."
      />
    </PageShell>
  );
}
