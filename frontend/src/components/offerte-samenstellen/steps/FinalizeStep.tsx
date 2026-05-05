"use client";

import React from "react";

import type { BasisData, QuoteDraft, QuoteScenario, ScenarioMetrics } from "@/components/offerte-samenstellen/types";
import { Metric } from "@/components/offerte-samenstellen/OfferteSamenstellenParts";
import { euro } from "@/components/offerte-samenstellen/offerteSamenstellenUi";

type Scenario = QuoteScenario;

export function FinalizeStep({
  basis,
  scenario,
  metrics,
  draftStatus,
  onBack,
  onDownload,
  onSave,
  onFinalize,
  isSaving,
}: {
  basis: BasisData;
  scenario: Scenario;
  metrics: ScenarioMetrics;
  draftStatus: QuoteDraft["meta"]["status"];
  onBack: () => void;
  onDownload: () => void;
  onSave: () => void;
  onFinalize: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Afronden</h2>
          <p className="cpq-card-subtitle">
            Export/document is nog niet geïmplementeerd. Dit is een technische stub voor toekomstige output.
          </p>
        </div>
      </div>

      <div className="cpq-final-grid">
        <div className="cpq-final-card">
          <h3 className="cpq-panel-title">Samenvatting</h3>
          <Metric label="Klant" value={basis.klantNaam || "—"} />
          <Metric label="Kanaal" value={basis.kanaal} />
          <Metric label="Voorstel" value={scenario.name} />
          <Metric label="Omzet (ex)" value={euro(metrics.revenueEx)} />
          <Metric label="Marge" value={`${Math.round(metrics.marginPct)}%`} />
          <Metric
            label="Break-even omzet"
            value={metrics.breakEvenCurrent === null ? "Niet ingesteld" : euro(metrics.breakEvenCurrent)}
          />
          <Metric label="Boven / onder BE" value={metrics.breakEvenProjected === null ? "-" : euro(metrics.breakEvenProjected)} />
          <Metric
            label="BE-dekking"
            value={
              metrics.breakEvenCoveragePct === null ? "Niet beschikbaar" : `${Math.round(metrics.breakEvenCoveragePct)}%`
            }
          />
        </div>
        <div className="cpq-final-card">
          <h3 className="cpq-panel-title">Opmerking</h3>
          <div className="cpq-panel-text">{basis.opmerking || "Geen opmerking."}</div>
          <div className="cpq-panel-text">Status: {draftStatus === "definitief" ? "Definitief" : "Concept"}</div>
        </div>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onBack} className="cpq-button cpq-button-secondary" type="button">
          Terug
        </button>
        <div className="cpq-actions-inline">
          <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
          <button
            onClick={onFinalize}
            className="cpq-button cpq-button-secondary"
            type="button"
            disabled={isSaving || draftStatus === "definitief"}
          >
            {draftStatus === "definitief" ? "Al definitief" : "Definitief opslaan"}
          </button>
          <button onClick={onDownload} className="cpq-button cpq-button-primary" type="button">
            Concept downloaden (JSON stub)
          </button>
        </div>
      </div>
    </section>
  );
}

