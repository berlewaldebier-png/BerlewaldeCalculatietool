"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { fetchMe } from "@/lib/auth";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
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

      if (!authenticated && pathname !== "/login") {
        const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
        window.location.replace(`/login${next}`);
        return;
      }

      if (authenticated && pathname === "/login") {
        router.replace("/");
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

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

  if (!isAuthenticated && pathname !== "/login") {
    return null;
  }

  return <>{children}</>;
}
