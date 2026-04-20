"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchMe, logout, readAuthSession } from "@/lib/auth";
import type { DashboardSummary, NavigationItem } from "@/lib/apiShared";

type HomeDashboardProps = {
  navigation: NavigationItem[];
  summary: DashboardSummary;
};

type DashboardNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

type AlertCard = {
  title: string;
  value: string;
  description: string;
  href?: string;
  tone?: "default" | "warning";
};

function buildNavItems(navigation: NavigationItem[]): DashboardNavItem[] {
  const preferredOrder = [
    "/",
    "/nieuwe-kostprijsberekening",
    "/offerte-samenstellen",
    "/productie",
    "/vaste-kosten",
    "/tarieven-heffingen",
    "/producten-verpakking",
    "/bieren",
    "/recept-hercalculatie",
    "/inkoopfacturen",
    "/verkoopstrategie",
    "/adviesprijzen",
    "/nieuw-jaar-voorbereiden",
    "/beheer"
  ];

  const normalized = navigation.map((item) => ({
    label: item.label,
    href: item.href
  }));

  const overviewItem = { label: "Overzicht", href: "/", active: true };
  const byHref = new Map(normalized.map((item) => [item.href, item]));

  const result: DashboardNavItem[] = [];

  for (const href of preferredOrder) {
    if (href === "/") {
      result.push(overviewItem);
      continue;
    }

    const found = byHref.get(href);
    if (found) {
      result.push({ ...found, active: false });
    }
  }

  return result;
}

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
      description: "Voorstellen die nog aandacht nodig hebben",
      href: "/offerte-samenstellen"
    },
    {
      title: "Definitieve prijsvoorstellen",
      value: String(summary.definitieve_prijsvoorstellen),
      description: "Afgeronde voorstellen in deze omgeving",
      href: "/offerte-samenstellen"
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
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState("gebruiker");

  useEffect(() => {
    const sync = () => {
      void fetchMe().then((session) => {
        setCurrentUser(session?.display_name ?? "gebruiker");
      });
    };

    sync();
    window.addEventListener("calculatietool-auth-changed", sync);
    return () => window.removeEventListener("calculatietool-auth-changed", sync);
  }, []);

  const navItems = useMemo(() => buildNavItems(navigation), [navigation]);
  const alertCards = useMemo(() => buildAlertCards(summary), [summary]);

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <aside className="dashboard-sidebar">
          <div className="dashboard-brand-block">
            <span className="dashboard-brand-text">BERLEWALDE</span>
            <small className="dashboard-brand-subtitle">CalculatieTool</small>
          </div>

          <nav className="dashboard-sidebar-nav" aria-label="Hoofdnavigatie">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href as Route}
                className={`dashboard-sidebar-link${item.active ? " is-active" : ""}`}
              >
                <span className="dashboard-sidebar-icon">
                  <MenuIcon />
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <section className="dashboard-main-content">
          <header className="dashboard-topbar">
            <div className="dashboard-searchbar">
              <input type="text" placeholder="Zoeken..." aria-label="Zoeken" />
              <button type="button" className="dashboard-search-button" aria-label="Zoeken">
                <SearchIcon />
              </button>
            </div>

            <div className="dashboard-topbar-actions">
              <button type="button" className="dashboard-icon-button" aria-label="Meldingen">
                <BellIcon />
              </button>

              <div className="dashboard-user-chip">
                <div className="dashboard-user-avatar">
                  <UserIcon />
                </div>
                <span className="dashboard-user-greeting">Hoi, {currentUser}</span>
              </div>

              <button
                type="button"
                className="dashboard-icon-button"
                aria-label="Uitloggen"
                title="Uitloggen"
                onClick={() => {
                  void logout().finally(() => {
                    router.replace("/login");
                  });
                }}
              >
                <LogoutIcon />
              </button>
            </div>
          </header>

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

                <Link href="/offerte-samenstellen" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Prijsvoorstel maken</div>
                  <div className="dashboard-quick-card-text">
                    Maak een nieuw prijsvoorstel in de CPQ builder (scenario's en prijsblokken).
                  </div>
                </Link>

                <Link href="/adviesprijzen" className="dashboard-quick-card">
                  <div className="dashboard-quick-card-title">Adviesprijzen</div>
                  <div className="dashboard-quick-card-text">
                    Beheer de adviesopslag per kanaal (sell-out) voor een gekozen jaar.
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
                href={"/offerte-samenstellen" as Route}
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16L21 21" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M12 4a4 4 0 0 0-4 4v2.2c0 .8-.24 1.57-.68 2.23L6 14.5h12l-1.32-2.07A4.02 4.02 0 0 1 16 10.2V8a4 4 0 0 0-4-4Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c1.5-3 4.1-4.5 7-4.5S17.5 16 19 19" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M14 16l5-4-5-4" />
      <path d="M19 12H10" />
    </svg>
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
