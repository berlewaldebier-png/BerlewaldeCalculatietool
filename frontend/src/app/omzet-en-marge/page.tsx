import { OmzetgegevensWorkspace } from "@/components/OmzetgegevensWorkspace";
import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function OmzetEnMargePage() {
  const bootstrap = await getBootstrap(["auth-status", "productie"], true, "/omzet-en-marge");
  const navigation = bootstrap.navigation ?? [];
  const productie = (bootstrap.datasets["productie"] as any) ?? {};
  const years = Array.isArray(productie)
    ? Array.from(new Set(productie.map((row: any) => Number(row?.jaar ?? 0)).filter((y: number) => y > 0))).sort((a, b) => a - b)
    : typeof productie === "object" && productie
      ? Object.keys(productie)
          .map((key) => Number(key))
          .filter((y) => Number.isFinite(y) && y > 0)
          .sort((a, b) => a - b)
      : [];

  return (
    <PageShell
      title="Omzet & marge"
      subtitle="Omzet, kostprijs en brutomarge per klant op basis van Douano sales-orders."
      activePath="/omzet-en-marge"
      navigation={navigation}
    >
      <OmzetgegevensWorkspace availableYears={years} />
    </PageShell>
  );
}
