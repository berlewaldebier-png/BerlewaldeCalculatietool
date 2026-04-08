import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function BeheerPage() {
  const bootstrap = await getBootstrap(["auth-status"], true, "/beheer");
  const navigation = bootstrap.navigation ?? [];
  const authStatus = (bootstrap.datasets["auth-status"] as any) ?? {};
  const env = String(authStatus.environment ?? "").toLowerCase();
  const showDevTools = env === "local" || env === "dev" || env === "development";

  return (
    <PageShell
      title="Beheer"
      subtitle="Users, handleiding en deployment-informatie in een beheeromgeving."
      activePath="/beheer"
      navigation={navigation}
    >
      <div className="home-grid">
        <Link href="/beheer/users" className="home-card">
          <div className="home-card-section">Beheer</div>
          <div className="home-card-title">Users</div>
          <div className="home-card-text">Auth readiness, users en rollenbasis voor de volgende fase.</div>
        </Link>
        <Link href="/beheer/handleiding" className="home-card">
          <div className="home-card-section">Beheer</div>
          <div className="home-card-title">Handleiding</div>
          <div className="home-card-text">Hier komt de werkinstructie en uitleg van berekeningen en bronnen.</div>
        </Link>
        <Link href="/beheer/deployment" className="home-card">
          <div className="home-card-section">Beheer</div>
          <div className="home-card-title">Deployment</div>
          <div className="home-card-text">Release-instructies voor de testomgeving en latere webdeployment.</div>
        </Link>
        {showDevTools ? (
          <Link href="/beheer/devtools" className="home-card">
            <div className="home-card-section">Beheer</div>
            <div className="home-card-title">Dev tools</div>
            <div className="home-card-text">Reset en demo-seed voor localhost (alleen data, nooit tabellen).</div>
          </Link>
        ) : null}
      </div>
    </PageShell>
  );
}

