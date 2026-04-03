import { HomeDashboard } from "@/components/HomeDashboard";
import { getBootstrap } from "@/lib/api";

export default async function HomePage() {
  const bootstrap = await getBootstrap(["dashboard-summary"], true);
  const navigation = bootstrap.navigation ?? [];
  const summary = (bootstrap.datasets["dashboard-summary"] as any) ?? {
    concept_berekeningen: 0,
    definitieve_berekeningen: 0,
    concept_prijsvoorstellen: 0,
    definitieve_prijsvoorstellen: 0
  };

  return <HomeDashboard navigation={navigation} summary={summary} />;
}
