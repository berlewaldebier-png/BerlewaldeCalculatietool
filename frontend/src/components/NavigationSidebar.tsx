"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  BarChart3,
  FileText,
  Scale,
  GitBranch,
  TrendingUp,
  Package,
  Briefcase,
  Beer,
  Calculator,
  Receipt,
  Target,
  Tag,
  CalendarCheck,
  SlidersHorizontal,
  Coins,
  Layers3,
  Factory,
  Percent,
  Settings,
} from "lucide-react";

import type { NavigationItem } from "@/lib/apiShared";

type DashboardNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

type DashboardNavGroup = {
  title?: string;
  items: DashboardNavItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
};

function buildNavGroups(navigation: NavigationItem[], activePath: string): DashboardNavGroup[] {
  const preferredOrder = [
    "/",
    "/prijsvoorstellen",
    "/break-even-v2",
    "/scenario-analyse",
    "/omzet-en-marge",
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
  const activeNormalized = String(activePath || "/").trim() || "/";

  // Frontend-owned entries that the backend navigation may not contain (yet).
  if (!byHref.has("/prijsvoorstellen")) {
    byHref.set("/prijsvoorstellen", { label: "Prijsvoorstel maken", href: "/prijsvoorstellen" });
  }
  if (!byHref.has("/break-even-v2")) {
    byHref.set("/break-even-v2", { label: "Break-even analyseren", href: "/break-even-v2" });
  }
  if (!byHref.has("/omzet-en-marge")) {
    byHref.set("/omzet-en-marge", { label: "Omzet & marge", href: "/omzet-en-marge" });
  }
  if (!byHref.has("/scenario-analyse")) {
    byHref.set("/scenario-analyse", { label: "Scenario analyse", href: "/scenario-analyse" });
  }
  if (!byHref.has("/producten-verpakking")) {
    byHref.set("/producten-verpakking", { label: "Producten & verpakkingen", href: "/producten-verpakking" });
  }
  if (!byHref.has("/instellingen")) {
    byHref.set("/instellingen", { label: "Instellingen", href: "/instellingen" });
  }
  if (!byHref.has("/diensten")) {
    byHref.set("/diensten", { label: "Diensten", href: "/diensten" });
  }

  // Kostprijs management group (Phase 6.1): keep costing-related flows together.
  const costingOrder = [
    "/nieuwe-kostprijsberekening",
    "/vaste-kosten",
    "/productie",
    "/tarieven-heffingen",
    "/instellingen",
  ];

  const costItems: DashboardNavItem[] = [];
  for (const href of costingOrder) {
    const found = byHref.get(href);
    if (!found) continue;
    const label =
      href === "/nieuwe-kostprijsberekening"
        ? "Kostprijs beheer"
        : href === "/vaste-kosten"
          ? "Vaste kosten (ABC)"
          : href === "/productie"
            ? "Productie en drivers"
            : href === "/tarieven-heffingen"
              ? "Tarieven en heffingen"
              : found.label;
    costItems.push({
      ...found,
      label,
      active: activeNormalized === href || (href !== "/" && activeNormalized.startsWith(`${href}/`)),
    });
  }

  const mainItems: DashboardNavItem[] = [];

  for (const href of preferredOrder) {
    const found = byHref.get(href);
    if (!found) continue;
    mainItems.push({
      ...found,
      active: activeNormalized === href || (href !== "/" && activeNormalized.startsWith(`${href}/`))
    });
  }

  // Fallback: ensure overview is always present.
  if (!mainItems.some((item) => item.href === "/")) {
    mainItems.unshift({ label: "Overzicht", href: "/", active: activeNormalized === "/" });
  }

  const groups: DashboardNavGroup[] = [];
  groups.push({ items: mainItems });

  const productsItems: DashboardNavItem[] = [];
  for (const href of ["/producten-verpakking", "/diensten"]) {
    const found = byHref.get(href);
    if (!found) continue;
    const label =
      href === "/producten-verpakking"
        ? "Producten & verpakkingen"
        : href === "/diensten"
          ? "Diensten"
          : found.label;
    productsItems.push({
      ...found,
      label,
      active: activeNormalized === href || (href !== "/" && activeNormalized.startsWith(`${href}/`)),
    });
  }
  if (productsItems.length > 0) {
    groups.push({ title: "Producten & diensten \u25BC", items: productsItems, collapsible: true, defaultOpen: true });
  }
  if (costItems.length > 0) {
    groups.push({ title: "Kostprijs management \u25BC", items: costItems, collapsible: true, defaultOpen: true });
  }
  return groups;
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

function getNavIcon(href: string) {
  const key = String(href || "").trim() || "/";

  // Main nav
  if (key === "/") return BarChart3;
  if (key === "/prijsvoorstellen") return FileText;
  if (key === "/break-even-v2") return Scale;
  if (key === "/scenario-analyse") return GitBranch;
  if (key === "/omzet-en-marge") return TrendingUp;
  if (key === "/producten-verpakking") return Package;
  if (key === "/diensten") return Briefcase;
  if (key === "/bieren") return Beer;
  if (key === "/recept-hercalculatie") return Calculator;
  if (key === "/inkoopfacturen") return Receipt;
  if (key === "/verkoopstrategie") return Target;
  if (key === "/adviesprijzen") return Tag;
  if (key === "/nieuw-jaar-voorbereiden") return CalendarCheck;
  if (key === "/beheer") return SlidersHorizontal;

  // Kostprijs management
  if (key === "/nieuwe-kostprijsberekening") return Coins;
  if (key === "/vaste-kosten") return Layers3;
  if (key === "/productie") return Factory;
  if (key === "/tarieven-heffingen") return Percent;
  if (key === "/instellingen") return Settings;

  return null;
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
  const groups = useMemo(() => buildNavGroups(navigation, activePath), [navigation, activePath]);

  return (
    <aside className={`dashboard-sidebar${variant === "pageShell" ? " page-shell-sidebar" : ""}`}>
      <div className={`dashboard-brand-block${variant === "pageShell" ? " page-shell-brand" : ""}`}>
        <span className="dashboard-brand-text">BERLEWALDE</span>
        <small className="dashboard-brand-subtitle">CalculatieTool</small>
      </div>

      <nav className="dashboard-sidebar-nav" aria-label="Hoofdnavigatie">
        {groups.map((group, groupIndex) => (
          <div key={`group-${groupIndex}`} className="dashboard-sidebar-group">
            {group.title && group.collapsible ? (
              <details className="dashboard-sidebar-group-details" open={group.defaultOpen}>
                <summary className="dashboard-sidebar-group-title">{group.title}</summary>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    className={`dashboard-sidebar-link${item.active ? " is-active" : ""}`}
                    aria-label={item.label}
                    title={item.label}
                  >
                    <span className="dashboard-sidebar-icon">
                      {(() => {
                        const Icon = getNavIcon(item.href);
                        return Icon ? <Icon className="h-5 w-5" /> : <MenuIcon />;
                      })()}
                    </span>
                    <span className="dashboard-sidebar-label">{item.label}</span>
                  </Link>
                ))}
              </details>
            ) : (
              <>
                {group.title ? <div className="dashboard-sidebar-group-title">{group.title}</div> : null}
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    className={`dashboard-sidebar-link${item.active ? " is-active" : ""}`}
                    aria-label={item.label}
                    title={item.label}
                  >
                    <span className="dashboard-sidebar-icon">
                      {(() => {
                        const Icon = getNavIcon(item.href);
                        return Icon ? <Icon className="h-5 w-5" /> : <MenuIcon />;
                      })()}
                    </span>
                    <span className="dashboard-sidebar-label">{item.label}</span>
                  </Link>
                ))}
              </>
            )}
          </div>
        ))}
      </nav>

      {footer ? <div className="page-shell-wizard-nav">{footer}</div> : null}
    </aside>
  );
}
