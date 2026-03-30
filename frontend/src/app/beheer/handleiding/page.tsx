import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getNavigation } from "@/lib/api";

export default async function HandleidingPage() {
  const navigation = await getNavigation();

  return (
    <PageShell
      title="Handleiding"
      subtitle="Werkinstructie en toelichting op berekeningen en bronnen."
      activePath="/beheer"
      navigation={navigation}
    >
      <SectionCard title="Werkinstructie">
        <div className="stack">
          <span>1. Controleer stamdata per jaar.</span>
          <span>2. Werk kostprijsberekeningen uit.</span>
          <span>3. Voeg inkoopfacturen toe waar nodig.</span>
          <span>4. Stel verkoopstrategie en prijsvoorstellen vast.</span>
        </div>
      </SectionCard>
      <SectionCard title="Berekeningen & bronnen">
        <div className="stack">
          <span>Gemiddelde inkoop per liter, indirecte kosten en integrale kostprijs blijven uit de bestaande Python-logica komen.</span>
          <span>Bronnen blijven voorlopig de JSON-bestanden in de opslaglaag totdat PostgreSQL is ingevoerd.</span>
        </div>
      </SectionCard>
      <SectionCard title="Regressiechecks">
        <div className="stack">
          <span>Voer voor grotere wijzigingen het script `scripts/run_regression_checks.ps1` uit.</span>
          <span>Golden scenarios: `Berlewalde Ipa 2025 Inkoop`, `Berlewalde Goudkoorts 2025 Eigen productie` en prijsvoorstel `202603001`.</span>
          <span>Loop daarnaast handmatig de belangrijkste schermen na: Productie, Vaste kosten, Kostprijs beheren, Inkoopfacturen, Recept hercalculatie en Nieuw jaar voorbereiden.</span>
        </div>
      </SectionCard>
    </PageShell>
  );
}
