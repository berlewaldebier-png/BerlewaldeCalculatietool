import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { PageShell } from "@/components/PageShell";
import { getNavigation, getVasteKosten } from "@/lib/api";

export default async function VasteKostenPage() {
  const [navigation, vasteKosten] = await Promise.all([getNavigation(), getVasteKosten()]);
  const rows = Object.entries(vasteKosten).flatMap(([jaar, rawItems]) => {
    const items = rawItems as Record<string, unknown>[];
    return items.map((item) => ({
      jaar: Number(jaar),
      id: String(item.id ?? ""),
      omschrijving: String(item.omschrijving ?? ""),
      kostensoort: String(item.kostensoort ?? ""),
      bedrag_per_jaar: Number(item.bedrag_per_jaar ?? 0)
    }));
  });

  return (
    <PageShell
      title="Vaste kosten"
      subtitle="Beheer vaste kosten per jaar in een echte tabelweergave. Opslag blijft tijdelijk JSON."
      activePath="/vaste-kosten"
      navigation={navigation}
    >
      <DatasetTableEditor
        endpoint="/data/vaste-kosten"
        initialRows={rows}
        saveShape="groupByYearList"
        addRowTemplate={{
          jaar: new Date().getFullYear(),
          id: "",
          omschrijving: "",
          kostensoort: "",
          bedrag_per_jaar: 0
        }}
        columns={[
          { key: "jaar", label: "Jaar", type: "number", width: "110px" },
          { key: "omschrijving", label: "Omschrijving", width: "280px" },
          { key: "kostensoort", label: "Kostensoort", width: "220px" },
          { key: "bedrag_per_jaar", label: "Bedrag per jaar", type: "number", width: "180px" }
        ]}
        title="Vaste kosten"
        description="Per jaar kun je hier de vaste kostenregels beheren die worden gebruikt in de kostprijsberekeningen."
      />
    </PageShell>
  );
}
