import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { PageShell } from "@/components/PageShell";
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
      hoeveelheid_inkoop_l: Number(values.hoeveelheid_inkoop_l ?? 0),
      hoeveelheid_productie_l: Number(values.hoeveelheid_productie_l ?? 0),
      batchgrootte_eigen_productie_l: Number(values.batchgrootte_eigen_productie_l ?? 0)
      };
    });

  return (
    <PageShell
      title="Productie"
      subtitle="Beheer productiegegevens per jaar in de nieuwe web-UI. Opslag blijft tijdelijk JSON."
      activePath="/productie"
      navigation={navigation}
    >
      <DatasetTableEditor
        endpoint="/data/productie"
        initialRows={rows}
        saveShape="recordByYear"
        addRowTemplate={{
          jaar: new Date().getFullYear(),
          hoeveelheid_inkoop_l: 0,
          hoeveelheid_productie_l: 0,
          batchgrootte_eigen_productie_l: 0
        }}
        columns={[
          { key: "jaar", label: "Jaar", type: "number", width: "110px" },
          { key: "hoeveelheid_inkoop_l", label: "Hoeveelheid inkoop in L", type: "number" },
          { key: "hoeveelheid_productie_l", label: "Hoeveelheid productie in L", type: "number" },
          {
            key: "batchgrootte_eigen_productie_l",
            label: "Batchgrootte eigen productie in L",
            type: "number"
          }
        ]}
        title="Productiedata"
        description="Deze gegevens worden per jaar opgeslagen en sluiten aan op de bestaande berekeningslogica."
      />
    </PageShell>
  );
}
