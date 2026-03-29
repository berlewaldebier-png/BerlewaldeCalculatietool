import type { ReactNode } from "react";

import { SidebarNav } from "@/components/SidebarNav";
import type { NavigationItem } from "@/lib/api";

type PageShellProps = {
  title: string;
  subtitle: string;
  activePath: string;
  navigation: NavigationItem[];
  children: ReactNode;
};

export function PageShell({
  title,
  subtitle,
  activePath,
  navigation,
  children
}: PageShellProps) {
  return (
    <div className="page-grid">
      <SidebarNav items={navigation} activePath={activePath} />
      <section className="content-card">
        <h1 className="page-title">{title}</h1>
        <p className="page-text">{subtitle}</p>
        {children}
      </section>
    </div>
  );
}
