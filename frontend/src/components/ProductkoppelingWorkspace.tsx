"use client";

import { useEffect, useState } from "react";

import { DouanoProductMappingCard } from "@/components/DouanoProductMappingCard";
import { DouanoUnmappedRulesCard } from "@/components/DouanoUnmappedRulesCard";

type Tab = "mappings" | "unmapped";

export function ProductkoppelingWorkspace({
  initialFilter = "",
  initialSkuId = "",
  initialTab = "mappings",
  initialUnmappedBasis = "invoice",
  initialUnmappedYear,
  initialUnmappedMatchType,
  initialUnmappedLineDescription,
}: {
  initialFilter?: string;
  initialSkuId?: string;
  initialTab?: Tab;
  initialUnmappedBasis?: "invoice" | "order";
  initialUnmappedYear?: number;
  initialUnmappedMatchType?: "douano_product_id" | "product0_description";
  initialUnmappedLineDescription?: string;
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
          <DouanoUnmappedRulesCard
            initialBasis={initialUnmappedBasis}
            initialYear={initialUnmappedYear}
            initialMatchType={initialUnmappedMatchType}
            initialLineDescription={initialUnmappedLineDescription}
          />
        )}
      </div>
    </div>
  );
}
