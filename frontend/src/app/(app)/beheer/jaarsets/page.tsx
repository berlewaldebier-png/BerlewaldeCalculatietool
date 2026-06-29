import { PageShell } from "@/components/PageShell";
import { JaarsetsPanel } from "@/components/JaarsetsPanel";
import { getBootstrap } from "@/lib/apiServer";

export default async function JaarsetsPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer/jaarsets");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Jaarbeheer"
      subtitle="Beheer jaarsets, frozen break-even plannen, nieuw-jaar-concepten en jaarafsluitingen."
      activePath="/beheer"
      navigation={navigation}
    >
      <JaarsetsPanel />
    </PageShell>
  );
}

