import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/apiServer";

export default async function HandleidingPage() {
  const bootstrap = await getBootstrap([], true, "/beheer/handleiding");
  const navigation = bootstrap.navigation ?? [];

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
          <span>2. Werk kostprijsversies uit.</span>
          <span>3. Voeg inkoopfacturen toe waar nodig.</span>
          <span>4. Stel verkoopstrategie en prijsvoorstellen vast.</span>
        </div>
      </SectionCard>
      <SectionCard title="Berekeningen & bronnen">
        <div className="stack">
          <span>Gemiddelde inkoop per liter, indirecte kosten en integrale kostprijs blijven uit de bestaande Python-logica komen.</span>
          <span>De opslag loopt nu PostgreSQL-first, met kostprijsversies als centrale bron voor nieuwe offertes.</span>
        </div>
      </SectionCard>
      <SectionCard title="Datamodel kostprijsversies">
        <div className="stack">
          <span>Download hier het actuele datamodel voor kostprijsversies en offertekoppelingen.</span>
          <div className="editor-actions-group">
            <a
              href="/docs/datamodel-compleet-erd.pdf"
              download="datamodel-compleet-erd.pdf"
              className="editor-button"
              style={{ width: "fit-content", textDecoration: "none" }}
            >
              Download complete ERD (PDF)
            </a>
            <a
              href="/docs/datamodel-kostprijsversies.pdf"
              download="datamodel-kostprijsversies.pdf"
              className="editor-button editor-button-secondary"
              style={{ width: "fit-content", textDecoration: "none" }}
            >
              Download kostprijsversies (PDF)
            </a>
          </div>
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
