import type { Route } from "next";
import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { getDashboardSummary, getNavigation } from "@/lib/api";


export default async function HomePage() {
  const [navigation, summary] = await Promise.all([
    getNavigation(),
    getDashboardSummary()
  ]);

  return (
    <PageShell
      title="Home"
      subtitle="Centrale toegang tot stamdata, kostprijsberekeningen, verkoopstrategie en beheer."
      activePath="/"
      navigation={navigation}
    >
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Concept berekeningen</div>
          <div className="stat-value">{summary.concept_berekeningen}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Definitieve berekeningen</div>
          <div className="stat-value">{summary.definitieve_berekeningen}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Concept prijsvoorstellen</div>
          <div className="stat-value">{summary.concept_prijsvoorstellen}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Definitieve prijsvoorstellen</div>
          <div className="stat-value">{summary.definitieve_prijsvoorstellen}</div>
        </div>
      </div>

      <div className="home-grid">
        {navigation.map((item) => (
          <Link href={item.href as Route} className="home-card" key={item.key}>
            <div className="home-card-section">{item.section}</div>
            <div className="home-card-title">{item.label}</div>
            <div className="home-card-text">{item.description}</div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
