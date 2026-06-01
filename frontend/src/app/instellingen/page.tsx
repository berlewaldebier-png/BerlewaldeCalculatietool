import { PageShell } from "@/components/PageShell";
import { CostManagementSettingsClient } from "@/components/instellingen/CostManagementSettingsClient";
import { CostPoolsClient } from "@/components/instellingen/CostPoolsClient";
import { getBootstrap } from "@/lib/apiServer";

export default async function InstellingenPage() {
  const bootstrap = await getBootstrap(["cost-management-settings", "cost-pools"], true, "/instellingen");
  const navigation = bootstrap.navigation ?? [];
  const settings = (bootstrap.datasets["cost-management-settings"] as Record<string, any>) ?? {};
  const pools = (bootstrap.datasets["cost-pools"] as any[]) ?? [];

  return (
    <PageShell
      title="Instellingen"
      subtitle="Defaults en definities voor kostprijsmanagement."
      activePath="/instellingen"
      navigation={navigation}
    >
      <CostManagementSettingsClient initial={settings} />
      <CostPoolsClient initial={pools} />
    </PageShell>
  );
}
