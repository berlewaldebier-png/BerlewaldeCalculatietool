"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCentralSkuIndex } from "@/features/sku/useCentralSkuIndex";
import { moneyEUR, type GenericRecord } from "@/features/sku/adapters/common";
import {
  toSellableTableRows,
  type PricingMethod,
  type SellableSubtype,
} from "@/features/sku/adapters/toSellablesTableRows";

function subtypeLabel(value: SellableSubtype) {
  if (value === "bier") return "Bier";
  if (value === "dienst") return "Dienst";
  return "Product";
}

function methodLabel(value: PricingMethod) {
  return value === "manual_rate" ? "Tarief" : "Kostprijs";
}

export function VerkoopbareArtikelenWorkspace({
  year,
  channels,
  verkoopprijzen,
  skus,
  articles,
  kostprijsversies,
  kostprijsproductactiveringen,
}: {
  year: number;
  channels: GenericRecord[];
  verkoopprijzen: GenericRecord[];
  skus: GenericRecord[];
  articles: GenericRecord[];
  kostprijsversies: GenericRecord[];
  kostprijsproductactiveringen: GenericRecord[];
}) {
  const [query, setQuery] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  const central = useCentralSkuIndex({
    year,
    channels: Array.isArray(channels) ? channels : [],
    verkoopprijzen: Array.isArray(verkoopprijzen) ? verkoopprijzen : [],
    skus: Array.isArray(skus) ? skus : [],
    articles: Array.isArray(articles) ? articles : [],
    kostprijsversies: Array.isArray(kostprijsversies) ? kostprijsversies : [],
    kostprijsproductactiveringen: Array.isArray(kostprijsproductactiveringen) ? kostprijsproductactiveringen : [],
  });

  const rows = useMemo(() => {
    return toSellableTableRows(central.rows);
  }, [central.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (showOnlyMissing) {
        if (row.pricingMethod === "manual_rate") return row.manualRateEx <= 0;
        return !row.hasActiveCost;
      }
      if (!q) return true;
      return (
        row.label.toLowerCase().includes(q) ||
        row.skuId.toLowerCase().includes(q) ||
        subtypeLabel(row.subtype).toLowerCase().includes(q)
      );
    });
  }, [rows, query, showOnlyMissing]);

  return (
    <section className="module-card">
      <div className="module-card-header">
        <div className="module-card-title">Verkoopbare artikelen</div>
        <div className="module-card-text">
          Centrale lijst van alles wat je kunt offreren (bier, producten, diensten). Producten verschijnen pas in de offerte als er een actieve kostprijs is (jaar {year}); diensten verschijnen zodra er een tarief is ingevuld.
        </div>
      </div>

      <div className="editor-toolbar">
        <div className="editor-toolbar-meta" style={{ gap: 10, display: "flex", alignItems: "center" }}>
          <span className="editor-pill">{filtered.length} artikelen</span>
          <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showOnlyMissing}
              onChange={(e) => setShowOnlyMissing(e.target.checked)}
            />
            Toon alleen ontbrekende kostprijs/tarief
          </label>
        </div>
        <div className="editor-toolbar-actions" style={{ gap: 10, display: "flex", alignItems: "center" }}>
          <input
            className="cpq-input"
            style={{ width: 320 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op naam (of ID)…"
          />

        </div>
      </div>

      <div className="dataset-editor-scroll">
        <table className="dataset-editor-table">
          <thead>
            <tr>
              <th style={{ width: 360 }}>Naam</th>
              <th style={{ width: 140 }}>Type</th>
              <th style={{ width: 140 }}>UoM</th>
              <th style={{ width: 140 }}>Inhoud (L)</th>
              <th style={{ width: 170 }}>{methodLabel("cost_plus")}</th>
              <th style={{ width: 220 }}>Status</th>
              <th style={{ width: 220 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: "1rem" }}>
                  Geen resultaten.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const status =
                  row.pricingMethod === "manual_rate"
                    ? row.manualRateEx > 0
                      ? `Tarief: ${moneyEUR(row.manualRateEx)}`
                      : "Tarief ontbreekt"
                    : row.hasActiveCost
                      ? `Actief (kostprijs: ${moneyEUR(row.kostprijsEx)})`
                      : "Nog te activeren";
                const actionHref =
                  row.pricingMethod === "cost_plus"
                    ? ({
                        pathname: "/nieuwe-kostprijsberekening",
                        query: { mode: "sku", kind: row.subtype, sku_id: row.skuId },
                      } as any)
                    : null;
                return (
                  <tr key={row.skuId}>
                    <td style={{ fontWeight: 600 }}>{row.label}</td>
                    <td>{subtypeLabel(row.subtype)}</td>
                    <td>{row.uom}</td>
                    <td>{row.contentLiter ? row.contentLiter.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                    <td>{row.pricingMethod === "cost_plus" ? moneyEUR(row.kostprijsEx) : "—"}</td>
                    <td>{status}</td>
                    <td style={{ textAlign: "right" }}>
                      {actionHref ? (
                        <Link className="cpq-button" href={actionHref}>
                          Kostprijs beheren
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
