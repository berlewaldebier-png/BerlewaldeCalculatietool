import type { Route } from "next";
import Link from "next/link";

import type { NavigationItem } from "@/lib/api";

type SidebarNavProps = {
  items: NavigationItem[];
  activePath?: string;
};

export function SidebarNav({ items, activePath = "/" }: SidebarNavProps) {
  const sections = new Map<string, NavigationItem[]>();

  for (const item of items) {
    const existing = sections.get(item.section) ?? [];
    existing.push(item);
    sections.set(item.section, existing);
  }

  return (
    <aside className="sidebar-card">
      <div className="section-label">Navigatie</div>
      {Array.from(sections.entries()).map(([section, sectionItems]) => (
        <div className="nav-group" key={section}>
          <div className="nav-group-title">{section}</div>
          {sectionItems.map((item) => (
            <Link
              key={item.key}
              href={item.href as Route}
              className={`nav-link${activePath === item.href ? " active" : ""}`}
            >
              <div className="nav-link-label">{item.label}</div>
              <div className="nav-link-text">{item.description}</div>
            </Link>
          ))}
        </div>
      ))}
    </aside>
  );
}
