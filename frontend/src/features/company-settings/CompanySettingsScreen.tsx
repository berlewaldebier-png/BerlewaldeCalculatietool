import Link from "next/link";

import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { ApplicationSettingsClient } from "@/components/instellingen/ApplicationSettingsClient";
import type { CompanySettingsScreenModel } from "@/features/company-settings/companySettingsScreenModel";

export function CompanySettingsScreen({ model }: { model: CompanySettingsScreenModel }) {
  const latestTariff = model.latestTariff;

  return (
    <PageShell
      title="Bedrijfsinstellingen"
      subtitle="Centrale bedrijfsdefaults voor calculaties, prijsvoorstellen en administratie."
      activePath="/instellingen"
      navigation={model.navigation}
    >
      <ApplicationSettingsClient initial={model.settings} />

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
              <small>{latestTariff ? latestTariff.jaar : "Geen tarieven gevonden"}</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Tarief hoog / laag</strong>
              <small>{latestTariff ? `${latestTariff.tarief_hoog} / ${latestTariff.tarief_laag}` : "-"}</small>
            </span>
          </div>
          <div className="wizard-toggle-card">
            <span>
              <strong>Verbruikersbelasting</strong>
              <small>{latestTariff ? latestTariff.verbruikersbelasting : "-"}</small>
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
