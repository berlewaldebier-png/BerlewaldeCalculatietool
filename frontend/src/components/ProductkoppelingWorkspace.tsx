import { useEffect, useState } from "react";

import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";

type Tab = "mappings" | "unmapped";

export function ProductkoppelingWorkspace({
  initialFilter = "",
  initialSkuId = "",
  initialTab = "mappings",
}: {
  initialFilter?: string;
  initialSkuId?: string;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab === "unmapped" ? "unmapped" : "mappings");

  useEffect(() => {
    setTab(initialTab === "unmapped" ? "unmapped" : "mappings");
  }, [initialTab]);

  return (
    <div>
      <div className="editor-actions" style={{ marginTop: 0 }}>
        <div className="editor-actions-group">
          <button
            type="button"
            className={`editor-button${tab === "mappings" ? "" : " editor-button-secondary"}`}
            onClick={() => setTab("mappings")}
          >
            Productkoppelingen
          </button>
          <button
            type="button"
            className={`editor-button${tab === "unmapped" ? "" : " editor-button-secondary"}`}
            onClick={() => setTab("unmapped")}
          >
            Ongekoppelde regels
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {tab === "mappings" ? (
          <DouanoProductMappingCard initialFilter={initialFilter} initialSkuId={initialSkuId} />
        ) : (
          <DouanoUnmappedRulesCard />
        )}
      </div>
    </div>
  );
}
