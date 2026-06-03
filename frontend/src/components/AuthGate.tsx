"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { fetchMe } from "@/lib/auth";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const session = await fetchMe();
      if (cancelled) {
        return;
      }

      const authenticated = Boolean(session);
      setIsAuthenticated(authenticated);
      setIsReady(true);

      if (!authenticated) {
        const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
        window.location.replace(`/login${next}`);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!isReady) {
    return (
      <main className="app-main">
        <div className="auth-loading-card">
          <div className="page-title">Beveiligde omgeving laden</div>
          <p className="page-text">De sessie wordt gecontroleerd.</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
