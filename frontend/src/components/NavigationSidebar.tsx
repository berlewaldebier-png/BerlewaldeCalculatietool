"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo } from "react";

import type { NavigationItem } from "@/lib/apiShared";

type DashboardNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

function buildNavItems(navigation: NavigationItem[], activePath: string): DashboardNavItem[] {
  const preferredOrder = [
    "/",
    "/nieuwe-kostprijsberekening",
    "/prijsvoorstellen",
    "/break-even",
    "/omzet-en-marge",
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

  const byHref = new Map(normalized.map((item) => [item.href, item]));

  // Frontend-owned entries that the backend navigation may not contain (yet).
  if (!byHref.has("/prijsvoorstellen")) {
    byHref.set("/prijsvoorstellen", { label: "Prijsvoorstel maken", href: "/prijsvoorstellen" });
  }
  if (!byHref.has("/break-even")) {
    byHref.set("/break-even", { label: "Break-even analyseren", href: "/break-even" });
  }
  if (!byHref.has("/omzet-en-marge")) {
    byHref.set("/omzet-en-marge", { label: "Omzet & marge", href: "/omzet-en-marge" });
  }

  const result: DashboardNavItem[] = [];
  const activeNormalized = String(activePath || "/").trim() || "/";

  for (const href of preferredOrder) {
    const found = byHref.get(href);
    if (!found) continue;
    result.push({
      ...found,
      active: activeNormalized === href || (href !== "/" && activeNormalized.startsWith(`${href}/`))
    });
  }

  // Fallback: ensure overview is always present.
  if (!result.some((item) => item.href === "/")) {
    result.unshift({ label: "Overzicht", href: "/", active: activeNormalized === "/" });
  }

  return result;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 17h14" />
    </svg>
  );
}

export function NavigationSidebar({
  navigation,
  activePath,
  variant = "default",
  footer
}: {
  navigation: NavigationItem[];
  activePath: string;
  variant?: "default" | "pageShell";
  footer?: ReactNode;
}) {
  const items = useMemo(() => buildNavItems(navigation, activePath), [navigation, activePath]);

  return (
    <aside className={`dashboard-sidebar${variant === "pageShell" ? " page-shell-sidebar" : ""}`}>
      <div className={`dashboard-brand-block${variant === "pageShell" ? " page-shell-brand" : ""}`}>
        <span className="dashboard-brand-text">BERLEWALDE</span>
        <small className="dashboard-brand-subtitle">CalculatieTool</small>
      </div>

      <nav className="dashboard-sidebar-nav" aria-label="Hoofdnavigatie">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className={`dashboard-sidebar-link${item.active ? " is-active" : ""}`}
            aria-label={item.label}
            title={item.label}
          >
            <span className="dashboard-sidebar-icon">
              <MenuIcon />
            </span>
            <span className="dashboard-sidebar-label">{item.label}</span>
          </Link>
        ))}
      </nav>

      {footer ? <div className="page-shell-wizard-nav">{footer}</div> : null}
    </aside>
  );
}
