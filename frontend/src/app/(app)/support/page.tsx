import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { SupportIssueForm } from "@/components/support/SupportIssueForm";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type MeResponse = {
  authenticated: boolean;
  username: string;
  display_name: string;
  role: string;
};

export default async function SupportPage() {
  const bootstrap = await getBootstrap(["application-settings", "auth-status"], true, "/support");
  const navigation = bootstrap.navigation ?? [];
  const settings = (bootstrap.datasets["application-settings"] as Record<string, any>) ?? {};
  const authStatus = (bootstrap.datasets["auth-status"] as Record<string, any>) ?? {};
  const me = await apiGetServer<MeResponse>("/auth/me", "/support");
  const supportEmail = String(settings.support_email || "info@berlewaldebier.nl");
  const environment = String(authStatus.environment || "-");

  return (
    <PageShell
      title="Support"
      subtitle="Hulp bij vragen, fouten of verbeterwensen in de CalculatieTool."
      activePath="/support"
      navigation={navigation}
    >
      <SupportIssueForm
        supportEmail={supportEmail}
        username={me.username}
        displayName={me.display_name}
        role={me.role}
        environment={environment}
        version="0.1.0"
      />

      <SectionCard title="Contact">
        <div className="stack">
          <span>E-mail: {supportEmail}</span>
          <span>Gebruik het formulier hierboven om direct context mee te sturen.</span>
        </div>
      </SectionCard>

      <SectionCard title="Supportcategorieen">
        <div className="record-card-grid">
          <div className="wizard-toggle-card">
            <span>
              <strong>Functionele vraag</strong>
              <small>Berekeningen, instellingen of prijsvoorstellen</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Technisch probleem</strong>
              <small>Login, koppelingen of data laden</small>
            </span>
          </div>
        </div>
      </SectionCard>
    </PageShell>
  );
}
