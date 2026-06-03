import { PageShell } from "@/components/PageShell";
import { DevToolsPanel } from "@/components/DevToolsPanel";
import { getBootstrap } from "@/lib/apiServer";

export default async function DevToolsPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/devtools");
  const navigation = bootstrap.navigation ?? [];
  const authStatus = (bootstrap.datasets["auth-status"] as any) ?? {};
  const env = String(authStatus.environment ?? "").toLowerCase();
  const isLocal = env === "local" || env === "dev" || env === "development";

  return (
    <PageShell
      title="Dev tools"
      subtitle="Alleen beschikbaar in localhost. Hiermee reset je uitsluitend de inhoud (rows), nooit tabellen."
      activePath="/beheer"
      navigation={navigation}
    >
      {isLocal ? (
        <DevToolsPanel />
      ) : (
        <div className="placeholder-block">
          <strong>Niet beschikbaar</strong>
          Deze pagina is alleen beschikbaar in local/dev.
        </div>
      )}
    </PageShell>
  );
}

