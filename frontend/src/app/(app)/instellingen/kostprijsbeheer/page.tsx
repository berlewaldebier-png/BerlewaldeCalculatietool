import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { getBootstrap } from "@/lib/apiServer";

export default async function KostprijsbeheerInstellingenPage() {
  const bootstrap = await getBootstrap(["cost-pools", "productgroepen"], true, "/instellingen/kostprijsbeheer");
  const navigation = bootstrap.navigation ?? [];
  const pools = ((bootstrap.datasets["cost-pools"] as any[]) ?? []).filter((row) => row?.active !== false);
  const productgroepen = ((bootstrap.datasets["productgroepen"] as any[]) ?? []).filter((row) => row?.active !== false);

  return (
    <PageShell
      title="Kostprijsbeheer"
      subtitle="Instellingen en beheerlinks rond kostprijsopbouw, categorieen en activatie."
      activePath="/instellingen"
      navigation={navigation}
    >
      <SectionCard title="Kostprijscategorieen" description="De actieve cost pools worden gebruikt bij vaste kosten en ABC-verdeling.">
        <div className="record-card-grid">
          {pools.map((pool) => (
            <div className="wizard-toggle-card" key={String(pool.id)}>
              <span>
                <strong>{String(pool.label || pool.id)}</strong>
                <small>Cost pool</small>
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Productgroepen" description="Classificaties die gebruikt worden voor SKU's, dashboards en defaults.">
        <div className="record-card-grid">
          {productgroepen.map((groep) => (
            <div className="wizard-toggle-card" key={String(groep.id)}>
              <span>
                <strong>{String(groep.label || groep.id)}</strong>
                <small>Productgroep</small>
              </span>
            </div>
          ))}
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <Link href="/beheer/productclassificatie" className="editor-button editor-button-secondary">
              Classificaties beheren
            </Link>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Kostprijswerkstromen" description="Operationele schermen waar kostprijzen worden opgesteld en definitief gemaakt.">
        <div className="home-grid">
          <Link href="/nieuwe-kostprijsberekening" className="home-card">
            <div className="home-card-section">Kostprijs</div>
            <div className="home-card-title">Nieuwe kostprijsberekening</div>
            <div className="home-card-text">Stel kostprijsversies op en controleer de opbouw.</div>
          </Link>
          <Link href="/kostprijs-activatie" className="home-card">
            <div className="home-card-section">Kostprijs</div>
            <div className="home-card-title">Kostprijs activeren</div>
            <div className="home-card-text">Maak definitieve kostprijzen actief voor gebruik in offertes en analyses.</div>
          </Link>
          <Link href="/vaste-kosten" className="home-card">
            <div className="home-card-section">Kosten</div>
            <div className="home-card-title">Vaste kosten</div>
            <div className="home-card-text">Beheer overhead en verdeelsleutels per jaar.</div>
          </Link>
        </div>
      </SectionCard>
    </PageShell>
  );
}
