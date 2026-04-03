import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/api";

export default async function UsersPage() {
  const bootstrap = await getBootstrap(["auth-status", "auth-users"], true);
  const navigation = bootstrap.navigation ?? [];
  const authStatus = (bootstrap.datasets["auth-status"] as any) ?? {
    enabled: false,
    mode: "unknown",
    postgres_configured: false,
    storage_provider: "unknown",
    user_count: 0,
    has_admin: false
  };
  const users = (bootstrap.datasets["auth-users"] as any[]) ?? [];

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
        {users.length === 0 ? (
          <div className="placeholder-block">
            <strong>Nog geen users</strong>
            De auth-laag staat klaar, maar er is nog geen admin of gebruiker aangemaakt.
          </div>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Gebruikersnaam</th>
                  <th>Naam</th>
                  <th>Rol</th>
                  <th>Status</th>
                  <th>Aangemaakt</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.display_name}</td>
                    <td>
                      <span className="pill">{user.role}</span>
                    </td>
                    <td>{user.is_active ? "Actief" : "Inactief"}</td>
                    <td>{new Date(user.created_at).toLocaleString("nl-NL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Volgende stap"
        description="Als we auth echt aanzetten, volgen hierna login, sessies en routebescherming in de web-UI."
      >
        <div className="module-card-text">
          Voor nu blijft de applicatie open beschikbaar, zodat we eerst de UI, refactor van oude code en businesslogica verder kunnen afronden.
        </div>
      </SectionCard>
    </PageShell>
  );
}
