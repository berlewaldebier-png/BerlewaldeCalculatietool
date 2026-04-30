"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { NavigationItem } from "@/lib/apiShared";
import { DevGitBadge } from "@/components/DevGitBadge";
import { NavigationSidebar } from "@/components/NavigationSidebar";

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
  disabled?: boolean;
};

type WizardSidebarState = {
  title: string;
  steps: WizardSidebarStep[];
  activeIndex: number;
  onStepSelect?: (index: number) => void;
};

type PageHeaderState = {
  title: string;
  subtitle: string;
};

const WizardSidebarContext = createContext<((state: WizardSidebarState | null) => void) | null>(null);
const PageHeaderContext = createContext<((state: PageHeaderState | null) => void) | null>(null);

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

export function usePageShellHeader(state: PageHeaderState | null) {
  const setState = useContext(PageHeaderContext);

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
  const [wizardSidebar, setWizardSidebar] = useState<WizardSidebarState | null>(null);
  const [pageHeader, setPageHeader] = useState<PageHeaderState | null>(null);
  const wizardContextValue = useMemo(() => setWizardSidebar, []);
  const headerContextValue = useMemo(() => setPageHeader, []);

  const wizardFooter = wizardSidebar ? (
    <>
      <div className="page-shell-wizard-title">{wizardSidebar.title}</div>
      <div className="page-shell-wizard-list">
        {wizardSidebar.steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={`page-shell-wizard-link${wizardSidebar.activeIndex === index ? " active" : ""}${
              index < wizardSidebar.activeIndex ? " completed" : ""
            }`}
            disabled={Boolean(step.disabled)}
            onClick={() => {
              if (step.disabled) return;
              wizardSidebar.onStepSelect?.(index);
            }}
          >
            <span className="page-shell-wizard-rail">
              <span className="page-shell-wizard-dot">{index < wizardSidebar.activeIndex ? "\u2713" : ""}</span>
              {index < wizardSidebar.steps.length - 1 ? <span className="page-shell-wizard-line" /> : null}
            </span>
            <span className="page-shell-wizard-copy">
              <span className="page-shell-wizard-label">{step.label}</span>
              <span className="page-shell-wizard-text">{step.description}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  ) : null;

  return (
    <WizardSidebarContext.Provider value={wizardContextValue}>
      <PageHeaderContext.Provider value={headerContextValue}>
        <div className="page-grid">
          <NavigationSidebar navigation={navigation} activePath={activePath} variant="pageShell" footer={wizardFooter} />

          <section className="content-card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <h1 className="page-title">{pageHeader?.title ?? title}</h1>
                <p className="page-text">{pageHeader?.subtitle ?? subtitle}</p>
              </div>
              <DevGitBadge />
            </div>
            {children}
          </section>
        </div>
      </PageHeaderContext.Provider>
    </WizardSidebarContext.Provider>
  );
}

