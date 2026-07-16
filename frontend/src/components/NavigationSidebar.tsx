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
  AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { NavigationItem } from "@/lib/apiShared";
import {
  buildNavigationProjection,
  type SidebarSectionTitle,
} from "@/components/navigation/navigationProjection";

const SECTION_ICONS: Record<SidebarSectionTitle, LucideIcon> = {
  Analyse: ChartNoAxesCombined,
  Prijsbeheer: Target,
  Aanbod: Boxes,
  Kostenstructuur: Layers3,
  Beheren: Settings,
};

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
  if (key === "/incidentele-kosten") return AlertTriangle;
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
  const groups = useMemo(
    () => buildNavigationProjection(navigation, activePath).map((group) => ({
      ...group,
      icon: SECTION_ICONS[group.title],
    })),
    [navigation, activePath]
  );
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
