"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  Calculator,
  ChevronDown,
  ChevronRight,
  Coins,
  Headphones,
  Home,
  LogOut,
  PlugZap,
  Sparkles,
  UserRound,
  Users
} from "lucide-react";

import {
  fetchMe,
  hasCapability,
  logout,
  type AuthCapability,
  type AuthSession
} from "@/lib/auth";
import { SmartGlobalSearch } from "@/components/SmartGlobalSearch";
import { loadApplicationSettings } from "@/components/instellingen/applicationSettingsApi";
import { ApiRequestError } from "@/lib/apiClient";

type Crumb = {
  label: string;
  href?: string;
};

type AccountMenuItem = {
  label: string;
  description: string;
  href: string;
  icon: typeof Bell;
  capability?: AuthCapability;
};

const settingsItems: AccountMenuItem[] = [
  { label: "Mijn account", description: "Profiel, wachtwoord, 2FA", href: "/account", icon: UserRound },
  {
    label: "Bedrijfsinstellingen",
    description: "Bedrijfsgegevens, BTW, valuta",
    href: "/instellingen/bedrijf",
    icon: Building2,
    capability: "calculation-settings:manage"
  },
  {
    label: "Calculatie instellingen",
    description: "Formules, staffels, defaults",
    href: "/instellingen",
    icon: Calculator,
    capability: "calculation-settings:manage"
  },
  {
    label: "Kostprijsbeheer",
    description: "Categorieen, overhead, ABC-kosten",
    href: "/instellingen/kostprijsbeheer",
    icon: Coins,
    capability: "costs:view"
  },
  {
    label: "Team & rechten",
    description: "Gebruikers, rollen, rechtenmatrix",
    href: "/beheer/users",
    icon: Users,
    capability: "users:view"
  },
  {
    label: "Datakwaliteit",
    description: "Douano, LOTs, koppelingen, margechecks",
    href: "/beheer/api",
    icon: PlugZap,
    capability: "douano:sync"
  }
];

const moreItems: AccountMenuItem[] = [
  { label: "Meldingen", description: "E-mail, alerts en waarschuwingen", href: "/instellingen/meldingen", icon: Bell },
  { label: "Helpcentrum", description: "Handleidingen en veelgestelde vragen", href: "/beheer/handleiding", icon: BookOpen },
  { label: "Nieuw in Berlewalde", description: "Bekijk updates en verbeteringen", href: "/changelog", icon: Sparkles },
  { label: "Support", description: "Neem contact op of meld een probleem", href: "/support", icon: Headphones }
];

function titleForSegment(segment: string): string {
  const normalized = segment.trim();
  if (!normalized) return "";

  const map: Record<string, string> = {
    "break-even": "Break-even",
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
    "recept-hercalculatie": "Brouwmoment",
    beheer: "Beheer",
    users: "Gebruikers",
    devtools: "Devtools",
    handleiding: "Handleiding",
    api: "Datakwaliteit",
    deployment: "Deployment",
    jaarsets: "Jaarsets",
    productclassificatie: "Productclassificatie",
    productkoppeling: "Productkoppeling",
    account: "Mijn account",
    bedrijf: "Bedrijfsinstellingen",
    meldingen: "Meldingen",
    kostprijsbeheer: "Kostprijsbeheer",
    changelog: "Nieuw in Berlewalde",
    support: "Support"
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
  const [companyName, setCompanyName] = useState("Berlewalde Brouwerij");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const syncSettings = () => {
      void loadApplicationSettings()
        .then((payload) => {
          if (cancelled) return;
          const nextCompanyName = String(payload.company_name || "").trim();
          if (nextCompanyName) {
            setCompanyName(nextCompanyName);
          }
        })
        .catch((error) => {
          if (!cancelled && !(error instanceof ApiRequestError && error.category === "http")) {
            setCompanyName("Berlewalde Brouwerij");
          }
        });
    };

    syncSettings();
    window.addEventListener("calculatietool-settings-changed", syncSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("calculatietool-settings-changed", syncSettings);
    };
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && accountMenuRef.current?.contains(target)) {
        return;
      }
      setAccountMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  const isLoginPage = pathname === "/login";
  const crumbs = useMemo(() => buildBreadcrumb(pathname), [pathname]);
  const displayName = session?.display_name || "Beheerder";
  const role = String(session?.role || "").toLowerCase();
  const visibleSettingsItems = settingsItems.filter(
    (item) => !item.capability || hasCapability(session, item.capability)
  );
  const roleLabel =
    ({
      admin: "Administrator",
      management: "Management",
      brewer: "Brouwer",
      sales: "Sales",
      user: "Gebruiker"
    }[role] ?? role) || "Gebruiker";

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
          <nav className="dashboard-header__crumbs" aria-label="Breadcrumb">
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

          <SmartGlobalSearch />

          <div className="dashboard-header__actions">
            <button
              type="button"
              className="dashboard-header__icon-button dashboard-header__icon-button--bell"
              aria-label="Meldingen"
              onClick={() => router.push("/instellingen/meldingen" as any)}
            >
              <Bell size={18} aria-hidden="true" />
              <span className="dashboard-header__badge" aria-hidden="true">
                3
              </span>
            </button>

            <div className="dashboard-header__divider" aria-hidden="true" />

            <div className="dashboard-header__account" ref={accountMenuRef}>
              <button
                type="button"
                className="dashboard-header__account-button"
                aria-label="Accountmenu openen"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                onClick={() => setAccountMenuOpen((current) => !current)}
              >
                <div className="dashboard-header__avatar" aria-hidden="true">
                  {initialsForDisplayName(displayName)}
                </div>

                <div className="dashboard-header__user-meta">
                  <div className="dashboard-header__user-name">{displayName}</div>
                  <div className="dashboard-header__user-subtitle">
                    {roleLabel} &bull; {companyName}
                  </div>
                </div>

                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={accountMenuOpen ? "dashboard-header__account-chevron is-open" : "dashboard-header__account-chevron"}
                />
              </button>

              {accountMenuOpen ? (
                <div className="account-menu" role="menu" aria-label="Account en instellingen">
                  <div className="account-menu__profile">
                    <div className="account-menu__avatar" aria-hidden="true">
                      {initialsForDisplayName(displayName)}
                    </div>
                    <div className="account-menu__profile-text">
                      <strong>{displayName}</strong>
                      <span>
                        {roleLabel} &bull; {companyName}
                      </span>
                      <small>{session?.username || "gebruiker"}</small>
                    </div>
                  </div>

                  <div className="account-menu__section-label">Instellingen</div>
                  <div className="account-menu__tiles">
                    {visibleSettingsItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href as any}
                          className="account-menu__tile"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                        >
                          <span className="account-menu__tile-icon" aria-hidden="true">
                            <Icon size={22} />
                          </span>
                          <span className="account-menu__tile-copy">
                            <strong>{item.label}</strong>
                            <small>{item.description}</small>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>

                  <div className="account-menu__section-label">Meer</div>
                  <div className="account-menu__list">
                    {moreItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href as any}
                          className="account-menu__row"
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                        >
                          <Icon size={20} aria-hidden="true" />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.description}</small>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="account-menu__row account-menu__logout"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void logout().finally(() => {
                        router.replace("/login");
                      });
                    }}
                  >
                    <LogOut size={20} aria-hidden="true" />
                    <span>
                      <strong>Uitloggen</strong>
                      <small>Veilig uitloggen uit jouw account</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <div className="dashboard-header__version" aria-label="Versie">
        versie 0,1
      </div>
    </header>
  );
}
