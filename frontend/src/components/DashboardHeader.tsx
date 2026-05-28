"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Search,
  Settings
} from "lucide-react";

import { fetchMe, logout, type AuthSession } from "@/lib/auth";

type Crumb = {
  label: string;
  href?: string;
};

function titleForSegment(segment: string): string {
  const normalized = segment.trim();
  if (!normalized) return "";

  const map: Record<string, string> = {
    "break-even-v2": "Break-even",
    "nieuwe-kostprijsberekening": "Kostprijs beheren",
    "kostprijs-activatie": "Kostprijs activeren",
    prijsvoorstellen: "Prijsvoorstellen",
    "offerte-samenstellen": "Offerte samenstellen",
    "nieuw-jaar-voorbereiden": "Nieuw jaar voorbereiden",
    "omzet-en-marge": "Omzet & marge",
    adviesprijzen: "Adviesprijzen",
    "product-samenstellen": "Product samenstellen",
    "producten-verpakking": "Verpakking beheren",
    productie: "Productie",
    "vaste-kosten": "Vaste kosten",
    inkoopfacturen: "Inkoopfacturen",
    "recept-hercalculatie": "Recept hercalculatie",
    beheer: "Beheer",
    users: "Gebruikers",
    devtools: "Devtools",
    handleiding: "Handleiding",
    api: "API",
    deployment: "Deployment",
    jaarsets: "Jaarsets",
    productclassificatie: "Productclassificatie",
    productkoppeling: "Productkoppeling"
  };

  if (map[normalized]) return map[normalized];

  const decoded = decodeURIComponent(normalized);
  return decoded.replace(/[-_]+/g, " ");
}

function buildBreadcrumb(pathname: string): Crumb[] {
  const cleanPath = pathname.split("?")[0].split("#")[0];
  if (!cleanPath || cleanPath === "/") {
    return [
      { label: "Dashboard", href: "/" },
      { label: "Overzicht" }
    ];
  }

  const segments = cleanPath.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "Dashboard", href: "/" }];

  let cursor = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    cursor += `/${segment}`;
    const label = titleForSegment(segment);
    const isLast = i === segments.length - 1;
    crumbs.push({ label, href: isLast ? undefined : cursor });
  }

  return crumbs;
}

function initialsForDisplayName(displayName: string): string {
  const parts = displayName
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "B";
  const second = parts[1]?.[0] ?? (parts[0]?.[1] ?? "E");
  return `${first}${second}`.toUpperCase();
}

export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void fetchMe().then((next) => {
        if (cancelled) return;
        setSession(next);
      });
    };

    sync();
    window.addEventListener("calculatietool-auth-changed", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("calculatietool-auth-changed", sync);
    };
  }, []);

  const isLoginPage = pathname === "/login";
  const crumbs = useMemo(() => buildBreadcrumb(pathname), [pathname]);

  return (
    <header className="dashboard-header">
      <div className="dashboard-header__brand">
        <div className="dashboard-header__logo">
          <Image
            src="/brand/berlewalde.png"
            alt="Berlewalde"
            width={40}
            height={40}
            className="dashboard-header__logo-image"
            priority
          />
        </div>

        <div className="dashboard-header__brand-text">
          <div className="dashboard-header__brand-title">BERLEWALDE</div>
          <div className="dashboard-header__brand-subtitle">CalculatieTool</div>
        </div>
      </div>

      {!isLoginPage ? (
        <>
          <nav
            className="dashboard-header__crumbs"
            aria-label="Breadcrumb"
          >
            <span className="dashboard-header__crumbs-home" aria-hidden="true">
              <Home size={16} />
            </span>

            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="dashboard-header__crumb">
                {index === 0 ? null : <ChevronRight size={14} aria-hidden="true" />}
                {crumb.href ? (
                  <Link href={crumb.href as any} className="dashboard-header__crumb-link">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="dashboard-header__crumb-current">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>

          <div className="dashboard-header__search">
            <Search
              size={18}
              className="dashboard-header__search-icon"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Zoek orders, klanten, producten..."
              className="dashboard-header__search-input"
            />
            <span className="dashboard-header__search-kbd" aria-hidden="true">
              ⌘ K
            </span>
          </div>

          <div className="dashboard-header__actions">
            <button
              type="button"
              className="dashboard-header__icon-button dashboard-header__icon-button--bell"
              aria-label="Meldingen"
            >
              <Bell size={18} aria-hidden="true" />
              <span className="dashboard-header__badge" aria-hidden="true">
                3
              </span>
            </button>

            <button
              type="button"
              className="dashboard-header__icon-button"
              aria-label="Instellingen"
              onClick={() => {
                router.push("/beheer" as any);
              }}
            >
              <Settings size={18} aria-hidden="true" />
            </button>

            <div className="dashboard-header__divider" aria-hidden="true" />

            <div className="dashboard-header__user">
              <div className="dashboard-header__avatar" aria-hidden="true">
                {initialsForDisplayName(session?.display_name ?? "Berlewalde")}
              </div>

              <div className="dashboard-header__user-meta">
                <div className="dashboard-header__user-name">{session?.display_name ?? "Berle"}</div>
                <div className="dashboard-header__user-subtitle">
                  {(session?.role ? `${session.role} • ` : "") + "Berlewalde"}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="dashboard-header__logout"
              onClick={() => {
                void logout().finally(() => {
                  router.replace("/login");
                });
              }}
              aria-label="Uitloggen"
            >
              <LogOut size={17} aria-hidden="true" />
              <span className="dashboard-header__logout-text">Uitloggen</span>
            </button>
          </div>
        </>
      ) : null}

      <div className="dashboard-header__version" aria-label="Versie">
        versie 0,1
      </div>
    </header>
  );
}
