import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getNavigation } from "@/lib/api";

export default async function DeploymentPage() {
  const navigation = await getNavigation();

  return (
    <PageShell
      title="Deployment"
      subtitle="Release-aanpak voor de testomgeving en latere productie."
      activePath="/beheer"
      navigation={navigation}
    >
      <SectionCard title="Testbranch">
        <pre>{`git checkout codex/calculatietest
git add .
git commit -m "Nieuwe web UI update"
git push`}</pre>
      </SectionCard>
      <SectionCard title="Doelarchitectuur">
        <div className="stack">
          <span>Frontend: Next.js + TypeScript</span>
          <span>Backend: FastAPI</span>
          <span>Businesslogica: bestaande Python-code</span>
          <span>Opslag: tijdelijk JSON, later PostgreSQL</span>
        </div>
      </SectionCard>
    </PageShell>
  );
}
