import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/apiServer";

export default async function MeldingenPage() {
  const bootstrap = await getBootstrap([], true, "/instellingen/meldingen");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Meldingen"
      subtitle="Voorkeuren voor notificaties, waarschuwingen en toekomstige alerts."
      activePath="/instellingen"
      navigation={navigation}
    >
      <SectionCard title="Notificaties">
        <div className="record-card-grid">
          <div className="wizard-toggle-card">
            <span>
              <strong>E-mail notificaties</strong>
              <small>Binnenkort</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Ontbrekende kostprijs</strong>
              <small>Binnenkort</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Marge alerts</strong>
              <small>Binnenkort</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>KPI alerts</strong>
              <small>Binnenkort</small>
            </span>
          </div>
        </div>
      </SectionCard>
    </PageShell>
  );
}
