"use client";

import React from "react";

import { EmptyHint } from "@/components/offerte-samenstellen/forms/FormControls";

type ProductLike = {
  optionId: string;
  label?: string;
  name?: string;
  meta?: string;
};

export function ProductScopeChecklist({
  products,
  selectedRefs,
  onChange,
  emptyHint,
  maxHeight = 260,
}: {
  products: ProductLike[];
  selectedRefs: string[];
  onChange: (nextRefs: string[]) => void;
  emptyHint: string;
  maxHeight?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.12)",
        borderRadius: 12,
        background: "white",
        padding: 10,
      }}
    >
      {products.length === 0 ? (
        <EmptyHint text={emptyHint} />
      ) : (
        <div
          style={{
            maxHeight,
            overflow: "auto",
            paddingRight: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {products.map((product) => {
            const label = String(product.label ?? product.name ?? "").trim();
            const checked = selectedRefs.includes(product.optionId);
            return (
              <label
                key={product.optionId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: checked ? "rgba(59,130,246,0.08)" : "transparent",
                  border: checked
                    ? "1px solid rgba(59,130,246,0.25)"
                    : "1px solid rgba(15,23,42,0.08)",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextRefs = event.target.checked
                      ? Array.from(new Set([...selectedRefs, product.optionId]))
                      : selectedRefs.filter((ref) => ref !== product.optionId);
                    onChange(nextRefs);
                  }}
                />
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontWeight: 700 }}>{label || product.optionId}</div>
                  {product.meta ? (
                    <div style={{ opacity: 0.7, fontSize: 12 }}>{String(product.meta)}</div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
