"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo } from "react";

import type { DashboardSummary, NavigationItem } from "@/lib/apiShared";
import { NavigationSidebar } from "@/components/NavigationSidebar";

type HomeDashboardProps = {
  navigation: NavigationItem[];
  summary: DashboardSummary;
};

type AlertCard = {
  title: string;
  value: string;
  description: string;
  href?: string;
  tone?: "default" | "warning";
};

function buildAlertCards(summary: DashboardSummary): AlertCard[] {
  const klaar = Number(summary.klaar_om_te_activeren ?? 0) || 0;
  const klaarWarn = Number(summary.klaar_om_te_activeren_waarschuwing ?? 0) || 0;

  return [
    {
      title: "Concept berekeningen",
      value: String(summary.concept_berekeningen).padStart(2, "0"),
      description: "Nog af te ronden kostprijsberekeningen",
      href: "/nieuwe-kostprijsberekening?mode=landing"
    },
    {
      title: "Definitieve berekeningen",
      value: String(summary.definitieve_berekeningen),
      description: "Beschikbare basis voor verdere prijslogica",
      href: "/nieuwe-kostprijsberekening?mode=landing"
    },
    {
      title: "Concept prijsvoorstellen",
      value: String(summary.concept_prijsvoorstellen).padStart(2, "0"),
      description: "Offertes in opbouw in de nieuwe CPQ builder",
      href: "/prijsvoorstellen"
    },
    {
      title: "Definitieve prijsvoorstellen",
      value: String(summary.definitieve_prijsvoorstellen),
      description: "Opgeslagen offertes en scenario's",
      href: "/prijsvoorstellen"
    },
    {
      title: "Klaar om te activeren",
      value: String(klaar).padStart(2, "0"),
      description: "Nieuwe kostprijsversies beschikbaar",
      href: "/nieuwe-kostprijsberekening?mode=landing&focus=activations",
      tone: klaarWarn > 0 ? "warning" : "default"
    }
  ];
}

export function HomeDashboard({ navigation, summary }: HomeDashboardProps) {
  const alertCards = useMemo(() => buildAlertCards(summary), [summary]);

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <NavigationSidebar navigation={navigation} activePath="/" />

        <section className="dashboard-main-content">
          <section className="dashboard-hero-section">
            <div className="dashboard-hero-copy">
              <p className="dashboard-hero-eyebrow">Overzicht</p>
              <h1>Welkom terug</h1>
              <p className="dashboard-hero-description">
                Start een nieuwe berekening, maak een prijsvoorstel of ga verder met bestaande
                biercalculaties.
              </p>
            </div>
          </section>

          <section className="dashboard-alerts-grid" aria-label="Overzichtskaarten">
            {alertCards.map((card) => (
              <Link
                key={card.title}
                href={(card.href ?? "/") as Route}
                className={`dashboard-alert-card${card.tone === "warning" ? " dashboard-alert-card-warning" : ""}`}
              >
                <div className="dashboard-alert-card-icon">
                  <BellSoftIcon />
                </div>

                <div className="dashboard-alert-card-content">
                  <span className="dashboard-alert-card-value">{card.value}</span>
                  <span className="dashboard-alert-card-title">{card.title}</span>
                  <span className="dashboard-alert-card-text">{card.description}</span>
                </div>
              </Link>
            ))}
          </section>

          <section className="dashboard-lower-grid">
            <article className="dashboard-panel dashboard-panel-large">
              <div className="dashboard-panel-header">
                <div>
                  <div className="dashboard-panel-title">Snelle start</div>
                  <div className="dashboard-panel-subtitle">
                    De belangrijkste acties voor dagelijks gebruik
                  </div>
                </div>
              </div>

              <div className="dashboard-quick-actions">
                <Link href="/nieuwe-kostprijsberekening" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Kostprijs beheren</div>
                  <div className="dashboard-quick-card-text">
                    Start een nieuwe berekening of open een bestaand dossier in de wizard.
                  </div>
                </Link>

                <Link href="/prijsvoorstellen" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Prijsvoorstel maken</div>
                  <div className="dashboard-quick-card-text">
                    Maak een nieuw prijsvoorstel in de CPQ builder (scenario's en prijsblokken).
                  </div>
                </Link>

                <Link href="/break-even" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Break-even analyseren</div>
                  <div className="dashboard-quick-card-text">
                    Bouw productmix-scenario&apos;s en bepaal welke break-even versie offertes gebruiken.
                  </div>
                </Link>

                <Link href="/adviesprijzen" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Adviesprijzen</div>
                  <div className="dashboard-quick-card-text">
                    Beheer de adviesopslag per kanaal (sell-out) voor een gekozen jaar.
                  </div>
                </Link>

                <Link href="/omzet-en-marge" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Omzet &amp; marge</div>
                  <div className="dashboard-quick-card-text">
                    Analyseer omzet, kostprijs en brutomarge per klant op basis van Douano orders.
                  </div>
                </Link>
              </div>
            </article>

            <article className="dashboard-panel">
              <div className="dashboard-panel-header">
                <div>
                  <div className="dashboard-panel-title">Aflopende offertes</div>
                  <div className="dashboard-panel-subtitle">
                    Conceptoffertes die binnenkort verlopen
                  </div>
                </div>
              </div>

              <Link
                href={"/prijsvoorstellen" as Route}
                className="dashboard-attention-list"
              >
                <div className="dashboard-attention-item">
                  <strong>{Number(summary.aflopende_offertes ?? 0) || 0}</strong>
                  <span>Aflopende offertes (14 dagen)</span>
                </div>
                {(summary.aflopende_offertes_items ?? []).slice(0, 4).map((item) => (
                  <div className="dashboard-attention-item" key={item.id}>
                    <strong>{item.offertenummer || "-"}</strong>
                    <span>
                      {item.klantnaam || "-"} | {item.verloopt_op || "-"}
                    </span>
                  </div>
                ))}
                {(summary.aflopende_offertes_items ?? []).length === 0 ? (
                  <div className="dashboard-attention-item">
                    <strong>-</strong>
                    <span>Geen aflopende offertes gevonden.</span>
                  </div>
                ) : null}
              </Link>
            </article>
          </section>

        </section>
      </div>
    </main>
  );
}

function BellSoftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="svg-icon soft-bell-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M12 4a4 4 0 0 0-4 4v2.2c0 .8-.24 1.57-.68 2.23L6 14.5h12l-1.32-2.07A4.02 4.02 0 0 1 16 10.2V8a4 4 0 0 0-4-4Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}
