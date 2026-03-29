import { HomeDashboard } from "@/components/HomeDashboard";
import { getDashboardSummary, getNavigation } from "@/lib/api";

export default async function HomePage() {
  const [navigation, summary] = await Promise.all([
    getNavigation(),
    getDashboardSummary()
  ]);

  return <HomeDashboard navigation={navigation} summary={summary} />;
}
