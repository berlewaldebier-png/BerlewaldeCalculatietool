import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { UserAdminPanel } from "@/components/UserAdminPanel";
import { UserManagementTable } from "@/components/UserManagementTable";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";
import type { AuthUser, MeResponse } from "@/lib/apiShared";

export default async function UsersPage() {
  const session = await apiGetServer<MeResponse>("/auth/me", "/beheer/users");
  const canManageUsers = Array.isArray(session.capabilities)
    ? session.capabilities.includes("users:manage")
    : session.role === "admin";
  let bootstrap: any;
  let users: AuthUser[] = [];
  let usersLoadError = "";

  try {
    bootstrap = await getBootstrap(["auth-status", "auth-users"], true, "/beheer/users");
    users = (bootstrap.datasets["auth-users"] as AuthUser[]) ?? [];
  } catch (error) {
    bootstrap = await getBootstrap(["auth-status"], true, "/beheer/users");
    usersLoadError =
      error instanceof Error ? error.message : "Gebruikers laden is niet gelukt.";
  }

  const navigation = bootstrap.navigation ?? [];
  const authStatus = (bootstrap.datasets["auth-status"] as any) ?? {
    enabled: false,
    mode: "unknown",
    postgres_configured: false,
    storage_provider: "unknown",
    user_count: 0,
    has_admin: false
  };

  return (
    <PageShell
      title="Users"
      subtitle="Bekijk gebruikers, rollen en de actuele authenticatieconfiguratie."
      activePath="/beheer"
      navigation={navigation}
    >
      <div className="stats-grid auth-stats-grid">
        <div className="stat-card">
          <div className="stat-label">Auth modus</div>
          <div className="stat-value small">{authStatus.mode}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Auth actief</div>
          <div className="stat-value small">{authStatus.enabled ? "Ja" : "Nog niet"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Users</div>
          <div className="stat-value">{authStatus.user_count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Admin aanwezig</div>
          <div className="stat-value small">{authStatus.has_admin ? "Ja" : "Nee"}</div>
        </div>
      </div>

      <SectionCard
        title="Authenticatie"
        description="Lokale ontwikkeling kan een expliciete login-bypass gebruiken. Buiten local en test moet authenticatie actief en veilig geconfigureerd zijn."
      >
        <div className="record-card-grid">
          <div className="wizard-toggle-card">
            <span>
              <strong>Storage provider</strong>
              <small>{authStatus.storage_provider}</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>PostgreSQL gereed</strong>
              <small>{authStatus.postgres_configured ? "Ja" : "Nee"}</small>
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Gebruikers"
        description="Dit zijn de gebruikers en rollen die voor login en autorisatie worden gebruikt."
      >
        {usersLoadError ? (
          <div className="placeholder-block">
            <strong>Gebruikers niet beschikbaar</strong>
            {usersLoadError}
          </div>
        ) : (
          <UserManagementTable initialUsers={users} canManage={canManageUsers} />
        )}
      </SectionCard>

      {canManageUsers ? (
        <SectionCard
          title="Acties"
          description="Beheer gebruikers en rollen. In local kun je met admin/admin inloggen; buiten local gebruik je een bootstrap token voor de eerste administrator."
        >
          <UserAdminPanel hasAdmin={Boolean(authStatus.has_admin)} />
        </SectionCard>
      ) : null}
    </PageShell>
  );
}
