import { PageShell } from "@/components/PageShell";
import { AccountSettingsClient } from "@/components/account/AccountSettingsClient";
import { apiGetServer, getBootstrap } from "@/lib/apiServer";

type MeResponse = {
  authenticated: boolean;
  username: string;
  display_name: string;
  role: string;
};

export default async function AccountPage() {
  const bootstrap = await getBootstrap([], true, "/account");
  const navigation = bootstrap.navigation ?? [];
  const me = await apiGetServer<MeResponse>("/auth/me", "/account");

  return (
    <PageShell
      title="Mijn account"
      subtitle="Persoonlijke gegevens en beveiligingsinstellingen voor jouw login."
      activePath="/account"
      navigation={navigation}
    >
      <AccountSettingsClient username={me.username} displayName={me.display_name} role={me.role} />
    </PageShell>
  );
}
