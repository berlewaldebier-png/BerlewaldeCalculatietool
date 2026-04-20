"use client";

import type { ReactNode } from "react";

type QuoteToolbarGroup = {
  title: string;
  items: Array<{
    key: string;
    label: string;
    title?: string;
    disabled?: boolean;
    onClick: () => void;
    icon: ReactNode;
  }>;
};

export function QuoteBuilderToolbar({
  groups
}: {
  groups: QuoteToolbarGroup[];
}) {
  return (
    <div className="quote-toolbar-card" aria-label="Bouwblokken toolbar">
      <div className="quote-toolbar-row">
        {groups.map((group) => (
          <div key={group.title} className="quote-toolbar-group">
            <span className="quote-toolbar-label">{group.title}</span>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="quote-toolbar-icon"
                onClick={item.onClick}
                disabled={Boolean(item.disabled)}
                aria-label={item.label}
                title={item.title ?? item.label}
              >
                {item.icon}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ToolbarIcon({ children }: { children: ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{children}</span>;
}

export function IconClock() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15v-4" />
      <path d="M12 15V9" />
      <path d="M16 15V7" />
    </svg>
  );
}

export function IconGift() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11h16v9H4z" />
      <path d="M12 11v9" />
      <path d="M4 11V7h16v4" />
      <path d="M12 7c-1.8 0-3-1.1-3-2.5S10.2 2 12 4c1.8-2 3-0.9 3 0.5S13.8 7 12 7z" />
    </svg>
  );
}

export function IconPercent() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 18L18 6" />
      <circle cx="8" cy="8" r="1.8" />
      <circle cx="16" cy="16" r="1.8" />
    </svg>
  );
}

export function IconTruck() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </svg>
  );
}

export function IconSparkle() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l1.2 4.3L18 9l-4.8 1.7L12 15l-1.2-4.3L6 9l4.8-1.7z" />
      <path d="M4 15l0.8 2.6L8 19l-3.2 1.4L4 23l-0.8-2.6L0 19l3.2-1.4z" />
    </svg>
  );
}

