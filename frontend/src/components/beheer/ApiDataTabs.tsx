"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabKey = "api" | "data";

export function ApiDataTabs({ api, data }: { api: ReactNode; data: ReactNode }) {
  const [active, setActive] = useState<TabKey>("api");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "").toLowerCase();
    if (hash === "data" || hash === "api") {
      setActive(hash);
    }
  }, []);

  function select(tab: TabKey) {
    setActive(tab);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${tab}`);
  }

  return (
    <div>
      <div className="tab-row" role="tablist" aria-label="Beheer tabs" style={{ marginTop: 14 }}>
        <button
          type="button"
          className={`tab-button ${active === "api" ? "active" : ""}`}
          onClick={() => select("api")}
          role="tab"
          aria-selected={active === "api"}
        >
          API
        </button>
        <button
          type="button"
          className={`tab-button ${active === "data" ? "active" : ""}`}
          onClick={() => select("data")}
          role="tab"
          aria-selected={active === "data"}
        >
          Data
        </button>
        <div className="tab-spacer" />
      </div>
      <div role="tabpanel" className="beheer-tab-panel">
        {active === "api" ? api : data}
      </div>
    </div>
  );
}
