import { PageShell } from "@/components/PageShell";
import { CostManagementSettingsClient } from "@/components/instellingen/CostManagementSettingsClient";
import { CostPoolsClient } from "@/components/instellingen/CostPoolsClient";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/apiServer";

export default async function InstellingenPage() {
  const bootstrap = await getBootstrap(["cost-management-settings", "cost-pools"], true, "/instellingen");
  const navigation = bootstrap.navigation ?? [];
  const settings = (bootstrap.datasets["cost-management-settings"] as Record<string, any>) ?? {};
  const pools = (bootstrap.datasets["cost-pools"] as any[]) ?? [];

  return (
    <PageShell
      title="Instellingen"
      subtitle="Defaults en definities voor kostprijsmanagement."
      activePath="/instellingen"
      navigation={navigation}
    >
      <SectionCard title="Formules en rekenregels" description="Leesbaar overzicht van de belangrijkste berekeningen. Nog niet bewerkbaar.">
        <div className="formula-grid">
          <div className="formula-card">
            <strong>Accijns</strong>
            <code>liters x tarief_hoog/laag + verbruikersbelasting</code>
            <span>Gebaseerd op Tarieven & heffingen per jaar en tariefkeuze per product.</span>
          </div>
          <div className="formula-card">
            <strong>Integrale kostprijs</strong>
            <code>primaire kosten + verpakking + vaste kosten + accijns</code>
            <span>Gebruikt in kostprijsversies, activatie en prijsvoorstellen.</span>
          </div>
          <div className="formula-card">
            <strong>Adviesprijs incl. BTW</strong>
            <code>verkoopprijs ex. BTW x (1 + btw%)</code>
            <span>BTW komt uit de product-/bierbasis en wordt zichtbaar in verkoop- en adviesprijsflows.</span>
          </div>
          <div className="formula-card">
            <strong>Handelingskosten offerte</strong>
            <code>shipments x multiplier + orderregels x picks</code>
            <span>De defaults hieronder sturen de offerteberekening.</span>
          </div>
        </div>
      </SectionCard>
      <CostManagementSettingsClient initial={settings} />
      <CostPoolsClient initial={pools} />
    </PageShell>
  );
}
