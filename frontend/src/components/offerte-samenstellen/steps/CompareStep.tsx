"use client";

import React from "react";

import type { QuoteScenario, ScenarioMetrics } from "@/components/offerte-samenstellen/types";
import { Metric } from "@/components/offerte-samenstellen/OfferteSamenstellenParts";
import { euro } from "@/components/offerte-samenstellen/offerteSamenstellenUi";

type ScenarioId = "A" | "B" | "C";
type Scenario = QuoteScenario;

export function CompareStep({
  scenarios,
  metrics,
  activeScenario,
  setActiveScenario,
  onNext,
  onBack,
  onSave,
  isSaving,
}: {
  scenarios: Record<ScenarioId, Scenario>;
  metrics: Record<ScenarioId, { standard: ScenarioMetrics; intro: ScenarioMetrics | null }>;
  activeScenario: ScenarioId;
  setActiveScenario: (id: ScenarioId) => void;
  onNext: () => void;
  onBack: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Vergelijken</h2>
          <p className="cpq-card-subtitle">
            Vergelijk voorstellen zonder verborgen aannames: we tonen standaard en (optioneel) introductie apart.
          </p>
        </div>
      </div>

      <div className="cpq-compare-grid">
        {(["A", "B", "C"] as ScenarioId[]).map((id) => {
          const active = activeScenario === id;
          const m = metrics[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveScenario(id)}
              className={`cpq-compare-card${active ? " active" : ""}`}
            >
              <div className="cpq-compare-title">
                <span>{scenarios[id].name}</span>
                {active ? <span className="cpq-badge">Actief</span> : null}
              </div>

              <div className="cpq-compare-section">
                <div className="cpq-compare-section-title">Standaard</div>
                <Metric label="Omzet" value={euro(m.standard.revenueEx)} />
                <Metric label="Kosten" value={euro(m.standard.costEx)} />
                <Metric label="Marge" value={`${Math.round(m.standard.marginPct)}%`} />
                <Metric
                  label="Break-even omzet"
                  value={m.standard.breakEvenCurrent === null ? "Niet ingesteld" : euro(m.standard.breakEvenCurrent)}
                />
                <Metric label="Boven / onder BE" value={m.standard.breakEvenProjected === null ? "-" : euro(m.standard.breakEvenProjected)} />
                <Metric
                  label="BE-dekking"
                  value={
                    m.standard.breakEvenCoveragePct === null ? "Niet beschikbaar" : `${Math.round(m.standard.breakEvenCoveragePct)}%`
                  }
                />
              </div>

              {m.intro ? (
                <div className="cpq-compare-section">
                  <div className="cpq-compare-section-title">Introductie</div>
                  <Metric label="Omzet" value={euro(m.intro.revenueEx)} />
                  <Metric label="Kosten" value={euro(m.intro.costEx)} />
                  <Metric label="Marge" value={`${Math.round(m.intro.marginPct)}%`} />
                  <Metric label="Boven / onder BE" value={m.intro.breakEvenProjected === null ? "-" : euro(m.intro.breakEvenProjected)} />
                  <Metric
                    label="BE-dekking"
                    value={
                      m.intro.breakEvenCoveragePct === null ? "Niet beschikbaar" : `${Math.round(m.intro.breakEvenCoveragePct)}%`
                    }
                  />
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onBack} className="cpq-button cpq-button-secondary" type="button">
          Vorige
        </button>
        <div className="cpq-actions-inline">
          <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
            {isSaving ? "Opslaan..." : "Opslaan"}
          </button>
          <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
            Verder naar afronden
          </button>
        </div>
      </div>
    </section>
  );
}

