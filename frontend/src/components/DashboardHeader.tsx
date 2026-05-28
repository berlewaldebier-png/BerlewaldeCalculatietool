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
  Plus,
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
    <header className="w-full bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-4 flex items-center justify-between gap-6">
      <div className="flex items-center gap-3 min-w-fit">
        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
          <Image
            src="/brand/berlewalde.png"
            alt="Berlewalde"
            width={40}
            height={40}
            className="w-10 h-10 object-cover"
            priority
          />
        </div>

        <div>
          <h1 className="text-sm font-bold tracking-widest text-slate-900">BERLEWALDE</h1>
          <p className="text-xs text-slate-500">CalculatieTool</p>
        </div>
      </div>

      {!isLoginPage ? (
        <>
          <nav
            className="hidden lg:flex items-center gap-3 text-sm text-slate-500"
            aria-label="Breadcrumb"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
              <Home size={16} />
            </div>
            <ChevronRight size={14} aria-hidden="true" />

            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-3">
                {index === 0 ? null : <ChevronRight size={14} aria-hidden="true" />}
                {crumb.href ? (
                  <Link href={crumb.href as any} className="hover:text-slate-700 transition">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-blue-600 font-medium">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>

          <div className="flex-1 max-w-md relative hidden md:block">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Zoek orders, klanten, producten..."
              className="w-full h-11 pl-11 pr-14 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
              ⌘ K
            </span>
          </div>

          <div className="flex items-center gap-3 min-w-fit">
            <button
              type="button"
              className="h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-semibold flex items-center gap-2 shadow-sm hover:bg-blue-700 transition"
              onClick={() => {
                router.push("/nieuwe-kostprijsberekening?mode=wizard-new" as any);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              Nieuwe calculatie
            </button>

            <button
              type="button"
              className="relative w-11 h-11 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition"
              aria-label="Meldingen"
            >
              <Bell size={18} aria-hidden="true" />
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                3
              </span>
            </button>

            <button
              type="button"
              className="w-11 h-11 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition"
              aria-label="Instellingen"
              onClick={() => {
                router.push("/beheer" as any);
              }}
            >
              <Settings size={18} aria-hidden="true" />
            </button>

            <div className="h-9 w-px bg-slate-200 mx-1" />

            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                {initialsForDisplayName(session?.display_name ?? "Berlewalde")}
              </div>

              <div className="hidden xl:block">
                <p className="text-sm font-semibold text-slate-900">
                  {session?.display_name ?? "Berle"}
                </p>
                <p className="text-xs text-slate-500">
                  {(session?.role ? `${session.role} • ` : "") + "Berlewalde"}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="h-11 px-4 rounded-xl text-slate-600 hover:bg-slate-50 flex items-center gap-2 text-sm transition"
              onClick={() => {
                void logout().finally(() => {
                  router.replace("/login");
                });
              }}
              aria-label="Uitloggen"
            >
              <LogOut size={17} aria-hidden="true" />
              <span className="hidden xl:inline">Uitloggen</span>
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
}
