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
      subtitle="Functioneel beheer, datakwaliteit en technische beheerfuncties."
      activePath="/beheer"
      navigation={navigation}
    >
      <div className="wizard-stack">
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Functioneel beheer</div>
            <div className="module-card-text">Beheerfuncties voor gebruikers, werkinstructies en productclassificatie.</div>
          </div>
          <div className="home-grid">
            <Link href="/beheer/users" className="home-card">
              <div className="home-card-section">Functioneel beheer</div>
              <div className="home-card-title">Users</div>
              <div className="home-card-text">Auth readiness, users en rollenbasis voor de volgende fase.</div>
            </Link>
            <Link href="/beheer/handleiding" className="home-card">
              <div className="home-card-section">Functioneel beheer</div>
              <div className="home-card-title">Handleiding</div>
              <div className="home-card-text">Werkinstructie en uitleg van berekeningen en bronnen.</div>
            </Link>
            <Link href="/beheer/productclassificatie" className="home-card">
              <div className="home-card-section">Functioneel beheer</div>
              <div className="home-card-title">Productclassificatie</div>
              <div className="home-card-text">Beheer dropdowns voor productgroep, alcoholcategorie en verpakkingstype.</div>
            </Link>
          </div>
        </section>

        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Technisch beheer</div>
            <div className="module-card-text">Datakwaliteit, integraties, jaarbeheer en technische ondersteuning.</div>
          </div>
          <div className="home-grid">
            <Link href="/beheer/api" className="home-card">
              <div className="home-card-section">Technisch beheer</div>
              <div className="home-card-title">Datakwaliteit</div>
              <div className="home-card-text">Doorloop Douano sync, productkoppeling, LOT-dekking en kostprijsdekking.</div>
            </Link>
            <Link href="/beheer/productkoppeling" className="home-card">
              <div className="home-card-section">Technisch beheer</div>
              <div className="home-card-title">Productkoppeling</div>
              <div className="home-card-text">Koppel Douano producten aan actieve kostprijscombinaties (bier + verpakking).</div>
            </Link>
            <Link href="/beheer/deployment" className="home-card">
              <div className="home-card-section">Technisch beheer</div>
              <div className="home-card-title">Deployment</div>
              <div className="home-card-text">Release-instructies voor de testomgeving en latere webdeployment.</div>
            </Link>
            <Link href="/beheer/jaarsets" className="home-card">
              <div className="home-card-section">Technisch beheer</div>
              <div className="home-card-title">Jaarsets</div>
              <div className="home-card-text">Concepten en definitieve jaren beheren, inclusief rollback van het laatste jaar.</div>
            </Link>
            {showDevTools ? (
              <Link href="/beheer/devtools" className="home-card">
                <div className="home-card-section">Technisch beheer</div>
                <div className="home-card-title">Dev tools</div>
                <div className="home-card-text">Reset en demo-seed voor localhost (alleen data, nooit tabellen).</div>
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

