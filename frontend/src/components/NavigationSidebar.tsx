"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  BarChart3,
  ChartNoAxesCombined,
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
  Boxes,
  Factory,
  Percent,
  Settings,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { NavigationItem } from "@/lib/apiShared";

type DashboardNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

type DashboardNavGroup = {
  title: string;
  icon: LucideIcon;
  items: DashboardNavItem[];
};

function buildNavGroups(navigation: NavigationItem[], activePath: string): DashboardNavGroup[] {
  const normalized = navigation.map((item) => ({
    label: item.label,
    href: item.href
  }));

  const byHref = new Map(normalized.map((item) => [item.href, item]));
  const activeNormalized = String(activePath || "/").trim() || "/";

  // Frontend-owned entries that the backend navigation may not contain (yet).
  const fallbackItems = [
    { label: "Break-even analyseren", href: "/break-even" },
    { label: "Scenario analyse", href: "/scenario-analyse" },
    { label: "Omzet & marge", href: "/omzet-en-marge" },
    { label: "Prijsvoorstel maken", href: "/prijsvoorstellen" },
    { label: "Verkoopstrategie", href: "/verkoopstrategie" },
    { label: "Adviesprijzen", href: "/adviesprijzen" },
    { label: "Bieren", href: "/bieren" },
    { label: "Producten en verpakkingen", href: "/producten-verpakking" },
    { label: "Diensten", href: "/diensten" },
    { label: "Kostprijs beheer", href: "/nieuwe-kostprijsberekening" },
    { label: "Vaste kosten (ABC)", href: "/vaste-kosten" },
    { label: "Productie en drivers", href: "/productie" },
    { label: "Tarieven en heffingen", href: "/tarieven-heffingen" },
    { label: "Recept hercalculeren", href: "/recept-hercalculatie" },
    { label: "Inkoopfacturen", href: "/inkoopfacturen" },
    { label: "Instellingen", href: "/instellingen" },
    { label: "Jaar afsluiten", href: "/jaar-afsluiten" },
    { label: "Nieuw jaar voorbereiden", href: "/nieuw-jaar-voorbereiden" },
    { label: "Beheer", href: "/beheer" },
    { label: "Productkoppeling", href: "/beheer/productkoppeling" },
  ];
  for (const item of fallbackItems) {
    if (!byHref.has(item.href)) {
      byHref.set(item.href, item);
    }
  }

  const sectionSpecs: Array<{
    title: string;
    icon: LucideIcon;
    items: Array<{ href: string; label: string }>;
  }> = [
    {
      title: "Analyse",
      icon: ChartNoAxesCombined,
      items: [
        { href: "/break-even", label: "Break-even analyseren" },
        { href: "/scenario-analyse", label: "Scenario analyseren" },
        { href: "/omzet-en-marge", label: "Omzet en marge" },
      ],
    },
    {
      title: "Prijsbeheer",
      icon: Target,
      items: [
        { href: "/prijsvoorstellen", label: "Prijsvoorstel maken" },
        { href: "/verkoopstrategie", label: "Verkoopstrategie" },
        { href: "/adviesprijzen", label: "Adviesprijzen" },
      ],
    },
    {
      title: "Aanbod",
      icon: Boxes,
      items: [
        { href: "/bieren", label: "Bieren" },
        { href: "/producten-verpakking", label: "Producten en verpakkingen" },
        { href: "/diensten", label: "Diensten" },
      ],
    },
    {
      title: "Kostenstructuur",
      icon: Layers3,
      items: [
        { href: "/nieuwe-kostprijsberekening", label: "Kostprijs beheer" },
        { href: "/vaste-kosten", label: "Vaste kosten (ABC)" },
        { href: "/productie", label: "Productie en drivers" },
        { href: "/tarieven-heffingen", label: "Tarieven en heffingen" },
        { href: "/recept-hercalculatie", label: "Recept hercalculeren" },
        { href: "/inkoopfacturen", label: "Inkoopfacturen" },
        { href: "/instellingen", label: "Instellingen" },
      ],
    },
    {
      title: "Beheren",
      icon: Settings,
      items: [
        { href: "/jaar-afsluiten", label: "Jaar afsluiten" },
        { href: "/setup", label: "Setup" },
        { href: "/nieuw-jaar-voorbereiden", label: "Nieuw jaar voorbereiden" },
        { href: "/beheer/productkoppeling", label: "Productkoppeling" },
        { href: "/beheer", label: "Beheer" },
      ],
    },
  ];

  return sectionSpecs.map((section) => {
    const items: DashboardNavItem[] = [];
    for (const spec of section.items) {
      const found = byHref.get(spec.href);
      if (!found) continue;
      const href = found.href;
      items.push({
        ...found,
        label: spec.label,
        active: activeNormalized === href || (href !== "/" && activeNormalized.startsWith(`${href}/`)),
      });
    }
    return { title: section.title, icon: section.icon, items };
  }).filter((group) => group.items.length > 0);
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

  if (key === "/break-even") return Scale;
  if (key === "/scenario-analyse") return GitBranch;
  if (key === "/omzet-en-marge") return TrendingUp;
  if (key === "/prijsvoorstellen") return FileText;
  if (key === "/verkoopstrategie") return Target;
  if (key === "/adviesprijzen") return Tag;
  if (key === "/bieren") return Beer;
  if (key === "/producten-verpakking") return Package;
  if (key === "/diensten") return Briefcase;
  if (key === "/nieuwe-kostprijsberekening") return Coins;
  if (key === "/recept-hercalculatie") return Calculator;
  if (key === "/inkoopfacturen") return Receipt;
  if (key === "/jaar-afsluiten") return CalendarCheck;
  if (key === "/setup") return ListChecks;
  if (key === "/nieuw-jaar-voorbereiden") return ListChecks;
  if (key === "/beheer/productkoppeling") return Package;
  if (key === "/beheer") return SlidersHorizontal;

  // Existing costing/admin routes can still arrive from backend navigation.
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
  const activeNormalized = String(activePath || "/").trim() || "/";

  return (
    <aside className={`dashboard-sidebar${variant === "pageShell" ? " page-shell-sidebar" : ""}`}>
      <div className={`dashboard-brand-block${variant === "pageShell" ? " page-shell-brand" : ""}`}>
        <span className="dashboard-brand-text">BERLEWALDE</span>
        <small className="dashboard-brand-subtitle">CalculatieTool</small>
      </div>

      <nav className="dashboard-sidebar-nav" aria-label="Hoofdnavigatie">
        <Link
          href={"/" as Route}
          className={`dashboard-sidebar-link dashboard-sidebar-overview${activeNormalized === "/" ? " is-active" : ""}`}
          aria-label="Overzicht"
          title="Overzicht"
        >
          <span className="dashboard-sidebar-icon">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="dashboard-sidebar-label">Overzicht</span>
        </Link>
        {groups.map((group, groupIndex) => (
          <div key={`group-${groupIndex}`} className="dashboard-sidebar-group">
            <div className="dashboard-sidebar-group-title">
              <span className="dashboard-sidebar-group-icon">
                <group.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>{group.title}</span>
            </div>
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
                    return Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : <MenuIcon />;
                  })()}
                </span>
                <span className="dashboard-sidebar-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {footer ? <div className="page-shell-wizard-nav">{footer}</div> : null}
    </aside>
  );
}
