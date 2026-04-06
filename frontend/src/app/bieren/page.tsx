import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function BierenPage() {
  const bootstrap = await getBootstrap(["bieren"], true, "/bieren");
  const navigation = bootstrap.navigation ?? [];
  const rawBieren = (bootstrap.datasets["bieren"] as any[]) ?? [];
  const rows = rawBieren.map((row) => ({
    id: String(row.id ?? ""),
    biernaam: String(row.biernaam ?? ""),
    stijl: String(row.stijl ?? ""),
    alcoholpercentage: Number(row.alcoholpercentage ?? 0),
    belastingsoort: String(row.belastingsoort ?? ""),
    tarief_accijns: String(row.tarief_accijns ?? ""),
    btw_tarief: String(row.btw_tarief ?? "")
  }));

  return (
    <PageShell
      title="Bieren"
      subtitle="Beheer hier de bierstamdata die gebruikt wordt in kostprijsberekeningen en prijsvoorstellen."
      activePath="/bieren"
      navigation={navigation}
    >
      <DatasetTableEditor
        endpoint="/data/bieren"
        initialRows={rows}
        addRowTemplate={{
          id: "",
          biernaam: "",
          stijl: "",
          alcoholpercentage: 0,
          belastingsoort: "Accijns",
          tarief_accijns: "Hoog",
          btw_tarief: "21%"
        }}
        columns={[
          { key: "biernaam", label: "Biernaam", width: "240px" },
          { key: "stijl", label: "Stijl", width: "180px" },
          { key: "alcoholpercentage", label: "Alcohol %", type: "number", width: "140px" },
          { key: "belastingsoort", label: "Belastingsoort", width: "160px" },
          { key: "tarief_accijns", label: "Tarief accijns", width: "160px" },
          { key: "btw_tarief", label: "BTW-tarief", width: "130px" }
        ]}
        title="Bierstamdata"
        description="Deze gegevens vormen de basis voor belasting, accijns en verdere berekeningen in de rest van de applicatie."
      />
    </PageShell>
  );
}
