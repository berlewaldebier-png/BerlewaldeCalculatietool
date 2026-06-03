import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { ApplicationSettingsClient } from "@/components/instellingen/ApplicationSettingsClient";
import { getBootstrap } from "@/lib/apiServer";

export default async function BedrijfsinstellingenPage() {
  const bootstrap = await getBootstrap(["application-settings", "tarieven-heffingen"], true, "/instellingen/bedrijf");
  const navigation = bootstrap.navigation ?? [];
  const settings = (bootstrap.datasets["application-settings"] as Record<string, any>) ?? {};
  const tarieven = ((bootstrap.datasets["tarieven-heffingen"] as any[]) ?? [])
    .map((row) => ({
      jaar: Number(row.jaar ?? 0),
      tarief_hoog: Number(row.tarief_hoog ?? 0),
      tarief_laag: Number(row.tarief_laag ?? 0),
      verbruikersbelasting: Number(row.verbruikersbelasting ?? 0),
    }))
    .filter((row) => row.jaar > 0)
    .sort((a, b) => b.jaar - a.jaar);
  const latestTarief = tarieven[0] ?? null;

  return (
    <PageShell
      title="Bedrijfsinstellingen"
      subtitle="Centrale bedrijfsdefaults voor calculaties, prijsvoorstellen en administratie."
      activePath="/instellingen"
      navigation={navigation}
    >
      <ApplicationSettingsClient initial={settings} />

      <SectionCard title="BTW, accijnzen en heffingen" description="Deze waarden blijven bewust in sync met Tarieven & heffingen.">
        <div className="record-card-grid">
          <div className="wizard-toggle-card">
            <span>
              <strong>BTW</strong>
              <small>Per bier/product via BTW-tarief; beheer bij Bieren en calculatiebasis</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Laatste accijnsjaar</strong>
              <small>{latestTarief ? latestTarief.jaar : "Geen tarieven gevonden"}</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Tarief hoog / laag</strong>
              <small>{latestTarief ? `${latestTarief.tarief_hoog} / ${latestTarief.tarief_laag}` : "-"}</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Verbruikersbelasting</strong>
              <small>{latestTarief ? latestTarief.verbruikersbelasting : "-"}</small>
            </span>
          </div>
        </div>
        <div className="editor-actions" style={{ marginTop: 12 }}>
          <div className="editor-actions-group" />
          <div className="editor-actions-group">
            <Link href="/tarieven-heffingen" className="editor-button editor-button-secondary">
              Open Tarieven & heffingen
            </Link>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Prijsvoorstel defaults" description="Templates, standaard marge en afronding komen hier samen.">
        <div className="placeholder-block">
          Standaard marge, opslagpercentage, afrondingsregels en prijsvoorstel templates volgen later. Operationele marges staan nu vooral in verkoopstrategie en prijsvoorstel-flows.
        </div>
      </SectionCard>
    </PageShell>
  );
}
