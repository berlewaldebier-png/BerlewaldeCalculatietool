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
      <SectionCard title="SKU-types en kostprijslogica">
        <div className="stack">
          <span>Afvuleenheden uit Producten en verpakkingen zijn de bron voor parent/child-relaties. Een doos die uit 24 flessen bestaat is dus moeder; de fles en kleinere verkoopbare varianten worden daarvan afgeleid.</span>
          <span>Verpakkingskosten bepalen nooit of een SKU moeder of child is. Inkoop, eigen productie en brouwmomenten gebruiken dezelfde afvuleenheid-relatie.</span>
          <span>Samengestelde artikelen zoals geschenkverpakkingen, Licht/Zwaar onder de boom en Alles onder de boom worden niet van een moeder gedeeld, maar opgebouwd door alle component-SKU's en verpakkingscomponenten op te tellen.</span>
          <span>Historische of handmatige kostprijzen hebben een expliciete status. Als een parent of component ontbreekt, moet de berekening blokkeren in plaats van stil een fallback-bedrag te tonen.</span>
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
          <span>Loop daarnaast handmatig de belangrijkste schermen na: Productie, Vaste kosten, Kostprijs beheren, Inkoopfacturen, Brouwmoment en Nieuw jaar voorbereiden.</span>
        </div>
      </SectionCard>
    </PageShell>
  );
}
