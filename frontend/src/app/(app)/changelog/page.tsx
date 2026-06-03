import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/apiServer";

export default async function ChangelogPage() {
  const bootstrap = await getBootstrap([], true, "/changelog");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Nieuw in Berlewalde"
      subtitle="Belangrijke wijzigingen, verbeteringen en release-notities."
      activePath="/changelog"
      navigation={navigation}
    >
      <SectionCard title="Werkwijze na productiegang" description="Elke afgeronde wijziging krijgt straks een korte release note.">
        <div className="stack">
          <span>Release notes worden per sprint of afgeronde verbetering bijgewerkt.</span>
          <span>Elke note beschrijft wat er is veranderd, waarom het relevant is en of gebruikers iets moeten doen.</span>
          <span>Na productiegang wordt dit de plek voor “Nieuw in Berlewalde”.</span>
        </div>
      </SectionCard>

      <SectionCard title="Versie 0.1.0" description="Basis voor gebruikersbeheer, login en kostprijsflows.">
        <div className="stack">
          <span>Login vernieuwd met wachtwoord-reset via e-mailcode.</span>
          <span>Gebruikersbeheer uitgebreid met bewerken en soft-delete.</span>
          <span>Accountmenu toegevoegd als centrale ingang voor instellingen en support.</span>
          <span>Bedrijfsinstellingen, supportmelding en instellingen-hubs voorbereid.</span>
        </div>
      </SectionCard>
    </PageShell>
  );
}
