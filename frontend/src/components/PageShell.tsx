"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { NavigationItem } from "@/lib/apiShared";

type PageShellProps = {
  title: string;
  subtitle: string;
  activePath: string;
  navigation: NavigationItem[];
  children: ReactNode;
};

type WizardSidebarStep = {
  id: string;
  label: string;
  description: string;
};

type WizardSidebarState = {
  title: string;
  steps: WizardSidebarStep[];
  activeIndex: number;
  onStepSelect?: (index: number) => void;
};

const WizardSidebarContext = createContext<((state: WizardSidebarState | null) => void) | null>(null);

export function usePageShellWizardSidebar(state: WizardSidebarState | null) {
  const setState = useContext(WizardSidebarContext);

  useEffect(() => {
    if (!setState) {
      return;
    }

    setState(state);

    return () => {
      setState(null);
    };
  }, [setState, state]);
}

export function PageShell({ title, subtitle, activePath, navigation, children }: PageShellProps) {
  void activePath;
  void navigation;

  const [wizardSidebar, setWizardSidebar] = useState<WizardSidebarState | null>(null);
  const contextValue = useMemo(() => setWizardSidebar, []);

  return (
    <WizardSidebarContext.Provider value={contextValue}>
      <div className="page-grid">
        <aside className="dashboard-sidebar page-shell-sidebar">
          <div className="brand-block page-shell-brand">
            <span className="brand-text">Berlewalde bier B.V.</span>
          </div>

          <nav className="dashboard-sidebar-nav" aria-label="Paginanavigatie">
            <Link href="/" className="dashboard-sidebar-link is-active">
              <span className="dashboard-sidebar-icon">
                <OverviewIcon />
              </span>
              <span>Overzicht</span>
            </Link>
          </nav>

          {wizardSidebar ? (
            <div className="page-shell-wizard-nav">
              <div className="page-shell-wizard-title">{wizardSidebar.title}</div>
              <div className="page-shell-wizard-list">
                {wizardSidebar.steps.map((step, index) => (
                  <button
                    key={step.id}
                    type="button"
                    className={`page-shell-wizard-link${
                      wizardSidebar.activeIndex === index ? " active" : ""
                    }${index < wizardSidebar.activeIndex ? " completed" : ""}`}
                    onClick={() => wizardSidebar.onStepSelect?.(index)}
                  >
                    <span className="page-shell-wizard-rail">
                      <span className="page-shell-wizard-dot">
                        {index < wizardSidebar.activeIndex ? "\u2713" : ""}
                      </span>
                      {index < wizardSidebar.steps.length - 1 ? (
                        <span className="page-shell-wizard-line" />
                      ) : null}
                    </span>
                    <span className="page-shell-wizard-copy">
                      <span className="page-shell-wizard-label">{step.label}</span>
                      <span className="page-shell-wizard-text">{step.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="content-card">
          <h1 className="page-title">{title}</h1>
          <p className="page-text">{subtitle}</p>
          {children}
        </section>
      </div>
    </WizardSidebarContext.Provider>
  );
}

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </svg>
  );
}

