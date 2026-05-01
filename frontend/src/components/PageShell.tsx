"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { NavigationItem } from "@/lib/apiShared";
import { DevGitBadge } from "@/components/DevGitBadge";
import { NavigationSidebar } from "@/components/NavigationSidebar";
import { WizardSteps } from "@/components/WizardSteps";

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

  const wizardSteps = wizardSidebar
    ? wizardSidebar.steps.map((step) => ({
        id: step.id,
        title: step.label,
        description: step.description,
        disabled: step.disabled
      }))
    : [];

  return (
    <WizardSidebarContext.Provider value={wizardContextValue}>
      <PageHeaderContext.Provider value={headerContextValue}>
        <div className={wizardSidebar ? "page-shell-grid page-shell-grid-wizard" : "page-grid"}>
          <NavigationSidebar navigation={navigation} activePath={activePath} variant="pageShell" />

          {wizardSidebar ? (
            <aside className="dashboard-sidebar page-shell-wizard-panel" aria-label="Wizard stappen">
              <WizardSteps
                title={wizardSidebar.title}
                steps={wizardSteps}
                activeIndex={wizardSidebar.activeIndex}
                onSelect={(index) => {
                  const next = wizardSidebar.steps[index];
                  if (!next || next.disabled) return;
                  wizardSidebar.onStepSelect?.(index);
                }}
              />
            </aside>
          ) : null}

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

