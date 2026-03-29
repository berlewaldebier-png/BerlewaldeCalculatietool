import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { PageShell } from "@/components/PageShell";
import { getNavigation, getTarievenHeffingen } from "@/lib/api";

export default async function TarievenHeffingenPage() {
  const [navigation, rawRows] = await Promise.all([getNavigation(), getTarievenHeffingen()]);
  const rows = rawRows.map((row) => ({
    id: String(row.id ?? ""),
    jaar: Number(row.jaar ?? 0),
    tarief_hoog: Number(row.tarief_hoog ?? 0),
    tarief_laag: Number(row.tarief_laag ?? 0),
    verbruikersbelasting: Number(row.verbruikersbelasting ?? 0)
  }));

  return (
    <PageShell
      title="Tarieven & heffingen"
      subtitle="Beheer accijns- en belastingtarieven in de nieuwe web-UI."
      activePath="/tarieven-heffingen"
      navigation={navigation}
    >
      <DatasetTableEditor
        endpoint="/data/tarieven-heffingen"
        initialRows={rows}
        addRowTemplate={{
          id: "",
          jaar: new Date().getFullYear(),
          tarief_hoog: 0,
          tarief_laag: 0,
          verbruikersbelasting: 0
        }}
        columns={[
          { key: "jaar", label: "Jaar", type: "number", width: "110px" },
          { key: "tarief_hoog", label: "Tarief hoog", type: "number", width: "160px" },
          { key: "tarief_laag", label: "Tarief laag", type: "number", width: "160px" },
          {
            key: "verbruikersbelasting",
            label: "Verbruikersbelasting",
            type: "number",
            width: "220px"
          }
        ]}
        title="Tarieven & heffingen"
        description="Deze waarden worden gebruikt voor accijns en belasting in berekeningen en prijsvoorstellen."
      />
    </PageShell>
  );
}
