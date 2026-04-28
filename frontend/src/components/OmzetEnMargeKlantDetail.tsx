"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { formatMoneyEUR } from "@/lib/formatters";

type UnmappedProduct = {
  douano_product_id: number;
  name: string;
  sku: string;
  gtin: string;
  lines: number;
  quantity: number;
  net_revenue_ex: number;
};

type LineRow = {
  line_id: number;
  sales_order_id: number;
  order_date: string;
  douano_product_id: number;
  douano_product_name: string;
  douano_sku: string;
  quantity: number;
  unit_price_ex: number;
  discount_ex: number;
  charges_ex: number;
  net_revenue_ex: number;
  bier_id: string;
  product_id: string;
  ignored: boolean;
  mapped: boolean;
  missing_cost: boolean;
  cost_price_ex: number | null;
  cost_total_ex: number;
  margin_ex: number;
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

function euro(value: number) {
  if (!Number.isFinite(value)) return "-";
  return formatMoneyEUR(value);
}

export function OmzetEnMargeKlantDetail({
  companyId,
  initialOnlyUnmapped = false,
  initialOnlyMissingCost = false
}: {
  companyId: number;
  initialOnlyUnmapped?: boolean;
  initialOnlyMissingCost?: boolean;
}) {
  const [since, setSince] = useState<string>("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(Boolean(initialOnlyUnmapped));
  const [onlyMissingCost, setOnlyMissingCost] = useState(Boolean(initialOnlyMissingCost));
  const [status, setStatus] = useState<string>("");
  const [tone, setTone] = useState<"" | "success" | "error">("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [unmappedProducts, setUnmappedProducts] = useState<UnmappedProduct[]>([]);

  async function load() {
    setStatus("Laden…");
    setTone("");
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", String(companyId));
      if (since.trim()) qs.set("since", since.trim());
      if (onlyUnmapped) qs.set("only_unmapped", "true");
      if (onlyMissingCost) qs.set("only_missing_cost", "true");
      qs.set("limit", "1000");
      const [linePayload, unmappedPayload] = await Promise.all([
        readJson(`/api/integrations/douano/company-lines?${qs.toString()}`),
        readJson(
          `/api/integrations/douano/company-unmapped-products?company_id=${encodeURIComponent(
            String(companyId)
          )}${since.trim() ? `&since=${encodeURIComponent(since.trim())}` : ""}`
        )
      ]);
      setLines(Array.isArray(linePayload?.items) ? linePayload.items : []);
      setUnmappedProducts(Array.isArray(unmappedPayload?.items) ? unmappedPayload.items : []);
      setStatus("Gereed");
      setTone("success");
    } catch (error) {
      setLines([]);
      setUnmappedProducts([]);
      setStatus(error instanceof Error ? error.message : String(error));
      setTone("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, row) => {
        acc.netto += Number(row.net_revenue_ex ?? 0) || 0;
        acc.kost += Number(row.cost_total_ex ?? 0) || 0;
        acc.marge += Number(row.margin_ex ?? 0) || 0;
        return acc;
      },
      { netto: 0, kost: 0, marge: 0 }
    );
  }, [lines]);

  return (
    <section>
      <div className="editor-actions" style={{ marginTop: 8 }}>
        <div className="editor-actions-group">
          <input
            className="editor-input"
            style={{ width: 180 }}
            placeholder="Sinds (YYYY-MM-DD)"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
            Alleen unmapped
          </label>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={onlyMissingCost}
              onChange={(e) => setOnlyMissingCost(e.target.checked)}
            />
            Alleen missing cost
          </label>
          <button type="button" className="editor-button editor-button-secondary" onClick={() => void load()}>
            Ververs
          </button>
        </div>
        <div className="editor-actions-group">
          <span className="pill">Netto {euro(totals.netto)}</span>
          <span className="pill">Kostprijs {euro(totals.kost)}</span>
          <span className="pill">Marge {euro(totals.marge)}</span>
        </div>
      </div>

      {status ? (
        <div className={`editor-status${tone ? ` ${tone}` : ""}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      ) : null}

      {unmappedProducts.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Top unmapped producten</div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Douano product</th>
                  <th style={{ width: 120 }}>Regels</th>
                  <th style={{ width: 160 }}>Netto omzet</th>
                  <th style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {unmappedProducts.slice(0, 20).map((p) => (
                  <tr key={p.douano_product_id}>
                    <td>
                      <strong>{p.name || String(p.douano_product_id)}</strong>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        <code>{p.sku}</code> <code>{p.gtin}</code>
                      </div>
                    </td>
                    <td>{p.lines}</td>
                    <td>{euro(p.net_revenue_ex)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/beheer/productkoppeling?q=${encodeURIComponent(p.name || String(p.douano_product_id))}`}
                        className="editor-button editor-button-secondary"
                      >
                        Koppel
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Orderregels</div>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Datum</th>
                <th>Douano product</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 140 }}>Netto</th>
                <th style={{ width: 140 }}>Kostprijs</th>
                <th style={{ width: 140 }}>Marge</th>
                <th style={{ width: 140 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.slice(0, 1000).map((row) => {
                const status = row.ignored ? "ignored" : !row.mapped ? "unmapped" : row.missing_cost ? "missing cost" : "ok";
                return (
                  <tr key={row.line_id}>
                    <td><code>{row.order_date}</code></td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{row.douano_product_name || String(row.douano_product_id)}</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        <code>{row.douano_sku}</code>{" "}
                        {row.mapped ? (
                          <code>
                            {row.bier_id}::{row.product_id}
                          </code>
                        ) : null}
                      </div>
                    </td>
                    <td>{row.quantity}</td>
                    <td>{euro(row.net_revenue_ex)}</td>
                    <td>{row.cost_price_ex === null ? "-" : euro(row.cost_total_ex)}</td>
                    <td>{row.cost_price_ex === null ? "-" : euro(row.margin_ex)}</td>
                    <td>
                      <span className="pill">{status}</span>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ opacity: 0.75 }}>
                    Geen regels gevonden.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
