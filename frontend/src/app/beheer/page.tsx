import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { getBootstrap } from "@/lib/apiServer";

export default async function BeheerPage() {
  const bootstrap = await getBootstrap([], true, "/beheer");
  const navigation = bootstrap.navigation ?? [];

  return (
    <PageShell
      title="Beheer"
      subtitle="Users, handleiding en deployment-informatie in één beheeromgeving."
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
      </div>
    </PageShell>
  );
}

