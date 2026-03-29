"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { clearAuthSession, readAuthSession, type AuthSession } from "@/lib/auth";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    const sync = () => setSession(readAuthSession());
    sync();
    window.addEventListener("calculatietool-auth-changed", sync);
    return () => window.removeEventListener("calculatietool-auth-changed", sync);
  }, []);

  const isLoginPage = pathname === "/login";
  const isDashboardHome = pathname === "/";

  if (isDashboardHome) {
    return null;
  }

  return (
    <header className="app-header">
      <div>
        <div className="app-brand">Berlewalde CalculatieTool</div>
        <div className="app-tagline">
          Nieuwe webinterface met behoud van bestaande Python-berekeningen
        </div>
      </div>
      {!isLoginPage && session ? (
        <div className="app-header-actions">
          <div className="app-user-welcome">
            <span>Welkom,</span>
            <strong>{session.display_name}</strong>
          </div>
          <button
            type="button"
            className="header-icon-button"
            aria-label="Uitloggen"
            title="Uitloggen"
            onClick={() => {
              clearAuthSession();
              router.replace("/login");
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 16l4-4-4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18 12H9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ) : null}
    </header>
  );
}
