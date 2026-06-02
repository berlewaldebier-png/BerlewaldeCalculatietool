import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { UserAdminPanel } from "@/components/UserAdminPanel";
import { UserManagementTable } from "@/components/UserManagementTable";
import { getBootstrap } from "@/lib/apiServer";
import type { AuthUser } from "@/lib/apiShared";

export default async function UsersPage() {
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
      subtitle="Auth-basis staat klaar. Hier zie je de huidige readiness van users, rollen en toekomstige login."
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
        title="Auth readiness"
        description="De backend is voorbereid op users en rollen, maar login wordt nog niet afgedwongen zodat we rustig verder kunnen migreren."
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
        description="Dit zijn de users die straks voor login en rollen gebruikt kunnen worden."
      >
        {usersLoadError ? (
          <div className="placeholder-block">
            <strong>Gebruikers niet beschikbaar</strong>
            {usersLoadError}
          </div>
        ) : (
          <UserManagementTable initialUsers={users} />
        )}
      </SectionCard>

      <SectionCard
        title="Acties"
        description="Beheer admins en users. In local kun je met admin/admin inloggen; in T gebruik je bootstrap token voor de eerste admin."
      >
        <UserAdminPanel hasAdmin={Boolean(authStatus.has_admin)} />
      </SectionCard>
    </PageShell>
  );
}
